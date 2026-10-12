import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

import { stop } from 'esbuild-wasm';

import { bundleScenario } from '../lib/bundle.ts';
import { PackageIndex } from '../lib/packages.ts';
import {
  BASELINE_FILE,
  BUDGET_FILE,
  checkBudgets,
  describeChanges,
  findResolutionGaps,
  formatBaseline,
  measure,
  parseBaseline,
  parseBudgets,
  runSizeReport,
  type SizeRow,
} from '../size-report.ts';
import { repositoryRoot } from '../lib/workspace.ts';
import { BUDGET_HEADER, fabricatedPackage, fixture, removeFixtures, writeFiles } from './size-fixtures.ts';

after(async () => {
  removeFixtures();
  await stop();
});

// A primitive package and a schema package, the shape of the library's own: the primitive must never pull the schema
// in unless it declares it as a dependency.
function leakyTree(coreManifest: Readonly<Record<string, unknown>> = {}): Record<string, string> {
  return {
    'package.json': JSON.stringify({ name: 'fixture-root', private: true }),
    'bench/size/yaltaan/core-omit.js': "export { omit } from '@fx/core';\n",
    [BUDGET_FILE]: `${BUDGET_HEADER}yaltaan/core-omit\t150\thypothesis\n`,
    ...fabricatedPackage(
      '@fx/core',
      { sideEffects: false, exports: { '.': './index.js' }, ...coreManifest },
      {
        'index.js':
          "import { parse } from '@fx/schema';\n" +
          'export const omit = (value, key) =>\n' +
          '  parse(Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)));\n',
      },
    ),
    ...fabricatedPackage(
      '@fx/schema',
      { sideEffects: false, exports: { '.': './index.js' } },
      { 'index.js': "export const parse = (value) => { if (typeof value !== 'object') throw 0; return value; };\n" },
    ),
  };
}

const leaks = (problems: readonly string[]): string[] => problems.filter((problem) => problem.includes('import leak'));

test('a scenario whose bundle pulls in a package it does not depend on fails under both bundlers', async () => {
  const report = await runSizeReport(fixture(leakyTree()), { update: true });
  const found = leaks(report.problems);
  assert.equal(found.length, 2, report.problems.join('\n'));
  for (const [index, bundler] of ['esbuild', 'rollup'].entries()) {
    assert.match(found[index] ?? '', new RegExp(`^yaltaan/core-omit: import leak under ${bundler}: `));
    assert.match(found[index] ?? '', /node_modules\/@fx\/schema\/index\.js \(@fx\/schema\)/);
    assert.match(found[index] ?? '', /may only pull in @fx\/core$/);
  }
  assert.equal(report.written, false, 'a failing run never records its figures');
});

test('a package declared as a dependency may be pulled in', async () => {
  const report = await runSizeReport(fixture(leakyTree({ dependencies: { '@fx/schema': '1.0.0' } })), {
    update: true,
  });
  assert.deepEqual(report.problems, []);
  assert.equal(report.written, true);
});

test('the bundle is the same on every run, and the baseline fails on any byte that moves', async () => {
  const root = fixture(leakyTree({ dependencies: { '@fx/schema': '1.0.0' } }));
  const first = await runSizeReport(root, { update: true });
  const second = await runSizeReport(root);
  assert.deepEqual(second.rows, first.rows);
  assert.deepEqual(second.problems, []);
  assert.deepEqual(second.changes, []);

  writeFiles(root, { 'node_modules/@fx/schema/index.js': 'export const parse = (value) => value;\n' });
  const changed = await runSizeReport(root);
  assert.equal(changed.problems.length, 1, changed.problems.join('\n'));
  assert.match(changed.problems[0] ?? '', new RegExp(`^${BASELINE_FILE} differs from this measurement`));
  assert.equal(changed.changes.length, 2);
  assert.match(changed.changes[0] ?? '', /^yaltaan\/core-omit esbuild: raw \d+ -> \d+ \(-\d+\), gzip/);
  const recorded = fs.readFileSync(path.join(root, BASELINE_FILE), 'utf8');
  assert.equal(recorded, formatBaseline(first.rows), 'a run without --update leaves the baseline alone');
});

// A browser entry that re-exports one used and one unused module, and imports a third for its side effect only.
function conditionalTree(sideEffects: readonly string[]): Record<string, string> {
  return {
    'bench/size/references/pick.js': "export { picked } from 'fx-lib';\n",
    ...fabricatedPackage(
      'fx-lib',
      { sideEffects, exports: { '.': { types: './index.d.ts', browser: './browser.js', import: './node.js' } } },
      {
        'browser.js':
          "export { picked } from './picked.js';\nexport { unused } from './unused.js';\nimport './effect.js';\n",
        'node.js': "export const picked = 'node';\n",
        'picked.js': "export const picked = 'browser';\n",
        'unused.js': "globalThis.unused = 'dropped: not listed in sideEffects';\nexport const unused = 1;\n",
        'effect.js': "globalThis.effect = 'kept: listed in sideEffects';\n",
      },
    ),
  };
}

