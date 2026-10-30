// Numbers, ARCHITECTURE.md §7.4 and ADR 0026: a strict reading of number text, bounds, a comparison within explicit
// tolerances, rounding by the named modes of Intl.NumberFormat, and conversions between `number` and `bigint`. No
// conversion loses precision without saying so: a text that says more than the number read keeps, a `bigint` between
// two numbers and a fraction asked to become a `bigint` are issues, never a silent rounding.
//
// Text grammar of parseNumber, `decimal` and `grouping` being the separators of the options:
//   number   = [sign] integer [decimal digits] [exponent]
//   sign     = "-" | "−" (U+2212)
//   integer  = digits | group 1*(grouping 3digit), group being 1 to 3 digits, the first not 0, when `grouping`
//              is given
//   exponent = ("e" | "E") ["+" | "-"] digits, unless `exponent: false`
//   digits   = 1*[0-9]
// One pass over the code units, no regular expression: the time is linear in a length bounded before the pass.
//
// `round` rounds the shortest decimal of a number, the one `String` and `toExponential()` write, then reads back the
// nearest number: the decimal a person reads is the one rounded, as Intl.NumberFormat rounds it, never the binary
// value that `toFixed` rounds.
//
// Differences from es-toolkit 1.52.0, each checked on generated inputs by the judge of the tests:
//   - clamp, inRange: a `NaN` bound is a RangeError; es-toolkit compares with it
//   - clamp: a `min` above `max` is a RangeError; es-toolkit returns `max`
//   - clamp: a value within the bounds comes back as it is, so a zero keeps its sign; es-toolkit returns the zero
//     `Math.min` or `Math.max` chooses
//   - inRange: a `min` equal to `max` with a bound excluded is an empty range, so false; es-toolkit throws an
//     `Error`
//   - inRange: a `min` above `max` is a RangeError; es-toolkit throws an `Error`
//   - round: the shortest decimal is rounded, so 1.005 rounds to 1.01; es-toolkit rounds `x × 10^digits` in floating
//     point, then divides it, and each step may err (1.005 to 1, 1e21 to 999999999999999900000)
//   - round: `digits` that is not an integer is a RangeError; es-toolkit throws an `Error`
import { err, ok, type Result } from '../result/index.ts';
import type { Path } from '../path/index.ts';

/**
 * Why a number could not be read or converted:
 * - `number.syntax`: the text breaks the grammar at code unit `index`.
 * - `number.too_long`: the text is `length` code units long, over `maximum`.
 * - `number.out_of_range`: the value is beyond the largest finite number, or not zero and nearer to zero than the
 *   smallest.
 * - `number.inexact`: the value has `digits` significant digits, more than the nearest number keeps.
 * - `number.not_integer`: a `bigint` was asked of a fraction, `NaN` or an infinity.
 * @since 0.1
 * @experimental
 */
export type NumberIssue =
  | { readonly code: 'number.syntax'; readonly path: Path; readonly params: { readonly index: number } }
  | {
      readonly code: 'number.too_long';
      readonly path: Path;
      readonly params: { readonly length: number; readonly maximum: number };
    }
  | { readonly code: 'number.out_of_range'; readonly path: Path }
  | { readonly code: 'number.inexact'; readonly path: Path; readonly params: { readonly digits: number } }
  | { readonly code: 'number.not_integer'; readonly path: Path };

/**
 * What `parseNumber` reads.
 * @since 0.1
 * @experimental
 */
export interface ParseNumberOptions {
  /** The decimal separator, one code unit; `'.'` by default. */
  readonly decimal?: string;
  /** The group separator of the integer part, one code unit; none by default, so that no group is read. */
  readonly grouping?: string;
  /** Whether an exponent (`1.5e-7`) is read; true by default, so that every text of `String(x)` is. */
  readonly exponent?: boolean;
  /** Most code units of the text; 1,000 by default. */
  readonly maxLength?: number;
}

/**
 * The bounds of `clamp`, each inclusive and optional.
 * @since 0.1
 * @experimental
 */
export interface Bounds {
  readonly min?: number;
  readonly max?: number;
}

