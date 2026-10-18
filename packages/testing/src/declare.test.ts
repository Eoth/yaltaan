import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { declareAdversarial, type Declaration } from './index.ts';
import { parseRecord, RECORD_PREFIX, RECORDS_VARIABLE, type AdversarialRecord } from './record.ts';
import { recordOf } from './reporter.ts';

const PACKAGE = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const INDEX = pathToFileURL(path.join(PACKAGE, 'src', 'index.ts')).href;
const REPORTER = path.join(PACKAGE, 'src', 'reporter.ts');

const temporaryDirs: string[] = [];
after(() => {
  for (const dir of temporaryDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The runner marks the process of each test file with NODE_TEST_CONTEXT; a runner started from such a process would
// report to it instead of printing, so the fixture's runner starts without it, as the gate's own does.
function childEnv(records: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['NODE_TEST_CONTEXT'];
  delete env[RECORDS_VARIABLE];
  return records ? { ...env, [RECORDS_VARIABLE]: '1' } : env;
}

/** Runs `source` as a test file in its own runner, with the repository's reporter, as the gate runs every file. */
function runFixture(source: string, options: { readonly records: boolean; readonly only?: boolean }) {
  const args = ['--test', ...(options.only === true ? ['--test-only'] : []), `--test-reporter=${REPORTER}`];
  const result = spawnSync(process.execPath, [...args, writeFixture(source)], {
    encoding: 'utf8',
    env: childEnv(options.records),
  });
  return { status: result.status, stdout: result.stdout };
}

function recordsOf(stdout: string): AdversarialRecord[] {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith(RECORD_PREFIX))
    .map((line) => {
      const record = parseRecord(line);
      assert.ok(record, line);
      return record;
    });
}

const FIXTURE = `
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adversarial, declareAdversarial } from '${INDEX}';

const seen = { boundary: 0, unicode: 0 };
declareAdversarial('@yaltaan/demo/object', 'omit', {
  boundary: () => { seen.boundary += 1; },
  structures: { na: 'takes no structure' },
  hostile: { deferred: 'waits for the path parser' },
  unicode: (text) => { seen.unicode += 1; assert.equal(typeof text, 'string'); },
  callbacks: { na: 'takes no callback' },
  async: { na: 'synchronous' },
}, { numRuns: 7 });
declareAdversarial('@yaltaan/demo/object', 'broken', {
  boundary: (value) => { if (Number.isNaN(value)) throw new Error('NaN mishandled'); },
  structures: { na: 'x' }, hostile: { na: 'x' }, unicode: { na: 'x' }, callbacks: { na: 'x' }, async: { na: 'x' },
}, { numRuns: 3 });
test('every named case and every random run reached its check', () => {
  assert.equal(seen.boundary, adversarial.boundary.cases.length + 7);
  assert.equal(seen.unicode, adversarial.unicode.cases.length + 7);
});
`;

test('a declaration runs its checks on every case, and the reporter records each category for the gate', () => {
  const { status, stdout } = runFixture(FIXTURE, { records: true });
  assert.equal(status, 1, 'the broken check fails the run');
  assert.match(stdout, /✔ every named case and every random run reached its check/);
  assert.match(stdout, /✖ NaN \(/u);
  const outcomes = recordsOf(stdout).map((record) => `${record.exportName} ${record.category} ${record.outcome}`);
  assert.deepEqual(outcomes.sort(), [
    'broken async n/a',
    'broken boundary failed',
    'broken callbacks n/a',
    'broken hostile n/a',
    'broken structures n/a',
    'broken unicode n/a',
    'omit async n/a',
    'omit boundary tested',
    'omit callbacks n/a',
    'omit hostile deferred',
    'omit structures n/a',
    'omit unicode tested',
  ]);
  assert.ok(recordsOf(stdout).every((record) => record.specifier === '@yaltaan/demo/object'));
});

test('the example of the README runs, and declares its six categories', () => {
  const readme = fs.readFileSync(path.join(PACKAGE, 'README.md'), 'utf8');
  const example = /```ts\n(import assert[^]*?)```/u.exec(readme)?.[1];
  assert.ok(example, 'the README has no example');
  const { status, stdout } = runFixture(example.replace("from '@yaltaan/testing'", `from '${INDEX}'`), {
    records: true,
  });
  assert.equal(status, 0, stdout);
  const outcomes = recordsOf(stdout).map((record) => `${record.category} ${record.outcome}`);
  assert.deepEqual(outcomes.sort(), [
    'async n/a',
    'boundary n/a',
    'callbacks n/a',
    'hostile tested',
    'structures tested',
    'unicode n/a',
  ]);
});

test('without the gate asking, the reporter prints the usual report and no record', () => {
  const { stdout } = runFixture(FIXTURE, { records: false });
  assert.equal(recordsOf(stdout).length, 0);
  assert.match(stdout, /^ℹ tests \d+$/mu);
  assert.match(stdout, /^ℹ todo 1$/mu);
});

test('a category test that the runner leaves out leaves no record, which the gate reads as not run', () => {
  const source = `${FIXTURE.replace(/^test\('every named case[^]*$/mu, '')}test.only('alone', () => {});\n`;
  const { status, stdout } = runFixture(source, { records: true, only: true });
  assert.equal(status, 0);
  assert.match(stdout, /✔ alone/u);
  assert.deepEqual(recordsOf(stdout), []);
});

function writeFixture(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-adversarial-'));
  temporaryDirs.push(dir);
  const file = path.join(dir, 'fixture.test.ts');
  fs.writeFileSync(file, source);
  return file;
}

test('a declaration is refused whole, before any test is registered, when one of its entries is wrong', () => {
  const valid: Declaration = {
    boundary: () => {},
    structures: { na: 'x' },
    hostile: { na: 'x' },
    unicode: { na: 'x' },
    callbacks: { na: 'x' },
    async: { na: 'x' },
  };
  assert.throws(() => declareAdversarial('core/object', 'omit', valid), /not a package subpath/);
  assert.throws(() => declareAdversarial('@yaltaan/Core', 'omit', valid), /not a package subpath/);
  assert.throws(() => declareAdversarial('@yaltaan/core', 'om it', valid), /not the name of an export/);
  assert.throws(() => declareAdversarial('@yaltaan/core', 'omit', valid, { numRuns: 0 }), /numRuns/);
  // The wrong entry is the last category: the first five would be registered by a declaration checked lazily.
  assert.throws(() => declareAdversarial('@yaltaan/core', 'omit', { ...valid, async: { na: ' ' } }), /needs a reason/);
  assert.throws(() => declareAdversarial('@yaltaan/core', 'omit', { ...valid, async: { deferred: '' } }), /reason/);
});

test('the reporter reads only finished adversarial tests', () => {
  const data = {
    name: 'adversarial @yaltaan/core omit: unicode',
    nesting: 0,
    testNumber: 1,
    details: { duration_ms: 1 },
  };
  const pass = { type: 'test:pass', data } as Parameters<typeof recordOf>[0];
  assert.deepEqual(recordOf(pass), {
    specifier: '@yaltaan/core',
    exportName: 'omit',
    category: 'unicode',
    outcome: 'tested',
  });
  const other = { type: 'test:pass', data: { ...data, name: 'adversarial @yaltaan/core omit: colour' } };
  assert.equal(recordOf(other as Parameters<typeof recordOf>[0]), undefined);
  // A skip or a todo that the declaration did not write is never counted as tested.
  for (const [skip, todo, outcome] of [
    ['n/a: synchronous', undefined, 'n/a'],
    [true, undefined, 'skipped'],
    ['filtered', undefined, 'skipped'],
    [undefined, 'deferred: later', 'deferred'],
    [undefined, true, 'skipped'],
  ] as const) {
    const event = { type: 'test:pass', data: { ...data, skip, todo } } as Parameters<typeof recordOf>[0];
    assert.equal(recordOf(event)?.outcome, outcome, `${String(skip)} ${String(todo)}`);
  }
  assert.equal(recordOf({ type: 'test:fail', data } as Parameters<typeof recordOf>[0])?.outcome, 'failed');
  const start = { type: 'test:start', data: { name: data.name, nesting: 0 } };
  assert.equal(recordOf(start as Parameters<typeof recordOf>[0]), undefined);
});

test('a record line is read back only when every field is valid', () => {
  const line = `${RECORD_PREFIX}{"specifier":"@yaltaan/core","exportName":"omit","category":"async","outcome":"n/a"}`;
  assert.deepEqual(parseRecord(line), {
    specifier: '@yaltaan/core',
    exportName: 'omit',
    category: 'async',
    outcome: 'n/a',
  });
  for (const broken of [
    line.replace('"n/a"', '"passed"'),
    line.replace('"async"', '"time"'),
    line.replace('@yaltaan/core', 'core'),
    `${RECORD_PREFIX}{`,
    `${RECORD_PREFIX}null`,
    line.slice(RECORD_PREFIX.length),
  ]) {
    assert.equal(parseRecord(broken), undefined, broken);
  }
});
