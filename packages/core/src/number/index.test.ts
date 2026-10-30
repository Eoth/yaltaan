// clamp, inRange, approxEqual and round. The judge of round is the platform: Intl.NumberFormat rounds the same
// decimal by the same nine modes, to fractional digits (`maximumFractionDigits`) and, for the tens and above, to
// significant digits (`maximumSignificantDigits`).
// Blind spots: Intl.NumberFormat cannot judge a rounding to more than 100 fractional digits, nor to a place above
// the 21st significant digit; there the laws of order and idempotence hold alone.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { declareAdversarial, fc, HostileError } from '@yaltaan/testing';

import { liveCodes } from '../../../../scripts/check-issue-codes.ts';
import {
  approxEqual,
  clamp,
  inRange,
  round,
  type Bounds,
  type NumberIssue,
  type Range,
  type RoundingMode,
  type Tolerance,
} from './index.ts';

const SUBPATH = '@yaltaan/core/number';
const PROPERTIES = { numRuns: 1000 };
const MODES: readonly RoundingMode[] = [
  'ceil',
  'floor',
  'expand',
  'trunc',
  'halfCeil',
  'halfFloor',
  'halfExpand',
  'halfTrunc',
  'halfEven',
];

const same = (actual: number, expected: number, message?: string): void => {
  assert.ok(Object.is(actual, expected), message ?? `${String(actual)} is not ${String(expected)}`);
};

test('clamp brings a value within its bounds, and leaves one within them as it is', () => {
  assert.equal(clamp(12, { min: 0, max: 10 }), 10);
  assert.equal(clamp(-3, { min: 0, max: 10 }), 0);
  assert.equal(clamp(4, { min: 0, max: 10 }), 4);
  assert.equal(clamp(-3, { min: 0 }), 0);
  assert.equal(clamp(Number.POSITIVE_INFINITY, { max: 1 }), 1);
  assert.equal(clamp(5, {}), 5);
  same(clamp(-0, { min: 0, max: 1 }), -0);
  same(clamp(Number.NaN, { min: 0, max: 1 }), Number.NaN);
  assert.equal(clamp(3, { min: 3, max: 3 }), 3);
  assert.throws(() => clamp(1, { min: 2, max: 1 }), RangeError);
  assert.throws(() => clamp(1, { min: Number.NaN }), RangeError);
  assert.throws(() => clamp('1' as unknown as number, {}), TypeError);
  assert.throws(() => clamp(1, { max: '2' as unknown as number }), TypeError);
});

test('inRange is closed by default and leaves out the bounds exclusive names', () => {
  assert.equal(inRange(10, { min: 0, max: 10 }), true);
  assert.equal(inRange(10, { min: 0, max: 10, exclusive: 'max' }), false);
  assert.equal(inRange(0, { min: 0, max: 10, exclusive: 'min' }), false);
  assert.equal(inRange(0, { min: 0, max: 10, exclusive: 'max' }), true);
  assert.equal(inRange(5, { min: 5, max: 5 }), true);
  assert.equal(inRange(5, { min: 5, max: 5, exclusive: 'both' }), false);
  assert.equal(inRange(10, { min: 0, max: 10, exclusive: 'both' }), false);
  assert.equal(inRange(-0, { min: 0 }), true);
  assert.equal(inRange(Number.NaN, {}), false);
  assert.equal(inRange(Number.NEGATIVE_INFINITY, {}), true);
  // A bound left out does not limit, even when exclusive names it.
  assert.equal(inRange(Number.NEGATIVE_INFINITY, { max: 0, exclusive: 'both' }), true);
  assert.equal(inRange(Number.POSITIVE_INFINITY, { exclusive: 'max' }), true);
  assert.equal(inRange(Number.NaN, { exclusive: 'both' }), false);
  assert.throws(() => inRange(1, { min: 2, max: 1 }), RangeError);
  assert.throws(() => inRange(1, { max: Number.NaN }), RangeError);
  assert.throws(() => inRange(1, { exclusive: 'neither' as 'min' }), TypeError);
});

