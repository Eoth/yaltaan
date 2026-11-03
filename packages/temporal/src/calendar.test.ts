import assert from 'node:assert/strict';
import test from 'node:test';
import { declareAdversarial, fc } from '@yaltaan/testing';
import { testOnEach } from '@yaltaan/testing/temporal';
import { runInNewContext } from 'node:vm';
import {
  addBusinessDays,
  businessDaysBetween,
  endOf,
  fromDate,
  isBusinessDay,
  parsePlainDate,
  startOf,
  toDate,
  type BusinessCalendar,
  type TemporalIssue,
} from './index.ts';

const SUBPATH = '@yaltaan/temporal';
const ZONES = [
  'UTC',
  'America/New_York',
  'Europe/Paris',
  'Asia/Kolkata',
  'Pacific/Apia',
  'America/Havana',
  'Asia/Gaza',
];
const zone = fc.constantFrom(...ZONES);
const units = ['day', 'month', 'quarter', 'year'] as const;

const errorCode = (result: { ok: true } | { ok: false; error: TemporalIssue }): string | undefined =>
  result.ok ? undefined : result.error.code;

const instantMs = fc.integer({ min: Date.UTC(1900, 0, 1), max: Date.UTC(2100, 0, 1) });
const dayArb = fc.integer({ min: -30000, max: 30000 });

function dateFrom(T: typeof Temporal, day: number): Temporal.PlainDate {
  return T.PlainDate.from('2000-01-01').add({ days: day });
}

testOnEach('a start and an end hold the value; the start is stable, and the next start follows the end', (T) => {
  fc.assert(
    fc.property(instantMs, zone, fc.constantFrom(...units), (ms, timeZone, unit) => {
      const value = T.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(timeZone);
      const start = startOf(value, unit);
      const end = endOf(value, unit);
      assert.ok(T.ZonedDateTime.compare(start, value) <= 0);
      assert.ok(T.ZonedDateTime.compare(value, end) <= 0);
      assert.ok(startOf(start, unit).equals(start));
      assert.ok(startOf(end, unit).equals(start));
      assert.ok(endOf(start, unit).equals(end));
      assert.equal(start.timeZoneId, value.timeZoneId);
      const next = end.add({ nanoseconds: 1 });
      assert.ok(T.ZonedDateTime.compare(startOf(next, unit), next) === 0);
      assert.ok(T.ZonedDateTime.compare(value, next) < 0);
    }),
    { numRuns: 200 },
  );
});

testOnEach('a start and an end hold the value on every zone, at its own changes of clock', (T) => {
  const zones = Intl.supportedValuesOf('timeZone');
  fc.assert(
    fc.property(
      fc.constantFrom(...zones),
      fc.integer({ min: Date.UTC(1990, 0, 1), max: Date.UTC(2030, 0, 1) }),
      fc.integer({ min: -2 * 3_600_000, max: 2 * 3_600_000 }),
      fc.constantFrom(...units),
      (timeZone, ms, shift, unit) => {
        const near = T.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(timeZone);
        const change = near.getTimeZoneTransition('next') ?? near;
        const value = change.add({ milliseconds: shift });
        assert.ok(T.ZonedDateTime.compare(startOf(value, unit), value) <= 0, String(value));
        assert.ok(T.ZonedDateTime.compare(value, endOf(value, unit)) <= 0, String(value));
      },
    ),
    { numRuns: 300 },
  );
});

testOnEach('a clock that goes back over the end of a day, and over midnight: the end stays after the value', (T) => {
  const johns = T.ZonedDateTime.from('2006-10-28T23:30:00-03:30[America/St_Johns]');
  const end = endOf(johns, 'day');
  assert.equal(end.offset, '-03:30');
  assert.equal(end.hour, 23);
  assert.ok(T.ZonedDateTime.compare(johns, end) <= 0);
  const repeated = T.ZonedDateTime.from('2024-11-03T12:00:00[America/Havana]');
  const start = startOf(repeated, 'day');
  assert.equal(start.hour, 0);
  assert.equal(start.offset, '-04:00');
});

