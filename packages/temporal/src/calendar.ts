/// <reference lib="esnext.temporal" preserve="true" />
// The boundary with `Date`, units, and business days. A conversion always names its time zone: the implicit zone of the
// machine is the first source of date bugs, and a function here has no way to fall back on it. A time zone or a
// calendar
// comes from outside, so a refusal of Temporal is a `Result`. Business days hold no data: holidays are a finite list,
// so
// that a loop ends, and the scan is integer arithmetic on days, with one call of Temporal at each end.
import { ok, type Result } from '@yaltaan/core/result';
import {
  failure,
  isPlausibleName,
  zoneFailure,
  temporal,
  wallInZone,
  refusing,
  type Disambiguation,
  type TemporalIssue,
} from './shared.ts';

const MAX_HOLIDAYS = 100_000;
const MAX_DAYS = 1_000_000;
const MS_PER_DAY = 86_400_000;

/**
 * This `Date` in this time zone, and in this calendar if one is given. An invalid `Date` is `temporal.invalid_date`.
 * @pure
 * @sharing none
 * @complexity O(1): a name over 64 code units is refused unread
 * @throws TypeError when the platform has no Temporal
 * @throws what a getter of `options` throws, unchanged
 * @since 0.3
 * @experimental
 * @example fromDate(new Date(0), { timeZone: 'Asia/Tokyo' }) // ok: 1970-01-01T09:00:00+09:00[Asia/Tokyo]
 */
export function fromDate(
  date: Date,
  options: { readonly timeZone: string; readonly calendar?: string },
): Result<Temporal.ZonedDateTime, TemporalIssue> {
  const T = temporal();
  let time: number;
  try {
    time = Date.prototype.getTime.call(date);
  } catch {
    return failure('temporal.invalid_date');
  }
  const instant = refusing('temporal.invalid_date', () => T.Instant.fromEpochMilliseconds(time));
  if (!instant.ok) {
    return instant;
  }
  const timeZone = options?.timeZone;
  if (!isPlausibleName(timeZone)) {
    return failure('temporal.invalid_time_zone');
  }
  const zoned = refusing('temporal.invalid_time_zone', () => instant.value.toZonedDateTimeISO(timeZone));
  const calendar = options?.calendar;
  if (!zoned.ok || calendar === undefined) {
    return zoned;
  }
  return isPlausibleName(calendar)
    ? refusing('temporal.invalid_calendar', () => zoned.value.withCalendar(calendar))
    : failure('temporal.invalid_calendar');
}

/**
 * This date, at the start of its day there, or this wall clock, as a `Date`, in this time zone: there is no conversion
 * without one. A wall clock the zone jumps over or goes through twice is refused unless `disambiguation` decides. A
 * `ZonedDateTime` or an `Instant` needs no function: `new Date(value.epochMilliseconds)`.
 * @pure
 * @sharing none
 * @complexity O(1): a name over 64 code units is refused unread
 * @throws TypeError when a wall clock comes with a `disambiguation` that is not one of its four values, or the value is
 * neither a `PlainDate` nor a `PlainDateTime`
 * @throws what a getter of `options` throws, unchanged
 * @since 0.3
 * @experimental
 * @example toDate(date, { timeZone: 'UTC' }) // ok: the Date of that midnight
 */
export function toDate(
  value: Temporal.PlainDate | Temporal.PlainDateTime,
  options: { readonly timeZone: string; readonly disambiguation?: Disambiguation },
): Result<Date, TemporalIssue> {
  const timeZone = options?.timeZone;
  let zoned: Result<Temporal.ZonedDateTime, TemporalIssue>;
  if ('hour' in value) {
    zoned = wallInZone(value, timeZone, options?.disambiguation);
  } else if (isPlausibleName(timeZone)) {
    zoned = refusing('temporal.invalid_time_zone', () => value.toZonedDateTime(timeZone));
    if (!zoned.ok) {
      zoned = zoneFailure(value, timeZone);
    }
  } else {
    zoned = failure('temporal.invalid_time_zone');
  }
  return zoned.ok ? ok(new Date(zoned.value.epochMilliseconds)) : zoned;
}

/**
 * A unit of the calendar that `startOf` and `endOf` know.
 * @since 0.3
 * @experimental
 */
export type CalendarUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

/**
 * A value with a date in it: what has a start and an end of a unit.
 * @since 0.3
 * @experimental
 */
export type DatedValue = Temporal.PlainDate | Temporal.PlainDateTime | Temporal.ZonedDateTime;

/**
 * What a week starts on, from 1, Monday, to 7, Sunday. No locale decides for an application.
 * @since 0.3
 * @experimental
 */
export interface WeekOptions {
  readonly firstDayOfWeek: number;
}

const PLAIN_DATE = '[object Temporal.PlainDate]';

