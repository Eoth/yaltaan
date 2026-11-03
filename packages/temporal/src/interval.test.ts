import assert from 'node:assert/strict';
import test from 'node:test';
import { assertType, declareAdversarial, fc, type Equal } from '@yaltaan/testing';
import { OTHER_IMPLEMENTATION, testOnEach } from '@yaltaan/testing/temporal';
import type { Result } from '@yaltaan/core/result';
import {
  contains,
  emptyInterval,
  gaps,
  intersect,
  interval,
  mergeAll,
  overlaps,
  union,
  type Interval,
  type Span,
} from './index.ts';
import type { TemporalIssue } from './shared.ts';

const SUBPATH = '@yaltaan/temporal';
const DAYS = 120;

/** Days from an origin stand for dates: the arbitrary is an integer, each implementation builds its own values. */
const dayPair = fc.tuple(fc.integer({ min: 0, max: DAYS }), fc.integer({ min: 0, max: DAYS }));
const dayLists = fc.array(dayPair, { maxLength: 30 });

type Date_ = Temporal.PlainDate;

function builders(T: typeof Temporal) {
  const origin = T.PlainDate.from('2024-01-01');
  const date = (day: number): Date_ => origin.add({ days: day });
  const dayOf = (value: Date_): number => value.since(origin, { largestUnit: 'days' }).days;
  const make = ([a, b]: readonly [number, number]): Interval<Date_> => {
    const built = interval(date(Math.min(a, b)), date(Math.max(a, b)));
    assert.ok(built.ok);
    return built.value;
  };
  /** The days an interval holds, as a set: what a law compares against, with no comparison of Temporal in it. */
  const daysIn = (one: Interval<Date_>): Set<number> => {
    const days = new Set<number>();
    if (one.start !== undefined) {
      const last = dayOf(one.end as Date_);
      for (let d = dayOf(one.start as Date_); d < last; d += 1) {
        days.add(d);
      }
    }
    return days;
  };
  const sameDays = (actual: ReadonlySet<number>, expected: ReadonlySet<number>): void => {
    assert.deepEqual(
      [...actual].sort((x, y) => x - y),
      [...expected].sort((x, y) => x - y),
    );
  };
  return { date, dayOf, make, daysIn, sameDays };
}

testOnEach('intersection holds the days both hold; commutative and associative', (T) => {
  const { make, daysIn, sameDays } = builders(T);
  fc.assert(
    fc.property(dayPair, dayPair, dayPair, (a, b, c) => {
      const [x, y, z] = [make(a), make(b), make(c)];
      const both = daysIn(intersect(x, y));
      sameDays(both, new Set([...daysIn(x)].filter((d) => daysIn(y).has(d))));
      sameDays(both, daysIn(intersect(y, x)));
      sameDays(daysIn(intersect(intersect(x, y), z)), daysIn(intersect(x, intersect(y, z))));
    }),
    { numRuns: 200 },
  );
});

testOnEach('overlaps and contains say what the days say', (T) => {
  const { date, make, daysIn } = builders(T);
  fc.assert(
    fc.property(dayPair, dayPair, fc.integer({ min: 0, max: DAYS }), (a, b, d) => {
      const [x, y] = [make(a), make(b)];
      const common = [...daysIn(x)].some((day) => daysIn(y).has(day));
      assert.equal(overlaps(x, y), common);
      assert.equal(overlaps(y, x), common);
      assert.equal(contains(x, date(d)), daysIn(x).has(d));
    }),
    { numRuns: 200 },
  );
});

testOnEach('mergeAll keeps the days, in order, without a touching or empty span; union is mergeAll of two', (T) => {
  const { make, daysIn, sameDays, dayOf } = builders(T);
  fc.assert(
    fc.property(dayLists, (pairs) => {
      const list = pairs.map(make);
      const result = mergeAll(list);
      assert.ok(result.ok);
      const expected = new Set(list.flatMap((one) => [...daysIn(one)]));
      sameDays(new Set(result.value.flatMap((one) => [...daysIn(one)])), expected);
      for (let i = 1; i < result.value.length; i += 1) {
        const previous = result.value[i - 1] as Span<Date_>;
        const current = result.value[i] as Span<Date_>;
        assert.ok(dayOf(previous.end) < dayOf(current.start));
      }
      for (const span of result.value) {
        assert.ok(T.PlainDate.compare(span.start, span.end) < 0);
      }
      const shuffled = mergeAll([...list].reverse());
      assert.ok(shuffled.ok);
      assert.deepEqual(shuffled.value.map(String), result.value.map(String));
    }),
    { numRuns: 100 },
  );
});

testOnEach('the union of disjoint intervals keeps the total measure', (T) => {
  const { make, daysIn } = builders(T);
  fc.assert(
    fc.property(dayPair, dayPair, (a, b) => {
      const [x, y] = [make(a), make(b)];
      const measure = (spans: readonly Interval<Date_>[]): number =>
        spans.reduce((sum, one) => sum + daysIn(one).size, 0);
      const merged = union(x, y);
      if (!overlaps(x, y)) {
        assert.equal(measure(merged), measure([x, y]));
      }
      assert.ok(merged.length <= 2);
    }),
    { numRuns: 200 },
  );
});