testOnEach('the kinds: what is neither a date nor a date and time is refused, never passed through', (T) => {
  const instant = T.Instant.from('2024-01-01T00:00Z');
  for (const value of [instant, {}, T.PlainTime.from('10:00'), T.PlainYearMonth.from('2024-01')]) {
    assert.throws(() => startOf(value as Temporal.PlainDate, 'day'), TypeError);
    assert.throws(() => endOf(value as Temporal.PlainDate, 'day'), TypeError);
  }
  const zoned = instant.toZonedDateTimeISO('UTC');
  const wall = T.PlainDateTime.from('2024-01-06T10:00');
  const calendar = { weekend: [6, 7], holidays: [] };
  for (const value of [instant, zoned, T.PlainTime.from('10:00'), {}]) {
    assert.throws(() => toDate(value as Temporal.PlainDate, { timeZone: 'UTC' }), TypeError);
  }
  for (const value of [wall, zoned, {}, '2024-01-06']) {
    assert.throws(() => isBusinessDay(value as Temporal.PlainDate, calendar), TypeError);
    assert.throws(() => addBusinessDays(value as Temporal.PlainDate, { ...calendar, days: 1 }), TypeError);
    const day = T.PlainDate.from('2024-01-08');
    const holidays = [value as Temporal.PlainDate];
    assert.throws(() => isBusinessDay(day, { weekend: [], holidays }), TypeError);
    assert.throws(() => businessDaysBetween(day, day, { weekend: [], holidays }), TypeError);
  }
  const monday = T.PlainDate.from('2024-01-08');
  for (const weekend of [undefined, null, ['6', '7'], [0], [8], [6.5], [1, 2, 3, 4, 5, 6, 7, 7], { length: 0 }, 'x']) {
    const bad = { weekend: weekend as number[], holidays: [] };
    assert.throws(() => isBusinessDay(monday, bad), TypeError);
    assert.throws(() => addBusinessDays(monday, { ...bad, days: 1 }), TypeError);
    assert.throws(() => businessDaysBetween(monday, monday, bad), TypeError);
  }
  const sixDays = addBusinessDays(monday, { weekend: [1, 2, 3, 4, 5, 6], holidays: [], days: 1 });
  assert.ok(sixDays.ok && sixDays.value.dayOfWeek === 7);
  assert.equal(
    isBusinessDay(monday, { weekend: [], holidays: new Array(100_001).fill(monday.add({ days: 1 })) }),
    true,
  );
  const sunday = T.PlainDate.from('2024-01-07');
  const none = businessDaysBetween(monday, sunday, calendar);
  assert.ok(none.ok && Object.is(none.value, 0));
});

testOnEach('a failure says what failed: the name, or the limit of Temporal', (T) => {
  const wall = T.PlainDateTime.from('+275760-09-13T00:00:00');
  assert.equal(errorCode(toDate(wall, { timeZone: 'America/New_York' })), 'temporal.out_of_range');
  assert.equal(errorCode(toDate(wall, { timeZone: 'Mars/Olympus' })), 'temporal.invalid_time_zone');
  const date = T.PlainDate.from('-271821-04-20');
  assert.equal(errorCode(toDate(date, { timeZone: 'Asia/Tokyo' })), 'temporal.out_of_range');
  assert.equal(errorCode(toDate(date, { timeZone: 'Mars/Olympus' })), 'temporal.invalid_time_zone');
  const overlap = T.PlainDateTime.from('2024-11-03T01:30');
  const earlier = toDate(overlap, { timeZone: 'America/New_York', disambiguation: 'earlier' });
  const later = toDate(overlap, { timeZone: 'America/New_York', disambiguation: 'later' });
  assert.ok(earlier.ok && later.ok);
  assert.equal(later.value.getTime() - earlier.value.getTime(), 3_600_000);
  class Lying extends Date {
    override getTime(): number {
      return 0;
    }
  }
  const lying = fromDate(new Lying(86_400_000), { timeZone: 'UTC' });
  assert.ok(lying.ok);
  assert.equal(lying.value.epochMilliseconds, 86_400_000);
  assert.equal(
    errorCode(fromDate({ getTime: () => 0 } as unknown as Date, { timeZone: 'UTC' })),
    'temporal.invalid_date',
  );
});

test('a quarter is refused outside the ISO and Gregorian calendars, whatever the date', () => {
  const native = (globalThis as { Temporal?: typeof Temporal }).Temporal;
  if (native !== undefined && typeof native.PlainDate.from('2024-01-15').withCalendar === 'function') {
    for (const text of ['2024-01-15', '2024-11-15']) {
      let hebrew: Temporal.PlainDate | undefined;
      try {
        hebrew = native.PlainDate.from(text).withCalendar('hebrew');
      } catch {
        return;
      }
      assert.throws(() => startOf(hebrew, 'quarter'), RangeError);
    }
  }
});

