// Measures what an application ships for each import scenario of bench/size/: a real bundle by esbuild and by Rollup,
// minified, then its bytes raw, gzip and brotli. Checks, for every scenario and bundler:
// - that the bundle holds code only from the packages the scenario imports and, transitively, their "dependencies"
//   (an import leak, such as a primitive that drags in the schema package, fails);
// - that both bundlers read the same files, so that the resolution the report gives Rollup is esbuild's;
// - that each figure equals the one recorded in docs/size-baseline.tsv: any byte that moves fails until `--update`
//   records it, and the commit that does explains every difference this report prints;
// - that each scenario of the library (bench/size/yaltaan/) stays within its budget of bench/size/budgets.tsv.
// Reference scenarios (bench/size/references/) measure other libraries in the same harness; they have no budget.
//
// Usage: node scripts/size-report.ts [--update]
import { stop } from 'esbuild-wasm';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import { BUNDLERS, bundleScenario, directImports, type Bundle, type BundlerName } from './lib/bundle.ts';
import { PackageIndex, splitBareSpecifier, type PackageInfo } from './lib/packages.ts';
import { describeError, repositoryRoot } from './lib/workspace.ts';

export const SCENARIO_DIR = 'bench/size';
export const BASELINE_FILE = 'docs/size-baseline.tsv';
export const BUDGET_FILE = 'bench/size/budgets.tsv';
/** Scenario folders: the library's own, which need a budget, and the reference libraries'. */
export const OWN = 'yaltaan';
export const REFERENCES = 'references';

export interface Sizes {
  readonly raw: number;
  readonly gzip: number;
  readonly brotli: number;
  /** First 16 hexadecimal digits of the SHA-256 of the minified output: a change of equal length still shows. */
  readonly sha256: string;
}

export interface SizeRow extends Sizes {
  /** `<folder>/<file name without .js>`: `references/es-toolkit-omit`. */
  readonly scenario: string;
  readonly bundler: BundlerName;
}

export interface Budget {
  readonly scenario: string;
  /** Most bytes, minified and brotli-compressed, under every bundler. */
  readonly brotli: number;
  /** The reference scenario the budget was calibrated against, or `hypothesis`. */
  readonly basis: string;
}

export interface SizeReport {
  readonly rows: readonly SizeRow[];
  readonly problems: readonly string[];
  /** Differences with the recorded baseline, one line each, ready for a commit message. */
  readonly changes: readonly string[];
  /** Budgets whose scenario does not exist yet. */
  readonly awaiting: readonly string[];
  /** Whether `--update` wrote the baseline: only when it differed and nothing else failed. */
  readonly written: boolean;
}

/** Gzip at its highest level, brotli at its highest quality with the input length as size hint: fixed settings. */
export function measure(code: string): Sizes {
  const bytes = Buffer.from(code, 'utf8');
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: constants.Z_BEST_COMPRESSION }).length,
    brotli: brotliCompressSync(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
      },
    }).length,
    sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
  };
}

