// clamp, inRange and round against their es-toolkit equivalents, on numbers drawn among the ones that tell them
// apart: the zeros, NaN, the infinities, bounds that cross or meet, decimals on a tie, and digit counts that are not
// integers. es-toolkit takes its bounds by position: `clamp(x, max)` or `clamp(x, min, max)`, `inRange(x, max)` for
// [0, max) or `inRange(x, min, max)` for [min, max), so that ours is called with the same range, `exclusive: 'max'`
// for inRange; its round is ours in the `halfCeil` mode of `Math.round`.
// Blind spots: es-toolkit has no other rounding mode, nor approxEqual, parseNumber or the bigint conversions: their
// judges are Intl.NumberFormat, Number and exact arithmetic, in the laws of the other test files.
import { clamp as theirClamp, inRange as theirInRange, round as theirRound } from 'es-toolkit';

import { createJudge, fc, type Difference } from '@yaltaan/testing';

import { clamp, inRange, round } from './index.ts';

const judge = createJudge(new URL('./index.ts', import.meta.url), 'es-toolkit');

type Call = readonly [value: number, first: number, second: number | undefined];

const values = fc.constantFrom(-2, -1, -0, 0, 0.5, 1, 2, Number.NaN, Number.POSITIVE_INFINITY, -Infinity);
const bounds = fc.constantFrom(-1, -0, 0, 1, 2, Number.NaN, Number.POSITIVE_INFINITY, -Infinity);
const calls: fc.Arbitrary<Call> = fc.tuple(
  fc.oneof(values, fc.double()),
  bounds,
  fc.option(bounds, { nil: undefined, freq: 3 }),
);

const nanBound: Difference<Call> = {
  text: 'a `NaN` bound is a RangeError; es-toolkit compares with it',
  applies: ([, first, second]) => Number.isNaN(first) || (second !== undefined && Number.isNaN(second)),
};

judge.compare('clamp', {
  input: calls,
  ours: ([value, first, second]) => clamp(value, second === undefined ? { max: first } : { min: first, max: second }),
  theirs: ([value, first, second]) =>
    second === undefined ? theirClamp(value, first) : theirClamp(value, first, second),
  differences: [
    nanBound,
    {
      text: 'a `min` above `max` is a RangeError; es-toolkit returns `max`',
      applies: ([, first, second]) => second !== undefined && first > second,
    },
    {
      text:
        'a value within the bounds comes back as it is, so a zero keeps its sign; es-toolkit returns the zero ' +
        '`Math.min` or `Math.max` chooses',
      // Math.min and Math.max choose between two zeros by their sign, ours by their order alone.
      applies: (call) => call.filter((each) => each === 0).length >= 2,
    },
  ],
});

// inRange's range as es-toolkit reads it: [0, first) with one bound, [first, second) with two.
const rangeOf = ([, first, second]: Call): [min: number, max: number] =>
  second === undefined ? [0, first] : [first, second];

judge.compare('inRange', {
  input: calls,
  ours: (call) => {
    const [min, max] = rangeOf(call);
    return inRange(call[0], { min, max, exclusive: 'max' });
  },
  theirs: ([value, first, second]) =>
    second === undefined ? theirInRange(value, first) : theirInRange(value, first, second),
  differences: [
    nanBound,
    {
      text: 'a `min` equal to `max` with a bound excluded is an empty range, so false; es-toolkit throws an `Error`',
      applies: (call) => rangeOf(call)[0] === rangeOf(call)[1],
    },
    {
      text: 'a `min` above `max` is a RangeError; es-toolkit throws an `Error`',
      applies: (call) => rangeOf(call)[0] > rangeOf(call)[1],
    },
  ],
});

// A finite number as an odd integer times a power of two, exactly; zero as 0n.
function dyadic(value: number): [odd: bigint, exponent: number] {
  if (value === 0) {
    return [0n, 0];
  }
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  let odd = (bits & ((1n << 52n) - 1n)) | (biased === 0 ? 0n : 1n << 52n);
  let exponent = (biased === 0 ? 1 : biased) - 1075;
  while ((odd & 1n) === 0n) {
    odd >>= 1n;
    exponent += 1;
  }
  return [bits >> 63n === 1n ? -odd : odd, exponent];
}

// Whether `product` is exactly `a × b`, with no rounding.
function isExactProduct(a: number, b: number, product: number): boolean {
  if (!Number.isFinite(product)) {
    return false;
  }
  const [oddA, exponentA] = dyadic(a);
  const [oddB, exponentB] = dyadic(b);
  const [odd, exponent] = dyadic(product);
  return oddA * oddB === odd && (odd === 0n || exponentA + exponentB === exponent);
}

// Whether every step of es-toolkit's `Math.round(x × 10^digits) / 10^digits` is exact: the power of ten, the
// product, and the quotient, which must be the decimal `units`e-`digits`. Then it rounds the exact value of x.
function isExactInFloatingPoint(value: number, digits: number): boolean {
  const multiplier = 10 ** digits;
  const product = value * multiplier;
  const units = Math.round(product);
  return (
    digits >= 0 &&
    digits <= 22 &&
    isExactProduct(value, multiplier, product) &&
    units / multiplier === Number(`${String(units)}e${String(-digits)}`)
  );
}

// Numbers whose binary value is a short decimal (integers, halves, quarters, eighths), which es-toolkit rounds
// exactly, beside any number.
const decimals = fc.oneof(
  { arbitrary: fc.double(), weight: 1 },
  {
    arbitrary: fc
      .tuple(fc.integer({ min: -99_999, max: 99_999 }), fc.integer({ min: 0, max: 4 }))
      .map(([numerator, power]) => numerator / 2 ** power),
    weight: 4,
  },
);

judge.compare('round', {
  input: fc.tuple(
    decimals,
    fc.oneof(
      { arbitrary: fc.integer({ min: -2, max: 6 }), weight: 9 },
      { arbitrary: fc.constantFrom(0.5, -1.5), weight: 1 },
    ),
  ),
  ours: ([value, digits]) => round(value, { digits, mode: 'halfCeil' }),
  theirs: ([value, digits]) => theirRound(value, digits),
  differences: [
    {
      text: '`digits` that is not an integer is a RangeError; es-toolkit throws an `Error`',
      applies: ([, digits]) => !Number.isInteger(digits),
    },
    {
      text:
        'the shortest decimal is rounded, so 1.005 rounds to 1.01; es-toolkit rounds `x × 10^digits` in floating ' +
        'point, then divides it, and each step may err (1.005 to 1, 1e21 to 999999999999999900000)',
      applies: ([value, digits]) => Number.isFinite(value) && value !== 0 && !isExactInFloatingPoint(value, digits),
    },
  ],
});
