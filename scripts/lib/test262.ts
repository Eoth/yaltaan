// Runs the Temporal tests of test262 on one implementation of Temporal, each test in a realm of its own, as
// INTERPRETING.md of test262 asks: assert.js, sta.js, the includes of the test's front matter, then the test. What
// comes out is a table of the tests that did not pass, with their error, so that a run can be compared to the table
// recorded in the repository: test262 is the judge, the table says what each implementation is known to do.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export type Implementation = 'native' | 'polyfill' | 'polyfill-full';

export interface Metadata {
  readonly includes: readonly string[];
  readonly flags: readonly string[];
  readonly negative: boolean;
}

export interface Outcome {
  /** The path under `test/`, without the extension. */
  readonly test: string;
  /** Empty when the test passed. */
  readonly error: string;
}

/** What a run needs that does not depend on the test: the sources of the harness, compiled once for all realms. */
export interface Setup {
  readonly root: string;
  /** The file that installs the polyfill in a realm; without it, the realm's own Temporal is under test. */
  readonly polyfill?: string;
  /** Tests run in strict mode unless they forbid it; this runs them in sloppy mode unless they forbid that. */
  readonly sloppy?: boolean;
  /** One test made false before it runs: the witness that a false test does come out as not passed. */
  readonly falsify?: string;
}

const FRONT_MATTER = /\/\*---\n([\s\S]*?)\n---\*\//;
const TIMEOUT_MS = 60_000;

function listIn(frontMatter: string, key: string): string[] {
  const inline = new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, 'm').exec(frontMatter);
  if (inline !== null) {
    return (inline[1] ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');
  }
  const block = new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s+.*\\n?)+)`, 'm').exec(frontMatter);
  if (block !== null) {
    return (block[1] ?? '')
      .split('\n')
      .map((line) => line.replace(/^\s+-\s+/, '').trim())
      .filter((item) => item !== '');
  }
  return [];
}

export function readMetadata(source: string): Metadata {
  const frontMatter = FRONT_MATTER.exec(source)?.[1] ?? '';
  return {
    includes: listIn(frontMatter, 'includes'),
    flags: listIn(frontMatter, 'flags'),
    negative: /^negative:/m.test(frontMatter),
  };
}

/** Every test file under `test/`, sorted, the fixtures of test262 left out as its harness does. */
export function listTests(root: string, directories: readonly string[]): string[] {
  const tests: string[] = [];
  for (const directory of directories) {
    const base = path.join(root, 'test', directory);
    for (const entry of fs.readdirSync(base, { recursive: true, encoding: 'utf8' })) {
      if (entry.endsWith('.js') && !entry.endsWith('_FIXTURE.js')) {
        tests.push(`${directory}/${entry.replaceAll(path.sep, '/').slice(0, -'.js'.length)}`);
      }
    }
  }
  return tests.sort();
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trim();
}

function describeError(error: unknown): string {
  // A value thrown by another realm is not an instance of this realm's Error, and Test262Error has no `name`: read
  // it by its shape.
  if (typeof error === 'object' && error !== null) {
    const { constructor, message } = error as { constructor?: { name?: unknown }; message?: unknown };
    if (typeof message === 'string') {
      return firstLine(`${String(constructor?.name)}: ${message}`);
    }
  }
  return firstLine(`thrown: ${String(error)}`);
}

export class Runner {
  private readonly setup: Setup;
  private readonly scripts = new Map<string, vm.Script>();
  private readonly polyfill: vm.Script | undefined;

  constructor(setup: Setup) {
    this.setup = setup;
    this.polyfill =
      setup.polyfill === undefined
        ? undefined
        : new vm.Script(fs.readFileSync(setup.polyfill, 'utf8'), { filename: 'temporal-polyfill' });
  }

  private harness(name: string): vm.Script {
    let script = this.scripts.get(name);
    if (script === undefined) {
      const filename = path.join(this.setup.root, 'harness', name);
      script = new vm.Script(fs.readFileSync(filename, 'utf8'), { filename });
      this.scripts.set(name, script);
    }
    return script;
  }

  private realm(): vm.Context {
    const context = vm.createContext({});
    const host = {
      global: vm.runInContext('globalThis', context),
      createRealm: () => {
        const realm = this.realm();
        return vm.runInContext('$262', realm);
      },
      evalScript: (code: string) => new vm.Script(code).runInContext(context),
      detachArrayBuffer: (buffer: ArrayBuffer) => {
        structuredClone(buffer, { transfer: [buffer] });
        return null;
      },
    };
    Object.defineProperty(context, '$262', { value: host, configurable: true, writable: true });
    if (this.polyfill !== undefined) {
      // Under a Node that ships Temporal, the polyfill must be the one under test.
      vm.runInContext('delete globalThis.Temporal; delete Date.prototype.toTemporalInstant;', context);
      this.polyfill.runInContext(context);
    }
    this.harness('assert.js').runInContext(context);
    this.harness('sta.js').runInContext(context);
    return context;
  }

  /** Runs one test, in one mode; an error of the runner itself is an outcome too, never a pass. */
  run(test: string): Outcome {
    const filename = path.join(this.setup.root, 'test', `${test}.js`);
    const read = fs.readFileSync(filename, 'utf8');
    const source = test === this.setup.falsify ? `${read}\nassert.sameValue(0, 1, 'made false on purpose');\n` : read;
    const metadata = readMetadata(source);
    const unsupported = metadata.flags.find((flag) => flag === 'async' || flag === 'module' || flag === 'raw');
    if (unsupported !== undefined || metadata.negative) {
      return { test, error: `runner: ${unsupported ?? 'negative'} test not supported` };
    }
    try {
      const context = this.realm();
      for (const include of metadata.includes) {
        this.harness(include).runInContext(context);
      }
      const sloppy =
        (this.setup.sloppy === true && !metadata.flags.includes('onlyStrict')) || metadata.flags.includes('noStrict');
      const prefix = sloppy ? '' : '"use strict";\n';
      new vm.Script(prefix + source, { filename }).runInContext(context, { timeout: TIMEOUT_MS });
      return { test, error: '' };
    } catch (error) {
      return { test, error: describeError(error) };
    }
  }
}

const COLUMNS = 120;
/** The default entry of the polyfill has no calendar but ISO and Gregorian: these failures say only that. */
const UNKNOWN_CALENDAR = /^RangeError: Unknown calendar ([a-z0-9-]+);/;

/** One row of the table: a line of the repository's text format, cut if needed, the same at each run. */
export function formatRow(outcome: Outcome): string {
  const row = `${outcome.test}\t${outcome.error}`.replaceAll(/[^\x20-\x7e\t]/g, '?').trimEnd();
  return row.length > COLUMNS ? row.slice(0, COLUMNS).trimEnd() : row;
}

export interface Header {
  readonly commit: string;
  readonly runtime: string;
  readonly implementation: string;
}

export function formatTable(header: Header, outcomes: readonly Outcome[]): string {
  const failed = outcomes.filter((outcome) => outcome.error !== '');
  const calendars = new Map<string, number>();
  const rows: string[] = [];
  for (const outcome of failed) {
    const calendar = UNKNOWN_CALENDAR.exec(outcome.error)?.[1];
    if (calendar === undefined) {
      rows.push(formatRow(outcome));
    } else {
      calendars.set(calendar, (calendars.get(calendar) ?? 0) + 1);
    }
  }
  const lines = [
    '# test262 on one implementation of Temporal: the tests that did not pass; written by scripts/test262.ts --write.',
    `# test262 commit: ${header.commit}`,
    `# implementation: ${header.implementation}`,
    `# runtime: ${header.runtime}`,
    `# tests: ${outcomes.length}, passed: ${outcomes.length - failed.length}, not passed: ${failed.length}`,
    ...[...calendars].sort().map(([calendar, count]) => `# unknown calendar ${calendar}: ${count} tests`),
    ...rows,
  ];
  return `${lines.join('\n')}\n`;
}