const STEPS = {
  day: { days: 1 },
  week: { weeks: 1 },
  month: { months: 1 },
  quarter: { months: 3 },
  year: { years: 1 },
} as const;

function firstDay(date: Temporal.PlainDate, unit: CalendarUnit, options: WeekOptions | undefined): Temporal.PlainDate {
  switch (unit) {
    case 'day':
      return date;
    case 'week': {
      const first = options?.firstDayOfWeek ?? 0;
      if (!Number.isInteger(first) || first < 1 || first > 7) {
        throw new RangeError('firstDayOfWeek goes from 1 to 7');
      }
      return date.subtract({ days: (date.dayOfWeek - first + 7) % 7 });
    }
    case 'month':
      return date.with({ day: 1 });
    case 'quarter':
      if (date.calendarId !== 'iso8601' && date.calendarId !== 'gregory') {
        throw new RangeError('A quarter needs the ISO or Gregorian calendar');
      }
      return date.with({ month: date.month - ((date.month - 1) % 3), day: 1 });
    case 'year':
      return date.with({ month: 1, day: 1 });
    default:
      throw new RangeError(`Unknown unit ${String(unit)}`);
  }
}

function dateOf(value: DatedValue): Temporal.PlainDate {
  switch (Object.prototype.toString.call(value)) {
    case PLAIN_DATE:
      return value as Temporal.PlainDate;
    case '[object Temporal.PlainDateTime]':
    case '[object Temporal.ZonedDateTime]':
      return (value as Temporal.PlainDateTime).toPlainDate();
    default:
      throw new TypeError('Not a date');
  }
}

/**
 * The start of this unit, of the same kind as this value. In a zone, the start of a day comes from the zone: 01:00
 * where
 * the clock jumps over midnight.
 * @pure
 * @sharing none
 * @complexity O(1)
 * @throws RangeError at the limits of Temporal, for a `firstDayOfWeek` out of 1 to 7, or a quarter outside the ISO and
 * Gregorian calendars
 * @throws TypeError for a value of another kind
 * @since 0.3
 * @experimental
 * @example startOf(date, 'quarter') // the first of January, April, July or October
 */
export function startOf<T extends DatedValue>(value: T, unit: 'week', options: WeekOptions): T;
export function startOf<T extends DatedValue>(value: T, unit: Exclude<CalendarUnit, 'week'>): T;
export function startOf(value: DatedValue, unit: CalendarUnit, options?: WeekOptions): DatedValue {
  const first = firstDay(dateOf(value), unit, options);
  if ('timeZoneId' in value) {
    return first.toZonedDateTime(value.timeZoneId);
  }
  return 'hour' in value ? first.toPlainDateTime() : first;
}

/**
 * The last moment of this unit, of the same kind as this value: the last day for a date, one nanosecond before the next
 * start for a time, and the later one where a clock goes back over it. An interval is half-open, and the next start is
 * the end to give it: `endOf` is for showing.
 * @pure
 * @sharing none
 * @complexity O(1)
 * @throws RangeError at the limits of Temporal, for a `firstDayOfWeek` out of 1 to 7, or a quarter outside the ISO and
 * Gregorian calendars
 * @throws TypeError for a value of another kind
 * @since 0.3
 * @experimental
 * @example endOf(date, 'month') // the last day of its month
 */
export function endOf<T extends DatedValue>(value: T, unit: 'week', options: WeekOptions): T;
export function endOf<T extends DatedValue>(value: T, unit: Exclude<CalendarUnit, 'week'>): T;
export function endOf(value: DatedValue, unit: CalendarUnit, options?: WeekOptions): DatedValue {
  const next = firstDay(dateOf(value), unit, options).add(STEPS[unit]);
  if ('timeZoneId' in value) {
    // The later of a wall clock that happens twice: a clock can go back over the end of a day just after it has ended.
    return next
      .toZonedDateTime(value.timeZoneId)
      .subtract({ nanoseconds: 1 })
      .toPlainDateTime()
      .toZonedDateTime(value.timeZoneId, { disambiguation: 'later' });
  }
  return 'hour' in value ? next.toPlainDateTime().subtract({ nanoseconds: 1 }) : next.subtract({ days: 1 });
}

/**
 * Which days a business does not work: both lists are required, as no country is a default. `weekend` holds days from
 * 1, Monday, to 7, Sunday; an application fills `holidays` for the years it needs.
 * @since 0.3
 * @experimental
 */
export interface BusinessCalendar {
  readonly weekend: readonly number[];
  readonly holidays: readonly Temporal.PlainDate[];
}

/** An integer that counts days: exact, as an instant of Temporal is within 2^53 milliseconds. */
function dayNumber(date: Temporal.PlainDate): number {
  if (Object.prototype.toString.call(date) !== PLAIN_DATE) {
    throw new TypeError('Not a PlainDate');
  }
  return date.toZonedDateTime('UTC').epochMilliseconds / MS_PER_DAY;
}

