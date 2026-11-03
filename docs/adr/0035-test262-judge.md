# ADR 0035 — test262 as the judge of the Temporal implementations

- Date: 2026-11-03
- Status: accepted (technical choice, internal)

## Context

`@yaltaan/temporal` computes nothing itself: it stands on the native Temporal or on `temporal-polyfill` ([ADR 0005](0005-temporal-as-a-platform-peer.md)). What those two do is therefore the first question, and it has an official judge: the `test/built-ins/Temporal` and `test/intl402/Temporal` folders of test262, the conformance suite of ECMAScript.

## Options

1. **Native, or do nothing.** Trust the implementations. Cost: a defect of either surfaces as a defect of ours, on one platform out of two, and the sentence "the same on native and on the polyfill" has nothing behind it.
2. **`test262-harness`, the suite's own runner.** A dependency tree that includes host adapters, one process per test. Not measured: installing it was refused by the rules of the machine this work ran on, as code from outside the request.
3. **A runner in the repository.** `INTERPRETING.md` of test262 asks for little when a suite has no `async`, `module`, `raw` or `negative` test: a fresh realm, `assert.js`, `sta.js`, the includes of the front matter, then the test. About 200 lines over `node:vm`; a flag this runner does not support is reported as a failure, never as a pass.

Kept: 3, with its verdict rechecked by a second method (see Measurements).

## Measurements

test262 commit `0b4e0812` of 2026-10-26, 6,634 tests (4,605 and 2,029), all in strict mode unless a test forbids it; on Node 26.12.1, V8 14.6, ICU 78.3, time zone data 2026e; 2026-11-03.

| Implementation | Passed | Not passed | Time, 8 threads |
|---|---:|---:|---:|
| native Temporal | 6,607 | 27 | 2.5 s |
| `temporal-polyfill` 1.0.5, default entry | 5,099 | 1,535, of which 1,515 say only that the calendar is absent | 7 s |
| `temporal-polyfill` 1.0.5, `full` entry | 6,612 | 22 | 10 s |

- No test fails on all three.
- Native: 16 are `toLocaleString`; 10 are `since`, `until` or `Duration.round` with `smallestUnit` and a rounding mode, on an exact multiple of the larger unit; 1 is `ZonedDateTime.round` in a zone where a date starts twice.
- Polyfill, whichever entry: 2 are `Duration.total` on very large values, 5 say that an array is iterated where the specification does not, 1 calls `Number.isFinite`, 1 is the `links` test of time zones; the default entry adds 11 error-order or field-check tests of calendars it does not have, the `full` entry 13 about Chinese calendar dates and extreme dates.
- `links` is the only difference when the polyfill runs on Node 24.21.0 instead (time zone data 2026c instead of 2026e): the test passes there. The table is a statement about one runtime.
- Sloppy mode gives the same three tables.
- Two runs give the same bytes. The whole step takes 21.8 s, or 0.6 s when none of its inputs changed.
- Second method: each of the 27 native failures and 300 tests drawn among the passes, run in a separate plain Node process with no `vm` context, harness and test concatenated: 327 of 327 agree. A false test: one line added to a fetched file fails the sum; `--falsify` on the real suite fails the comparison and names the test; both seen red.

## Decision

- `scripts/test262.sh` fetches Node 26.12.1 and the pinned commit, each checked by a sum written in the script, into the user's cache and never through npm; `scripts/test262.ts` runs the three implementations and compares each with its table in `docs/test262/`. The gate step runs it; without network and without a cache, the step is reported skipped.
- `--write` rewrites the tables, only in a commit that changes a pin and says why.
- A row of a table holds the first 120 characters of the test and its error. A failure that says only that the default entry lacks a calendar is counted by calendar rather than listed: 1,515 rows would say the same thing.
- The functions of `@yaltaan/temporal` use only what passes everywhere: no `round` on a `ZonedDateTime` (the start of a day comes from `startOfDay`), no `smallestUnit` or rounding mode on `since` or `until`, no `Duration.total` on calendar units, no `toLocaleString`, no comparison of time zone names.

## Consequences

- The gate gains a step of about 22 s when an input changes, and CI, with an empty cache, always pays it, plus about 40 MB downloaded.
- A new polyfill version or a new pin of Node moves a table: the change is read before it is written, and its diff is the list of what changed.
- What this judge does not see: Firefox, WebKit, Deno, Bun and other Node versions; `@js-temporal/polyfill`, promised by ADR 0005, opened as its own ticket; what test262 itself does not test (it asserts behaviour on chosen values: daylight saving on generated values is the work of the comparison against dayjs); a test of `Intl` outside the `Temporal` folders.

## Review condition

A new Node line with Temporal (pin raised, table read), a version of `temporal-polyfill`, or a failure of a test on a function that `@yaltaan/temporal` uses.
