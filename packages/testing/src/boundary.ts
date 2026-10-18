// Boundary values: the empty and absent values, the numbers that IEEE 754 makes special, the extremes of each
// numeric type, and lengths that a quadratic or recursive implementation does not survive.
import fc from 'fast-check';

import { defineCategory, named, type Category } from './category.ts';

/** Long enough that a quadratic algorithm takes visible time, short enough to build in a millisecond. */
export const LONG_LENGTH = 1 << 16;

export const boundary: Category<unknown> = defineCategory<unknown>(
  'boundary',
  [
    named('undefined', () => undefined),
    named('null', () => null),
    named('empty string', () => ''),
    named('empty array', () => []),
    named('empty object', () => ({})),
    named('NaN', () => Number.NaN),
    named('-0', () => -0),
    named('Infinity', () => Number.POSITIVE_INFINITY),
    named('-Infinity', () => Number.NEGATIVE_INFINITY),
    named('largest safe integer', () => Number.MAX_SAFE_INTEGER),
    named('smallest safe integer', () => Number.MIN_SAFE_INTEGER),
    named('largest number', () => Number.MAX_VALUE),
    named('smallest positive number', () => Number.MIN_VALUE),
    named('zero bigint', () => 0n),
    named('very large bigint', () => 2n ** 128n),
    named('very small bigint', () => -(2n ** 128n)),
    named('very long string', () => 'x'.repeat(LONG_LENGTH)),
    named('very long array', () => Array.from({ length: LONG_LENGTH }, (_, index) => index)),
  ],
  // fc.double() yields NaN, -0 and both infinities among its values by default.
  fc.oneof(
    fc.constantFrom(undefined, null),
    fc.boolean(),
    fc.integer(),
    fc.double(),
    fc.bigInt(),
    fc.string(),
    fc.array(fc.integer(), { maxLength: 8 }),
  ),
);
