import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { CATEGORY_NAMES, type CategoryName } from '../../packages/testing/src/category.ts';
import { RECORD_PREFIX, type AdversarialRecord, type Outcome } from '../../packages/testing/src/record.ts';
import { checkAdversarial, judgeAdversarial, parseRecords } from '../check-adversarial.ts';
import { checkContractTags } from '../check-contract-tags.ts';
import type { ExportKind, PublicExport } from '../lib/contract-tags.ts';
import { repositoryRoot } from '../lib/workspace.ts';

const temporaryRoots: string[] = [];
after(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function exported(name: string, kind: ExportKind = 'callable', stability = 'experimental'): PublicExport {
  return {
    name,
    kind,
    kindDetail: '',
    value: kind !== 'type',
    tags: [{ name: stability, text: '' }],
    parameters: [],
    documentation: '',
    declarations: [],
  };
}

const SPECIFIER = '@yaltaan/core/object';

/** The six records of one export, each with `outcome` unless `outcomes` says otherwise. */
function declaration(
  exportName: string,
  outcome: Outcome = 'tested',
  outcomes: Partial<Record<CategoryName, Outcome>> = {},
): AdversarialRecord[] {
  return CATEGORY_NAMES.map((category) => ({
    specifier: SPECIFIER,
    exportName,
    category,
    outcome: outcomes[category] ?? outcome,
  }));
}

function problemsOf(exports: readonly PublicExport[], records: readonly AdversarialRecord[]): readonly string[] {
  return judgeAdversarial([{ specifier: SPECIFIER, exports }], records).problems;
}

function assertOneProblem(problems: readonly string[], fragment: string): void {
  assert.equal(problems.length, 1, `expected one problem, got: ${JSON.stringify(problems)}`);
  assert.ok(problems[0]?.includes(fragment), `"${problems[0]}" does not mention "${fragment}"`);
}

test('an export that declares every category, tested, N/A or deferred, passes and is counted', () => {
  const records = declaration('omit', 'tested', { async: 'n/a', hostile: 'deferred' });
  const verdict = judgeAdversarial([{ specifier: SPECIFIER, exports: [exported('omit')] }], records);
  assert.deepEqual(verdict.problems, []);
  assert.deepEqual([verdict.exports, verdict.tested, verdict.notApplicable, verdict.deferred], [1, 4, 1, 1]);
});

test('an export that runs without a declaration fails', () => {
  assertOneProblem(problemsOf([exported('omit')], []), `${SPECIFIER} omit: no adversarial declaration`);
  assertOneProblem(problemsOf([exported('Cache', 'class')], []), `${SPECIFIER} Cache: no adversarial declaration`);
});

test('an export that never runs declares nothing, and a declaration of one fails', () => {
  for (const kind of ['constant', 'type'] as const) {
    assert.deepEqual(problemsOf([exported('Limit', kind)], []), [], kind);
    assertOneProblem(problemsOf([exported('Limit', kind)], declaration('Limit', 'n/a')), 'the export never runs');
  }
});

test('a declaration that names no published export fails', () => {
  assertOneProblem(problemsOf([], declaration('omitt')), `${SPECIFIER} omitt: declared, but no subpath publishes`);
});

test('a category without its record, or with two, fails', () => {
  const missing = declaration('omit').filter((record) => record.category !== 'unicode');
  assertOneProblem(problemsOf([exported('omit')], missing), 'the unicode test of its declaration did not run');
  const twice = [...declaration('omit'), ...declaration('omit', 'n/a')];
  const problems = problemsOf([exported('omit')], twice);
  assert.equal(problems.length, CATEGORY_NAMES.length, JSON.stringify(problems));
  assert.ok(problems.every((problem) => problem.includes('declared 2 times: one declaration per export')));
});

test('a check that failed or was skipped fails', () => {
  const failed = declaration('omit', 'tested', { boundary: 'failed' });
  assertOneProblem(problemsOf([exported('omit')], failed), 'the boundary check failed');
  const skipped = declaration('omit', 'tested', { callbacks: 'skipped' });
  assertOneProblem(problemsOf([exported('omit')], skipped), 'the callbacks check was skipped by the runner');
});

test('a stable export cannot defer a category; an experimental one can', () => {
  const records = declaration('omit', 'tested', { structures: 'deferred' });
  assert.deepEqual(problemsOf([exported('omit')], records), []);
  assertOneProblem(problemsOf([exported('omit', 'callable', 'stable')], records), 'is @stable but defers structures');
});

test('every line with the record prefix must be a record; other lines are ignored', () => {
  const good = `${RECORD_PREFIX}{"specifier":"@yaltaan/core","exportName":"omit","category":"async","outcome":"n/a"}`;
  const parsed = parseRecords(['ℹ tests 3', good, `${RECORD_PREFIX}{"specifier":"core"}`, ''].join('\n'));
  assert.equal(parsed.records.length, 1);
  assert.deepEqual(parsed.problems.length, 1);
  assert.match(parsed.problems[0] ?? '', /^records line 3: not a well-formed record/u);
});

// A built package of one function and one interface, read through the contract tag check as the gate reads it.
const COMPILER = path.join(
  path.dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
  'bin',
  'tsc',
);

function builtPackage(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-adversarial-'));
  temporaryRoots.push(root);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture', private: true, type: 'module', workspaces: ['packages/*'] }),
    'packages/demo/package.json': JSON.stringify({
      name: '@yaltaan/demo',
      version: '0.0.0',
      private: true,
      type: 'module',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    }),
    'packages/demo/tsconfig.build.json': JSON.stringify({
      compilerOptions: {
        target: 'es2023',
        module: 'nodenext',
        types: [],
        declaration: true,
        rootDir: 'src',
        outDir: 'dist',
      },
      include: ['src'],
    }),
    'packages/demo/src/index.ts': [
      '/**',
      ' * Doubles a number.',
      ' * @pure',
      ' * @sharing none',
      ' * @complexity O(1)',
      ' * @throws never',
      ' * @since 0.1',
      ' * @experimental',
      ' */',
      'export function double(value: number): number {',
      '  return value * 2;',
      '}',
      '',
      '/**',
      ' * A pair.',
      ' * @since 0.1',
      ' * @experimental',
      ' */',
      'export interface Pair {',
      '  readonly left: number;',
      '}',
      '',
    ].join('\n'),
  };
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  }
  const built = spawnSync(process.execPath, [COMPILER, '-p', 'packages/demo/tsconfig.build.json'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  return root;
}

test('in a built package, the function must declare and the interface need not', async () => {
  const root = builtPackage();
  assert.deepEqual((await checkContractTags(root, { update: true })).problems, []);
  const lines = CATEGORY_NAMES.map((category) => {
    const record = { specifier: '@yaltaan/demo', exportName: 'double', category, outcome: 'n/a' };
    return `${RECORD_PREFIX}${JSON.stringify(record)}`;
  });
  const declared = await checkAdversarial(root, lines.join('\n'));
  assert.deepEqual(declared.problems, []);
  assert.equal(declared.exports, 1);
  assertOneProblem((await checkAdversarial(root, '')).problems, '@yaltaan/demo double: no adversarial declaration');
});

test('a public surface read with problems is never judged as passing', async () => {
  const root = builtPackage();
  fs.rmSync(path.join(root, 'packages/demo/dist/index.d.ts'));
  assertOneProblem(
    (await checkAdversarial(root, '')).problems,
    'the public exports could not be read without problems',
  );
});

// Without the records of a real run, the verdict on this repository depends on how many exports it has: the program
// is held to print a verdict that agrees with its exit status, not to pass.
test('run as a program, the check reads a records file and prints a verdict that agrees with its status', () => {
  const records = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-adversarial-')), 'records.txt');
  temporaryRoots.push(path.dirname(records));
  fs.writeFileSync(records, '');
  const script = path.join(repositoryRoot, 'scripts', 'check-adversarial.ts');
  const result = spawnSync(process.execPath, [script, records], { encoding: 'utf8' });
  if (result.status === 0) {
    assert.match(result.stdout, /^ok: \d+ export\(s\) that run declare the adversarial catalogue: /u);
  } else {
    assert.match(result.stderr, /^error: .+: no adversarial declaration: /mu);
  }
  const usage = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /usage: node scripts\/check-adversarial\.ts <records file>/u);
});
