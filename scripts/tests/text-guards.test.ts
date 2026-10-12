import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { repositoryRoot, withRepo } from './run-script.ts';

const TEXT = 'scripts/check-text-format.sh';
const COMMENTS = 'scripts/check-comment-hygiene.sh';
const SIZE = 'scripts/check-file-size.sh';
const TICKETS = 'scripts/check-roadmap-tickets.sh';
const EXECUTABLE = 'scripts/check-executable-scripts.sh';

function status(files: Readonly<Record<string, string>>, script: string, ...args: string[]): number | null {
  return withRepo(files, (repo) => repo.run(script, ...args).status);
}

test('text format: clean files pass', () => {
  const files = {
    'a.ts': '/**\n * @pure\n */\nexport const x = 1;\n',
    'b.md': '# Title\n\nOne paragraph on one line.\n\n- item\n  - nested item\n\n```\ncode\nmore code\n```\n',
    'c.ts': `const s = '${'é'.repeat(100)}';\n`,
    LICENSE: `${'x'.repeat(200)}\n`,
  };
  assert.equal(status(files, TEXT), 0);
});

test('text format: each rule refuses its violation', () => {
  for (const [label, files] of [
    ['a tab in the indentation', { 'a.ts': '\tconst x = 1;\n' }],
    ['an odd indentation', { 'a.ts': 'if (x) {\n   y();\n}\n' }],
    ['121 characters, multibyte ones counted once', { 'a.ts': `// ${'é'.repeat(118)}\n` }],
    ['a trailing space', { 'a.ts': 'const x = 1; \n' }],
    ['no final newline', { 'a.ts': 'const x = 1;' }],
    ['a wrapped Markdown paragraph', { 'a.md': 'First half of a sentence\nand its second half.\n' }],
    ['a wrapped list item', { 'a.md': '- an item that goes on\nover a second line\n' }],
  ] as const) {
    assert.equal(status(files, TEXT), 1, label);
  }
});

test('text format: --cached judges the staged content', () => {
  withRepo({ 'a.ts': 'const x = 1;\n' }, (repo) => {
    fs.writeFileSync(path.join(repo.dir, 'a.ts'), '\tconst x = 1;\n');
    assert.equal(repo.run(TEXT, '--cached').status, 0);
    assert.equal(repo.run(TEXT).status, 1);
  });
});

test('comment hygiene: dates, roadmap references and ticket identifiers are refused in comments only', () => {
  assert.equal(
    status({ 'a.ts': "const url = 'https://example.org/2026-10-12';\n// Why: SameValueZero.\n" }, COMMENTS),
    0,
  );
  for (const comment of ['// fixed on 2026-10-12', '/* see ROADMAP.md */', ' * done in T0.1', '// T12.3 follow-up']) {
    assert.equal(status({ 'a.ts': `${comment}\nexport {};\n` }, COMMENTS), 1, comment);
  }
  assert.equal(status({ 'a.sh': '#!/usr/bin/env bash\n# written 2026-10-12\n' }, COMMENTS), 1);
});

function sizeFixture(extra: Readonly<Record<string, string>>): Record<string, string> {
  const caps = fs.readFileSync(path.join(repositoryRoot, 'docs/file-size-caps.tsv'), 'utf8');
  return { 'docs/file-size-caps.tsv': caps, ...extra };
}

test('file size: production files stay within 1200 lines and hold no test', () => {
  const lines = (n: number): string => 'export const x = 1;\n'.repeat(n);
  assert.equal(status(sizeFixture({ 'packages/core/src/a.ts': lines(1200) }), SIZE), 0);
  assert.equal(status(sizeFixture({ 'packages/core/src/a.ts': lines(1201) }), SIZE), 1);
  assert.equal(status(sizeFixture({ 'packages/core/src/a.test.ts': lines(1500) }), SIZE), 0);
  assert.equal(status(sizeFixture({ 'packages/core/src/a.ts': "describe('x', () => {});\n" }), SIZE), 1);
});

test('roadmap tickets: a number opened twice, or open and closed, is refused', () => {
  const ticket = (id: string): string => `#### ${id} — title\n- **Pourquoi** : x.\n\n`;
  const closed = (id: string): string => `| Ticket | Commit |\n|---|---|\n| ${id} | \`abc\` |\n`;
  assert.equal(status({ 'ROADMAP.md': ticket('T0.1') + ticket('T0.2') + closed('T0.3') }, TICKETS), 0);
  assert.equal(status({ 'ROADMAP.md': ticket('T0.1') + ticket('T0.1') }, TICKETS), 1);
  assert.equal(status({ 'ROADMAP.md': ticket('T0.2') + closed('T0.2') }, TICKETS), 1);
  assert.equal(status({ 'ROADMAP.md': ticket('T1.6') + closed('T1.6 a') }, TICKETS), 0);
  // --cached on an index without the roadmap says so and passes; the working tree mode still needs the file.
  withRepo({ 'a.txt': 'x\n' }, (repo) => {
    const cached = repo.run(TICKETS, '--cached');
    assert.equal(cached.status, 0);
    assert.match(cached.stdout, /not applicable/);
    assert.equal(repo.run(TICKETS).status, 1);
  });
});

test('executable scripts: a shebang file must be recorded executable', () => {
  withRepo({ 'tool.sh': '#!/usr/bin/env bash\necho hi\n', 'notes.md': '#! not a shebang\n' }, (repo) => {
    assert.equal(repo.run(EXECUTABLE).status, 1);
    repo.git('update-index', '--chmod=+x', 'tool.sh');
    assert.equal(repo.run(EXECUTABLE).status, 0);
  });
});
