// Runs the Temporal tests of test262 on the native Temporal and on temporal-polyfill, and compares each result with
// its table in docs/test262/. Called by scripts/test262.sh, which fetches and checks what this needs.
//
// Usage: node scripts/test262.ts --root <test262> --commit <sha> [options]
//   --write                   rewrite the tables
//   --falsify <test>          make one test false before the run: the comparison must then fail
//   --implementation <name>   native, polyfill or polyfill-full; all by default
//   --sloppy                  run in sloppy mode the tests that allow both modes
//   --table <folder>          where the tables are; docs/test262 by default
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  compareTables,
  formatSummary,
  formatTable,
  listTests,
  type Implementation,
  type Outcome,
  type Setup,
} from './lib/test262.ts';

const repository = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    commit: { type: 'string' },
    write: { type: 'boolean', default: false },
    table: { type: 'string' },
    threads: { type: 'string' },
    implementation: { type: 'string' },
    falsify: { type: 'string' },
    sloppy: { type: 'boolean', default: false },
  },
});
if (values.root === undefined || values.commit === undefined) {
  throw new Error('usage: node scripts/test262.ts --root <test262> --commit <sha> [--write]');
}
const root = values.root;
const tables = values.table ?? path.join(repository, 'docs', 'test262');
const directories = ['built-ins/Temporal', 'intl402/Temporal'];
const threads = Number(values.threads ?? Math.min(8, os.availableParallelism()));
const BATCH = 40;

const POLYFILL_FILES: Readonly<Partial<Record<Implementation, string>>> = {
  polyfill: 'global.js',
  'polyfill-full': 'full/global.js',
};
const ALL: readonly Implementation[] = ['native', 'polyfill', 'polyfill-full'];

function polyfillVersion(): string {
  const manifest = path.join(repository, 'node_modules', 'temporal-polyfill', 'package.json');
  return (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version: string }).version;
}

function runAll(setup: Setup, tests: readonly string[]): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  let next = 0;
  return new Promise((resolve, reject) => {
    let running = 0;
    for (let i = 0; i < threads; i += 1) {
      const worker = new Worker(new URL('./lib/test262-worker.ts', import.meta.url), { workerData: setup });
      const send = (): void => {
        if (next >= tests.length) {
          void worker.terminate();
          running -= 1;
          if (running === 0) {
            resolve(outcomes.sort((a, b) => (a.test < b.test ? -1 : a.test > b.test ? 1 : 0)));
          }
          return;
        }
        const batch = tests.slice(next, next + BATCH);
        next += BATCH;
        worker.postMessage(batch);
      };
      running += 1;
      worker.on('message', (done: Outcome[]) => {
        outcomes.push(...done);
        send();
      });
      worker.on('error', reject);
      send();
    }
  });
}

const tests = listTests(root, directories);
if (tests.length === 0) {
  throw new Error(`no test found under ${root}`);
}
const { node, v8, icu, tz } = process.versions as Record<string, string>;
const runtime = `node ${node}, v8 ${v8}, icu ${icu}, tz ${tz}`;
const implementations = values.implementation === undefined ? ALL : ALL.filter((one) => one === values.implementation);
if (implementations.length === 0) {
  throw new Error(`unknown implementation ${values.implementation}`);
}
let different = false;
const runs = new Map<Implementation, readonly Outcome[]>();
for (const implementation of implementations) {
  if (implementation === 'native' && typeof (globalThis as { Temporal?: unknown }).Temporal === 'undefined') {
    throw new Error(`node ${process.versions.node} has no Temporal: the native implementation cannot run`);
  }
  const started = Date.now();
  const entry = POLYFILL_FILES[implementation];
  const setup: Setup = {
    root,
    sloppy: values.sloppy,
    ...(entry === undefined ? {} : { polyfill: path.join(repository, 'node_modules', 'temporal-polyfill', entry) }),
    ...(values.falsify === undefined ? {} : { falsify: values.falsify }),
  };
  const outcomes = await runAll(setup, tests);
  runs.set(implementation, outcomes);
  const header = {
    commit: values.commit,
    runtime,
    implementation: entry === undefined ? 'native Temporal' : `temporal-polyfill ${polyfillVersion()}, ${entry}`,
  };
  const table = formatTable(header, outcomes);
  const file = path.join(tables, `${implementation}.tsv`);
  const failed = outcomes.filter((outcome) => outcome.error !== '').length;
  console.log(
    `${implementation}: ${outcomes.length} tests, ${outcomes.length - failed} passed, ${failed} not passed, ` +
      `${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
  if (values.write) {
    fs.mkdirSync(tables, { recursive: true });
    fs.writeFileSync(file, table);
    continue;
  }
  const differences = fs.existsSync(file)
    ? compareTables(fs.readFileSync(file, 'utf8'), table)
    : [`+ ${file} does not exist: run with --write`];
  if (differences.length > 0) {
    different = true;
    console.error(`error: ${implementation} differs from ${path.relative(repository, file)}:`);
    console.error(differences.slice(0, 40).join('\n'));
    if (differences.length > 40) {
      console.error(`... and ${differences.length - 40} more`);
    }
  }
}
if (implementations.length === ALL.length) {
  const summary = formatSummary(values.commit, runtime, runs);
  const file = path.join(tables, 'README.md');
  if (values.write) {
    fs.writeFileSync(file, summary);
  } else if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== summary) {
    different = true;
    console.error(`error: ${path.relative(repository, file)} differs: run scripts/test262.sh --write`);
  }
}
process.exitCode = different ? 1 : 0;