const number = fc.oneof(
  fc.double(),
  fc.integer({ min: -5, max: 5 }),
  fc.constantFrom(-0, 0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
);
const bounds: fc.Arbitrary<Bounds> = fc
  .tuple(
    fc.option(fc.double({ noNaN: true }), { nil: undefined }),
    fc.option(fc.double({ noNaN: true }), { nil: undefined }),
  )
  .map(([a, b]) => {
    if (a !== undefined && b !== undefined && a > b) {
      return { min: b, max: a };
    }
    return { ...(a === undefined ? {} : { min: a }), ...(b === undefined ? {} : { max: b }) };
  });

test('clamp lands in the closed range, keeps a value within it, and is monotone and idempotent', () => {
  fc.assert(
    fc.property(number, number, bounds, (x, y, range) => {
      const clamped = clamp(x, range);
      if (Number.isNaN(x)) {
        same(clamped, Number.NaN);
        return;
      }
      assert.ok(inRange(clamped, range));
      if (inRange(x, range)) {
        same(clamped, x);
      } else {
        same(clamped, x < (range.min ?? Number.NEGATIVE_INFINITY) ? range.min! : range.max!);
      }
      same(clamp(clamped, range), clamped);
      if (!Number.isNaN(y) && x <= y) {
        assert.ok(clamped <= clamp(y, range));
      }
    }),
    PROPERTIES,
  );
});

test('inRange with an excluded bound is the closed range without that bound', () => {
  fc.assert(
    fc.property(number, bounds, fc.constantFrom(undefined, 'min', 'max', 'both'), (drawn, range, exclusive) => {
      // The bounds themselves are checked on every draw: a random number is seldom one of them.
      for (const x of [drawn, range.min ?? drawn, range.max ?? drawn]) {
        const closed = inRange(x, range);
        // The closed range holds exactly what clamp leaves where it is.
        assert.equal(closed, !Number.isNaN(x) && clamp(x, range) === x);
        const outMin = (exclusive === 'min' || exclusive === 'both') && x === range.min;
        const outMax = (exclusive === 'max' || exclusive === 'both') && x === range.max;
        const options: Range = exclusive === undefined ? range : { ...range, exclusive };
        assert.equal(inRange(x, options), closed && !outMin && !outMax);
      }
    }),
    PROPERTIES,
  );
});

test('approxEqual compares within the wider of two explicit tolerances', () => {
  assert.equal(approxEqual(0.1 + 0.2, 0.3, { relative: 1e-9 }), true);
  assert.equal(approxEqual(0.1 + 0.2, 0.3, { absolute: 0 }), false);
  assert.equal(approxEqual(1e-12, 0, { relative: 1e-9 }), false);
  assert.equal(approxEqual(1e-12, 0, { relative: 1e-9, absolute: 1e-9 }), true);
  assert.equal(approxEqual(100, 101, { relative: 0.01 }), true);
  assert.equal(approxEqual(100, 102, { relative: 0.01 }), false);
  // Relative to the larger magnitude, as math.isclose: 1.6 is within 1.58 % of 101.6, not of 100.
  assert.equal(approxEqual(100, 101.6, { relative: 0.0158 }), true);
  assert.equal(approxEqual(101.6, 100, { relative: 0.0157 }), false);
  assert.equal(approxEqual(-0, 0, { absolute: 0 }), true);
  assert.equal(approxEqual(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, { absolute: 0 }), true);
  assert.equal(approxEqual(Number.POSITIVE_INFINITY, 1, { absolute: Number.POSITIVE_INFINITY }), false);
  // Any relative tolerance of an infinity is infinite: an infinity is still near itself only.
  assert.equal(approxEqual(Number.POSITIVE_INFINITY, 1, { relative: 0.5 }), false);
  assert.equal(approxEqual(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, { relative: 1 }), false);
  assert.equal(approxEqual(Number.NaN, Number.NaN, { absolute: Number.POSITIVE_INFINITY }), false);
  assert.equal(approxEqual(1, 2, { absolute: Number.POSITIVE_INFINITY }), true);
  assert.throws(() => approxEqual(1, 1, {} as Tolerance), TypeError);
  assert.throws(() => approxEqual(1, 1, { absolute: -1 }), RangeError);
  assert.throws(() => approxEqual(1, 1, { relative: Number.NaN }), RangeError);
  // Above 1, a relative tolerance means nothing, and would overflow: 1.1 x 1.7e308 is infinite.
  assert.throws(() => approxEqual(1.7e308, -1.7e308, { relative: 1.1 }), RangeError);
  assert.equal(approxEqual(1.7e308, -1.7e308, { relative: 1 }), false);
  assert.equal(approxEqual(1, 1.5, { absolute: 0.5 }), true);
  assert.throws(() => approxEqual(1, '1' as unknown as number, { absolute: 1 }), TypeError);
  // Never called: the lines below are checked by the compiler only.
  const rejected = (): void => {
    // @ts-expect-error a tolerance is required
    approxEqual(1, 1, {});
  };
  void rejected;
});

const tolerance: fc.Arbitrary<Tolerance> = fc.oneof(
  fc.record({ absolute: fc.double({ min: 0, noNaN: true }) }),
  fc.record({ relative: fc.double({ min: 0, max: 1, noNaN: true }) }),
  fc.record({ absolute: fc.double({ min: 0, noNaN: true }), relative: fc.double({ min: 0, max: 1, noNaN: true }) }),
);

test('approxEqual is reflexive, symmetric, monotone in its tolerances, and exact at zero tolerance', () => {
  fc.assert(
    fc.property(number, number, tolerance, (a, b, within) => {
      const near = approxEqual(a, b, within);
      assert.equal(approxEqual(b, a, within), near);
      assert.equal(approxEqual(a, a, within), !Number.isNaN(a));
      assert.equal(approxEqual(a, b, { absolute: 0, relative: 0 }), a === b);
      if (near) {
        const wider = { absolute: (within.absolute ?? 0) * 2, relative: Math.min(1, (within.relative ?? 0) * 2) };
        assert.ok(approxEqual(a, b, wider));
      }
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        assert.equal(near, a === b);
      }
      // A relative tolerance holds at every scale: doubling both numbers changes no bit of their ratio.
      if (within.absolute === undefined && Math.abs(a) < 1e300 && Math.abs(b) < 1e300) {
        if (Math.abs(a) > 1e-300 && Math.abs(b) > 1e-300) {
          assert.equal(approxEqual(a * 2, b * 2, within), near);
        }
      }
    }),
    PROPERTIES,
  );
});

