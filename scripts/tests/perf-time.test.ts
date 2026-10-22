import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatHeader, formatNs, formatPasses, formatTable, passSpread, type TimeRow } from '../lib/perf-time.ts';

const environment = {
  date: '2026-01-01T00:00:00.000Z',
  cpu: 'Example CPU',
  processors: 8,
  pinned: 3,
  os: 'Example OS, kernel 1.0, x64',
  power: 'mains, governor performance',
  runtime: 'Node v24.0.0, V8 13.6',
  command: 'scripts/perf-time.sh --passes 2',
  warmupMs: 100,
  budgetMs: 500,
  passes: 2,
  loadBefore: [1, 2, 3],
  loadAfter: [1.5, 2, 3],
};

function row(variant: string, pass: number, p50: number, withAlloc: boolean): TimeRow {
  return {
    scenario: 'omit',
    variant,
    pass,
    time: {
      batch: 256,
      floor: 0.75,
      summary: { samples: 40, p50, p99: p50 * 2, min: p50 - 1, max: p50 * 3, mean: p50 + 1, margin: 0.5, rme: 1.25 },
    },
    alloc: withAlloc
      ? {
          heap: { calls: 1000, bytes: 48, min: 48, max: 48 },
          check: { calls: 1000, bytes: 49.5, min: 49, max: 50 },
        }
      : null,
  };
}

test('nanoseconds keep two decimals below 10, one below 1 000, none above', () => {
  assert.deepEqual([0.256, -0.256, 34.94, 1234.6].map(formatNs), ['0.26', '-0.26', '34.9', '1235']);
});

test('the header publishes every field a reader needs beside the figures', () => {
  const header = formatHeader(environment).join('\n');
  for (const field of [
    'Example CPU, 8 logical processors; every measured process pinned to processor 3',
    'Example OS',
    'mains, governor performance',
    'Node v24.0.0',
    'Command: scripts/perf-time.sh --passes 2',
    'Warmup: 100 ms',
    'budget: 500 ms',
    '2 passes',
    'at least 10 µs',
    'floor',
    'heap growth',
    'collections let run',
    'Load average: 1.00 2.00 3.00 before',
  ]) {
    assert.ok(header.includes(field), field);
  }
});

test('a row shows pass, batch, samples, floor, quantiles, margin and allocations; later passes no allocations', () => {
  const table = formatTable([row('native/micro', 1, 9.5, true), row('native/micro', 2, 10.5, false)]).split('\n');
  assert.equal(
    table[2],
    '| omit | native/micro | 1 | 256 | 40 | 0.75 | 9.50 | 19.0 | 8.50 | 28.5 | 10.5 ± 0.50 | 1.25 % ' +
      '| 48.0 [48, 48] | 49.5 |',
  );
  assert.equal(
    table[3],
    '| omit | native/micro | 2 | 256 | 40 | 0.75 | 10.5 | 21.0 | 9.50 | 31.5 | 11.5 ± 0.50 | 1.25 % |  |  |',
  );
});

test('the spread across passes is the range of p50 over its median', () => {
  const rows = [row('native/micro', 1, 9, false), row('native/micro', 2, 11, false), row('native/micro', 3, 10, false)];
  assert.deepEqual(passSpread(rows), [{ key: 'omit native/micro', min: 9, median: 10, max: 11, spread: 20 }]);
  assert.match(formatPasses(rows), /\| omit \| native\/micro \| 9\.00 \| 10\.0 \| 11\.0 \| 20\.0 % \|/);
});
