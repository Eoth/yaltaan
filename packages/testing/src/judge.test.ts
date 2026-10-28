import assert from 'node:assert/strict';
import { test } from 'node:test';

import fc from 'fast-check';

import { checkClaimed, documentedDifferences, runComparison } from './judge.ts';

const MODULE = `// A module.
//
// Differences from lib 1.0.0, each checked:
//   - first, second: a difference whose line is long enough
//     to go on
//   - second: another one
// Not a line of the block.
//   - third: after the block, never read
export const x = 1;
`;

test('documentedDifferences reads one pair per function and line, continuations joined', () => {
  assert.deepEqual(
    [...documentedDifferences(MODULE, 'lib 1.0.0')],
    [
      'first: a difference whose line is long enough to go on',
      'second: a difference whose line is long enough to go on',
      'second: another one',
    ],
  );
});

test('documentedDifferences throws when the block of the reference version is missing', () => {
  assert.throws(() => documentedDifferences(MODULE, 'lib 2.0.0'), /no line "\/\/ Differences from lib 2.0.0"/);
});

test('checkClaimed throws on a documented pair that no comparison claimed', () => {
  checkClaimed(new Set(['f: a']), new Set(['f: a']));
  assert.throws(() => checkClaimed(new Set(['f: a', 'g: b']), new Set(['f: a'])), /checked by no comparison: g: b/);
});

const integers = fc.integer({ min: -50, max: 50 });

test('runComparison passes when both sides agree, and counts what it compared', () => {
  const report = runComparison('agree', { input: integers, ours: (n) => n * 2, theirs: (n) => n + n, numRuns: 200 });
  assert.equal(report, '200 of 200 inputs compared,  left to a difference');
});

test('runComparison throws on one input where the sides disagree, outside every difference', () => {
  assert.throws(
    () => runComparison('disagree', { input: integers, ours: (n) => n, theirs: (n) => (n === 7 ? 0 : n) }),
    /Property failed/,
  );
});

test('runComparison compares the name of what each side throws', () => {
  const fail = (error: Error) => () => {
    throw error;
  };
  runComparison('same error', { input: integers, ours: fail(new TypeError('a')), theirs: fail(new TypeError('b')) });
  assert.throws(
    () =>
      runComparison('other error', { input: integers, ours: fail(new TypeError()), theirs: fail(new RangeError()) }),
    /Property failed/,
  );
});

test('runComparison leaves an input to the difference that applies to it', () => {
  const report = runComparison('negatives', {
    input: integers,
    ours: (n) => Math.abs(n),
    theirs: (n) => n,
    differences: [{ text: 'negatives', applies: (n) => n < 0 }],
    numRuns: 400,
  });
  assert.match(report, /^\d+ of 400 inputs compared, \d+ left to a difference$/);
});

test('runComparison throws on a difference that no input reaches, or that changes no outcome', () => {
  const unreached = { text: 'never', applies: () => false };
  assert.throws(
    () => runComparison('unreached', { input: integers, ours: (n) => n, theirs: (n) => n, differences: [unreached] }),
    /"never" reached by 0 inputs/,
  );
  const unchanged = { text: 'odd', applies: (n: number) => n % 2 !== 0 };
  assert.throws(
    () => runComparison('unchanged', { input: integers, ours: (n) => n, theirs: (n) => n, differences: [unchanged] }),
    /"odd" reached by \d+ inputs, changed 0/,
  );
});

test('runComparison throws when less than a quarter of the inputs are compared', () => {
  const wide = { text: 'most', applies: (n: number) => n > -40 };
  assert.throws(
    () =>
      runComparison('wide', { input: integers, ours: (n) => n, theirs: (n) => (n > -40 ? 0 : n), differences: [wide] }),
    /only \d+ of 1000 inputs compared/,
  );
});

test('runComparison checks a difference against what it says ours returns, when it says so', () => {
  const doubled = {
    text: 'doubled',
    applies: (n: number) => n > 0,
    expected: (theirs: unknown) => (theirs as number) * 2,
  };
  runComparison('expected', {
    input: integers,
    ours: (n) => (n > 0 ? 2 * n : n),
    theirs: (n) => n,
    differences: [doubled],
  });
  assert.throws(
    () =>
      runComparison('unexpected', {
        input: integers,
        ours: (n) => (n > 0 ? 3 * n : n),
        theirs: (n) => n,
        differences: [doubled],
      }),
    /Property failed/,
  );
});