async function bundledPackageModules(sideEffects: readonly string[]): Promise<Record<string, readonly string[]>> {
  const root = fixture(conditionalTree(sideEffects));
  const bundles = await bundleScenario({
    root,
    entry: path.join(root, 'bench/size/references/pick.js'),
    external: [],
    packages: new PackageIndex(),
  });
  const modules: Record<string, readonly string[]> = {};
  for (const bundle of bundles) {
    assert.ok(bundle.loaded.includes('node_modules/fx-lib/browser.js'), bundle.bundler);
    assert.ok(!bundle.loaded.includes('node_modules/fx-lib/node.js'), bundle.bundler);
    modules[bundle.bundler] = bundle.modules.filter((module) => module.startsWith('node_modules/'));
  }
  return modules;
}

test('both bundlers honour "sideEffects" and the export conditions of a browser build', async () => {
  const kept = ['node_modules/fx-lib/effect.js', 'node_modules/fx-lib/picked.js'];
  assert.deepEqual(await bundledPackageModules(['./browser.js', './effect.js']), { esbuild: kept, rollup: kept });
  // Where they differ, and why both are measured: Rollup does not follow a side-effect import made by a module that
  // declares no side effect, esbuild does.
  assert.deepEqual(await bundledPackageModules(['./effect.js']), {
    esbuild: kept,
    rollup: ['node_modules/fx-lib/picked.js'],
  });
});

test("a peer dependency stays out of the bundle, as an application's framework does", async () => {
  const root = fixture({
    'bench/size/references/adapter.js': "export { bind } from 'fx-adapter';\n",
    [BUDGET_FILE]: BUDGET_HEADER,
    ...fabricatedPackage(
      'fx-adapter',
      { sideEffects: false, exports: './index.js', peerDependencies: { 'fx-framework': '*' } },
      { 'index.js': "import { use } from 'fx-framework';\nexport const bind = (node) => use(node.get);\n" },
    ),
    ...fabricatedPackage('fx-framework', { exports: './index.js' }, { 'index.js': 'export const use = (f) => f();\n' }),
  });
  const report = await runSizeReport(root, { update: true });
  assert.deepEqual(report.problems, []);
  const baseline = fs.readFileSync(path.join(root, BASELINE_FILE), 'utf8');
  assert.equal(parseBaseline(baseline).size, 2);
  const bundles = await bundleScenario({
    root,
    entry: path.join(root, 'bench/size/references/adapter.js'),
    external: ['fx-framework'],
    packages: new PackageIndex(),
  });
  for (const bundle of bundles) {
    assert.ok(!bundle.modules.some((module) => module.includes('fx-framework')), bundle.bundler);
    assert.match(bundle.code, /from"fx-framework"/, bundle.bundler);
  }
});

test('a form of package.json the resolver does not implement fails the scenario instead of being guessed', async () => {
  const root = fixture({
    'bench/size/references/pattern.js': "export { a } from 'fx-pattern/a';\n",
    'bench/size/references/glob.js': "export { b } from 'fx-glob';\n",
    ...fabricatedPackage('fx-pattern', { exports: { './*': './lib/*.js' } }, { 'lib/a.js': 'export const a = 1;\n' }),
    ...fabricatedPackage(
      'fx-glob',
      { sideEffects: ['*.css'], exports: './index.js' },
      { 'index.js': 'export const b = 2;\n' },
    ),
  });
  const report = await runSizeReport(root, { update: true });
  const byScenario = (name: string): string => report.problems.find((problem) => problem.startsWith(name)) ?? '';
  assert.match(byScenario('references/pattern'), /subpath patterns of "exports" are not implemented/);
  assert.match(byScenario('references/glob'), /"sideEffects" entry "\*\.css" is not a plain file path/);
  assert.equal(report.written, false);
});

test('a file one bundler ships and the other never read means they resolved differently', () => {
  const bundle = (bundler: 'esbuild' | 'rollup', modules: string[], loaded: string[]) => ({
    bundler,
    code: '',
    modules,
    loaded,
  });
  const shaken = [bundle('esbuild', ['a.js'], ['a.js', 'b.js']), bundle('rollup', ['a.js', 'b.js'], ['a.js', 'b.js'])];
  assert.deepEqual(findResolutionGaps(shaken), [], 'a file read by both but shaken out by one is no gap');
  const resolvedApart = [bundle('esbuild', ['browser.js'], ['browser.js']), bundle('rollup', ['node.js'], ['node.js'])];
  assert.deepEqual(findResolutionGaps(resolvedApart), [
    'esbuild bundles browser.js, which rollup never read',
    'rollup bundles node.js, which esbuild never read',
  ]);
});

test('a scenario imports packages only', async () => {
  const root = fixture({
    'bench/size/references/local.js': "export { x } from './helper.js';\n",
    'bench/size/references/helper.js': 'export const x = 1;\n',
  });
  const report = await runSizeReport(root, { update: true });
  assert.ok(
    report.problems.some((problem) => /^references\/local: a scenario imports packages only/.test(problem)),
    report.problems.join('\n'),
  );
});

