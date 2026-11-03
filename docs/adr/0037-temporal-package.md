# ADR 0037 — The `@yaltaan/temporal` package

- Date: 2026-11-03
- Status: accepted by delegation of the owner (design choices), to be read by the owner with the beta kit

## Context

`ARCHITECTURE.md` §7.8 lists what Temporal does not give: intervals, declared formats, boundary conversions, `startOf`/`endOf`, business days. [ADR 0035](0035-test262-judge.md) says which parts of Temporal pass everywhere, and [ADR 0036](0036-comparison-with-dayjs.md) what a project leaving dayjs needs. Several questions remain open: what an interval is as a value, what a mix of kinds or implementations does, what a format is, which errors are a `Result`, and how far a reader of outside input may go.

Facts read on 2026-11-03, Node 26.12.1 and temporal-polyfill 1.0.5:

- `compare` ignores the calendar and `equals` does not: `PlainDate.compare(iso, hebrew)` is 0 for the same day and `iso.equals(hebrew)` is false; `since` between them throws a `RangeError`. The same on both implementations.
- `compare` accepts other kinds without a word: `PlainDate.compare(date, zoned)` is 0.
- Two implementations mix badly and unevenly: `PlainDate.compare(native, polyfill)` reads the other as a bag of fields and answers; `ZonedDateTime.compare(native, polyfill)` throws a `TypeError`, and a polyfill date in the Hebrew calendar makes the native `compare` throw a `RangeError`.
- The main entry of `temporal-polyfill` hands back the native Temporal where there is one, so that an application rarely holds both, but a copy of the polyfill's `/implementation` does.

## Options

1. **Native, or do nothing.** Every application rewrites intervals and format readers, and its reader is where `dayjs` goes wrong today.
2. **A class `Interval` with methods.** Reads well, cannot be tree-shaken, and is one more thing to serialize.
3. **Free functions over plain values, `Result` for what data can cause, `TypeError` for what only a program can cause.** The shape of `@yaltaan/core` and `@yaltaan/rules`.

Kept: 3.

## Decision

Temporal is read from `globalThis` when a function that needs it is called; absent, a `TypeError` names the polyfill. A function over Temporal values uses the class of those values.

**Intervals.** An interval is `{ start, end }`, half-open, `start` before `end`, or `emptyInterval`, whose two fields are `undefined`: a plain value, written or read without the library. `interval(start, end)` returns a `Result`: inverted gives `temporal.inverted_interval`, and equal bounds give `emptyInterval`. `overlaps`, `contains`, `intersect`, `union`, `mergeAll`, `gaps`. Touching intervals merge and do not overlap. A closed end is the next value: an interval has one rule. `mergeAll` and `gaps` return a `Result`, as a list can come from data: over 1,000,000 intervals, `temporal.too_large`. Every comparison goes through one function, which refuses with a `TypeError` two bounds of different classes, implementations or calendars. Time zones may differ: two `ZonedDateTime` compare by their instant.

**Formats.** `parsePlainDate`, `parsePlainTime`, `parsePlainDateTime`, `parseZonedDateTime`, each `(text, { format, ... })` → `Result`. A format is `yyyy yy MM M dd d HH H mm ss SSS` and literal characters, `T` among them; another letter, a token used twice, a one-or-two-digit token followed by another token, or a missing field is `temporal.invalid_format`, whatever the text. `yy` needs `pivotYear`: the year falls in `[pivotYear, pivotYear + 99]`; without it, `temporal.ambiguous_format`. Without a format, only the ISO form is read, and anything else is `temporal.ambiguous_format`, never a guess. Digits are ASCII. Text over 64 code units: `temporal.too_long`, and a format over 64 is invalid: both are read at most once, without a regular expression. A text that is not a string is a `temporal.format_mismatch`. The date itself is built by the constructor of Temporal, whose `RangeError` becomes `temporal.invalid_date`. No function exports formatting: `Intl` does it, and a test builds the text a law reads.

**A wall clock in a zone.** `parseZonedDateTime` and `toDate(plain, { timeZone })` refuse by default a time that does not exist (`temporal.nonexistent_time`) or exists twice (`temporal.ambiguous_time`), the error dayjs cannot make: `disambiguation` says otherwise. A time zone or a calendar is outside input: over 64 code units, or refused by Temporal, it is `temporal.invalid_time_zone` or `temporal.invalid_calendar`. `fromDate(date, { timeZone, calendar })` also refuses an invalid `Date`. `toDate` of a `ZonedDateTime` or an `Instant` does not exist: `new Date(value.epochMilliseconds)` is the platform.

**Units.** `startOf(value, unit)` and `endOf(value, unit)` return the same kind, on a `PlainDate`, a `PlainDateTime` or a `ZonedDateTime`; the start of a day comes from the zone, not from midnight; `endOf` of a time is one nanosecond before the next start. `week` requires `firstDayOfWeek`, so that an application says it; a quarter on a calendar without 12 months is a `RangeError`. They return their value, as Temporal itself does, and throw at the limits of its range: a date that near the limit never comes from a reader of `yyyy`.

**Business days.** `isBusinessDay`, `addBusinessDays`, `businessDaysBetween` with `weekend` and `holidays`, both required: no country is a default. Holidays are a list of dates, not a callback: an application fills it for the years it needs, a loop cannot call out, and it ends because the list is finite. Over 100,000 holidays or 1,000,000 days, `temporal.too_large`; every day in the weekend, `temporal.no_business_day`; beyond the range of Temporal, `temporal.out_of_range`. The scan is integer arithmetic, one Temporal call at each end.

Rejected: an `Option` for the empty interval, a callback for holidays (a calendar where every day is a holiday would never end), a default weekend, `dayjs`-style tokens (`YYYY` is another token in `Intl`, in Unicode patterns and here it would mean a week year: `yyyy` is what Java and Unicode call a year), a method `format`, and an exception for an inverted interval.

## Measurements

Size, instruction counts and limits are written in the commits of the package, as each function arrives: budget `yaltaan/temporal-layer`, 1,790 bytes ([ADR 0010](0010-import-size-budgets.md)).

## Consequences

- An application needs `lib` nothing: each declaration brings `esnext.temporal` itself, present in TypeScript 6.0 and 7.
- The result of a parse holds nothing of the text: an issue never echoes outside input.
- Every function is `@experimental`. `T4.4`'s codecs wait for the codec of `@yaltaan/schema`.

## Review condition

A real project that needs a closed interval, a callback for holidays or a format token this list lacks; the budget exceeded; a test262 failure on a Temporal call used here.