test('a RangeError of Temporal from another realm is a refusal too', () => {
  const held = (globalThis as { Temporal?: unknown }).Temporal;
  const realm = runInNewContext('({ RangeError })') as { RangeError: new (message: string) => Error };
  (globalThis as { Temporal?: unknown }).Temporal = {
    PlainDate: class {
      constructor() {
        throw new realm.RangeError('not a date');
      }
    },
  };
  try {
    assert.equal(errorCode(parsePlainDate('2024-02-31')), 'temporal.invalid_date');
  } finally {
    (globalThis as { Temporal?: unknown }).Temporal = held;
  }
});

testOnEach('the three kinds agree: a date, a date and time and a zoned value give one calendar day', (T) => {
  fc.assert(
    fc.property(dayArb, fc.constantFrom(...units), (day, unit) => {
      const date = dateFrom(T, day);
      const wall = date.toPlainDateTime({ hour: 13 });
      const zoned = date.toZonedDateTime('UTC');
      assert.ok(startOf(date, unit).equals(startOf(wall, unit).toPlainDate()));
      assert.ok(startOf(date, unit).equals(startOf(zoned, unit).toPlainDate()));
      assert.ok(endOf(date, unit).equals(endOf(wall, unit).toPlainDate()));
      assert.ok(endOf(date, unit).equals(endOf(zoned, unit).toPlainDate()));
      assert.equal(startOf(wall, unit).hour, 0);
      assert.equal(endOf(wall, unit).nanosecond, 999);
      assert.equal(endOf(wall, unit).hour, 23);
    }),
    { numRuns: 300 },
  );
});

testOnEach('a week starts on the day it is told, whatever the date', (T) => {
  fc.assert(
    fc.property(dayArb, fc.integer({ min: 1, max: 7 }), (day, firstDayOfWeek) => {
      const date = dateFrom(T, day);
      const start = startOf(date, 'week', { firstDayOfWeek });
      const end = endOf(date, 'week', { firstDayOfWeek });
      assert.equal(start.dayOfWeek, firstDayOfWeek);
      assert.equal(start.until(end).days, 6);
      assert.ok(T.PlainDate.compare(start, date) <= 0 && T.PlainDate.compare(date, end) <= 0);
    }),
    { numRuns: 300 },
  );
  const date = T.PlainDate.from('2024-05-15');
  for (const firstDayOfWeek of [0, 8, 1.5, Number.NaN]) {
    assert.throws(() => startOf(date, 'week', { firstDayOfWeek }), RangeError);
    assert.throws(() => endOf(date, 'week', { firstDayOfWeek }), RangeError);
  }
  assert.throws(() => startOf(date, 'hour' as 'day'), RangeError);
  assert.throws(() => startOf(date, 'week' as 'day'), RangeError);
});

testOnEach('a quarter starts in January, April, July or October, in a calendar of 12 months only', (T) => {
  for (let month = 1; month <= 12; month += 1) {
    const date = T.PlainDate.from({ year: 2024, month, day: 15 });
    const start = startOf(date, 'quarter');
    assert.equal(start.month, month - ((month - 1) % 3));
    assert.equal(start.day, 1);
    assert.equal(endOf(date, 'quarter').month, start.month + 2);
  }
});

testOnEach('the start of a day comes from the zone: the clock jumps over midnight in Havana', (T) => {
  const zoned = T.ZonedDateTime.from('2024-03-10T12:00:00[America/Havana]');
  const start = startOf(zoned, 'day');
  assert.equal(start.hour, 1);
  assert.equal(start.day, 10);
  assert.equal(start.offset, '-04:00');
  const end = endOf(zoned.subtract({ days: 1 }), 'day');
  assert.equal(end.hour, 23);
  assert.equal(end.add({ nanoseconds: 1 }).epochMilliseconds, start.epochMilliseconds);
  const gaza = T.ZonedDateTime.from('2023-04-29T06:00:00[Asia/Gaza]');
  assert.equal(startOf(gaza, 'day').offset, '+02:00');
});

