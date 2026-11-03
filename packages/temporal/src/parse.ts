/// <reference lib="esnext.temporal" preserve="true" />
// Reading a text in a declared format, the input of this package that comes from outside. A reader that guesses is
// where a date library goes wrong: a text that follows no declared format is refused, a date that does not exist is
// refused, and a `RangeError` of Temporal never leaves. There is no regular expression and no backtracking: one pass
// over a format of at most 64 code units, reading at most as many of a text of at most 64. The format is judged
// whatever
// the text, so that an application learns of a bad format from its first text. An issue holds no part of the text.
import { ok, type Result } from '@yaltaan/core/result';
import { failure, refusing, temporal, wallInZone, type Disambiguation, type TemporalIssue } from './shared.ts';

const MAX_LENGTH = 64;

/** A token: the field it fills, and its digits; 1 means one or two. */
const TOKENS = {
  __proto__: null,
  yyyy: ['y', 4],
  yy: ['y', 2],
  MM: ['M', 2],
  M: ['M', 1],
  dd: ['d', 2],
  d: ['d', 1],
  HH: ['H', 2],
  H: ['H', 1],
  mm: ['m', 2],
  ss: ['s', 2],
  SSS: ['S', 3],
} as unknown as Readonly<Record<string, readonly [string, number]>>;

/**
 * How to read a text. Without `format`, only the ISO form is read, and anything else is `temporal.ambiguous_format`.
 * A format is made of `yyyy yy MM M dd d HH H mm ss SSS` and of literal characters, `T` among them; `M`, `d` and `H`
 * read
 * one or two digits. `yy` needs `pivotYear`: the year falls from `pivotYear` to `pivotYear + 99`.
 * @since 0.3
 * @experimental
 */
export interface ParseOptions {
  readonly format?: string;
  readonly pivotYear?: number;
}

/**
 * How to read a text as a wall clock in a time zone. `disambiguation` says what to do with a wall clock that does not
 * exist or exists twice there; by default it is refused.
 * @since 0.3
 * @experimental
 */
export interface ParseZonedOptions extends ParseOptions {
  readonly timeZone: string;
  readonly disambiguation?: Disambiguation;
}

const isLetter = (code: number): boolean => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isDigit = (code: number): boolean => code >= 48 && code <= 57;
const LITERAL_T = 84;

type Fields = Readonly<Record<string, number | undefined>>;

function readFields(
  text: unknown,
  options: ParseOptions | undefined,
  allowed: string,
  needed: string,
  iso: string,
): Result<Fields, TemporalIssue> {
  const declared = options?.format;
  const format = declared === undefined ? iso : declared;
  if (typeof format !== 'string' || format.length > MAX_LENGTH) {
    return failure('temporal.invalid_format');
  }
  // No prototype: a polluted `Object.prototype` must not fill a field. And no code unit of a text too long to read:
  // reading one makes V8 flatten a string built by concatenation, whatever its length.
  const fields = { __proto__: null } as unknown as Record<string, number>;
  const isText = typeof text === 'string';
  const tooLong = isText && text.length > MAX_LENGTH;
  let mismatch = isText && !tooLong ? -1 : 0;
  let at = 0;
  let short = false;
  for (let i = 0; i < format.length;) {
    const code = format.charCodeAt(i);
    if (!isLetter(code) || code === LITERAL_T) {
      if (mismatch < 0 && (text as string).charCodeAt(at) !== code) {
        mismatch = at;
      }
      at += 1;
      i += 1;
      continue;
    }
    let end = i + 1;
    while (format.charCodeAt(end) === code) {
      end += 1;
    }
    const token = TOKENS[format.slice(i, end)];
    const next = format.charCodeAt(end);
    if (
      token === undefined ||
      !allowed.includes(token[0]) ||
      fields[token[0]] !== undefined ||
      (token[1] === 1 && ((isLetter(next) && next !== LITERAL_T) || isDigit(next)))
    ) {
      return failure('temporal.invalid_format');
    }
    short ||= end - i === 2 && code === 121;
    const most = token[1] === 1 ? 2 : token[1];
    let value = 0;
    let digits = 0;
    if (mismatch < 0) {
      while (digits < most && isDigit((text as string).charCodeAt(at))) {
        value = value * 10 + (text as string).charCodeAt(at) - 48;
        at += 1;
        digits += 1;
      }
      if (digits < token[1]) {
        mismatch = at;
      }
    }
    fields[token[0]] = value;
    i = end;
  }
  for (const field of needed) {
    if (fields[field] === undefined) {
      return failure('temporal.invalid_format');
    }
  }
  if (fields['S'] !== undefined && fields['s'] === undefined) {
    return failure('temporal.invalid_format');
  }
  if (short) {
    const pivot = options?.pivotYear;
    if (pivot === undefined) {
      return failure('temporal.ambiguous_format');
    }
    if (!Number.isInteger(pivot) || pivot < 0 || pivot > 9900) {
      return failure('temporal.invalid_format');
    }
    const year = pivot - (pivot % 100) + (fields['y'] as number);
    fields['y'] = year < pivot ? year + 100 : year;
  }
  if (tooLong) {
    return failure('temporal.too_long', { maximum: MAX_LENGTH });
  }
  if (mismatch >= 0 || at !== (text as string).length) {
    return declared === undefined
      ? failure('temporal.ambiguous_format')
      : failure('temporal.format_mismatch', { at: mismatch >= 0 ? mismatch : at });
  }
  return ok(fields);
}

