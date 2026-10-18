import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';

import { parseInternalPackages, readInternalPackages, textBlockAfter } from '../lib/internal-packages.ts';
import { repositoryRoot } from '../lib/workspace.ts';

test('the internal packages are the folders of the text block after the heading', () => {
  const read = parseInternalPackages(
    '# Doc\n\nInternal packages, never published:\n\n```text\ntesting\n\nmocks\n```\n',
  );
  assert.deepEqual(read.ok ? [...read.names] : read.problem, ['testing', 'mocks']);
});

test('a document without the heading has no internal package', () => {
  const read = parseInternalPackages('# Doc\n\n```text\ntesting\n```\n');
  assert.deepEqual(read.ok ? [...read.names] : read.problem, []);
});

test('a heading whose block cannot be read, or a name that is not a folder, is a problem', () => {
  for (const [markdown, fragment] of [
    ['Internal packages:\n\ntesting\n', 'no `text` block after the line "Internal packages…"'],
    ['Internal packages:\n\n```ts\ntesting\n```\n', 'no `text` block'],
    ['Internal packages:\n\n```text\ntesting\n', 'no `text` block'],
    ['Internal packages:\n\n```text\n@yaltaan/testing\n```\n', 'internal package "@yaltaan/testing" is not a folder'],
  ] as const) {
    const read = parseInternalPackages(markdown);
    assert.ok(!read.ok && read.problem.includes(fragment), `${markdown}: ${JSON.stringify(read)}`);
  }
});

test('a text block is read after the first line that starts with its heading', () => {
  const markdown = 'A\n```text\nx\n```\nB heading\n```text\ny\nz\n```\n';
  assert.deepEqual(textBlockAfter(markdown, 'B'), { ok: true, lines: ['y', 'z'] });
  assert.deepEqual(textBlockAfter(markdown, 'C'), { ok: false });
});

test('this repository lists testing as its internal package', () => {
  const read = readInternalPackages(repositoryRoot);
  assert.deepEqual(read.ok ? [...read.names] : read.problem, ['testing']);
});

test('run as a program, it prints each internal package folder for the shell guards', () => {
  const script = path.join(repositoryRoot, 'scripts', 'lib', 'internal-packages.ts');
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'testing\n');
});