testOnEach('fromDate and toDate go and come back, whatever the time zone of the machine', (T) => {
  const held = process.env['TZ'];
  try {
    for (const host of ['UTC', 'Europe/Paris', 'America/New_York', 'Asia/Tokyo']) {
      process.env['TZ'] = host;
      fc.assert(
        fc.property(instantMs, zone, (ms, timeZone) => {
          const read = fromDate(new Date(ms), { timeZone });
          assert.ok(read.ok);
          assert.equal(read.value.epochMilliseconds, ms);
          assert.equal(read.value.timeZoneId, timeZone);
          assert.equal(read.value.calendarId, 'iso8601');
          const back = toDate(read.value.toPlainDateTime(), { timeZone, disambiguation: 'compatible' });
          assert.ok(back.ok);
          const expected = read.value.toPlainDateTime().toZonedDateTime(timeZone).epochMilliseconds;
          assert.equal(back.value.getTime(), expected);
        }),
        { numRuns: 60 },
      );
    }
  } finally {
    process.env['TZ'] = held;
  }
  assert.ok(T.Instant !== undefined);
});

testOnEach('a time zone and a calendar from outside: a Result, whatever they hold', (T) => {
  const date = new Date(0);
  const bad = [
    'Mars/Olympus',
    '',
    'A'.repeat(100_000),
    '../../etc/passwd',
    '__proto__',
    5,
    null,
    undefined,
    {},
    Symbol('x'),
  ];
  for (const timeZone of bad) {
    assert.equal(errorCode(fromDate(date, { timeZone: timeZone as string })), 'temporal.invalid_time_zone');
    assert.equal(
      errorCode(toDate(T.PlainDate.from('2024-01-01'), { timeZone: timeZone as string })),
      'temporal.invalid_time_zone',
    );
    assert.equal(
      errorCode(toDate(T.PlainDateTime.from('2024-01-01T10:00'), { timeZone: timeZone as string })),
      'temporal.invalid_time_zone',
    );
  }
  for (const calendar of ['nope', '', 'A'.repeat(100_000), '__proto__', 5, null, {}]) {
    assert.equal(
      errorCode(fromDate(date, { timeZone: 'UTC', calendar: calendar as string })),
      'temporal.invalid_calendar',
    );
  }
  const iso = fromDate(date, { timeZone: 'UTC', calendar: 'iso8601' });
  assert.ok(iso.ok);
  assert.equal(iso.value.calendarId, 'iso8601');
  for (const invalid of [new Date(Number.NaN), {}, null, undefined, 0, '2024-01-01']) {
    assert.equal(errorCode(fromDate(invalid as Date, { timeZone: 'UTC' })), 'temporal.invalid_date');
  }
  assert.equal(errorCode(fromDate(date, undefined as unknown as { timeZone: string })), 'temporal.invalid_time_zone');
  assert.equal(
    errorCode(toDate(T.PlainDateTime.from('2024-01-01T10:00'), null as unknown as { timeZone: string })),
    'temporal.invalid_time_zone',
  );
});

testOnEach('toDate refuses a wall clock that does not exist or exists twice, and the very end of the range', (T) => {
  const timeZone = 'America/New_York';
  assert.equal(errorCode(toDate(T.PlainDateTime.from('2024-03-10T02:30'), { timeZone })), 'temporal.nonexistent_time');
  assert.equal(errorCode(toDate(T.PlainDateTime.from('2024-11-03T01:30'), { timeZone })), 'temporal.ambiguous_time');
  const fine = toDate(T.PlainDateTime.from('2024-07-01T12:00'), { timeZone });
  assert.ok(fine.ok);
  assert.equal(fine.value.getTime(), Date.UTC(2024, 6, 1, 16));
  const atMidnightGap = toDate(T.PlainDate.from('2024-03-10'), { timeZone: 'America/Havana' });
  assert.ok(atMidnightGap.ok);
  assert.equal(atMidnightGap.value.getTime(), Date.UTC(2024, 2, 10, 5));
  assert.equal(errorCode(toDate(T.PlainDate.from('-271821-04-19'), { timeZone: 'UTC' })), 'temporal.out_of_range');
  assert.equal(
    errorCode(toDate(T.PlainDateTime.from('-271821-04-19T12:00'), { timeZone: 'UTC' })),
    'temporal.out_of_range',
  );
});

