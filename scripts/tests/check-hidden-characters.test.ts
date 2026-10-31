import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { findHidden } from '../../packages/core/src/string/index.ts';
import { repositoryRoot, withRepo, type FixtureRepo, type RunResult } from './run-script.ts';

// The check runs from this repository, so that it imports the library it judges by, on the fixture as the working
// directory.
function check(repo: FixtureRepo, ...args: string[]): RunResult {
  const script = path.join(repositoryRoot, 'scripts/check-hidden-characters.ts');
  const result = spawnSync(process.execPath, [script, ...args], { cwd: repo.dir, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Every code point the library reports, read from it rather than listed here.
function everyHidden(): ReturnType<typeof findHidden> {
  const parts: string[] = [];
  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint < 0xd800 || codePoint > 0xdfff) {
      parts.push(String.fromCodePoint(codePoint));
    }
  }
  return findHidden(parts.join(''));
}

test('hidden characters: clean files pass, escapes, tabs, line breaks and visible letters included', () => {
  const files = {
    'a.ts': "const rlo = '\\u202E';\nconst zwj = '\\u{200D}';\n",
    'b.md': '# Titre\n\nCr\u00e8me br\u00fbl\u00e9e, \u2026 et \u{1F600}.\n',
    'c.tsv': 'a\tb\r\nc\td\r\n',
    'd.txt': 'page\fbreak\n',
  };
  withRepo(files, (repo) => {
    const result = check(repo);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^ok: 4 text files/);
    assert.equal(check(repo, '--cached').status, 0);
  });
});

test('hidden characters: each kind the library reports is refused, with its file, line and code point', () => {
  const hidden = everyHidden();
  // The first and the last code point of each kind, and every 61st, each in a file of its own on a line of its own.
  // U+0000 aside: git takes a file that holds it for binary, a blind spot the check names.
  const chosen = hidden.filter(
    (each, at) =>
      each.codePoint !== 0 &&
      (at % 61 === 0 ||
        hidden.findIndex(({ kind }) => kind === each.kind) === at ||
        hidden.findLastIndex(({ kind }) => kind === each.kind) === at),
  );
  assert.deepEqual(new Set(chosen.map(({ kind }) => kind)), new Set(['bidi', 'invisible', 'control']));
  const files = Object.fromEntries(
    chosen.map(({ codePoint }) => [`f${codePoint.toString(16)}.txt`, `first\nx${String.fromCodePoint(codePoint)}y\n`]),
  );
  withRepo(files, (repo) => {
    for (const mode of [[], ['--cached']]) {
      const result = check(repo, ...mode);
      assert.equal(result.status, 1);
      const reported = result.stderr.split('\n').filter((line) => line.startsWith('f'));
      assert.deepEqual(
        reported.toSorted(),
        chosen
          .map(({ codePoint, kind }) => {
            const name = codePoint.toString(16).toUpperCase().padStart(4, '0');
            return `f${codePoint.toString(16)}.txt:2: U+${name} (${kind}) written as it is: write it as an escape`;
          })
          .toSorted(),
      );
    }
  });
});

test('hidden characters: the working tree includes untracked files, the index only what is staged', () => {
  withRepo({ 'a.ts': 'const a = 1;\n' }, (repo) => {
    fs.writeFileSync(path.join(repo.dir, 'b.ts'), 'const b = "\u202E";\n');
    assert.equal(check(repo).status, 1);
    assert.equal(check(repo, '--cached').status, 0);
    repo.git('add', 'b.ts');
    fs.writeFileSync(path.join(repo.dir, 'b.ts'), 'const b = 1;\n');
    assert.equal(check(repo).status, 0);
    assert.equal(check(repo, '--cached').status, 1);
  });
});

test('hidden characters: a file git takes for binary is left out', () => {
  withRepo({ 'a.bin': '\u0000\u0001\u202E' }, (repo) => {
    assert.equal(check(repo).status, 0);
  });
});