/**
 * The range of `inRange`: closed unless `exclusive` names the bounds it leaves out.
 * @since 0.1
 * @experimental
 */
export interface Range extends Bounds {
  readonly exclusive?: 'min' | 'max' | 'both';
}

/**
 * The tolerances of `approxEqual`: an absolute difference, non-negative, a fraction of the larger magnitude, from 0
 * to 1, or both, the wider winning.
 * @since 0.1
 * @experimental
 */
export type Tolerance =
  { readonly absolute: number; readonly relative?: number } | { readonly absolute?: number; readonly relative: number };

/**
 * A rounding mode, named as `Intl.NumberFormat`'s `roundingMode`: toward +∞ (`ceil`), −∞ (`floor`), away from zero
 * (`expand`) or toward it (`trunc`), or to the nearest with a tie broken one of those ways or to the even digit.
 * @since 0.1
 * @experimental
 */
export type RoundingMode =
  'ceil' | 'floor' | 'expand' | 'trunc' | 'halfCeil' | 'halfFloor' | 'halfExpand' | 'halfTrunc' | 'halfEven';

/**
 * What `round` does.
 * @since 0.1
 * @experimental
 */
export interface RoundOptions {
  /** Fractional digits kept, a safe integer; 0 by default, negative to round to tens, hundreds… */
  readonly digits?: number;
  readonly mode: RoundingMode;
}

const DEFAULT_MAX_LENGTH = 1000;
// Any decimal of at most 15 significant digits reads back from the nearest normal number (DBL_DIG).
const ALWAYS_EXACT_DIGITS = 15;
// The most digits `toPrecision` writes.
const MOST_PRECISE_DIGITS = 100;
const SMALLEST_NORMAL = 2.2250738585072014e-308;
const ZERO = 48;
const NINE = 57;
// A literal, not `BigInt(Number.MAX_SAFE_INTEGER)`: a bundler keeps a call at the top of a module, used or not.
const MAX_SAFE = 9_007_199_254_740_991n;
// An array, not a Set: a module of the library runs nothing when it loads.
const MODES: readonly string[] = [
  'ceil',
  'floor',
  'expand',
  'trunc',
  'halfCeil',
  'halfFloor',
  'halfExpand',
  'halfTrunc',
  'halfEven',
] satisfies readonly RoundingMode[];

function issue(code: 'number.out_of_range' | 'number.not_integer'): Result<never, NumberIssue> {
  return err({ code, path: [] });
}

function syntax(index: number): Result<never, NumberIssue> {
  return err({ code: 'number.syntax', path: [], params: { index } });
}

function inexact(digits: number): Result<never, NumberIssue> {
  return err({ code: 'number.inexact', path: [], params: { digits } });
}

function checkNumber(name: string, value: unknown): void {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number, not ${typeof value}`);
  }
}

function separator(name: string, value: string): number {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string, not ${typeof value}`);
  }
  if (value.length !== 1 || /[0-9eE+\-\u2212]/.test(value)) {
    throw new RangeError(`${name} must be one code unit, neither a digit, a sign nor an exponent mark`);
  }
  return value.charCodeAt(0);
}

function isDigit(code: number): boolean {
  return code >= ZERO && code <= NINE;
}

/**
 * Reads a number written as the grammar of this module says (`-1234.5`, `1.5e-7`, `1 234,5` with the separators of a
 * locale), or says why not. The text is untrusted: its length is bounded, a departure from the grammar is an issue at
 * the code unit where it is, and a text that says more than the number read keeps (beyond the finite numbers, below
 * the smallest, more significant digits than it holds) is refused, never rounded in silence.
 * @pure
 * @sharing none
 * @complexity O(n) (n = length of the text)
 * @throws TypeError when `text` or a separator is not a string, or `exponent` is not a boolean
 * @throws RangeError when a separator is not one code unit, is a digit, a sign or `e`, or both are the same, or
 *   when `maxLength` is neither a non-negative integer nor Infinity
 * @since 0.1
 * @experimental
 * @example parseNumber('1 234,5', { decimal: ',', grouping: ' ' }) // { ok: true, value: 1234.5 }
 */