function checkWeekend(weekend: readonly number[]): void {
  if (
    !Array.isArray(weekend) ||
    weekend.length > 7 ||
    !weekend.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)
  ) {
    throw new TypeError('weekend holds days from 1 to 7');
  }
}

/** From 1, Monday, to 7, Sunday: 1 January 1970, day 0, was a Thursday. */
const weekdayOf = (day: number): number => (((day % 7) + 10) % 7) + 1;

function openDays(calendar: BusinessCalendar): Result<(day: number) => boolean, TemporalIssue> {
  const { weekend, holidays } = calendar;
  checkWeekend(weekend);
  if (holidays.length > MAX_HOLIDAYS) {
    return failure('temporal.too_large', { maximum: MAX_HOLIDAYS });
  }
  const closed = new Set(weekend);
  if ([1, 2, 3, 4, 5, 6, 7].every((weekday) => closed.has(weekday))) {
    return failure('temporal.no_business_day');
  }
  const off = new Set(holidays.map(dayNumber));
  return ok((day) => !closed.has(weekdayOf(day)) && !off.has(day));
}

/**
 * Whether a business works on this date.
 * @pure
 * @sharing none
 * @complexity O(h) (h = holidays)
 * @throws RangeError for a date at the very limits of Temporal
 * @throws TypeError when a date is not a `PlainDate`, or `weekend` is not a list of days from 1 to 7
 * @since 0.3
 * @experimental
 * @example isBusinessDay(sunday, { weekend: [6, 7], holidays: [] }) // false
 */
export function isBusinessDay(date: Temporal.PlainDate, calendar: BusinessCalendar): boolean {
  const day = dayNumber(date);
  checkWeekend(calendar.weekend);
  return !calendar.weekend.includes(weekdayOf(day)) && !calendar.holidays.some((holiday) => dayNumber(holiday) === day);
}

function guarded<T>(run: () => Result<T, TemporalIssue>): Result<T, TemporalIssue> {
  const result = refusing('temporal.out_of_range', run);
  return result.ok ? result.value : result;
}

/**
 * This date moved by `days` business days, forwards or backwards; 0 days does not move a day off to a working day.
 * More than
 * 1,000,000 days, or a number of days that is not an integer, or more than 100,000 holidays: `temporal.too_large`.
 * @pure
 * @sharing none
 * @complexity O(d + h) (d = days, h = holidays)
 * @throws TypeError when a date is not a `PlainDate`, or `weekend` is not a list of days from 1 to 7
 * @since 0.3
 * @experimental
 * @example addBusinessDays(friday, { days: 1, weekend: [6, 7], holidays: [] }) // ok: the Monday after
 */
export function addBusinessDays(
  date: Temporal.PlainDate,
  options: BusinessCalendar & { readonly days: number },
): Result<Temporal.PlainDate, TemporalIssue> {
  const { days } = options;
  if (!Number.isInteger(days) || Math.abs(days) > MAX_DAYS) {
    return failure('temporal.too_large', { maximum: MAX_DAYS });
  }
  return guarded(() => {
    const open = openDays(options);
    if (!open.ok) {
      return open;
    }
    const start = dayNumber(date);
    const step = days < 0 ? -1 : 1;
    let day = start;
    for (let left = Math.abs(days); left > 0;) {
      day += step;
      if (open.value(day)) {
        left -= 1;
      }
    }
    return ok(date.add({ days: day - start }));
  });
}

/**
 * How many business days lie from `start`, included, to `end`, left out; when `end` comes first, minus the count from
 * `end` to `start`. Over 1,000,000
 * days apart, or more than 100,000 holidays: `temporal.too_large`.
 * @pure
 * @sharing none
 * @complexity O(d + h) (d = days apart, h = holidays)
 * @throws TypeError when a date is not a `PlainDate`, or `weekend` is not a list of days from 1 to 7
 * @since 0.3
 * @experimental
 * @example businessDaysBetween(monday, nextMonday, { weekend: [6, 7], holidays: [] }) // ok: 5
 */
export function businessDaysBetween(
  start: Temporal.PlainDate,
  end: Temporal.PlainDate,
  calendar: BusinessCalendar,
): Result<number, TemporalIssue> {
  return guarded(() => {
    const open = openDays(calendar);
    if (!open.ok) {
      return open;
    }
    const from = dayNumber(start);
    const to = dayNumber(end);
    if (Math.abs(to - from) > MAX_DAYS) {
      return failure('temporal.too_large', { maximum: MAX_DAYS });
    }
    let count = 0;
    for (let day = Math.min(from, to); day < Math.max(from, to); day += 1) {
      if (open.value(day)) {
        count += 1;
      }
    }
    return ok(to < from ? 0 - count : count);
  });
}
