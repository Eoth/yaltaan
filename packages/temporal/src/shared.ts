/// <reference lib="esnext.temporal" preserve="true" />
// What the modules of the package share: Temporal as the platform provides it, read when a function is called, and the
// shape of a failure. An issue carries numbers and names of its own, never the text it was given.
import { err, ok, type Err, type Result } from '@yaltaan/core/result';
import type { Path } from '@yaltaan/core/path';

/**
 * An expected failure of this package. An issue never holds the text it refused:
 * - `temporal.inverted_interval`: the start of an interval comes after its end;
 * - `temporal.too_large`: more intervals, holidays or days than `maximum`, or a number of days that is not an integer;
 * - `temporal.ambiguous_format`: no format says how to read this text, or `yy` has no `pivotYear`;
 * - `temporal.invalid_format`: the format cannot be read: an unknown letter, a token used twice, a missing field, `SSS`
 *   without `ss`, or a `pivotYear` that is not an integer from 0 to 9900;
 * - `temporal.format_mismatch`: the text does not follow the format from the code unit `at`;
 * - `temporal.too_long`: the text has more than `maximum` code units;
 * - `temporal.invalid_date`: no such date or time, or an invalid `Date`;
 * - `temporal.invalid_time_zone`, `temporal.invalid_calendar`: Temporal does not know this name;
 * - `temporal.nonexistent_time`: this wall clock does not exist in this zone: the clock jumps over it;
 * - `temporal.ambiguous_time`: this wall clock exists twice in this zone: the clock goes back over it;
 * - `temporal.out_of_range`: the result would fall outside the range of Temporal;
 * - `temporal.no_business_day`: every day of the week is in the weekend.
 * @since 0.3
 * @experimental
 */
export type TemporalIssue =
  | {
      readonly code: 'temporal.inverted_interval';
      readonly path: Path;
      readonly params: { readonly start: string; readonly end: string };
    }
  | { readonly code: 'temporal.too_large'; readonly path: Path; readonly params: { readonly maximum: number } }
  | { readonly code: 'temporal.ambiguous_format'; readonly path: Path }
  | { readonly code: 'temporal.invalid_format'; readonly path: Path }
  | { readonly code: 'temporal.format_mismatch'; readonly path: Path; readonly params: { readonly at: number } }
  | { readonly code: 'temporal.too_long'; readonly path: Path; readonly params: { readonly maximum: number } }
  | { readonly code: 'temporal.invalid_date'; readonly path: Path }
  | { readonly code: 'temporal.invalid_time_zone'; readonly path: Path }
  | { readonly code: 'temporal.invalid_calendar'; readonly path: Path }
  | { readonly code: 'temporal.nonexistent_time'; readonly path: Path }
  | { readonly code: 'temporal.ambiguous_time'; readonly path: Path }
  | { readonly code: 'temporal.out_of_range'; readonly path: Path }
  | { readonly code: 'temporal.no_business_day'; readonly path: Path };

/** The issue of this code. */
export function failure(code: TemporalIssue['code'], params?: Readonly<Record<string, unknown>>): Err<TemporalIssue> {
  return err((params === undefined ? { code, path: [] } : { code, path: [], params }) as TemporalIssue);
}

/** Temporal as the platform has it now; an import never needs it, a call that builds a value does. */
export function temporal(): typeof Temporal {
  const found = (globalThis as { Temporal?: typeof Temporal }).Temporal;
  if (!found) {
    throw new TypeError(
      '@yaltaan/temporal needs Temporal: install temporal-polyfill and import temporal-polyfill/global',
    );
  }
  return found;
}

/**
 * What to do with a wall clock that does not exist or exists twice in a zone: the values of Temporal, `reject` by
 * default
 * here where it is `compatible` there.
 * @since 0.3
 * @experimental
 */
export type Disambiguation = 'compatible' | 'earlier' | 'later' | 'reject';

const MAX_NAME = 64;

/**
 * A name that came from outside: a time zone or a calendar is shown to Temporal only if it could be one. Temporal also
 * takes a whole date and time for a time zone and reads the zone out of it, and its two implementations differ on what
 * they take: a name starts with a letter, or is an offset. One pass, no backtracking.
 */
export function isPlausibleName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= MAX_NAME && /^(?:[A-Za-z][\w+/-]*|[+-]\d\d(?::?\d\d)?)$/.test(name);
}

/** What `make` builds; a `RangeError` of Temporal becomes this code, and anything else is a bug that stays one. */
export function refusing<T>(code: TemporalIssue['code'], make: () => T): Result<T, TemporalIssue> {
  try {
    return ok(make());
  } catch (error) {
    // By name: the Temporal of another realm throws the `RangeError` of that realm.
    if ((error as Error | undefined)?.name === 'RangeError') {
      return failure(code);
    }
    throw error;
  }
}

/**
 * This wall clock in this zone, refusing by default one that does not exist or that exists twice. A `RangeError` of
 * Temporal says one of three things here, and is told apart by asking again.
 */
export function wallInZone(
  wall: Temporal.PlainDateTime,
  timeZone: string,
  disambiguation: Disambiguation = 'reject',
): Result<Temporal.ZonedDateTime, TemporalIssue> {
  if (!['compatible', 'earlier', 'later', 'reject'].includes(disambiguation)) {
    throw new TypeError('disambiguation is compatible, earlier, later or reject');
  }
  if (!isPlausibleName(timeZone)) {
    return failure('temporal.invalid_time_zone');
  }
  const compatible = refusing('temporal.invalid_time_zone', () => wall.toZonedDateTime(timeZone));
  if (!compatible.ok) {
    return zoneFailure(wall, timeZone);
  }
  return refusing(
    compatible.value.toPlainDateTime().equals(wall) ? 'temporal.ambiguous_time' : 'temporal.nonexistent_time',
    () => wall.toZonedDateTime(timeZone, { disambiguation }),
  );
}

/**
 * Why a value has no instant in this zone: a value far from the limits of Temporal tells whether the name is at fault,
 * as a value at the limit may fit in one zone and not in the next.
 */
export function zoneFailure(value: Temporal.PlainDateTime | Temporal.PlainDate, timeZone: string): Err<TemporalIssue> {
  const known = refusing('temporal.invalid_time_zone', () => value.with({ year: 2000 }).toZonedDateTime(timeZone));
  return failure(known.ok ? 'temporal.out_of_range' : 'temporal.invalid_time_zone');
}