test('the types: no conversion compiles without a time zone, nor a week without its first day', () => {
  const never = (): void => {
    const date = Temporal.PlainDate.from('2024-01-01');
    // @ts-expect-error: a conversion names its time zone
    fromDate(new Date());
    // @ts-expect-error: a conversion names its time zone
    fromDate(new Date(), {});
    // @ts-expect-error: a conversion names its time zone
    toDate(date);
    // @ts-expect-error: a conversion names its time zone
    toDate(date, {});
    // @ts-expect-error: an instant needs no function, and a wall clock needs a zone
    toDate(Temporal.Instant.from('2024-01-01T00:00Z'), { timeZone: 'UTC' });
    // @ts-expect-error: a week says what it starts on
    startOf(date, 'week');
    // @ts-expect-error: a week says what it starts on
    endOf(date, 'week');
    // @ts-expect-error: both lists are required
    isBusinessDay(date, { weekend: [6, 7] });
    // @ts-expect-error: both lists are required
    addBusinessDays(date, { days: 1, holidays: [] });
  };
  assert.equal(typeof never, 'function');
});

/** The rule of a business day written the slow way, by Temporal itself: the oracle of the integer arithmetic. */
function slowOpen(date: Temporal.PlainDate, calendar: BusinessCalendar): boolean {
  return !calendar.weekend.includes(date.dayOfWeek) && !calendar.holidays.some((one) => one.equals(date));
}

const calendars = fc.record({
  weekend: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { maxLength: 6 }),
  holidays: fc.array(fc.integer({ min: -60, max: 60 }), { maxLength: 12 }),
});

testOnEach('business days: the integer arithmetic says what Temporal says, day by day', (T) => {
  fc.assert(
    fc.property(dayArb, fc.integer({ min: -40, max: 40 }), calendars, (day, days, drawn) => {
      const date = dateFrom(T, day);
      const calendar = { weekend: drawn.weekend, holidays: drawn.holidays.map((shift) => date.add({ days: shift })) };
      assert.equal(isBusinessDay(date, calendar), slowOpen(date, calendar));
      const moved = addBusinessDays(date, { ...calendar, days });
      assert.ok(moved.ok);
      let at = date;
      for (let left = Math.abs(days); left > 0;) {
        at = at.add({ days: Math.sign(days) });
        if (slowOpen(at, calendar)) {
          left -= 1;
        }
      }
      assert.ok(moved.value.equals(at), `${String(moved.value)} is not ${String(at)}`);
      const between = businessDaysBetween(date, at, calendar);
      assert.ok(between.ok);
      let count = 0;
      const [low, high] = T.PlainDate.compare(date, at) <= 0 ? [date, at] : [at, date];
      for (let walk = low; T.PlainDate.compare(walk, high) < 0; walk = walk.add({ days: 1 })) {
        count += slowOpen(walk, calendar) ? 1 : 0;
      }
      assert.equal(between.value, T.PlainDate.compare(date, at) <= 0 ? count : -count);
      const back = businessDaysBetween(at, date, calendar);
      assert.ok(back.ok);
      assert.equal(back.value + 0, -between.value + 0);
    }),
    { numRuns: 200 },
  );
});

