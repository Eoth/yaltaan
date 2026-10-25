import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkRegistry,
  checkRepositoryIssueCodes,
  declaredCodes,
  parseRegistry,
  REGISTRY_HEADER,
  type RegistryRow,
} from '../check-issue-codes.ts';
import { repositoryRoot } from '../lib/workspace.ts';
import { withRepo } from './run-script.ts';

function registry(...rows: string[]): string {
  return ['# Issue codes', '', REGISTRY_HEADER, '|---|---|---|---|---|', ...rows, ''].join('\n');
}

function rowsOf(markdown: string): readonly RegistryRow[] {
  const read = parseRegistry(markdown, 'core.md');
  assert.ok(read.ok, JSON.stringify(read));
  return read.rows;
}

const LIVE = '| `path.syntax` | `index` | The text breaks the grammar. | 0.1 | |';

test('a registry table is read row by row', () => {
  assert.deepEqual(rowsOf(registry(LIVE, '| `path.old` | | Gone. | 0.1 | 0.2 |')), [
    { code: 'path.syntax', since: '0.1', removed: undefined },
    { code: 'path.old', since: '0.1', removed: '0.2' },
  ]);
});

test('a malformed registry is refused, never half read', () => {
  assert.equal(parseRegistry('# Issue codes\n', 'core.md').ok, false);
  for (const row of [
    '| `Path.Syntax` | | Uppercase. | 0.1 | |',
    '| `syntax` | | No namespace. | 0.1 | |',
    '| path.syntax | | No backticks. | 0.1 | |',
    '| `path.syntax` | | No version. | | |',
    '| `path.syntax` | | A patch version. | 0.1.0 | |',
    '| `path.syntax` | Four cells. | 0.1 | |',
  ]) {
    assert.equal(parseRegistry(registry(row), 'core.md').ok, false, row);
  }
});

test('codes are read from declarations, never from their comments', () => {
  const declarations = [
    '/** @example parse() // { code: "path.example", … } */',
    "export type A = { readonly code: 'path.syntax'; readonly path: Path };",
    'export interface B {',
    '  readonly code: \'path.too_long\' | "path.too_deep";',
    '  // code: "path.comment"',
    '}',
    'export interface C { readonly code: string }',
  ].join('\n');
  assert.deepEqual(declaredCodes(declarations), ['path.syntax', 'path.too_long', 'path.too_deep']);
});

test('the registry and the declarations hold the same live codes', () => {
  const rows = rowsOf(registry(LIVE));
  assert.deepEqual(checkRegistry('core.md', rows, new Set(['path.syntax']), []), []);
  // A code removed from the code while its row stays live.
  assert.match(checkRegistry('core.md', rows, new Set(), []).join('\n'), /path\.syntax.* is live but no published/);
  // A code added without its row.
  const added = checkRegistry('core.md', rows, new Set(['path.syntax', 'path.new']), []);
  assert.match(added.join('\n'), /path\.new.* is declared but has no row/);
  // A row marked removed whose code is still declared.
  const removed = rowsOf(registry('| `path.syntax` | | Gone. | 0.1 | 0.2 |'));
  assert.match(checkRegistry('core.md', removed, new Set(['path.syntax']), []).join('\n'), /still declared/);
});

test('a code removed from the registry or renamed fails against its committed versions', () => {
  const history = [{ revision: 'abc1234', rows: rowsOf(registry(LIVE)) }];
  const renamed = rowsOf(registry('| `path.grammar` | `index` | Renamed. | 0.1 | |'));
  const problems = checkRegistry('core.md', renamed, new Set(['path.grammar']), history);
  assert.match(problems.join('\n'), /path\.syntax.* was registered at abc1234 and its row is gone/);
  const redated = rowsOf(registry('| `path.syntax` | `index` | Redated. | 0.2 | |'));
  assert.match(checkRegistry('core.md', redated, new Set(['path.syntax']), history).join('\n'), /added in 0\.1/);
  const tombstone = rowsOf(registry('| `path.syntax` | `index` | Gone. | 0.1 | 0.2 |'));
  assert.deepEqual(checkRegistry('core.md', tombstone, new Set(), history), []);
});

test('a removal follows SemVer: after its addition, and a major version from 1.0 on', () => {
  for (const [since, removed, allowed] of [
    ['0.1', '0.2', true],
    ['0.3', '1.0', true],
    ['1.2', '2.0', true],
    ['0.2', '0.2', false],
    ['0.3', '0.1', false],
    ['1.2', '1.5', false],
    ['1.2', '2.1', false],
    ['1.0', '1.0', false],
  ] as const) {
    const rows = rowsOf(registry(`| \`path.syntax\` | | Gone. | ${since} | ${removed} |`));
    assert.equal(checkRegistry('core.md', rows, new Set(), []).length === 0, allowed, `${since} → ${removed}`);
  }
});

test('a code listed twice is refused', () => {
  const rows = rowsOf(registry(LIVE, LIVE));
  assert.match(checkRegistry('core.md', rows, new Set(['path.syntax']), []).join('\n'), /listed twice/);
});

const DECLARATION = "export type PathIssue = { readonly code: 'path.syntax' };\n";

function fixture(registryText: string): Record<string, string> {
  return {
    'package.json': JSON.stringify({ name: 'w', private: true, workspaces: ['packages/*'] }),
    'ARCHITECTURE.md': '# Architecture\n',
    'packages/core/package.json': JSON.stringify({ name: '@yaltaan/core' }),
    'packages/core/dist/path/index.d.ts': DECLARATION,
    'docs/issue-codes/core.md': registryText,
  };
}

test('a row deleted after it was committed fails the gate, in a repository', () => {
  withRepo(fixture(registry(LIVE)), (repo) => {
    repo.git('commit', '-q', '-m', 'registry');
    assert.deepEqual(checkRepositoryIssueCodes(repo.dir).problems, []);
    // The code leaves both the declarations and the registry: only the committed version still knows it.
    repo.write({ 'packages/core/dist/path/index.d.ts': 'export {};\n', 'docs/issue-codes/core.md': registry() });
    const verdict = checkRepositoryIssueCodes(repo.dir);
    assert.match(verdict.problems.join('\n'), /path\.syntax.* was registered at [0-9a-f]+ and its row is gone/);
    assert.equal(verdict.commits, 1);
    // A deleted registry fails the same way.
    repo.write({ 'docs/issue-codes/core.md': '' });
    assert.ok(checkRepositoryIssueCodes(repo.dir).problems.length > 0);
  });
});

test('a package that declares codes without a registry fails', () => {
  const files = fixture('');
  delete files['docs/issue-codes/core.md'];
  withRepo(files, (repo) => {
    assert.match(checkRepositoryIssueCodes(repo.dir).problems.join('\n'), /core\.md is missing/);
  });
});

test('the registries of this repository match what its packages declare', () => {
  const verdict = checkRepositoryIssueCodes(repositoryRoot);
  assert.deepEqual(verdict.problems, []);
  assert.ok(verdict.codes >= 6, String(verdict.codes));
});
