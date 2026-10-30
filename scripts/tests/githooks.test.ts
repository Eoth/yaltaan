import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { repositoryRoot, withRepo } from './run-script.ts';

// Every hook of githooks/ that hands over to a local hook of the clone, found in the hooks themselves: a hook added
// later is judged without editing this file. The scripts a hook calls are stubbed, so that only the hand-over runs.
const HOOKS = fs
  .readdirSync(path.join(repositoryRoot, 'githooks'))
  .map((name) => ({ name, source: fs.readFileSync(path.join(repositoryRoot, 'githooks', name), 'utf8') }))
  .filter(({ source }) => /hooks\/[\w-]+\.local/.test(source));

function stubs(source: string): Record<string, string> {
  const files: Record<string, string> = { 'msg.txt': 'fix(core): keep the order\n' };
  for (const [script] of source.matchAll(/scripts\/[\w.-]+\.(?:sh|ts)/g)) {
    files[script] = script.endsWith('.sh') ? 'exit 0\n' : '';
  }
  return files;
}

function runHook(
  name: string,
  source: string,
  local: { mode: number } | undefined,
): { status: number | null; stderr: string } {
  return withRepo(stubs(source), (repo) => {
    for (const script of Object.keys(stubs(source)).filter((file) => file.endsWith('.sh'))) {
      fs.chmodSync(path.join(repo.dir, script), 0o755);
    }
    if (local !== undefined) {
      const file = path.join(repo.dir, '.git', 'hooks', `${name}.local`);
      fs.writeFileSync(file, '#!/usr/bin/env bash\nexit 7\n');
      fs.chmodSync(file, local.mode);
    }
    return repo.run(`githooks/${name}`, 'msg.txt');
  });
}

test('the hooks that hand over to a local hook are found', () => {
  assert.deepEqual(HOOKS.map(({ name }) => name).sort(), ['commit-msg', 'pre-commit']);
});

for (const { name, source } of HOOKS) {
  test(
    `${name}: passes without a local hook, runs an executable one, refuses one it cannot run`,
    {
      skip: process.platform === 'win32' ? 'no execute bit on Windows' : false,
    },
    () => {
      assert.equal(runHook(name, source, undefined).status, 0);
      assert.equal(runHook(name, source, { mode: 0o755 }).status, 7);
      const skipped = runHook(name, source, { mode: 0o644 });
      assert.equal(skipped.status, 1);
      assert.match(skipped.stderr, /exists but is not executable/);
    },
  );
}
