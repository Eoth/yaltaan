// Measures what the library's public types cost the type check of an application, through `--extendedDiagnostics`,
// under TypeScript 7 (`tsc`) and 6.0 (`tsc6`), with and without `exactOptionalPropertyTypes`. Checks:
// - that the reference project (scripts/lib/type-project.ts) and every usage fixture check with no error;
// - that each instantiation count equals the one recorded in docs/type-cost-baseline.tsv: counts are deterministic,
//   so any count that moves fails until `--update` records it, and the commit that does explains the difference;
// - that each usage of bench/types/usages/ adds at most its ceiling of bench/types/ceilings.tsv to a fixture of
//   FIXTURE_FILES files, under each compiler (the two compilers count differently);
// - that the reference project with every usage checks at most TIME_BUDGET slower than without, under TypeScript 7,
//   on the medians of TIMED_PASSES interleaved passes. A difference within the spread of the passes without the
//   usages is noise, never a verdict: one pass varies by more than the budget on a loaded machine.
// Check time under 6.0 and memory are printed, not judged. Projects are written under node_modules/.cache/, where
// module resolution finds the workspace packages, and removed afterwards.
//
// Usage: node scripts/type-cost.ts [--update]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { generateProject, type Usage } from './lib/type-project.ts';
import { describeError, repositoryRoot } from './lib/workspace.ts';

export const MODEL_FILE = 'bench/types/model.ts';
export const USAGE_DIR = 'bench/types/usages';
export const CEILING_FILE = 'bench/types/ceilings.tsv';
export const BASELINE_FILE = 'docs/type-cost-baseline.tsv';
export const WORK_DIR = 'node_modules/.cache/yaltaan-type-cost';
export const REFERENCE_FILES = 2000;
export const FIXTURE_FILES = 10;
export const TIMED_PASSES = 5;
export const TIME_BUDGET = 0.1;

export const COMPILERS = ['ts7', 'ts6'] as const;
export type CompilerName = (typeof COMPILERS)[number];
export const OPTION_SETS = ['exact', 'loose'] as const;
export type OptionSet = (typeof OPTION_SETS)[number];

export interface Compiler {
  readonly name: CompilerName;
  readonly version: string;
  /** The JavaScript file of the command, run by the Node that runs this script. */
  readonly bin: string;
}

export interface Diagnostics {
  readonly instantiations: number;
  /** Seconds. */
  readonly checkTime: number;
  /** Kilobytes. */
  readonly memory: number;
}

export interface CountRow {
  /** `reference`, `reference+usages`, `fixture` or `usage/<name>`. */
  readonly subject: string;
  readonly compiler: CompilerName;
  readonly options: OptionSet;
  readonly instantiations: number;
}

export interface TimeVerdict {
  readonly without: { readonly median: number; readonly min: number; readonly max: number };
  readonly with: { readonly median: number; readonly min: number; readonly max: number };
  /** Relative difference of the medians: 0.05 is 5 % slower with the usages. */
  readonly ratio: number;
  readonly ok: boolean;
}

export interface TypeCostReport {
  readonly rows: readonly CountRow[];
  readonly time: TimeVerdict | undefined;
  /** One line per measurement, for the log. */
  readonly lines: readonly string[];
  readonly problems: readonly string[];
  readonly changes: readonly string[];
  /** Ceilings whose usage does not exist yet. */
  readonly awaiting: readonly string[];
  readonly written: boolean;
}

/** The two compilers, found from this script's own dependencies (a fixture root has none). */
export function findCompilers(): Compiler[] {
  const require = createRequire(import.meta.url);
  const ts7 = path.dirname(require.resolve('typescript/package.json'));
  const wrapper = path.dirname(require.resolve('@typescript/typescript6/package.json'));
  // The wrapper's version is its own; the compiler's is that of the aliased package it loads.
  const ts6 = path.dirname(createRequire(path.join(wrapper, 'package.json')).resolve('@typescript/old/package.json'));
  const version = (dir: string): string =>
    String(JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version);
  return [
    { name: 'ts7', version: version(ts7), bin: path.join(ts7, 'bin', 'tsc') },
    { name: 'ts6', version: version(ts6), bin: path.join(wrapper, 'bin', 'tsc6') },
  ];
}

