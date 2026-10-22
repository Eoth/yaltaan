// The timed harness checked end to end on bench/perf/fixtures/calibration.ts, through the command a maintainer runs.
// Not a `.test.ts` file: a clock read while the other test files run side by side reads their load, so the gate runs
// this file alone, after the test run. Even alone, the machine may be shared, so each check reads three passes and
// the checks get a second attempt before they fail.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TimeRow } from '../../scripts/lib/perf-time.ts';
import { perfTime, pinning } from './run-perf-time.ts';

function median(rows: readonly TimeRow[], variant: string, pick: (row: TimeRow) => number): number {
  const values = rows
    .filter((row) => row.variant === variant)
    .map(pick)
    .sort((a, b) => a - b);
  assert.equal(values.length, 3, variant);
  return values[1] ?? NaN;
}

/** The failures of one timed run of the calibration; empty when the harness reads as it should. */
function timingFailures(rows: readonly TimeRow[]): string[] {
  const failures: string[] = [];
  const p50 = (variant: string): number => median(rows, variant, (row) => row.time.summary.p50);
  const floor = median(rows, 'floor/micro', (row) => row.time.floor);
  if (!(Math.abs(p50('empty/micro')) < 1)) {
    failures.push(`an empty function reads ${p50('empty/micro')} ns, not within 1 ns of zero`);
  }
  if (!(floor > 0 && Math.abs(p50('floor/micro')) < floor / 3)) {
    failures.push(`the floor function reads ${p50('floor/micro')} ns over a floor of ${floor} ns, not zero`);
  }
  // Load only ever slows a pass down: the fastest pass of each workload is the one the machine left alone.
  const fastest = (variant: string): number =>
    Math.min(...rows.filter((row) => row.variant === variant).map((row) => row.time.summary.p50));
  const ratio = fastest('double/micro') / fastest('work/micro');
  if (!(ratio >= 1.8 && ratio <= 2.2)) {
    failures.push(`twice the work reads ${ratio} times the time, outside [1.8, 2.2]`);
  }
  for (const { variant, pass, time } of rows) {
    const sample = time.batch * (time.summary.p50 + time.floor);
    if (!(sample >= 10_000) || time.summary.samples < 30) {
      failures.push(`${variant}, pass ${pass}: median sample ${sample} ns, ${time.summary.samples} samples`);
    }
  }
  return failures;
}

test('the harness reads an empty function as zero, its own floor as zero, and twice the work as twice the time', () => {
  const args = [
    ...pinning(),
    '--passes',
    '3',
    '--budget',
    '100',
    '--no-alloc',
    '^calibration (empty|floor|work|double)/',
  ];
  let failures = timingFailures(perfTime(args));
  if (failures.length > 0) {
    failures = [...failures.map((failure) => `first attempt: ${failure}`), ...timingFailures(perfTime(args))];
    assert.deepEqual(
      failures.filter((failure) => !failure.startsWith('first attempt')),
      [],
      failures.join('\n'),
    );
  }
});
