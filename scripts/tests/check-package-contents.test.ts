import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkPackedFiles, checkRepositoryPackageContents } from '../check-package-contents.ts';
import { repositoryRoot } from '../lib/workspace.ts';

const BASE = ['package.json', 'README.md', 'LICENSE'];

test('a tarball of the manifest, readme, licence and built output passes', () => {
  const built = ['dist/result/index.js', 'dist/result/index.d.ts', 'dist/result/index.d.ts.map', 'dist/a.js.map'];
  assert.deepEqual(checkPackedFiles([...BASE, ...built], 'packages/core'), []);
});

test('tests, fixtures, sources and unlisted files are refused', () => {
  for (const file of ['dist/a.test.js', 'dist/tests/a.js', 'dist/fixtures/a.json', 'src/a.ts', 'tsconfig.json']) {
    assert.equal(checkPackedFiles([...BASE, file], 'packages/core').length, 1, file);
  }
});

test('a tarball without its manifest or its licence is refused', () => {
  assert.equal(checkPackedFiles(['README.md', 'LICENSE'], 'packages/core').length, 1);
  assert.equal(checkPackedFiles(['package.json', 'README.md'], 'packages/core').length, 1);
});

test('the packages of this repository pack only allowed files', () => {
  assert.deepEqual(checkRepositoryPackageContents(repositoryRoot).problems, []);
});
