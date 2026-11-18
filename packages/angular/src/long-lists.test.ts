// The bench of a keystroke in a long list (bench/long-lists.ts) still runs: on 20, 40 and 80 rows, once, it prints a
// line for each form and case. What it measures is judged by hand, on 1,000 rows and more, never by the gate, where
// another process would move the figures.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const bench = fileURLToPath(new URL('../bench/long-lists.ts', import.meta.url));

test('the bench of long lists runs, and prints the three forms in the three cases at n, 2n and 4n rows', () => {
  const ran = spawnSync(process.execPath, [bench, '20', '1'], { encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  const lines = ran.stdout.trim().split('\n');
  assert.equal(lines.length, 9, ran.stdout);
  for (const line of lines) {
    assert.match(
      line,
      /^(bridge|by hand|no rule) +\S.* {2}20: [\d.]+ ms {2}40: [\d.]+ ms {2}80: [\d.]+ ms {2}4n\/n [\d.]+$/,
    );
  }
});
