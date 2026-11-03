/// <reference lib="esnext.temporal" preserve="true" />
// Intervals over any Temporal value that can be ordered: plain values, half-open, the empty one explicit. One function
// compares two bounds, and refuses a mix that Temporal itself would answer unevenly: `compare` ignores the calendar and
// accepts another kind without a word, and two implementations read each other as bags of fields, or throw.
import { ok, type Result } from '@yaltaan/core/result';
import { failure, type TemporalIssue } from './shared.ts';

const MAX_INTERVALS = 1_000_000;

/**
 * A value an interval can hold: every Temporal class that has `compare`.
 * @since 0.3
 * @experimental
 */
export type IntervalBound =
  | Temporal.PlainDate
  | Temporal.PlainDateTime
  | Temporal.PlainTime
  | Temporal.PlainYearMonth
  | Temporal.Instant
  | Temporal.ZonedDateTime;

/**
 * An interval that holds something: from `start`, included, to `end`, left out; `start` comes first.
 * @since 0.3
 * @experimental
 */
export interface Span<T extends IntervalBound> {
  readonly start: T;
  readonly end: T;
}

/**
 * The interval that holds nothing.
 * @since 0.3
 * @experimental
 */
export interface EmptyInterval {
  readonly start: undefined;
  readonly end: undefined;
}

/**
 * An interval, half-open: a span, or nothing.
 * @since 0.3
 * @experimental
 */
export type Interval<T extends IntervalBound> = Span<T> | EmptyInterval;

/**
 * The interval that holds nothing.
 * @since 0.3
 * @experimental
 */
export const emptyInterval: EmptyInterval = { start: undefined, end: undefined };

const isSpan = <T extends IntervalBound>(one: Interval<T>): one is Span<T> => one.start !== undefined;

function order(one: IntervalBound, other: IntervalBound): number {
  const kind = one.constructor as unknown as { compare(a: IntervalBound, b: IntervalBound): number };
  if (
    (kind as unknown) !== other.constructor ||
    (one as Temporal.PlainDate).calendarId !== (other as Temporal.PlainDate).calendarId
  ) {
    throw new TypeError('These values cannot be ordered: they differ by class, implementation or calendar');
  }
  return kind.compare(one, other);
}

/**
 * The interval from `start` to `end`, left out; `emptyInterval` when they are equal.
 * @pure
 * @sharing identity-preserving
 * @complexity O(1)
 * @throws TypeError when the bounds differ by class, implementation or calendar
 * @since 0.3
 * @experimental
 * @example interval(end, start) // err: temporal.inverted_interval
 */
export function interval<T extends IntervalBound>(start: T, end: T): Result<Interval<T>, TemporalIssue> {
  const sign = order(start, end);
  if (sign > 0) {
    return failure('temporal.inverted_interval', { start: String(start), end: String(end) });
  }
  return ok(sign === 0 ? emptyInterval : { start, end });
}

/**
 * Whether this value is inside: at `start`, or after it and before `end`.
 * @pure
 * @sharing none
 * @complexity O(1)
 * @throws TypeError when the values differ by class, implementation or calendar
 * @since 0.3
 * @experimental
 * @example contains(span, span.start) // true
 */
export function contains<T extends IntervalBound>(within: Interval<T>, value: T): boolean {
  return isSpan(within) && order(within.start, value) <= 0 && order(value, within.end) < 0;
}

/**
 * Whether two intervals hold a value in common. Intervals that touch do not.
 * @pure
 * @sharing none
 * @complexity O(1)
 * @throws TypeError when the values differ by class, implementation or calendar
 * @since 0.3
 * @experimental
 * @example overlaps(january, february) // false
 */
export function overlaps<T extends IntervalBound>(one: Interval<T>, other: Interval<T>): boolean {
  return isSpan(one) && isSpan(other) && order(one.start, other.end) < 0 && order(other.start, one.end) < 0;
}