const build = <T>(make: () => T): Result<T, TemporalIssue> => refusing('temporal.invalid_date', make);

const num = (fields: Fields, field: string): number => fields[field] ?? 0;

function plainDateTime(T: typeof Temporal, fields: Fields): Result<Temporal.PlainDateTime, TemporalIssue> {
  return build(
    () =>
      new T.PlainDateTime(
        num(fields, 'y'),
        num(fields, 'M'),
        num(fields, 'd'),
        num(fields, 'H'),
        num(fields, 'm'),
        num(fields, 's'),
        num(fields, 'S'),
      ),
  );
}

const DATE = 'yMd';
const TIME = 'HmsS';
const WALL = 'yMdHm';
const ISO_DATE = 'yyyy-MM-dd';
const ISO_WALL = 'yyyy-MM-ddTHH:mm:ss';

/**
 * This text as a date, in the declared format, or in `yyyy-MM-dd` without one.
 * @pure
 * @sharing none
 * @complexity O(1): text and format over 64 code units are refused, and read at most once
 * @throws TypeError when the platform has no Temporal
 * @throws what a getter of `options` throws, unchanged
 * @since 0.3
 * @experimental
 * @example parsePlainDate(text, { format: 'dd/MM/yyyy' }) // err: temporal.invalid_date, for the 31st of February
 */
export function parsePlainDate(text: string, options?: ParseOptions): Result<Temporal.PlainDate, TemporalIssue> {
  const T = temporal();
  const fields = readFields(text, options, DATE, DATE, ISO_DATE);
  return fields.ok
    ? build(() => new T.PlainDate(num(fields.value, 'y'), num(fields.value, 'M'), num(fields.value, 'd')))
    : fields;
}

/**
 * This text as a time, in the declared format, or in `HH:mm:ss` without one.
 * @pure
 * @sharing none
 * @complexity O(1): text and format over 64 code units are refused, and read at most once
 * @throws TypeError when the platform has no Temporal
 * @throws what a getter of `options` throws, unchanged
 * @since 0.3
 * @experimental
 * @example parsePlainTime('25:00', { format: 'HH:mm' }) // err: temporal.invalid_date
 */
export function parsePlainTime(text: string, options?: ParseOptions): Result<Temporal.PlainTime, TemporalIssue> {
  const T = temporal();
  const fields = readFields(text, options, TIME, 'Hm', 'HH:mm:ss');
  return fields.ok
    ? build(
        () =>
          new T.PlainTime(
            num(fields.value, 'H'),
            num(fields.value, 'm'),
            num(fields.value, 's'),
            num(fields.value, 'S'),
          ),
      )
    : fields;
}

/**
 * This text as a date and a time, in the declared format, or in `yyyy-MM-ddTHH:mm:ss` without one.
 * @pure
 * @sharing none
 * @complexity O(1): text and format over 64 code units are refused, and read at most once
 * @throws TypeError when the platform has no Temporal
 * @throws what a getter of `options` throws, unchanged
 * @since 0.3
 * @experimental
 * @example parsePlainDateTime(text, { format: 'yyyy-MM-dd HH:mm' }) // ok, when the text follows it
 */
export function parsePlainDateTime(
  text: string,
  options?: ParseOptions,
): Result<Temporal.PlainDateTime, TemporalIssue> {
  const T = temporal();
  const fields = readFields(text, options, DATE + TIME, WALL, ISO_WALL);
  return fields.ok ? plainDateTime(T, fields.value) : fields;
}

/**
 * This text as a wall clock in a time zone, in the declared format, or in `yyyy-MM-ddTHH:mm:ss` without one. A wall
 * clock the zone jumps over is `temporal.nonexistent_time`, one it goes through twice `temporal.ambiguous_time`, unless
 * `disambiguation` decides.
 * @pure
 * @sharing none
 * @complexity O(1): text, format and time zone over 64 code units are refused, and read at most once
 * @throws TypeError when the platform has no Temporal, or `disambiguation` is not one of its four values
 * @throws what a getter of `options` throws, unchanged
 * @since 0.3
 * @experimental
 * @example parseZonedDateTime(text, { timeZone: 'America/New_York' }) // err: temporal.nonexistent_time
 */
export function parseZonedDateTime(
  text: string,
  options: ParseZonedOptions,
): Result<Temporal.ZonedDateTime, TemporalIssue> {
  const T = temporal();
  const fields = readFields(text, options, DATE + TIME, WALL, ISO_WALL);
  if (!fields.ok) {
    return fields;
  }
  const wall = plainDateTime(T, fields.value);
  return wall.ok ? wallInZone(wall.value, options?.timeZone, options?.disambiguation) : wall;
}
