import assert from 'node:assert/strict';
import { test } from 'node:test';

import { quantile, summarize, tCritical95 } from './statistics.ts';

test('a quantile interpolates between the two closest ranks', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([10], 0.99), 10);
  assert.equal(quantile([0, 100], 0.99), 99);
  assert.equal(quantile([1, 2, 3], 0), 1);
  assert.equal(quantile([1, 2, 3], 1), 3);
  assert.throws(() => quantile([], 0.5), /needs values/);
  assert.throws(() => quantile([1], 1.5), /rank in \[0, 1\]/);
});

test("Student's critical value matches the tables within 0.1 % from 10 degrees of freedom", () => {
  for (const [df, table] of [
    [10, 2.228],
    [29, 2.045],
    [100, 1.984],
    [1e9, 1.96],
  ] as const) {
    assert.ok(Math.abs(tCritical95(df) / table - 1) < 0.001, `${df}: ${tCritical95(df)}`);
  }
  assert.throws(() => tCritical95(0), /at least 1/);
});

test('a summary subtracts the floor from every figure', () => {
  const summary = summarize([12, 11, 13, 14, 10], 1);
  assert.deepEqual(
    { p50: summary.p50, min: summary.min, max: summary.max, mean: summary.mean, samples: summary.samples },
    { p50: 11, min: 9, max: 13, mean: 11, samples: 5 },
  );
  assert.equal(summary.p99, 12.96);
  // Standard deviation √2.5, t(4) by the expansion 2.770 against 2.776 in the tables.
  assert.ok(Math.abs(summary.margin - (tCritical95(4) * Math.sqrt(2.5)) / Math.sqrt(5)) < 1e-12);
  assert.equal(summary.rme, (summary.margin / 11) * 100);
});

test('a summary of an empty function has no relative margin', () => {
  assert.equal(summarize([0.9, 0.95, 1], 1).rme, Infinity);
  assert.throws(() => summarize([1], 0), /at least two samples/);
});