/** The three figures of an `--extendedDiagnostics` output, or `undefined` if one is missing. */
export function parseDiagnostics(output: string): Diagnostics | undefined {
  const read = (label: string, unit: string): number | undefined => {
    const match = new RegExp(`^${label}:\\s+([0-9.]+)${unit}\\s*$`, 'm').exec(output);
    return match?.[1] === undefined ? undefined : Number(match[1]);
  };
  const instantiations = read('Instantiations', '');
  const checkTime = read('Check time', 's');
  const memory = read('Memory used', 'K');
  if (instantiations === undefined || checkTime === undefined || memory === undefined) {
    return undefined;
  }
  return { instantiations, checkTime, memory };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Judges check times of passes without and with the usages: slower by more than `budget` on the medians, and by more
 * than the spread of the passes without, fails.
 */
export function judgeCheckTime(
  without: readonly number[],
  withUsages: readonly number[],
  budget: number = TIME_BUDGET,
): TimeVerdict {
  const summary = (values: readonly number[]): TimeVerdict['without'] => ({
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
  });
  const a = summary(without);
  const b = summary(withUsages);
  const ratio = a.median === 0 ? 0 : b.median / a.median - 1;
  const ok = !(ratio > budget && b.median - a.median > a.max - a.min);
  return { without: a, with: b, ratio, ok };
}

const BASELINE_HEADER = [
  '# Instantiations of the type-check of each subject of scripts/type-cost.ts, under each compiler and option set',
  '# (exact: exactOptionalPropertyTypes on). Written by `node scripts/type-cost.ts --update`, never by hand: the gate',
  '# fails on any difference, and the commit that records one explains it.',
  'subject\tcompiler\toptions\tinstantiations',
];

export function formatBaseline(rows: readonly CountRow[]): string {
  const lines = rows.map((row) => [row.subject, row.compiler, row.options, row.instantiations].join('\t'));
  return `${[...BASELINE_HEADER, ...lines].join('\n')}\n`;
}

/** Recorded counts keyed `<subject> <compiler> <options>`; lines that are not rows are ignored. */
export function parseBaseline(text: string): Map<string, number> {
  const rows = new Map<string, number>();
  for (const line of text.split('\n')) {
    const [subject, compiler, options, count, ...rest] = line.split('\t');
    if (subject === undefined || subject.startsWith('#') || subject === 'subject' || rest.length > 0) {
      continue;
    }
    if (count !== undefined && /^[0-9]+$/.test(count)) {
      rows.set(`${subject} ${compiler} ${options}`, Number(count));
    }
  }
  return rows;
}

export function describeChanges(recorded: ReadonlyMap<string, number>, rows: readonly CountRow[]): string[] {
  const changes: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.subject} ${row.compiler} ${row.options}`;
    seen.add(key);
    const before = recorded.get(key);
    if (before === undefined) {
      changes.push(`${key}: new, ${row.instantiations} instantiations`);
    } else if (before !== row.instantiations) {
      const delta = row.instantiations - before;
      changes.push(`${key}: ${before} -> ${row.instantiations} (${delta > 0 ? '+' : ''}${delta})`);
    }
  }
  for (const key of recorded.keys()) {
    if (!seen.has(key)) {
      changes.push(`${key}: removed`);
    }
  }
  return changes;
}

/** Ceilings keyed `<usage> <compiler>`, and the problems of the file. */
export function parseCeilings(text: string): { ceilings: Map<string, number>; problems: string[] } {
  const ceilings = new Map<string, number>();
  const problems: string[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (line === '' || line.startsWith('#') || line === 'usage\tcompiler\tinstantiations\tbasis') {
      continue;
    }
    const [usage, compiler, count, basis, ...rest] = line.split('\t');
    const where = `${CEILING_FILE}:${index + 1}`;
    if (
      usage === undefined ||
      !COMPILERS.some((name) => name === compiler) ||
      count === undefined ||
      !/^[1-9][0-9]*$/.test(count) ||
      basis === undefined ||
      basis === '' ||
      rest.length > 0
    ) {
      problems.push(`${where}: expected "<usage>\\t<${COMPILERS.join('|')}>\\t<instantiations>\\t<basis>"`);
      continue;
    }
    const key = `${usage} ${compiler}`;
    if (ceilings.has(key)) {
      problems.push(`${where}: a second ceiling for ${key}`);
    }
    ceilings.set(key, Number(count));
  }
  return { ceilings, problems };
}

/** Problems of the usage counts against their ceilings, and the ceilings that await their usage. */
export function checkCeilings(
  ceilings: ReadonlyMap<string, number>,
  usages: readonly string[],
  rows: readonly CountRow[],
): { problems: string[]; awaiting: string[] } {
  const problems: string[] = [];
  const count = (subject: string, compiler: CompilerName, options: OptionSet): number | undefined =>
    rows.find((row) => row.subject === subject && row.compiler === compiler && row.options === options)?.instantiations;
  for (const usage of usages) {
    for (const compiler of COMPILERS) {
      const ceiling = ceilings.get(`${usage} ${compiler}`);
      if (ceiling === undefined) {
        problems.push(`usage ${usage} has no ceiling under ${compiler} in ${CEILING_FILE}`);
        continue;
      }
      for (const options of OPTION_SETS) {
        const used = count(`usage/${usage}`, compiler, options);
        const base = count('fixture', compiler, options);
        if (used !== undefined && base !== undefined && used - base > ceiling) {
          problems.push(
            `usage ${usage} adds ${used - base} instantiations under ${compiler} (${options}), over its ceiling of ` +
              `${ceiling}`,
          );
        }
      }
    }
  }
  const awaiting = [...ceilings.keys()]
    .map((key) => key.slice(0, key.lastIndexOf(' ')))
    .filter((usage, index, all) => !usages.includes(usage) && all.indexOf(usage) === index);
  return { problems, awaiting };
}

function readUsages(root: string): Usage[] {
  const dir = path.join(root, USAGE_DIR);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.ts'))
    .sort()
    .map((entry) => ({ name: entry.slice(0, -'.ts'.length), source: readFileSync(path.join(dir, entry), 'utf8') }));
}

function writeProject(dir: string, files: ReadonlyMap<string, string>): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of files) {
    writeFileSync(path.join(dir, name), text);
  }
  for (const options of OPTION_SETS) {
    // The settings of a strict application. skipLibCheck as most applications set it: the library's own declarations
    // are checked by its build.
    const compilerOptions = {
      target: 'es2023',
      lib: ['es2023'],
      module: 'nodenext',
      strict: true,
      exactOptionalPropertyTypes: options === 'exact',
      noEmit: true,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
      types: [],
    };
    writeFileSync(path.join(dir, `tsconfig.${options}.json`), JSON.stringify({ compilerOptions, include: ['*.ts'] }));
  }
}

function check(compiler: Compiler, dir: string, options: OptionSet): Diagnostics | string {
  const config = path.join(dir, `tsconfig.${options}.json`);
  const result = spawnSync(process.execPath, [compiler.bin, '-p', config, '--extendedDiagnostics'], {
    cwd: dir,
    encoding: 'utf8',
  });
  const output = `${result.stdout}${result.stderr}`;
  const diagnostics = parseDiagnostics(output);
  if (result.status !== 0 || diagnostics === undefined) {
    const errors = output.split('\n').filter((line) => line.includes('error TS'));
    const shown = errors.length > 0 ? errors.slice(0, 3) : output.trim().split('\n').slice(0, 3);
    return `the compiler exited with ${result.status}: ${shown.join(' | ')}`;
  }
  return diagnostics;
}

export interface TypeCostOptions {
  readonly update?: boolean;
  readonly referenceFiles?: number;
  readonly fixtureFiles?: number;
  readonly passes?: number;
  /** The compilers to run, all by default; the tests run TypeScript 7 alone where the compiler does not matter. */
  readonly compilers?: readonly CompilerName[];
}

/** Measures every subject under `root` and judges it; with `update`, writes the baseline instead of comparing. */
export function runTypeCost(root: string, options: TypeCostOptions = {}): TypeCostReport {
  const problems: string[] = [];
  const lines: string[] = [];
  const rows: CountRow[] = [];
  const work = path.join(root, WORK_DIR);
  let time: TimeVerdict | undefined;
  try {
    const compilers = findCompilers().filter((compiler) => options.compilers?.includes(compiler.name) ?? true);
    const model = readFileSync(path.join(root, MODEL_FILE), 'utf8');
    const usages = readUsages(root);
    const referenceFiles = options.referenceFiles ?? REFERENCE_FILES;
    const fixtureFiles = options.fixtureFiles ?? FIXTURE_FILES;
    const subjects = new Map<string, ReadonlyMap<string, string>>([
      ['reference', generateProject(referenceFiles, model, [])],
    ]);
    if (usages.length > 0) {
      subjects.set('reference+usages', generateProject(referenceFiles, model, usages));
      subjects.set('fixture', generateProject(fixtureFiles, model, []));
      for (const usage of usages) {
        subjects.set(`usage/${usage.name}`, generateProject(fixtureFiles, model, [usage]));
      }
    }
    const dirs = new Map<string, string>();
    for (const [subject, files] of subjects) {
      const dir = path.join(work, subject.replace('/', '-'));
      writeProject(dir, files);
      dirs.set(subject, dir);
    }

    for (const compiler of compilers) {
      for (const optionSet of OPTION_SETS) {
        for (const [subject, dir] of dirs) {
          const measured = check(compiler, dir, optionSet);
          if (typeof measured === 'string') {
            problems.push(`${subject} under ${compiler.name} ${compiler.version} (${optionSet}): ${measured}`);
            continue;
          }
          rows.push({ subject, compiler: compiler.name, options: optionSet, instantiations: measured.instantiations });
          lines.push(
            [
              subject.padEnd(24),
              compiler.name,
              optionSet.padEnd(5),
              `${String(measured.instantiations).padStart(10)} instantiations`,
              ` check ${measured.checkTime.toFixed(3)} s`,
              ` memory ${Math.round(measured.memory / 1024)} MB`,
            ].join(' '),
          );
        }
      }
    }

    const ts7 = compilers.find((compiler) => compiler.name === 'ts7');
    const withDir = dirs.get('reference+usages');
    const withoutDir = dirs.get('reference');
    if (ts7 !== undefined && withDir !== undefined && withoutDir !== undefined) {
      const times = { without: [] as number[], with: [] as number[] };
      const counts = { without: new Set<number>(), with: new Set<number>() };
      for (let pass = 0; pass < (options.passes ?? TIMED_PASSES); pass += 1) {
        for (const [side, dir] of [
          ['without', withoutDir],
          ['with', withDir],
        ] as const) {
          const measured = check(ts7, dir, 'exact');
          if (typeof measured !== 'string') {
            times[side].push(measured.checkTime);
            counts[side].add(measured.instantiations);
          }
        }
      }
      if (counts.without.size > 1 || counts.with.size > 1) {
        problems.push(`instantiation counts varied between timed passes: ${[...counts.without, ...counts.with]}`);
      }
      if (times.without.length > 0 && times.with.length > 0) {
        time = judgeCheckTime(times.without, times.with);
        if (!time.ok) {
          problems.push(
            `with every usage the reference project checks ${(time.ratio * 100).toFixed(1)} % slower under ts7 ` +
              `(median ${time.with.median} s against ${time.without.median} s), over the budget of ` +
              `${TIME_BUDGET * 100} %`,
          );
        }
      }
    }

    const ceilingPath = path.join(root, CEILING_FILE);
    const parsed = existsSync(ceilingPath)
      ? parseCeilings(readFileSync(ceilingPath, 'utf8'))
      : { ceilings: new Map<string, number>(), problems: [`${CEILING_FILE} is missing`] };
    const ceilingCheck = checkCeilings(
      parsed.ceilings,
      usages.map((usage) => usage.name),
      rows,
    );
    problems.push(...parsed.problems, ...ceilingCheck.problems);

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
          `${BASELINE_FILE} differs from this measurement: run node scripts/type-cost.ts --update, then explain each ` +
            'change in the commit message',
        );
      }
    }
    lines.push(`compilers: ${compilers.map((compiler) => `${compiler.name} ${compiler.version}`).join(', ')}`);
    return { rows, time, lines, problems, changes, awaiting: ceilingCheck.awaiting, written };
  } catch (error) {
    problems.push(describeError(error));
    return { rows, time, lines, problems, changes: [], awaiting: [], written: false };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--update')) {
    console.error('usage: node scripts/type-cost.ts [--update]');
    process.exit(2);
  }
  const result = runTypeCost(repositoryRoot, { update: args[0] === '--update' });
  console.log(result.lines.join('\n'));
  if (result.time !== undefined) {
    const { without, with: withUsages, ratio } = result.time;
    console.log(
      `check time under ts7, ${TIMED_PASSES} passes: without usages ${without.median} s ` +
        `(${without.min}-${without.max}), ` +
        `with ${withUsages.median} s (${withUsages.min}-${withUsages.max}), ${(ratio * 100).toFixed(1)} %`,
    );
  } else {
    console.log('check time not judged: no usage of a public type yet, the project with usages is the one without');
  }
  if (result.awaiting.length > 0) {
    console.log(`${result.awaiting.length} ceiling(s) await their usage: ${result.awaiting.join(', ')}.`);
  }
  if (result.changes.length > 0) {
    console.log(`${result.written ? 'Recorded in' : 'Differences with'} ${BASELINE_FILE}:`);
    console.log(result.changes.map((change) => `  ${change}`).join('\n'));
  }
  for (const problem of result.problems) {
    console.error(`error: ${problem}`);
  }
  if (result.problems.length > 0) {
    console.error(`${result.problems.length} problem(s) found.`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${result.rows.length} type check(s) counted.`);
  }
}
