# ADR 0036 — A generated comparison with dayjs, java.time as the referee

- Date: 2026-11-03
- Status: accepted (technical choice, internal)

## Context

The owner decided on 2026-11-03 to bring the Temporal lot forward: a real project under dayjs gets its date arithmetic and its date checks wrong. Whether Temporal and `@yaltaan/temporal` do better has to be shown, on every variant, including where dayjs wins, before the package is written. test262 ([ADR 0035](0035-test262-judge.md)) judges Temporal on values its authors chose; nothing judges dayjs, and nothing compares them.

## Options

1. **Native, or do nothing.** Trust the reputation of Temporal. The decision to move rests then on an opinion, and a beta tester asks for the proof first.
2. **A list of known dayjs bugs from its issue tracker.** Quick, and it covers only what someone already reported; it would also say nothing of what Temporal itself does.
3. **Cases generated from the platform, three sides and a referee.** Time zones read from `Intl.supportedValuesOf('timeZone')`, instants read from each zone's own transitions, calendar edges enumerated, the rest from a fixed seed; dayjs and its plugins, the native Temporal and temporal-polyfill answer the same questions, and java.time, which shares no code with them, decides.

Kept: 3.

## Measurements

dayjs 1.11.23, Node 26.12.1 (ICU 78.3, time zone data 2026e), temporal-polyfill 1.0.5, Java 17.0.20.1 (tzdb 2026b), 418 time zones, 2026-11-03. 45 s for the report. The full tables are in [docs/comparisons/dayjs.md](../comparisons/dayjs.md) and [dayjs-measures.md](../comparisons/dayjs-measures.md).

- 161,636 cases, of which 121,268 on transitions since 2000 and on calendar families. On these: all agree on 111,258; dayjs differs on 9,383 where java.time and Temporal agree; Temporal differs on 531, all of them the convention of the side of an overlap; java.time alone on 27, from its older data; 69 undecided, the pivot of a two-digit year.
- dayjs does not differ at all on adding or subtracting days and months to a date, days between dates, start and end of a unit without a zone, a gap read in a zone, or its strict reading with a format.
- dayjs differs after arithmetic across a transition (`zoned-add-hours`: the instant is right and the wall clock wrong, on 4,262 of 6,390 cases taken around transitions), at the start of a day with a transition (`start-of-zoned`, 339), when the machine has another time zone (`date-to-zone`: 0 under UTC, 172 under Paris), and on the side of an overlap, which follows the day the code runs (1,383 cases in January, 174 in July).
- `dayjs('2024-02-31')` passes for valid and moves to March; 483 of 2,310 permissive validations are accepted where java.time and Temporal refuse.
- Native and polyfill differ only around the 1976 transition of `Africa/El_Aaiun`, in 28 cases. Temporal differs from java.time by more than a convention only for `America/Bogota` in 1992, where the data of Node are newer than those of Java.
- What dayjs wins: 6,131 bytes against 17,851 for the polyfill on Safari, iOS, Node 22 and 24; fewer instructions than the polyfill on 4 operations out of 8. The native Temporal does the fewest on all 8, and costs 0 bytes.

A verdict was recouped by hand on cases that do not need a referee: `Asia/Gaza`, 2023-04-29, 02:00 does not exist, and 23:00 plus 3 hours is 03:00; dayjs says 02:00. The clock dependence was read in the source of the plugin (`tzOffset(+d(), timezone)`) before it was measured.

## Decision

- `tests/compare-dayjs/`: `generate.mjs` makes the cases, `families.mjs` holds the sides, `Oracle.java` the referee, `report.ts` the verdict, tested in the gate; `run.sh` replays, `run.sh --write` rewrites, `measure.sh` measures. Outside the gate and outside the lockfile, as `tests/interop/run.sh`: dayjs is compared, not used, and its version and integrity are pinned in the script.
- dayjs sees a machine clock fixed at 15 January 2026, and at 15 July for one family: without it the report would change with the seasons. Each side's time zone data are written in the report; a family `:old` holds the transitions before 2000, apart from what an application meets every day.
- A polyfill is compared through `temporal-polyfill/implementation`: the main entry hands back the native Temporal where there is one, and the comparison would have judged native against itself. The script refuses to run when the two sides are one.
- Every function of `@yaltaan/temporal` that has an equivalent enters the comparison in its own commit.
- Conventions are not faults: the notes of the report say which columns hold one, and those notes are prose, checked against the smallest examples when the report changes.

## Consequences

- The result is a statement about one runtime and one version of each side: a new pin moves it, and the difference is the list of what changed.
- What this comparison does not see: dayjs's locale data and formatting; browsers; the machine time zones it does not try; a dayjs call the families do not make; time zone data newer than those of a side.
- A real project that always uses `dayjs.utc` and the strict mode meets few of these errors, and the report says so; the owner's own cases were not available to this comparison.

## Review condition

A version of dayjs that changes a verdict, a new pin of Node or of the polyfill, or a case from a real project that the families do not produce.