test('round rounds the shortest decimal by each named mode', () => {
  const at = (value: number, digits: number, mode: RoundingMode): number => round(value, { digits, mode });
  assert.equal(at(1.005, 2, 'halfExpand'), 1.01);
  assert.equal(at(0.15, 1, 'halfEven'), 0.2);
  assert.equal(at(0.25, 1, 'halfEven'), 0.2);
  assert.equal(at(2.345, 2, 'halfEven'), 2.34);
  assert.equal(at(2.5, 0, 'halfEven'), 2);
  assert.equal(at(3.5, 0, 'halfEven'), 4);
  assert.equal(at(-2.5, 0, 'halfCeil'), -2);
  assert.equal(at(-2.5, 0, 'halfFloor'), -3);
  assert.equal(at(-2.5, 0, 'halfExpand'), -3);
  assert.equal(at(-2.5, 0, 'halfTrunc'), -2);
  assert.equal(at(1.21, 1, 'ceil'), 1.3);
  assert.equal(at(-1.21, 1, 'ceil'), -1.2);
  assert.equal(at(1.29, 1, 'floor'), 1.2);
  assert.equal(at(-1.21, 1, 'expand'), -1.3);
  assert.equal(at(-1.29, 1, 'trunc'), -1.2);
  assert.equal(at(1234, -2, 'halfExpand'), 1200);
  assert.equal(at(99, -1, 'halfExpand'), 100);
  assert.equal(at(0.0004, 2, 'ceil'), 0.01);
  assert.equal(at(0.0004, 2, 'halfExpand'), 0);
  assert.equal(at(1e21, 2, 'halfCeil'), 1e21);
  assert.equal(at(5, -400, 'floor'), 0);
  same(at(-0.4, 0, 'halfExpand'), -0);
  same(at(-0, 3, 'ceil'), -0);
  same(at(Number.NaN, 1, 'floor'), Number.NaN);
  same(at(Number.NEGATIVE_INFINITY, 1, 'ceil'), Number.NEGATIVE_INFINITY);
  assert.equal(round(7.5, { mode: 'halfEven' }), 8);
  assert.throws(() => at(Number.MAX_VALUE, -308, 'ceil'), RangeError);
  assert.throws(() => at(1, 0.5, 'ceil'), RangeError);
  assert.throws(() => at(1, 2 ** 53, 'ceil'), RangeError);
  assert.throws(() => at(1, 0, 'up' as RoundingMode), TypeError);
  assert.throws(() => round('1' as unknown as number, { mode: 'ceil' }), TypeError);
  // Never called: the lines below are checked by the compiler only.
  const rejected = (): void => {
    // @ts-expect-error a mode is required
    round(1, { digits: 2 });
  };
  void rejected;
});