testOnEach('gaps hold the days of within that the intervals do not; without within, what lies between', (T) => {
  const { make, daysIn, sameDays } = builders(T);
  fc.assert(
    fc.property(dayLists, dayPair, (pairs, around) => {
      const list = pairs.map(make);
      const within = make(around);
      const covered = new Set(list.flatMap((one) => [...daysIn(one)]));
      const inside = gaps(list, { within });
      assert.ok(inside.ok);
      sameDays(
        new Set(inside.value.flatMap((one) => [...daysIn(one)])),
        new Set([...daysIn(within)].filter((d) => !covered.has(d))),
      );
      const between = gaps(list);
      assert.ok(between.ok);
      for (const hole of [...inside.value, ...between.value]) {
        assert.ok(T.PlainDate.compare(hole.start, hole.end) < 0, 'a hole holds something');
      }
      const days = [...covered].sort((x, y) => x - y);
      const expected = new Set<number>();
      for (let d = days[0] ?? 0; d < (days.at(-1) ?? 0); d += 1) {
        if (!covered.has(d)) {
          expected.add(d);
        }
      }
      sameDays(new Set(between.value.flatMap((one) => [...daysIn(one)])), expected);
    }),
    { numRuns: 100 },
  );
});

testOnEach('every kind of value with compare makes an interval; the zone of a bound is kept', (T) => {
  const instant = T.Instant.from('2024-03-10T07:00:00Z');
  const samples = [
    [T.PlainDate.from('2024-01-01'), T.PlainDate.from('2024-01-02')],
    [T.PlainDateTime.from('2024-01-01T10:00'), T.PlainDateTime.from('2024-01-01T11:00')],
    [T.PlainTime.from('10:00'), T.PlainTime.from('11:00')],
    [T.PlainYearMonth.from('2024-01'), T.PlainYearMonth.from('2024-02')],
    [instant, instant.add({ hours: 1 })],
    [instant.toZonedDateTimeISO('America/New_York'), instant.add({ hours: 1 }).toZonedDateTimeISO('Asia/Tokyo')],
  ] as const;
  for (const [start, end] of samples) {
    const built = interval<typeof start | typeof end>(start, end);
    assert.ok(built.ok);
    assert.equal(built.value.start, start);
    assert.ok(contains(built.value, start));
    assert.ok(!contains(built.value, end));
    assert.deepEqual(interval<typeof start | typeof end>(end, start), {
      ok: false,
      error: { code: 'temporal.inverted_interval', path: [], params: { start: String(end), end: String(start) } },
    });
    assert.deepEqual(interval<typeof start>(start, start), { ok: true, value: emptyInterval });
  }
});

testOnEach('compare ignores the calendar and equals does not: an interval never mixes two calendars', (T) => {
  const iso = T.PlainDate.from('2024-03-15');
  const other = iso.withCalendar('gregory');
  assert.equal(T.PlainDate.compare(iso, other), 0);
  assert.equal(iso.equals(other), false);
  assert.throws(() => interval(iso, other), TypeError);
  assert.throws(() => contains({ start: iso, end: iso.add({ days: 1 }) }, other), TypeError);
  const zoned = iso.toZonedDateTime('UTC');
  assert.equal(T.ZonedDateTime.compare(zoned, zoned.withCalendar('gregory')), 0);
  assert.equal(zoned.equals(zoned.withCalendar('gregory')), false);
  assert.throws(() => interval(zoned, zoned.withCalendar('gregory')), TypeError);
});

testOnEach('two kinds never mix, though compare would answer', (T) => {
  const date = T.PlainDate.from('2024-03-15');
  const zoned = date.toZonedDateTime('UTC');
  assert.equal(T.PlainDate.compare(date, zoned), 0);
  assert.throws(() => interval<Temporal.PlainDate | Temporal.ZonedDateTime>(date, zoned), TypeError);
  assert.throws(() => interval<Temporal.PlainDate | Temporal.Instant>(date, zoned.toInstant()), TypeError);
});

