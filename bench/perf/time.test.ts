// The allocation reading checked end to end on bench/perf/fixtures/calibration.ts, through the command a maintainer
// runs. The timing checks, which a clock shared with the rest of the test run would disturb, live in
// time.serial-test.ts, which the gate runs alone.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { perfTime } from './run-perf-time.ts';

test('both readings of the bytes a call allocates agree with the heap layout', () => {
  const rows = perfTime(['--passes', '1', '--budget', '20', '^calibration (empty|object|array)/']);
  // These variants keep what they allocate, so the optimizing compiler has nothing to remove and the V8 layout gives
  // the bytes: the published reading and its check must both find them.
  const bytes = (variant: string): { heap: number; check: number } => {
    const alloc = rows.find((row) => row.variant === variant)?.alloc;
    const [heap, check] = [alloc?.heap.bytes, alloc?.check.bytes];
    assert.ok(typeof heap === 'number' && typeof check === 'number', variant);
    return { heap, check };
  };
  const empty = bytes('empty/micro');
  assert.ok(Math.abs(empty.heap) < 1 && Math.abs(empty.check) < 1, JSON.stringify(empty));
  const object = bytes('object/micro');
  assert.ok(Math.abs(object.heap - 48) < 1 && Math.abs(object.check - 48) < 1, JSON.stringify(object));
  // Heap growth also counts the end of each 256 KB page that an 8 KB array no longer fits in: up to 3 % more.
  const array = bytes('array/micro');
  for (const value of [array.heap, array.check]) {
    assert.ok(value >= 8048 && value < 8048 * 1.03, JSON.stringify(array));
  }
});
