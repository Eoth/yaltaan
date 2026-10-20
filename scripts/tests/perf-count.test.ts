import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  callgrindTotal,
  changePercent,
  formatTable,
  formatTsv,
  judge,
  parseVariant,
  spreadPercent,
  toJavaScript,
  workPerCall,
} from '../lib/perf-count.ts';

test('a variant name is a side and a known dataset', () => {
  assert.deepEqual(parseVariant('native/micro'), { side: 'native', dataset: 'micro' });
  assert.deepEqual(parseVariant('es-toolkit/pathological'), { side: 'es-toolkit', dataset: 'pathological' });
  for (const name of ['native', 'native/huge', 'Native/micro', 'native/micro/x', '/micro', 'native/']) {
    assert.equal(parseVariant(name), undefined, name);
  }
});

test("Callgrind's total is its summary line, or its totals line without one", () => {
  assert.equal(callgrindTotal('version: 1\nevents: Ir\nfn=main\n1 5\nsummary: 422081923\ntotals: 1\n'), 422081923);
  assert.equal(callgrindTotal('events: Ir\ntotals: 1234\n'), 1234);
  assert.throws(() => callgrindTotal('events: Ir\n'), /neither a summary nor a totals line/);
});

test('the work of one call is the difference of two processes over the extra calls', () => {
  assert.equal(workPerCall(93_000_000, 93_000_000 + 4 * 2500, 4), 2500);
  assert.throws(() => workPerCall(1, 2, 0), /positive integer/);
  assert.throws(() => workPerCall(1, 2, 1.5), /positive integer/);
});

test('the spread of repeated counts is relative to the smallest', () => {
  assert.equal(spreadPercent([1000, 1001, 1000.5]), 0.1);
  assert.equal(spreadPercent([1000]), 0);
  assert.equal(changePercent(200, 210), 5);
});

test('a change past the threshold is more or less work, within it the same work', () => {
  const a = new Map([
    ['omit native/micro', 1000],
    ['omit native/realistic', 1000],
    ['omit native/pathological', 1000],
    ['login native/micro', 1000],
  ]);
  const b = new Map([
    ['omit native/micro', 1050],
    ['omit native/realistic', 1000.9],
    ['omit native/pathological', 990],
    ['omit yaltaan/micro', 10],
  ]);
  const verdicts = judge(a, b, 0.1).map((row) => `${row.name}: ${row.verdict}`);
  assert.deepEqual(verdicts, [
    'login native/micro: only in A',
    'omit native/micro: MORE work',
    'omit yaltaan/micro: only in B',
    'omit native/realistic: same work',
    'omit native/pathological: less work',
  ]);
});

test('a regression of one tenth of a percent and a hair is caught, one of a tenth is not', () => {
  const a = new Map([['s native/micro', 1_000_000]]);
  assert.equal(judge(a, new Map([['s native/micro', 1_001_001]]), 0.1)[0]?.verdict, 'MORE work');
  assert.equal(judge(a, new Map([['s native/micro', 1_001_000]]), 0.1)[0]?.verdict, 'same work');
});

test('the table carries both counts, the signed change and the verdict', () => {
  const rows = judge(
    new Map([
      ['omit native/micro', 12851.04],
      ['omit es-toolkit/micro', 5026.9],
    ]),
    new Map([
      ['omit native/micro', 12851.04],
      ['omit es-toolkit/micro', 5278.25],
    ]),
    0.1,
  );
  assert.equal(
    formatTable(rows),
    [
      '| Scenario | Variant | A, instructions per call | B, instructions per call | Change | Verdict |',
      '|---|---|---:|---:|---:|---|',
      '| omit | es-toolkit/micro | 5,026.9 | 5,278.3 | +5.000 % | MORE work |',
      '| omit | native/micro | 12,851.0 | 12,851.0 | 0.000 % | same work |',
    ].join('\n'),
  );
  assert.equal(formatTsv(rows).split('\n')[1], 'omit\tes-toolkit/micro\t5026.9\t5278.25\t5.000099\tMORE work');
});

test('a module becomes JavaScript: types erased, relative .ts imports pointed at .js', () => {
  const source = [
    "import { omit } from 'es-toolkit';",
    "import { seededRandom, type PerfScenario } from '../scenario.ts';",
    'import type { Other } from "./other.ts";',
    "const later = await import('./lazy.ts');",
    'const calls: number = 2;',
    "export const name = 'not/a/path.ts';",
  ].join('\n');
  const output = toJavaScript(source);
  assert.match(output, /from 'es-toolkit'/);
  assert.match(output, /from '\.\.\/scenario\.js'/);
  assert.match(output, /import\('\.\/lazy\.js'\)/);
  assert.match(output, /'not\/a\/path\.ts'/);
  assert.doesNotMatch(output, /PerfScenario|Other|: number/);
  // Stripping keeps every line where it was, so that an error in the counted process points at the source line.
  assert.equal(output.split('\n').length, source.split('\n').length);
});