export function parseNumber(text: string, options: ParseNumberOptions = {}): Result<number, NumberIssue> {
  if (typeof text !== 'string') {
    throw new TypeError(`parseNumber reads a string, not ${typeof text}`);
  }
  const { decimal = '.', grouping, exponent = true, maxLength = DEFAULT_MAX_LENGTH } = options;
  const decimalCode = separator('decimal', decimal);
  const groupCode = grouping === undefined ? -1 : separator('grouping', grouping);
  if (groupCode === decimalCode) {
    throw new RangeError('decimal and grouping must differ');
  }
  if (typeof exponent !== 'boolean') {
    throw new TypeError(`exponent must be a boolean, not ${typeof exponent}`);
  }
  if (!(Number.isInteger(maxLength) && maxLength >= 0) && maxLength !== Number.POSITIVE_INFINITY) {
    throw new RangeError(`maxLength must be a non-negative integer or Infinity, not ${String(maxLength)}`);
  }
  const { length } = text;
  if (length > maxLength) {
    return err({ code: 'number.too_long', path: [], params: { length, maximum: maxLength } });
  }
  let index = 0;
  let canonical = true;
  const negative = text[0] === '-' || text[0] === '\u2212';
  if (negative) {
    canonical = text[0] === '-';
    index = 1;
  }
  const leading = digitsFrom(text, index) - index;
  index += leading;
  if (leading === 0) {
    return syntax(index);
  }
  if (groupCode !== -1 && text.charCodeAt(index) === groupCode) {
    // A first group that starts with 0 is a decimal written in another locale (`0,123`), never 123.
    if (leading > 3 || text.charCodeAt(index - leading) === ZERO) {
      return syntax(index);
    }
    canonical = false;
    while (text.charCodeAt(index) === groupCode) {
      const end = digitsFrom(text, index + 1);
      if (end - index - 1 !== 3) {
        return syntax(Math.min(end, index + 4));
      }
      index = end;
    }
  }
  if (text.charCodeAt(index) === decimalCode) {
    canonical &&= decimal === '.';
    const end = digitsFrom(text, index + 1);
    if (end === index + 1) {
      return syntax(end);
    }
    index = end;
  }
  const mantissaEnd = index;
  const mark = text.charCodeAt(index);
  if (exponent && (mark === 101 || mark === 69)) {
    index += 1;
    const sign = text.charCodeAt(index);
    if (sign === 43 || sign === 45) {
      index += 1;
    }
    const end = digitsFrom(text, index);
    if (end === index) {
      return syntax(end);
    }
    index = end;
  }
  if (index !== length) {
    return syntax(index);
  }
  const plain = canonical ? text : plainText(text, negative, mantissaEnd, decimalCode);
  const value = Number(plain);
  if (!Number.isFinite(value)) {
    return issue('number.out_of_range');
  }
  const digits = significantDigits(text, mantissaEnd);
  if (digits === 0) {
    return ok(value);
  }
  if (value === 0) {
    return issue('number.out_of_range');
  }
  if (digits <= ALWAYS_EXACT_DIGITS && Math.abs(value) >= SMALLEST_NORMAL) {
    return ok(value);
  }
  // `toPrecision` rounds the number to the text's digits, which is the text in all but two cases: a text exactly
  // halfway between two decimals of its length, which `toPrecision` breaks upward, and more than 100 digits, which
  // it does not write. The exact comparison decides those.
  const magnitude = Math.abs(value);
  if (
    (digits > MOST_PRECISE_DIGITS || significant(magnitude.toPrecision(digits)) !== significant(plain)) &&
    !isWithinHalfUnit(magnitude, plain)
  ) {
    return inexact(digits);
  }
  return ok(value);
}

// The end of the run of ASCII digits that starts at `index`.
function digitsFrom(text: string, index: number): number {
  let end = index;
  while (isDigit(text.charCodeAt(end))) {
    end += 1;
  }
  return end;
}