/**
 * What two intervals hold in common.
 * @pure
 * @sharing identity-preserving
 * @complexity O(1)
 * @throws TypeError when the values differ by class, implementation or calendar
 * @since 0.3
 * @experimental
 * @example intersect(january, february) // emptyInterval
 */
export function intersect<T extends IntervalBound>(one: Interval<T>, other: Interval<T>): Interval<T> {
  if (!isSpan(one) || !isSpan(other) || !overlaps(one, other)) {
    return emptyInterval;
  }
  return {
    start: order(one.start, other.start) >= 0 ? one.start : other.start,
    end: order(one.end, other.end) <= 0 ? one.end : other.end,
  };
}

function merged<T extends IntervalBound>(list: readonly Interval<T>[]): Span<T>[] {
  const spans = list.filter(isSpan);
  spans.sort((one, other) => order(one.start, other.start));
  const result: Span<T>[] = [];
  let last: Span<T> | undefined;
  for (const span of spans) {
    if (last === undefined || order(last.end, span.start) < 0) {
      last = span;
      result.push(last);
    } else if (order(last.end, span.end) < 0) {
      last = { start: last.start, end: span.end };
      result[result.length - 1] = last;
    }
  }
  return result;
}

/**
 * What two intervals hold, as the fewest spans in order: one when they overlap or touch, two otherwise, none when both
 * are empty.
 * @pure
 * @sharing identity-preserving
 * @complexity O(1)
 * @throws TypeError when the values differ by class, implementation or calendar
 * @since 0.3
 * @experimental
 * @example union(january, february) // one span, from January to the end of February
 */
export function union<T extends IntervalBound>(one: Interval<T>, other: Interval<T>): readonly Span<T>[] {
  return merged([one, other]);
}

/**
 * What these intervals hold, as the fewest spans in order. Over 1,000,000 intervals, `temporal.too_large`, none read.
 * @pure
 * @sharing identity-preserving
 * @complexity O(n log n) comparisons (n = intervals), O(n) when they come in order
 * @throws TypeError when the values differ by class, implementation or calendar
 * @since 0.3
 * @experimental
 * @example mergeAll([february, january]) // ok: one span
 */
export function mergeAll<T extends IntervalBound>(
  intervals: readonly Interval<T>[],
): Result<readonly Span<T>[], TemporalIssue> {
  return intervals.length > MAX_INTERVALS
    ? failure('temporal.too_large', { maximum: MAX_INTERVALS })
    : ok(merged(intervals));
}

/**
 * What lies between these intervals, in order; with `within`, what it holds that they do not, its two ends included.
 * Over 1,000,000 intervals, `temporal.too_large`, none read.
 * @pure
 * @sharing identity-preserving
 * @complexity O(n log n) comparisons (n = intervals), O(n) when they come in order
 * @throws TypeError when the values differ by class, implementation or calendar
 * @since 0.3
 * @experimental
 * @example gaps([january, march]) // ok: February, as one span
 */
export function gaps<T extends IntervalBound>(
  intervals: readonly Interval<T>[],
  options?: { readonly within?: Interval<T> },
): Result<readonly Span<T>[], TemporalIssue> {
  if (intervals.length > MAX_INTERVALS) {
    return failure('temporal.too_large', { maximum: MAX_INTERVALS });
  }
  const within = options?.within;
  if (within !== undefined && !isSpan(within)) {
    return ok([]);
  }
  const holes: Span<T>[] = [];
  const stop = within?.end;
  let from = within?.start;
  for (const { start, end } of merged(intervals)) {
    if (from !== undefined && order(from, start) < 0) {
      const to = stop !== undefined && order(stop, start) < 0 ? stop : start;
      if (order(from, to) < 0) {
        holes.push({ start: from, end: to });
      }
    }
    if (from === undefined || order(from, end) < 0) {
      from = end;
    }
  }
  if (stop !== undefined && from !== undefined && order(from, stop) < 0) {
    holes.push({ start: from, end: stop });
  }
  return ok(holes);
}