test('measure gives the raw length and a hash of the output, and compresses the same way every time', () => {
  const code = 'export const omit=(o,k)=>{const r={...o};delete r[k];return r};';
  const sizes = measure(code);
  assert.equal(sizes.raw, Buffer.byteLength(code));
  assert.equal(sizes.sha256, createHash('sha256').update(code).digest('hex').slice(0, 16));
  assert.ok(sizes.gzip > 0 && sizes.brotli > 0);
  assert.deepEqual(measure(code), sizes);
  assert.equal(measure('é').raw, 2, 'bytes, not characters');
});

const row = (scenario: string, bundler: 'esbuild' | 'rollup', brotli: number, sha256 = 'a'.repeat(16)): SizeRow => ({
  scenario,
  bundler,
  raw: 100,
  gzip: 90,
  brotli,
  sha256,
});

test('the baseline round-trips through its file, and each difference is described', () => {
  const rows = [row('references/x', 'esbuild', 80), row('references/x', 'rollup', 81)];
  const text = formatBaseline(rows);
  assert.ok(text.endsWith('\n') && text.split('\n').every((line) => line.length <= 120));
  assert.deepEqual([...parseBaseline(text).values()], rows);

  const after = [row('references/x', 'esbuild', 85), row('references/x', 'rollup', 81, 'b'.repeat(16))];
  after.push(row('references/y', 'esbuild', 10));
  const before = parseBaseline(text);
  before.set('references/z esbuild', row('references/z', 'esbuild', 5));
  assert.deepEqual(describeChanges(before, after), [
    'references/x esbuild: raw 100 -> 100 (+0), gzip 90 -> 90 (+0), brotli 80 -> 85 (+5)',
    'references/x rollup: same sizes, other bytes',
    'references/y esbuild: new, raw 100, gzip 90, brotli 10',
    'references/z esbuild: removed',
  ]);
});

test('the budget file is a header and one well-formed row per scenario of the library', () => {
  const { budgets, problems } = parseBudgets(
    '# comment\n' +
      BUDGET_HEADER +
      'yaltaan/core-omit\t150\treferences/es-toolkit-omit\n' +
      'yaltaan/core-omit\t160\thypothesis\n' +
      'references/es-toolkit-omit\t100\thypothesis\n' +
      'yaltaan/rules-five\t1k\thypothesis\n' +
      'yaltaan/form\t7000\tguess\n',
  );
  assert.deepEqual([...budgets.keys()], ['yaltaan/core-omit']);
  assert.deepEqual(problems, [
    `${BUDGET_FILE}:4: yaltaan/core-omit already has a budget`,
    `${BUDGET_FILE}:5: a row is "yaltaan/<scenario><TAB><bytes><TAB><basis>", ` +
      'not "references/es-toolkit-omit\\t100\\thypothesis"',
    `${BUDGET_FILE}:6: the budget of yaltaan/rules-five must be a whole number of bytes, not "1k"`,
    `${BUDGET_FILE}:7: the basis of yaltaan/form is a references/ scenario or "hypothesis"`,
  ]);
  assert.deepEqual(parseBudgets('yaltaan/a\t1\thypothesis\n').problems, [
    `${BUDGET_FILE}:1: the header must be "scenario<TAB>brotli<TAB>basis"`,
  ]);
});

test('a scenario of the library needs a budget and must hold it under every bundler', () => {
  const { budgets } = parseBudgets(
    BUDGET_HEADER +
      'yaltaan/core-omit\t150\treferences/es-toolkit-omit\n' +
      'yaltaan/core-reactive\t1000\treferences/missing\n' +
      'yaltaan/schema-login\t1500\thypothesis\n',
  );
  const scenarios = ['references/es-toolkit-omit', 'yaltaan/core-omit', 'yaltaan/core-reactive', 'yaltaan/unbudgeted'];
  const rows = [row('yaltaan/core-omit', 'esbuild', 150), row('yaltaan/core-omit', 'rollup', 151)];
  const { problems, awaiting } = checkBudgets(budgets, scenarios, rows);
  assert.deepEqual(awaiting, ['yaltaan/schema-login']);
  assert.equal(problems.length, 3, problems.join('\n'));
  assert.match(
    problems[0] ?? '',
    /yaltaan\/core-reactive is calibrated against references\/missing, which is no scenario/,
  );
  assert.match(problems[1] ?? '', /^yaltaan\/core-omit weighs 151 B brotli with rollup, over its budget of 150 B/);
  assert.match(problems[2] ?? '', /^yaltaan\/unbudgeted has no budget/);
});

test('run as a program, the report refuses an unknown argument', () => {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, 'scripts/size-report.ts'), '--bogus'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: node scripts\/size-report\.ts \[--update\]/);
});

test('the budget file of this repository is well formed and calibrated against existing references', () => {
  const { budgets, problems } = parseBudgets(fs.readFileSync(path.join(repositoryRoot, BUDGET_FILE), 'utf8'));
  assert.deepEqual(problems, []);
  for (const budget of budgets.values()) {
    if (budget.basis !== 'hypothesis') {
      assert.ok(fs.existsSync(path.join(repositoryRoot, 'bench/size', `${budget.basis}.js`)), budget.basis);
    }
  }
});
