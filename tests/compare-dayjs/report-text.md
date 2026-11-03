# dayjs, the native Temporal and temporal-polyfill on generated cases

Written by `bash tests/compare-dayjs/run.sh --write`, and replayed to the byte by the same command without `--write`. The method is in [ADR 0036](../adr/0036-comparison-with-dayjs.md); what each side costs is in [the measures](dayjs-measures.md).

A disagreement goes to java.time, which shares no code with the others: "dayjs differs" means dayjs answers otherwise while java.time and the native Temporal agree, and "Temporal differs" the reverse. "Undecided" means this rule does not settle it: three different answers, a case where java.time or Temporal has no answer, or the polyfill alone against the rest (the last column counts those). A referee can only say who agrees with it: where a rule is a convention, the notes under the table say so. A family name ending in `:old` holds the cases of transitions before 2000, apart from what an application meets every day.

Sides: dayjs {dayjs} with its `utc`, `timezone`, `customParseFormat`, `isBetween`, `quarterOfYear` and `isoWeek` plugins; native Temporal of Node {node} (ICU {icu}, time zone data {tz}); temporal-polyfill {polyfill} on the same Node; {java}. Time zones: {zones}, read from `Intl.supportedValuesOf('timeZone')`. The process runs in UTC unless a family says otherwise. dayjs sees a machine clock fixed at 15 January 2026, because `dayjs.tz` reads the clock, and a report must not depend on the day.

<!-- notes -->
- A stamp is the wall clock and the instant. The table of stamps counts those where only the wall clock is wrong (the instant is right: what is displayed is false), those where only the instant differs (same wall clock: the other side of an overlap, or a sub-minute offset), and those where both differ.
- `overlap-in-zone`: which side of an overlap `dayjs.tz(wall, zone)` takes depends on the offset of the zone on the day the code runs: `overlap-in-zone` runs with a machine clock of 15 January, `overlap-in-zone@july` of 15 July, and the counts differ. `dayjs(wall)` in a process set to that zone, the native `Date`, Temporal and `atZone` of java.time always take the earlier instant (`overlap-local` agrees).
- `date-to-zone@paris`, `date-to-zone@new-york`: the same call as `date-to-zone`, on a machine set to another zone: under UTC dayjs agrees everywhere on recent dates, and not there: its answer depends on the time zone of the machine.
- `zoned-add-*`, "Temporal differs": landing in an overlap, Temporal takes the earlier instant (`compatible`), and `ZonedDateTime.plus*` of java.time keeps the offset of its start when it can. Both are documented conventions; dayjs agrees with java.time on these cases by what its offset was, not by that rule.
- `diff-months`, `diff-years`: from 29 January to 28 February, dayjs counts one month, as adding a month to the 29th lands on the 28th; Temporal and java.time count none. A convention too, where those two agree.
- `two-digit-year`: no truth, only pivots: dayjs reads 69 as 1969, java.time as 2069, Temporal reads no such text.
- `parse-strict`, `validate-strict`: with a format and `true`, dayjs agrees everywhere: a project that always uses its strict mode does not meet the errors of `validate-permissive`.
- `parse-strict` is answered by Temporal only for `YYYY-MM-DD`: it reads ISO 8601 and nothing else.
- `@yaltaan/temporal` answers where it has the function, on the native Temporal and on the polyfill, each as `globalThis.Temporal`; its column counts the cases where it differs from the native Temporal, or from java.time where Temporal has no answer.
- Time zones where the native Temporal and the polyfill differ, read from the results: {polyfillApart}.
- Time zones where Temporal differs by more than the side of an overlap, read from the results: {temporalApart}. The time zone data of Node are newer than those of Java.