/** The lines that differ between a recorded table and a new one, each named; empty when they are identical. */
export function compareTables(recorded: string, current: string): string[] {
  const old = new Set(recorded.split('\n'));
  const now = new Set(current.split('\n'));
  const differences: string[] = [];
  for (const line of old) {
    if (!now.has(line)) {
      differences.push(`- ${line}`);
    }
  }
  for (const line of now) {
    if (!old.has(line)) {
      differences.push(`+ ${line}`);
    }
  }
  return differences;
}

/** Where the tests of an implementation fall short, by Temporal class: the page a reader opens first. */
export function formatSummary(
  commit: string,
  runtime: string,
  runs: ReadonlyMap<Implementation, readonly Outcome[]>,
): string {
  const names = [...runs.keys()];
  const areas = new Map<string, Map<Implementation, number>>();
  const totals = new Map<string, number>();
  const everywhere = new Map<string, number>();
  for (const [implementation, outcomes] of runs) {
    for (const { test, error } of outcomes) {
      const area = test.split('/').slice(0, 3).join('/').replace(/\.js$/, '');
      const row = areas.get(area) ?? new Map<Implementation, number>();
      areas.set(area, row);
      row.set(implementation, (row.get(implementation) ?? 0) + (error === '' ? 0 : 1));
      if (implementation === names[0]) {
        totals.set(area, (totals.get(area) ?? 0) + 1);
      }
      if (error !== '') {
        everywhere.set(test, (everywhere.get(test) ?? 0) + 1);
      }
    }
  }
  const lines = [
    '# Temporal under test262',
    '',
    'Written by `bash scripts/test262.sh --write`, compared by the gate. Each `.tsv` file of this folder lists the ' +
      'tests that did not pass on one implementation, with their error; ' +
      '[ADR 0035](../adr/0035-test262-judge.md) says how they are run and what they mean for `@yaltaan/temporal`.',
    '',
    `test262 commit \`${commit}\`; ${runtime}.`,
    '',
    `| Area | Tests | ${names.map((name) => `${name}: not passed`).join(' | ')} |`,
    `|---|---:|${names.map(() => '---:').join('|')}|`,
  ];
  for (const area of [...areas.keys()].sort()) {
    const row = areas.get(area);
    lines.push(`| ${area} | ${totals.get(area) ?? 0} | ${names.map((name) => row?.get(name) ?? 0).join(' | ')} |`);
  }
  const all = [...everywhere].filter(([, count]) => count === names.length).length;
  lines.push('', `Tests that fail on all ${names.length} implementations: ${all}.`, '');
  return lines.join('\n');
}