test(
  'the native Temporal and the polyfill never mix, whichever kind, though compare answers for some',
  { skip: OTHER_IMPLEMENTATION === undefined },
  () => {
    const [Native, Other] = OTHER_IMPLEMENTATION as readonly [typeof Temporal, typeof Temporal];
    const pairs = [
      [Native.PlainDate.from('2024-03-15'), Other.PlainDate.from('2024-03-16')],
      [Native.PlainDateTime.from('2024-03-15T10:00'), Other.PlainDateTime.from('2024-03-15T11:00')],
      [Native.PlainTime.from('10:00'), Other.PlainTime.from('11:00')],
      [Native.PlainYearMonth.from('2024-03'), Other.PlainYearMonth.from('2024-04')],
      [Native.Instant.from('2024-03-15T00:00Z'), Other.Instant.from('2024-03-16T00:00Z')],
      [Native.ZonedDateTime.from('2024-03-15T00:00Z[UTC]'), Other.ZonedDateTime.from('2024-03-16T00:00Z[UTC]')],
    ] as const;
    for (const [mine, theirs] of pairs) {
      assert.throws(() => interval<typeof mine | typeof theirs>(mine, theirs), TypeError);
      assert.throws(() => interval<typeof mine | typeof theirs>(theirs, mine), TypeError);
    }
    // Why the check exists: on its own, Temporal answers for a plain date and throws for a zoned one.
    const [date, otherDate] = pairs[0];
    assert.equal(Native.PlainDate.compare(date, otherDate), -1);
    const [zoned, otherZoned] = pairs[5];
    assert.throws(() => Native.ZonedDateTime.compare(zoned, otherZoned), TypeError);
  },
);

testOnEach('limits: a list over a million intervals is refused without being read', (T) => {
  const tooLong = new Array(1_000_001) as Interval<Temporal.PlainDate>[];
  const expected = { ok: false, error: { code: 'temporal.too_large', path: [], params: { maximum: 1_000_000 } } };
  assert.deepEqual(mergeAll(tooLong), expected);
  assert.deepEqual(gaps(tooLong), expected);
  assert.ok(T.PlainDate !== undefined);
});

testOnEach('a million intervals merge, in order and out of order, within a bounded time', (T) => {
  const origin = T.PlainDate.from('2024-01-01');
  const one = { start: origin, end: origin.add({ days: 1 }) };
  const list = new Array<Interval<Temporal.PlainDate>>(1_000_000).fill(one);
  const merged = mergeAll(list);
  assert.ok(merged.ok);
  assert.equal(merged.value.length, 1);
  const holes = gaps(list);
  assert.ok(holes.ok);
  assert.equal(holes.value.length, 0);
});

testOnEach('mergeAll grows like its input: n, 2n, 4n', (T) => {
  const origin = T.PlainDate.from('2024-01-01');
  const spans = Array.from({ length: 16000 }, (_, i) => ({
    start: origin.add({ days: (i * 7919) % 16000 }),
    end: origin.add({ days: ((i * 7919) % 16000) + 2 }),
  }));
  const timeOf = (n: number): number => {
    const part = spans.slice(0, n);
    let best = Infinity;
    for (let pass = 0; pass < 5; pass += 1) {
      const started = performance.now();
      assert.ok(mergeAll(part).ok);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  timeOf(1000);
  const [one, four] = [timeOf(4000), timeOf(16000)];
  // A quadratic sort would read 16; n log n reads about 4.7; the margin is for a machine under load.
  assert.ok(four / one < 10, `4n took ${four / one} times n`);
});

test('the types: a mix of kinds does not compile, and a function that can refuse says so', () => {
  const never = (): void => {
    const date = Temporal.PlainDate.from('2024-01-01');
    const instant = Temporal.Instant.from('2024-01-01T00:00Z');
    // @ts-expect-error: both bounds are one kind
    interval(date, instant);
    // @ts-expect-error: a Date is no bound
    interval(new Date(), new Date());
    assertType<
      Equal<ReturnType<typeof interval<Temporal.PlainDate>>, Result<Interval<Temporal.PlainDate>, TemporalIssue>>
    >();
  };
  assert.equal(typeof never, 'function');
});

function declareInterval(name: string, run: (value: unknown) => unknown, ownError = true): void {
  declareAdversarial(SUBPATH, name, {
    boundary: (value) => {
      try {
        run(value);
      } catch (error) {
        assert.ok(error instanceof TypeError);
      }
    },
    structures: (value) => {
      try {
        run(value);
      } catch (error) {
        assert.ok(error instanceof TypeError || error instanceof RangeError);
      }
    },
    hostile: (value) => {
      try {
        run(value);
      } catch (error) {
        assert.ok(ownError);
        assert.ok(error !== undefined);
      }
    },
    unicode: { na: `${name} reads no text` },
    callbacks: { na: `${name} takes no callback` },
    async: { na: `${name} is synchronous and takes no signal` },
  });
}

declareInterval('interval', (value) => interval(value as Temporal.PlainDate, value as Temporal.PlainDate));
declareInterval('contains', (value) =>
  contains({ start: value, end: value } as Span<Temporal.PlainDate>, value as Temporal.PlainDate),
);
declareInterval('overlaps', (value) => overlaps(value as Span<Temporal.PlainDate>, value as Span<Temporal.PlainDate>));
declareInterval('intersect', (value) =>
  intersect(value as Span<Temporal.PlainDate>, value as Span<Temporal.PlainDate>),
);
declareInterval('union', (value) => union(value as Span<Temporal.PlainDate>, value as Span<Temporal.PlainDate>));
declareInterval('mergeAll', (value) => mergeAll([value] as Span<Temporal.PlainDate>[]));
declareInterval('gaps', (value) => gaps([value] as Span<Temporal.PlainDate>[]));
