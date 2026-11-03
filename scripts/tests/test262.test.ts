import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareTables, formatRow, formatTable, listTests, readMetadata, Runner } from '../lib/test262.ts';

const repository = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A small tree of the shape of test262: its own assert, one test that passes, and what must never count as a pass. */
function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test262-'));
  const files: Readonly<Record<string, string>> = {
    'harness/assert.js': `var assert = {
      sameValue(a, b, m) { if (a !== b) { throw new Test262Error(m ?? 'different'); } }
    };`,
    'harness/sta.js': `function Test262Error(message) { this.message = message; }`,
    'harness/extra.js': `var extra = 41;`,
    'test/built-ins/Temporal/passes.js': `/*---\ndescription: passes\n---*/\nassert.sameValue(1, 1);\n`,
    'test/built-ins/Temporal/fails.js': `/*---\ndescription: fails\n---*/\nassert.sameValue(1, 2, 'one is not two');\n`,
    'test/built-ins/Temporal/include.js': `/*---\nincludes: [extra.js]\n---*/\nassert.sameValue(extra + 1, 42);\n`,
    'test/built-ins/Temporal/block.js': `/*---\nincludes:\n  - extra.js\n---*/\nassert.sameValue(extra, 41);\n`,
    'test/built-ins/Temporal/broken.js': `/*---\ndescription: broken\n---*/\nfunction (;\n`,
    'test/built-ins/Temporal/async.js': `/*---\nflags: [async]\n---*/\n`,
    'test/built-ins/Temporal/negative.js': `/*---\nnegative:\n  phase: parse\n  type: SyntaxError\n---*/\n`,
    'test/built-ins/Temporal/strict.js': `/*---\ndescription: strict\n---*/\nundeclared = 1;\n`,
    'test/built-ins/Temporal/sloppy.js': `/*---\nflags: [noStrict]\n---*/\nundeclaredSloppy = 1;\n`,
    'test/built-ins/Temporal/uses-polyfill.js': `/*---\n---*/\nassert.sameValue(Temporal.fake, true);\n`,
    'test/built-ins/Temporal/thing_FIXTURE.js': `throw new Error('a fixture is no test');\n`,
    'test/intl402/Temporal/passes.js': `/*---\ndescription: passes\n---*/\n`,
  };
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

const DIRECTORIES = ['built-ins/Temporal', 'intl402/Temporal'];

test('metadata: an inline list, a block list, a negative test', () => {
  assert.deepEqual(readMetadata('/*---\nincludes: [a.js, b.js]\nflags: [onlyStrict]\n---*/').includes, [
    'a.js',
    'b.js',
  ]);
  assert.deepEqual(readMetadata('/*---\nincludes:\n  - a.js\n  - b.js\nesid: x\n---*/').includes, ['a.js', 'b.js']);
  assert.equal(readMetadata('/*---\nnegative:\n  phase: parse\n---*/').negative, true);
  assert.deepEqual(readMetadata('no front matter'), { includes: [], flags: [], negative: false });
});

test('tests are listed sorted, under each folder, fixtures left out', () => {
  const root = fixture();
  const tests = listTests(root, DIRECTORIES);
  assert.deepEqual(tests, [...tests].sort());
  assert.ok(tests.includes('built-ins/Temporal/passes'));
  assert.ok(tests.includes('intl402/Temporal/passes'));
  assert.ok(!tests.some((name) => name.endsWith('_FIXTURE')));
  fs.rmSync(root, { recursive: true });
});

test('what passes passes, and nothing else does', () => {
  const root = fixture();
  const runner = new Runner({ root });
  const error = (name: string): string => runner.run(`built-ins/Temporal/${name}`).error;
  assert.equal(error('passes'), '');
  assert.equal(error('include'), '');
  assert.equal(error('block'), '');
  assert.equal(error('fails'), 'Test262Error: one is not two');
  assert.match(error('broken'), /^SyntaxError: /);
  assert.equal(error('async'), 'runner: async test not supported');
  assert.equal(error('negative'), 'runner: negative test not supported');
  fs.rmSync(root, { recursive: true });
});

test('strict mode unless a test forbids it, sloppy mode on demand', () => {
  const root = fixture();
  const strict = new Runner({ root });
  assert.match(strict.run('built-ins/Temporal/strict').error, /^ReferenceError: /);
  assert.equal(strict.run('built-ins/Temporal/sloppy').error, '');
  assert.equal(new Runner({ root, sloppy: true }).run('built-ins/Temporal/strict').error, '');
  fs.rmSync(root, { recursive: true });
});