// How many digits of the mantissa run from its first non-zero digit to its last one, separators skipped.
function significantDigits(text: string, mantissaEnd: number): number {
  let digit = 0;
  let first = -1;
  let last = -1;
  for (let index = 0; index < mantissaEnd; index += 1) {
    const code = text.charCodeAt(index);
    if (isDigit(code)) {
      if (code !== ZERO) {
        first = first === -1 ? digit : first;
        last = digit;
      }
      digit += 1;
    }
  }
  return first === -1 ? 0 : last - first + 1;
}

// The text with `-` for its sign, its groups taken out and `.` for its decimal separator: what `Number` reads.
function plainText(text: string, negative: boolean, mantissaEnd: number, decimalCode: number): string {
  let plain = negative ? '-' : '';
  for (let index = negative ? 1 : 0; index < mantissaEnd; index += 1) {
    const code = text.charCodeAt(index);
    if (isDigit(code)) {
      plain += text[index];
    } else if (code === decimalCode) {
      plain += '.';
    }
  }
  return plain + text.slice(mantissaEnd);
}

// The significant digits of a number written by `toPrecision` or of a plain text: its mantissa without sign,
// separator, leading or trailing zeros.
function significant(written: string): string {
  const end = written.search(/[eE]/);
  const mantissa = (end === -1 ? written : written.slice(0, end)).replace(/^-|\./g, '');
  return mantissa.replace(/^0+|0+$/g, '');
}

// Whether the plain text lies within half a unit of its last significant digit from the exact value of `magnitude`,
// a positive finite number: with `magnitude` = y / 2^shift and the text d × 10^e, whether 2 |d × 10^e - y / 2^shift|
// <= 10^e, in exact bigint arithmetic. Doubling a number is exact, so `y` is found without rounding.
function isWithinHalfUnit(magnitude: number, plain: string): boolean {
  let y = magnitude;
  let shift = 0;
  while (!Number.isInteger(y)) {
    y *= 2;
    shift += 1;
  }
  const end = plain.search(/[eE]/);
  const mantissa = end === -1 ? plain : plain.slice(0, end);
  const point = mantissa.indexOf('.');
  const all = mantissa.replace(/^-|\./g, '');
  const digits = all.replace(/0+$/, '');
  const exponent =
    (end === -1 ? 0 : Number(plain.slice(end + 1))) -
    (point === -1 ? 0 : mantissa.length - point - 1) +
    all.length -
    digits.length;
  const scale = 2n ** BigInt(shift);
  const power = 10n ** BigInt(Math.abs(exponent));
  const difference =
    exponent >= 0 ? BigInt(digits) * power * scale - BigInt(y) : BigInt(digits) * scale - BigInt(y) * power;
  return 2n * (difference < 0n ? -difference : difference) <= (exponent >= 0 ? power * scale : scale);
}

function bound(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  checkNumber('a bound', value);
  if (Number.isNaN(value)) {
    throw new RangeError('a bound must not be NaN');
  }
  return value;
}

// Two bounds, not an array of them: an array would be allocated on every call.
function checkOrder(min: number, max: number): void {
  if (min > max) {
    throw new RangeError('min must not be above max');
  }
}

/**
 * `value` brought within `min` and `max`: `value` itself when it is within them (so `-0` stays `-0`), the bound it
 * crosses otherwise; `NaN` stays `NaN`. A bound left out does not limit.
 * @pure
 * @sharing none
 * @complexity O(1)
 * @throws TypeError when `value` or a bound is not a number
 * @throws RangeError when a bound is `NaN`, or `min` is above `max`
 * @since 0.1
 * @experimental
 * @example clamp(12, { min: 0, max: 10 }) // 10
 */
export function clamp(value: number, bounds: Bounds): number {
  checkNumber('value', value);
  // `-Infinity` and `Infinity` rather than `Number.NEGATIVE_INFINITY`: the minifier writes them in three bytes.
  const min = bound(bounds.min, -Infinity);
  const max = bound(bounds.max, Infinity);
  checkOrder(min, max);
  return value < min ? min : value > max ? max : value;
}

