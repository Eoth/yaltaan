// Runs the timed harness's command on bench/perf/fixtures/calibration.ts and returns its rows, for the harness's tests.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TimeRow } from '../../scripts/lib/perf-time.ts';

const command = fileURLToPath(new URL('../../scripts/perf-time.ts', import.meta.url));

/**
 * On a hybrid processor, the last fast core, to pin the measured processes to: a process placed on a slow core for its
 * whole life reads a quarter slower than its neighbour, which no choice among passes undoes. Linux lists the fast
 * cores of an Intel hybrid processor; elsewhere, and without taskset, nothing is pinned.
 */
export function pinning(): string[] {
  try {
    const fast = fs.readFileSync('/sys/devices/cpu_core/cpus', 'utf8').trim().split(/[,-]/).at(-1);
    return spawnSync('taskset', ['-V']).status === 0 && fast !== undefined ? ['--cpu', fast] : [];
  } catch {
    return [];
  }
}

/** The rows of one run of the command on the calibration variants, with a short warmup. */
export function perfTime(args: readonly string[]): TimeRow[] {
  const result = spawnSync(
    process.execPath,
    [command, '--folder', 'bench/perf/fixtures', '--warmup', '30', '--json', ...args],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { rows: TimeRow[] }).rows;
}
