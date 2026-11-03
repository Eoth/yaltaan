/// <reference lib="esnext.temporal" preserve="true" />
// What the modules of the package share: Temporal as the platform provides it, read when a function is called, and the
// shape of a failure. An issue carries numbers and names of its own, never the text it was given.
import { err, type Err } from '@yaltaan/core/result';
import type { Path } from '@yaltaan/core/path';

/**
 * An expected failure of this package. An issue never holds the text it refused:
 * - `temporal.inverted_interval`: the start of an interval comes after its end;
 * - `temporal.too_large`: more intervals, holidays or days than `maximum`, or a number of days that is not an integer;
 * - `temporal.ambiguous_format`: no format says how to read this text, or `yy` has no `pivotYear`;
 * - `temporal.invalid_format`: the format cannot be read: an unknown letter, a token used twice, a missing field;
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
  if (found === undefined) {
    throw new TypeError(
      '@yaltaan/temporal needs Temporal: install temporal-polyfill and import temporal-polyfill/global',
    );
  }
  return found;
}