/**
 * Whether `value` lies within the range: closed by default, without the bounds `exclusive` names; a bound left out
 * does not limit, excluded or not. `NaN` lies in no range, and a range whose bounds are equal and one of them excluded
 * holds nothing.
 * @pure
 * @sharing none
 * @complexity O(1)
 * @throws TypeError when `value` or a bound is not a number, or `exclusive` is not `'min'`, `'max'` or `'both'`
 * @throws RangeError when a bound is `NaN`, or `min` is above `max`
 * @since 0.1
 * @experimental
 * @example inRange(10, { min: 0, max: 10, exclusive: 'max' }) // false
 */
export function inRange(value: number, range: Range): boolean {
  checkNumber('value', value);
  const min = bound(range.min, -Infinity);
  const max = bound(range.max, Infinity);
  checkOrder(min, max);
  const { exclusive } = range;
  if (exclusive !== undefined && exclusive !== 'min' && exclusive !== 'max' && exclusive !== 'both') {
    throw new TypeError(`exclusive: ${String(exclusive)}`);
  }
  // Only a bound given is excluded: one left out does not limit, so it lets the infinity on its side in.
  const openMin = range.min !== undefined && (exclusive === 'min' || exclusive === 'both');
  const openMax = range.max !== undefined && (exclusive === 'max' || exclusive === 'both');
  return (openMin ? value > min : value >= min) && (openMax ? value < max : value <= max);
}

function tolerance(name: string, value: number | undefined, most: number): number {
  if (value === undefined) {
    return 0;
  }
  checkNumber(name, value);
  if (!(value >= 0 && value <= most)) {
    throw new RangeError(`${name} must be a number from 0 to ${String(most)}, not ${String(value)}`);
  }
  return value;
}

/**
 * Whether `a` and `b` differ by at most the wider of the absolute tolerance and the relative one times the larger
 * magnitude. Equal numbers always are (`-0` and `0`, an infinity and itself), `NaN` never is, and an infinity is
 * only to itself.
 * @pure
 * @sharing none
 * @complexity O(1)
 * @throws TypeError when `a`, `b` or a tolerance is not a number, or no tolerance is given
 * @throws RangeError when a tolerance is negative or `NaN`, or `relative` is above 1
 * @since 0.1
 * @experimental
 * @example approxEqual(0.1 + 0.2, 0.3, { relative: 1e-9 }) // true
 */
export function approxEqual(a: number, b: number, within: Tolerance): boolean {
  checkNumber('a', a);
  checkNumber('b', b);
  if (within.absolute === undefined && within.relative === undefined) {
    throw new TypeError('approxEqual needs an absolute or a relative tolerance');
  }
  const absolute = tolerance('absolute', within.absolute, Infinity);
  // Above 1, a relative tolerance means nothing, and `relative * max` could overflow to a false `true`.
  const relative = tolerance('relative', within.relative, 1);
  if (a === b) {
    return true;
  }
  if (!(Number.isFinite(a) && Number.isFinite(b))) {
    return false;
  }
  return Math.abs(a - b) <= Math.max(absolute, relative * Math.max(Math.abs(a), Math.abs(b)));
}

// Whether the kept digits move one unit away from zero, given the first digit dropped and whether a non-zero digit
// follows it. The digits dropped are never all zeros: the shortest decimal ends with a non-zero digit.
function roundsAway(mode: RoundingMode, negative: boolean, lastKept: number, dropped: number, rest: boolean): boolean {
  switch (mode) {
    case 'trunc':
      return false;
    case 'expand':
      return true;
    case 'ceil':
      return !negative;
    case 'floor':
      return negative;
    default:
      break;
  }
  if (dropped !== 5 || rest) {
    return dropped >= 5;
  }
  switch (mode) {
    case 'halfCeil':
      return !negative;
    case 'halfFloor':
      return negative;
    case 'halfExpand':
      return true;
    case 'halfTrunc':
      return false;
    default:
      return lastKept % 2 === 1;
  }
}

// The decimal digits of `digits` plus one, as text: `'199'` gives `'200'`, `'99'` gives `'100'`.
function increment(digits: string): string {
  let index = digits.length - 1;
  while (index >= 0 && digits[index] === '9') {
    index -= 1;
  }
  if (index === -1) {
    return `1${'0'.repeat(digits.length)}`;
  }
  return digits.slice(0, index) + String(Number(digits[index]) + 1) + '0'.repeat(digits.length - index - 1);
}