const finite = fc.double({ noNaN: true, noDefaultInfinity: true });
// Decimals that stand on a tie of their last digit, and their neighbours, beside any number.
const decimals = fc.oneof(
  finite,
  fc
    .tuple(fc.integer({ min: -99_999, max: 99_999 }), fc.integer({ min: 0, max: 8 }), fc.constantFrom(5, 4, 6))
    .map(([head, places, last]) => Number(`${String(head)}${String(last)}e-${String(places + 1)}`)),
);
const formats = new Map<string, Intl.NumberFormat>();
function intl(options: Intl.NumberFormatOptions & { roundingMode: RoundingMode }): Intl.NumberFormat {
  const name = JSON.stringify(options);
  let format = formats.get(name);
  if (format === undefined) {
    format = new Intl.NumberFormat('en-US', { ...options, useGrouping: false });
    formats.set(name, format);
  }
  return format;
}

test('round to fractional digits gives what Intl.NumberFormat writes', () => {
  fc.assert(
    fc.property(decimals, fc.integer({ min: 0, max: 20 }), fc.constantFrom(...MODES), (x, digits, mode) => {
      const written = intl({ maximumFractionDigits: digits, roundingMode: mode }).format(x);
      same(round(x, { digits, mode }), Number(written), `${String(x)} to ${String(digits)} by ${mode}: ${written}`);
    }),
    PROPERTIES,
  );
});

test('round to tens and above gives what Intl.NumberFormat writes at the same significant digits', () => {
  fc.assert(
    fc.property(decimals, fc.integer({ min: -12, max: 0 }), fc.constantFrom(...MODES), (x, digits, mode) => {
      fc.pre(x !== 0);
      // The place of the first digit: x is d.ddd × 10^exponent.
      const exponent = Number(x.toExponential().split('e')[1]);
      const significant = exponent + 1 + digits;
      fc.pre(significant >= 1 && significant <= 21);
      const written = intl({ maximumSignificantDigits: significant, roundingMode: mode }).format(x);
      same(round(x, { digits, mode }), Number(written), `${String(x)} to ${String(digits)} by ${mode}: ${written}`);
    }),
    PROPERTIES,
  );
});