test('a test made false no longer passes, and the others are left alone', () => {
  const root = fixture();
  const runner = new Runner({ root, falsify: 'built-ins/Temporal/passes' });
  assert.match(runner.run('built-ins/Temporal/passes').error, /made false on purpose/);
  assert.equal(runner.run('intl402/Temporal/passes').error, '');
  fs.rmSync(root, { recursive: true });
});

test('the polyfill replaces whatever Temporal the runtime has, in each realm', () => {
  const root = fixture();
  const polyfill = path.join(root, 'polyfill.js');
  fs.writeFileSync(polyfill, 'globalThis.Temporal = { fake: true };');
  const runner = new Runner({ root, polyfill });
  assert.equal(runner.run('built-ins/Temporal/uses-polyfill').error, '');
  assert.equal(runner.run('built-ins/Temporal/uses-polyfill').error, '');
  assert.notEqual(new Runner({ root }).run('built-ins/Temporal/uses-polyfill').error, '');
  fs.rmSync(root, { recursive: true });
});

const HEADER = { commit: 'abc', runtime: 'node', implementation: 'x' };

test('a table: a row per failure, cut to the line length, an unknown calendar counted instead of listed', () => {
  const long = 'x'.repeat(300);
  assert.equal(formatRow({ test: 'a', error: long }).length, 120);
  assert.equal(formatRow({ test: 'a', error: 'café' }), 'a\tcaf?');
  const table = formatTable(HEADER, [
    { test: 'a', error: '' },
    { test: 'b', error: 'Test262Error: no' },
    { test: 'c', error: 'RangeError: Unknown calendar hebrew; might need temporal-polyfill/full' },
    { test: 'd', error: 'RangeError: Unknown calendar hebrew; might need temporal-polyfill/full' },
  ]);
  assert.ok(table.includes('# tests: 4, passed: 1, not passed: 3\n'));
  assert.ok(table.includes('# unknown calendar hebrew: 2 tests\n'));
  assert.ok(table.includes('b\tTest262Error: no\n'));
  assert.ok(!table.includes('\nc\t'));
});

test('two tables compare equal only when identical, each difference named', () => {
  const table = formatTable(HEADER, [{ test: 'a', error: 'E: no' }]);
  assert.deepEqual(compareTables(table, table), []);
  const fixed = formatTable(HEADER, [{ test: 'a', error: '' }]);
  assert.ok(compareTables(table, fixed).includes('- a\tE: no'));
  const worse = formatTable(HEADER, [
    { test: 'a', error: 'E: no' },
    { test: 'b', error: 'E: new' },
  ]);
  assert.ok(compareTables(table, worse).includes('+ b\tE: new'));
});

test('the command: written, replayed identical, red on a false test and on a changed table', () => {
  const root = fixture();
  const tables = path.join(root, 'tables');
  const args = [
    path.join(repository, 'scripts', 'test262.ts'),
    ...['--root', root, '--commit', 'abc', '--implementation', 'polyfill', '--table', tables, '--threads', '2'],
  ];
  execFileSync(process.execPath, [...args, '--write'], { stdio: 'pipe' });
  const table = path.join(tables, 'polyfill.tsv');
  assert.match(fs.readFileSync(table, 'utf8'), /built-ins\/Temporal\/fails\tTest262Error: one is not two/);
  assert.equal(spawnSync(process.execPath, args).status, 0);

  const falsified = spawnSync(process.execPath, [...args, '--falsify', 'built-ins/Temporal/passes'], {
    encoding: 'utf8',
  });
  assert.equal(falsified.status, 1);
  assert.match(falsified.stderr, /^\+ built-ins\/Temporal\/passes\t.*made false on purpose/m);

  fs.appendFileSync(path.join(root, 'test/built-ins/Temporal/block.js'), 'assert.sameValue(1, 2);\n');
  assert.equal(spawnSync(process.execPath, args).status, 1);
  fs.rmSync(root, { recursive: true });
});

test('the command refuses an unknown implementation and an empty tree', () => {
  const root = fixture();
  const script = path.join(repository, 'scripts', 'test262.ts');
  const common = [script, '--commit', 'abc', '--table', path.join(root, 'tables')];
  const unknown = spawnSync(process.execPath, [...common, '--root', root, '--implementation', 'nope'], {
    encoding: 'utf8',
  });
  assert.notEqual(unknown.status, 0);
  const empty = path.join(root, 'empty');
  fs.mkdirSync(path.join(empty, 'test/built-ins/Temporal'), { recursive: true });
  fs.mkdirSync(path.join(empty, 'test/intl402/Temporal'), { recursive: true });
  assert.notEqual(spawnSync(process.execPath, [...common, '--root', empty]).status, 0);
  fs.rmSync(root, { recursive: true });
});
