import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { gzipSync } from 'node:zlib';

import { packPackage } from '../check-package-contents.ts';
import { readTarball } from '../lib/tarball.ts';
import { repositoryRoot } from '../lib/workspace.ts';
import { paxPath, tarEntry, writeTarball } from './tarball-fixtures.ts';

const folders: string[] = [];
after(() => {
  for (const folder of folders) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("a tarball npm packs is read entry by entry, with npm's fixed date and modes", () => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-test-'));
  folders.push(destination);
  const packed = packPackage(path.join(repositoryRoot, 'packages/core'), 'packages/core', destination);
  assert.ok(packed.ok, packed.ok ? '' : packed.problem);
  const read = readTarball(fs.readFileSync(packed.file));
  assert.ok(read.ok, read.ok ? '' : read.problem);
  const paths = read.entries.map((entry) => entry.path);
  assert.ok(paths.includes('package/package.json') && paths.includes('package/dist/result/index.js'), String(paths));
  const manifest = read.entries.find((entry) => entry.path === 'package/package.json');
  assert.equal(JSON.parse(manifest?.bytes.toString('utf8') ?? '{}').name, '@yaltaan/core');
  // 1985-10-26 08:15 UTC: the date npm gives every entry, so that a tarball does not depend on when it was made.
  assert.ok(read.entries.every((entry) => entry.mtime === 499162500 && entry.mode === 0o644));
});

test('files, their bytes and a pax path are read; the end of the archive is its zero-filled block', () => {
  const read = readTarball(
    writeTarball([
      { path: 'package/a.js', bytes: 'export {};\n' },
      paxPath(`package/${'long/'.repeat(30)}b.js`),
      tarEntry({ path: 'ignored-short-name', bytes: 'x'.repeat(600) }),
      { path: 'package/empty.txt' },
    ]),
  );
  assert.ok(read.ok, read.ok ? '' : read.problem);
  assert.deepEqual(
    read.entries.map((entry) => [entry.path, entry.bytes.length]),
    [
      ['package/a.js', 11],
      [`package/${'long/'.repeat(30)}b.js`, 600],
      ['package/empty.txt', 0],
    ],
  );
});

test('an entry that is not a regular file, a stream that is not gzip and an archive cut short are refused', () => {
  const cases: [Buffer, string][] = [
    [writeTarball([{ path: 'package/link', type: '2' }]), 'of type "2", not a regular file'],
    [writeTarball([{ path: 'package/dist', type: '5' }]), 'of type "5", not a regular file'],
    [Buffer.from('not gzip'), 'not a gzip stream'],
    [writeTarball([{ path: 'package/a.js', bytes: 'a' }], false), 'without its closing zero-filled block'],
    [gzipSync(tarEntry({ path: 'package/a.js', bytes: 'x'.repeat(700) }).subarray(0, 600)), 'past the end'],
  ];
  const broken = tarEntry({ path: 'package/a.js' });
  broken.write('zz', 124, 'latin1');
  cases.push([writeTarball([broken]), 'not octal']);
  for (const [compressed, fragment] of cases) {
    const read = readTarball(compressed);
    assert.ok(!read.ok && read.problem.includes(fragment), `${fragment}: ${JSON.stringify(read)}`);
  }
});