/** The scenarios under `root`: one `.js` entry file each, in `references/` or `yaltaan/`, sorted by name. */
export function listScenarios(root: string): { name: string; file: string }[] {
  const scenarios: { name: string; file: string }[] = [];
  for (const folder of [OWN, REFERENCES]) {
    const dir = path.join(root, SCENARIO_DIR, folder);
    if (!existsSync(dir)) {
      continue;
    }
    for (const entry of readdirSync(dir).sort()) {
      if (entry.endsWith('.js')) {
        scenarios.push({ name: `${folder}/${entry.slice(0, -'.js'.length)}`, file: path.join(dir, entry) });
      }
    }
  }
  return scenarios.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const BASELINE_HEADER = [
  '# Bytes of each import scenario of bench/size/, bundled and minified by each bundler, then compressed by node:zlib',
  '# (gzip level 9, brotli quality 11). Written by `node scripts/size-report.ts --update`, never by hand: the gate',
  '# fails on any difference, and the commit that records one explains it.',
  'scenario\tbundler\traw\tgzip\tbrotli\tsha256',
];

export function formatBaseline(rows: readonly SizeRow[]): string {
  const lines = rows.map((r) => [r.scenario, r.bundler, r.raw, r.gzip, r.brotli, r.sha256].join('\t'));
  return `${[...BASELINE_HEADER, ...lines].join('\n')}\n`;
}

/** The rows of a baseline file, keyed `<scenario> <bundler>`; lines that are not rows are ignored. */
export function parseBaseline(text: string): Map<string, SizeRow> {
  const rows = new Map<string, SizeRow>();
  for (const line of text.split('\n')) {
    const [scenario, bundler, raw, gzip, brotli, sha256, ...rest] = line.split('\t');
    if (scenario === undefined || scenario.startsWith('#') || scenario === 'scenario' || rest.length > 0) {
      continue;
    }
    if ((bundler === 'esbuild' || bundler === 'rollup') && sha256 !== undefined) {
      rows.set(`${scenario} ${bundler}`, {
        scenario,
        bundler,
        raw: Number(raw),
        gzip: Number(gzip),
        brotli: Number(brotli),
        sha256,
      });
    }
  }
  return rows;
}

type SizeField = 'raw' | 'gzip' | 'brotli';
const SIZE_FIELDS: readonly SizeField[] = ['raw', 'gzip', 'brotli'];

/** One line per row added, removed or changed between two baselines, with the change of each size. */
export function describeChanges(before: ReadonlyMap<string, SizeRow>, after: readonly SizeRow[]): string[] {
  const changes: string[] = [];
  const seen = new Set<string>();
  const sizes = (row: Sizes): string => `raw ${row.raw}, gzip ${row.gzip}, brotli ${row.brotli}`;
  for (const row of after) {
    const key = `${row.scenario} ${row.bundler}`;
    seen.add(key);
    const old = before.get(key);
    if (old === undefined) {
      changes.push(`${key}: new, ${sizes(row)}`);
    } else if (SIZE_FIELDS.some((field) => old[field] !== row[field])) {
      const delta = (field: SizeField): string => {
        const difference = row[field] - old[field];
        return `${field} ${old[field]} -> ${row[field]} (${difference >= 0 ? '+' : ''}${difference})`;
      };
      changes.push(`${key}: ${SIZE_FIELDS.map(delta).join(', ')}`);
    } else if (old.sha256 !== row.sha256) {
      changes.push(`${key}: same sizes, other bytes`);
    }
  }
  for (const key of before.keys()) {
    if (!seen.has(key)) {
      changes.push(`${key}: removed`);
    }
  }
  return changes;
}

/** Parses the budget file: a `scenario  brotli  basis` header, then one row per scenario of the library. */
export function parseBudgets(text: string): { budgets: Map<string, Budget>; problems: string[] } {
  const budgets = new Map<string, Budget>();
  const problems: string[] = [];
  let header = false;
  text.split('\n').forEach((line, index) => {
    const where = `${BUDGET_FILE}:${index + 1}`;
    if (line === '' || line.startsWith('#')) {
      return;
    }
    if (!header) {
      header = true;
      if (line !== 'scenario\tbrotli\tbasis') {
        problems.push(`${where}: the header must be "scenario<TAB>brotli<TAB>basis"`);
      }
      return;
    }
    const [scenario = '', brotli = '', basis = '', ...rest] = line.split('\t');
    if (!new RegExp(`^${OWN}/[a-z0-9]+(-[a-z0-9]+)*$`).test(scenario) || rest.length > 0) {
      problems.push(`${where}: a row is "${OWN}/<scenario><TAB><bytes><TAB><basis>", not ${JSON.stringify(line)}`);
    } else if (!/^[1-9][0-9]*$/.test(brotli)) {
      problems.push(
        `${where}: the budget of ${scenario} must be a whole number of bytes, not ${JSON.stringify(brotli)}`,
      );
    } else if (basis !== 'hypothesis' && !basis.startsWith(`${REFERENCES}/`)) {
      problems.push(`${where}: the basis of ${scenario} is a ${REFERENCES}/ scenario or "hypothesis"`);
    } else if (budgets.has(scenario)) {
      problems.push(`${where}: ${scenario} already has a budget`);
    } else {
      budgets.set(scenario, { scenario, brotli: Number(brotli), basis });
    }
  });
  if (!header) {
    problems.push(`${BUDGET_FILE}: no header row`);
  }
  return { budgets, problems };
}

/** Problems of the budgets against the measured rows and the existing scenarios, and the budgets still waiting. */
export function checkBudgets(
  budgets: ReadonlyMap<string, Budget>,
  scenarios: readonly string[],
  rows: readonly SizeRow[],
): { problems: string[]; awaiting: string[] } {
  const problems: string[] = [];
  const awaiting: string[] = [];
  for (const budget of budgets.values()) {
    if (budget.basis !== 'hypothesis' && !scenarios.includes(budget.basis)) {
      problems.push(`${BUDGET_FILE}: ${budget.scenario} is calibrated against ${budget.basis}, which is no scenario`);
    }
    if (!scenarios.includes(budget.scenario)) {
      awaiting.push(budget.scenario);
    }
  }
  for (const scenario of scenarios.filter((name) => name.startsWith(`${OWN}/`))) {
    const budget = budgets.get(scenario);
    if (budget === undefined) {
      problems.push(`${scenario} has no budget: add its row to ${BUDGET_FILE}, as a decision record sets it`);
      continue;
    }
    for (const row of rows.filter((r) => r.scenario === scenario && r.brotli > budget.brotli)) {
      problems.push(
        `${scenario} weighs ${row.brotli} B brotli with ${row.bundler}, over its budget of ${budget.brotli} B: ` +
          'shrink it, or raise the budget by a decision record that gives the measurement',
      );
    }
  }
  return { problems, awaiting };
}

/** Packages that put code into `bundle` though the scenario neither imports them nor depends on them. */
export function findLeaks(
  bundle: Bundle,
  root: string,
  entry: string,
  allowed: ReadonlySet<string>,
  packages: PackageIndex,
): string[] {
  const leaks: string[] = [];
  for (const module of bundle.modules) {
    const file = path.resolve(root, module);
    if (file === entry) {
      continue;
    }
    const owner = packages.ownerOf(file)?.name ?? 'no package';
    if (!allowed.has(owner)) {
      leaks.push(`${module} (${owner})`);
    }
  }
  return leaks;
}

/** Files one bundler put into its output that the other never read: the two did not resolve the same imports. */
export function findResolutionGaps(bundles: readonly Bundle[]): string[] {
  const gaps: string[] = [];
  for (const bundle of bundles) {
    for (const other of bundles.filter((candidate) => candidate !== bundle)) {
      const missing = bundle.modules.filter((module) => !other.loaded.includes(module));
      if (missing.length > 0) {
        gaps.push(`${bundle.bundler} bundles ${missing.join(', ')}, which ${other.bundler} never read`);
      }
    }
  }
  return gaps;
}

async function measureScenario(
  root: string,
  scenario: { name: string; file: string },
  packages: PackageIndex,
): Promise<{ rows: SizeRow[]; problems: string[] }> {
  const fail = (problem: string): { rows: SizeRow[]; problems: string[] } => ({
    rows: [],
    problems: [`${scenario.name}: ${problem}`],
  });
  try {
    const subjects: PackageInfo[] = [];
    for (const specifier of await directImports(root, scenario.file)) {
      const name = splitBareSpecifier(specifier)?.name;
      if (name === undefined) {
        return fail(`imports ${specifier}, which is not a package`);
      }
      subjects.push(packages.find(name, path.dirname(scenario.file)));
    }
    const { allowed, peers } = packages.closure(subjects);
    const bundles = await bundleScenario({ root, entry: scenario.file, external: peers, packages });
    const problems: string[] = [];
    for (const bundle of bundles) {
      const leaks = findLeaks(bundle, root, scenario.file, allowed, packages);
      if (leaks.length > 0) {
        problems.push(
          `${scenario.name}: import leak under ${bundle.bundler}: ${leaks.join(', ')}; ` +
            `the scenario may only pull in ${[...allowed].sort().join(', ')}`,
        );
      }
    }
    problems.push(...findResolutionGaps(bundles).map((gap) => `${scenario.name}: ${gap}`));
    return {
      rows: bundles.map((bundle) => ({ scenario: scenario.name, bundler: bundle.bundler, ...measure(bundle.code) })),
      problems,
    };
  } catch (error) {
    return fail(describeError(error));
  }
}

/** Measures every scenario under `root` and judges it; with `update`, writes the baseline instead of comparing. */
export async function runSizeReport(root: string, options: { readonly update?: boolean } = {}): Promise<SizeReport> {
  const scenarios = listScenarios(root);
  const packages = new PackageIndex();
  // One scenario at a time, as bundleScenario requires.
  const measured: { rows: SizeRow[]; problems: string[] }[] = [];
  for (const scenario of scenarios) {
    measured.push(await measureScenario(root, scenario, packages));
  }
  const rows = measured.flatMap((result) => result.rows);
  const problems = measured.flatMap((result) => result.problems);
  if (scenarios.length === 0) {
    problems.push(`no scenario under ${SCENARIO_DIR}/${OWN}/ or ${SCENARIO_DIR}/${REFERENCES}/`);
  }

  const budgetPath = path.join(root, BUDGET_FILE);
  const parsed = existsSync(budgetPath)
    ? parseBudgets(readFileSync(budgetPath, 'utf8'))
    : { budgets: new Map<string, Budget>(), problems: [`${BUDGET_FILE} is missing`] };
  const budgetCheck = checkBudgets(
    parsed.budgets,
    scenarios.map((scenario) => scenario.name),
    rows,
  );
  problems.push(...parsed.problems, ...budgetCheck.problems);

  const baselinePath = path.join(root, BASELINE_FILE);
  const recorded = existsSync(baselinePath) ? readFileSync(baselinePath, 'utf8') : '';
  const actual = formatBaseline(rows);
  const changes = describeChanges(parseBaseline(recorded), rows);
  let written = false;
  if (actual !== recorded) {
    if (options.update === true && problems.length === 0) {
      mkdirSync(path.dirname(baselinePath), { recursive: true });
      writeFileSync(baselinePath, actual);
      written = true;
    } else if (options.update !== true) {
      problems.push(
        `${BASELINE_FILE} differs from this measurement${changes.length === 0 ? ' (outside its rows)' : ''}: ` +
          'run node scripts/size-report.ts --update, then explain each change in the commit message',
      );
    }
  }
  return { rows, problems, changes, awaiting: budgetCheck.awaiting, written };
}

function printRows(rows: readonly SizeRow[]): void {
  const width = Math.max('scenario'.length, ...rows.map((row) => row.scenario.length));
  console.log(`${'scenario'.padEnd(width)}  bundler        raw     gzip   brotli`);
  for (const row of rows) {
    const sizes = [row.raw, row.gzip, row.brotli].map((size) => String(size).padStart(8)).join(' ');
    console.log(`${row.scenario.padEnd(width)}  ${row.bundler.padEnd(8)} ${sizes}`);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--update')) {
    console.error('usage: node scripts/size-report.ts [--update]');
    process.exit(2);
  }
  const update = args[0] === '--update';
  try {
    const result = await runSizeReport(repositoryRoot, { update });
    printRows(result.rows);
    if (result.awaiting.length > 0) {
      console.log(`${result.awaiting.length} budget(s) await their scenario: ${result.awaiting.join(', ')}.`);
    }
    if (result.changes.length > 0) {
      console.log(`${result.written ? 'Recorded in' : 'Differences with'} ${BASELINE_FILE}:`);
      console.log(result.changes.map((change) => `  ${change}`).join('\n'));
      console.log(`node ${process.versions.node}, zlib ${process.versions.zlib}, brotli ${process.versions['brotli']}`);
    }
    for (const problem of result.problems) {
      console.error(`error: ${problem}`);
    }
    if (result.problems.length > 0) {
      console.error(`${result.problems.length} problem(s) found.`);
      process.exitCode = 1;
    } else {
      console.log(`ok: ${result.rows.length} bundles of ${result.rows.length / BUNDLERS.length} scenarios measured.`);
    }
  } finally {
    await stop();
  }
}