/**
 * `value` rounded to `digits` fractional digits by `mode`, on its shortest decimal (the one `String` writes), then
 * read back as the nearest number: `1.005` rounds to `1.01`, as `Intl.NumberFormat` rounds it. `NaN`, the infinities
 * and the zeros come back as they are, and a negative value rounded to zero gives `-0`.
 * @pure
 * @sharing none
 * @complexity O(1)
 * @throws TypeError when `value` is not a number, or `mode` is not a rounding mode
 * @throws RangeError when `digits` is not a safe integer, or the result is beyond the largest finite number
 * @since 0.1
 * @experimental
 * @example round(2.345, { digits: 2, mode: 'halfEven' }) // 2.34
 */
export function round(value: number, options: RoundOptions): number {
  checkNumber('value', value);
  const { digits = 0, mode } = options;
  if (!Number.isSafeInteger(digits)) {
    throw new RangeError(`digits must be a safe integer, not ${String(digits)}`);
  }
  if (!MODES.includes(mode)) {
    throw new TypeError(`mode: ${String(mode)}`);
  }
  if (!Number.isFinite(value) || value === 0) {
    return value;
  }
  // `d.ddde±x`: the shortest digits, the first one in the units place of 10^x.
  const written = value.toExponential();
  const negative = value < 0;
  const mark = written.indexOf('e');
  const mantissa = written.slice(negative ? 1 : 0, mark).replace('.', '');
  const kept = Number(written.slice(mark + 1)) + 1 + digits;
  if (kept >= mantissa.length) {
    return value;
  }
  const head = kept > 0 ? mantissa.slice(0, kept) : '';
  const dropped = kept >= 0 ? mantissa.charCodeAt(kept) - ZERO : 0;
  const rest = kept < 0 || kept + 1 < mantissa.length;
  const lastKept = head === '' ? 0 : head.charCodeAt(head.length - 1) - ZERO;
  const away = roundsAway(mode, negative, lastKept, dropped, rest);
  const units = away ? increment(head === '' ? '0' : head) : head;
  if (units === '') {
    return negative ? -0 : 0;
  }
  const result = Number(`${negative ? '-' : ''}${units}e${String(-digits)}`);
  if (!Number.isFinite(result)) {
    throw new RangeError(`${String(value)} rounded to ${String(digits)} digits is beyond the largest finite number`);
  }
  return result;
}

/**
 * The number equal to `value`, or why there is none: `number.out_of_range` beyond the largest finite number,
 * `number.inexact` between two numbers, where `Number(value)` would round in silence.
 * @pure
 * @sharing none
 * @complexity O(d) (d = digits of `value`)
 * @throws TypeError when `value` is not a bigint
 * @since 0.1
 * @experimental
 * @example bigIntToNumber(2n ** 53n + 1n).ok // false
 */
export function bigIntToNumber(value: bigint): Result<number, NumberIssue> {
  if (typeof value !== 'bigint') {
    throw new TypeError(`bigIntToNumber reads a bigint, not ${typeof value}`);
  }
  const number = Number(value);
  if (value >= -MAX_SAFE && value <= MAX_SAFE) {
    return ok(number);
  }
  if (!Number.isFinite(number)) {
    return issue('number.out_of_range');
  }
  if (BigInt(number) !== value) {
    return inexact(significant(String(value)).length);
  }
  return ok(number);
}

/**
 * The `bigint` equal to `value`, an integer (`-0` gives `0n`), or `number.not_integer` for a fraction, `NaN` or an
 * infinity.
 * @pure
 * @sharing none
 * @complexity O(1)
 * @throws TypeError when `value` is not a number
 * @since 0.1
 * @experimental
 * @example numberToBigInt(2 ** 60) // { ok: true, value: 1152921504606846976n }
 */
export function numberToBigInt(value: number): Result<bigint, NumberIssue> {
  checkNumber('value', value);
  return Number.isInteger(value) ? ok(BigInt(value)) : issue('number.not_integer');
}