test('round is idempotent, ordered by mode, and writes no more digits than asked', () => {
  fc.assert(
    fc.property(decimals, fc.integer({ min: -30, max: 30 }), fc.constantFrom(...MODES), (x, digits, mode) => {
      let rounded: number;
      try {
        rounded = round(x, { digits, mode });
      } catch (error) {
        // Only a rounding up past the largest finite number may throw.
        assert.ok(error instanceof RangeError && Math.abs(x) > 1e277, String(error));
        return;
      }
      same(round(rounded, { digits, mode }), rounded);
      const all = (name: RoundingMode): number => round(x, { digits, mode: name });
      assert.ok(all('floor') <= x && x <= all('ceil'));
      assert.ok(
        all('floor') <= all('halfFloor') && all('halfFloor') <= all('halfCeil') && all('halfCeil') <= all('ceil'),
      );
      assert.ok(Math.abs(all('trunc')) <= Math.abs(x) && Math.abs(x) <= Math.abs(all('expand')));
      // The sign is kept, a zero's included: a negative value or -0 rounds to a negative value or -0.
      const negative = x < 0 || Object.is(x, -0);
      assert.ok(negative ? rounded < 0 || Object.is(rounded, -0) : rounded > 0 || Object.is(rounded, 0));
      if (digits >= 0 && Math.abs(rounded) >= 1e-6 && Math.abs(rounded) < 1e21) {
        const fraction = String(rounded).split('.')[1] ?? '';
        assert.ok(fraction.length <= digits, `${String(rounded)} holds more than ${String(digits)} digits`);
      }
      if (Number.isInteger(x) && digits >= 0) {
        same(rounded, x);
      }
    }),
    PROPERTIES,
  );
});

test('the codes of this module are the number codes of the registry', () => {
  // Keyed, so that the compiler checks the list is whole.
  const codes: { readonly [Code in NumberIssue['code']]: true } = {
    'number.syntax': true,
    'number.too_long': true,
    'number.out_of_range': true,
    'number.inexact': true,
    'number.not_integer': true,
  };
  const registered = [...liveCodes('core')].filter((code) => code.startsWith('number.'));
  assert.deepEqual(registered.toSorted(), Object.keys(codes).toSorted());
});

// What may come out for an adversarial value: a result, a TypeError or a RangeError (an argument of the wrong type,
// a bound that is NaN, a digit count that is no safe integer), or the error of the hostile value itself.
function survives(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    assert.ok(
      error instanceof HostileError || error instanceof TypeError || error instanceof RangeError,
      String(error),
    );
  }
}

const CALLS = {
  clamp: (value: unknown, option: unknown) => {
    survives(() => clamp(value as number, { min: 0, max: 1 }));
    survives(() => clamp(0.5, { min: option as number }));
    survives(() => clamp(0.5, option as Bounds));
  },
  inRange: (value: unknown, option: unknown) => {
    survives(() => inRange(value as number, { min: 0, max: 1 }));
    survives(() => inRange(0.5, { max: option as number, exclusive: 'max' }));
    survives(() => inRange(0.5, option as Range));
  },
  approxEqual: (value: unknown, option: unknown) => {
    survives(() => approxEqual(value as number, 1, { relative: 1e-9 }));
    survives(() => approxEqual(1, 1, { absolute: option as number }));
    survives(() => approxEqual(1, 1, option as Tolerance));
  },
  round: (value: unknown, option: unknown) => {
    survives(() => round(value as number, { digits: 2, mode: 'halfEven' }));
    survives(() => round(1.5, { digits: option as number, mode: 'halfEven' }));
    survives(() => round(1.5, option as { mode: RoundingMode }));
  },
} as const;

for (const [name, call] of Object.entries(CALLS)) {
  const handles = (value: unknown): void => {
    call(value, value);
  };
  declareAdversarial(SUBPATH, name, {
    boundary: (value) => {
      handles(value);
      // A number is never refused for its value: only bounds, tolerances and digit counts have a domain.
      if (typeof value === 'number') {
        call(value, 1);
        if (name === 'clamp' && !Number.isNaN(value)) {
          assert.ok(inRange(clamp(value, { min: 0, max: 1 }), { min: 0, max: 1 }));
        }
      }
    },
    structures: handles,
    hostile: handles,
    unicode: { na: `${name} takes no text` },
    callbacks: { na: `${name} takes no callback` },
    async: { na: `${name} is synchronous and takes no signal` },
  });
}