testOnEach('limits of business days: a huge number, a week without a working day, every day a holiday', (T) => {
  const date = T.PlainDate.from('2024-01-01');
  const plain = { weekend: [6, 7], holidays: [] };
  const tooLarge = (maximum: number) => ({
    ok: false,
    error: { code: 'temporal.too_large', path: [], params: { maximum } },
  });
  for (const days of [1_000_001, -1_000_001, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY, Number.NaN, 1.5]) {
    assert.deepEqual(addBusinessDays(date, { ...plain, days }), tooLarge(1_000_000));
  }
  assert.ok(addBusinessDays(date, { ...plain, days: 1_000_000 }).ok);
  assert.ok(addBusinessDays(date, { ...plain, days: -1_000_000 }).ok);
  const farAway = T.PlainDate.from('+200000-01-01');
  assert.ok(businessDaysBetween(farAway, farAway.add({ days: 1_000_000 }), plain).ok);
  const noWork = { weekend: [1, 2, 3, 4, 5, 6, 7], holidays: [] };
  assert.equal(errorCode(addBusinessDays(date, { ...noWork, days: 1 })), 'temporal.no_business_day');
  assert.equal(errorCode(businessDaysBetween(date, date.add({ days: 1 }), noWork)), 'temporal.no_business_day');
  assert.equal(isBusinessDay(date, noWork), false);
  const manyHolidays = new Array<Temporal.PlainDate>(100_001).fill(date);
  assert.deepEqual(addBusinessDays(date, { weekend: [], holidays: manyHolidays, days: 1 }), tooLarge(100_000));
  assert.deepEqual(businessDaysBetween(date, date, { weekend: [], holidays: manyHolidays }), tooLarge(100_000));
  assert.deepEqual(businessDaysBetween(date, date.add({ days: 1_000_001 }), plain), tooLarge(1_000_000));
  // Every day of the next 100,000 is a holiday: the scan goes past the list, and it ends.
  const allHolidays = Array.from({ length: 100_000 }, (_, i) => date.add({ days: i + 1 }));
  const after = addBusinessDays(date, { weekend: [], holidays: allHolidays, days: 1 });
  assert.ok(after.ok);
  assert.ok(after.value.equals(date.add({ days: 100_001 })));
  assert.equal(
    errorCode(addBusinessDays(T.PlainDate.from('+275760-09-12'), { ...plain, days: 10 })),
    'temporal.out_of_range',
  );
  assert.equal(errorCode(businessDaysBetween(T.PlainDate.from('-271821-04-19'), date, plain)), 'temporal.out_of_range');
  assert.ok(addBusinessDays(date, { ...plain, days: 0 }).ok);
  assert.throws(
    () => addBusinessDays(date, { weekend: [], holidays: ['2024-01-02' as unknown as Temporal.PlainDate], days: 1 }),
    TypeError,
  );
  const saturday = T.PlainDate.from('2024-01-06');
  const same = addBusinessDays(saturday, { ...plain, days: 0 });
  assert.ok(same.ok && same.value.equals(saturday));
  const inOtherCalendar = addBusinessDays(date.withCalendar('gregory'), { ...plain, days: 1 });
  assert.ok(inOtherCalendar.ok);
  assert.equal(inOtherCalendar.value.calendarId, 'gregory');
});

testOnEach('business days grow like their input: n, 2n, 4n', (T) => {
  const date = T.PlainDate.from('2024-01-01');
  const calendar = { weekend: [6, 7], holidays: [] };
  const timeOf = (days: number): number => {
    let best = Infinity;
    for (let pass = 0; pass < 5; pass += 1) {
      const started = performance.now();
      addBusinessDays(date, { ...calendar, days });
      businessDaysBetween(date, date.add({ days }), calendar);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  timeOf(1000);
  const [one, four] = [timeOf(200_000), timeOf(800_000)];
  assert.ok(four / one < 12, `4n took ${String(four / one)} times n`);
});

function declareTotal(name: string, run: (value: unknown) => unknown): void {
  const allowed = (check: () => void): void => {
    try {
      check();
    } catch (error) {
      assert.ok(error instanceof TypeError || error instanceof RangeError, String(error));
    }
  };
  declareAdversarial(SUBPATH, name, {
    boundary: (value) => allowed(() => run(value)),
    structures: (value) => allowed(() => run(value)),
    hostile: (value) => {
      try {
        run(value);
      } catch (error) {
        assert.ok(error !== undefined);
      }
    },
    unicode: (text) => allowed(() => run(text)),
    callbacks: { na: `${name} takes no callback` },
    async: { na: `${name} is synchronous and takes no signal` },
  });
}

declareTotal('fromDate', (value) => fromDate(new Date(0), { timeZone: value as string }));
declareTotal('toDate', (value) => toDate(value as Temporal.PlainDate, { timeZone: 'UTC' }));
declareTotal('startOf', (value) => startOf(value as Temporal.PlainDate, 'month'));
declareTotal('endOf', (value) => endOf(value as Temporal.PlainDate, 'month'));
declareTotal('isBusinessDay', (value) => isBusinessDay(value as Temporal.PlainDate, { weekend: [], holidays: [] }));
declareTotal('addBusinessDays', (value) =>
  addBusinessDays(value as Temporal.PlainDate, { weekend: [], holidays: [], days: 1 }),
);
declareTotal('businessDaysBetween', (value) =>
  businessDaysBetween(value as Temporal.PlainDate, value as Temporal.PlainDate, { weekend: [], holidays: [] }),
);
