# dayjs, the native Temporal and temporal-polyfill on generated cases

Written by `bash tests/compare-dayjs/run.sh --write`, and replayed to the byte by the same command without `--write`. The method is in [ADR 0036](../adr/0036-comparison-with-dayjs.md); what each side costs is in [the measures](dayjs-measures.md).

A disagreement goes to java.time, which shares no code with the others: "dayjs differs" means dayjs answers otherwise while java.time and the native Temporal agree, and "Temporal differs" the reverse. "Undecided" means this rule does not settle it: three different answers, a case where java.time or Temporal has no answer, or the polyfill alone against the rest (the last column counts those). A referee can only say who agrees with it: where a rule is a convention, the notes under the table say so. A family name ending in `:old` holds the cases of transitions before 2000, apart from what an application meets every day.

Sides: dayjs 1.11.23 with its `utc`, `timezone`, `customParseFormat`, `isBetween`, `quarterOfYear` and `isoWeek` plugins; native Temporal of Node 26.12.1 (ICU 78.3, time zone data 2026e); temporal-polyfill 1.0.5 on the same Node; java 17.0.20.1, tzdb 2026b. Time zones: 418, read from `Intl.supportedValuesOf('timeZone')`. The process runs in UTC unless a family says otherwise. dayjs sees a machine clock fixed at 15 January 2026, because `dayjs.tz` reads the clock, and a report must not depend on the day.

| Family | Cases | All agree | dayjs differs | Temporal differs | java.time alone | Undecided | Native and polyfill differ |
|---|---:|---:|---:|---:|---:|---:|---:|
| add-days | 4570 | 4570 | 0 | 0 | 0 | 0 | 0 |
| add-months | 5941 | 5941 | 0 | 0 | 0 | 0 | 0 |
| between | 3195 | 2751 | 444 | 0 | 0 | 0 | 0 |
| between:old | 2088 | 1792 | 296 | 0 | 0 | 0 | 0 |
| compare | 3195 | 2886 | 307 | 0 | 2 | 0 | 0 |
| compare:old | 2088 | 1729 | 359 | 0 | 0 | 0 | 0 |
| date-to-zone | 5325 | 5325 | 0 | 0 | 0 | 0 | 0 |
| date-to-zone:old | 3480 | 2619 | 855 | 0 | 3 | 3 | 3 |
| date-to-zone@new-york | 5325 | 5316 | 9 | 0 | 0 | 0 | 0 |
| date-to-zone@new-york:old | 3480 | 2470 | 1004 | 0 | 3 | 3 | 3 |
| date-to-zone@paris | 5325 | 5153 | 172 | 0 | 0 | 0 | 0 |
| date-to-zone@paris:old | 3480 | 1981 | 1493 | 0 | 3 | 3 | 3 |
| diff-days | 8570 | 8570 | 0 | 0 | 0 | 0 | 0 |
| diff-months | 8570 | 8408 | 162 | 0 | 0 | 0 | 0 |
| diff-years | 8570 | 8568 | 2 | 0 | 0 | 0 | 0 |
| end-of-plain | 2742 | 2742 | 0 | 0 | 0 | 0 | 0 |
| end-of-zoned | 6808 | 6801 | 0 | 0 | 7 | 0 | 0 |
| end-of-zoned:old | 4176 | 1670 | 2500 | 0 | 2 | 4 | 4 |
| extreme-add-month | 17 | 9 | 6 | 0 | 2 | 0 | 0 |
| extreme-add-year | 17 | 9 | 6 | 0 | 2 | 0 | 0 |
| extreme-read | 17 | 11 | 5 | 0 | 1 | 0 | 0 |
| far-date-to-zone | 836 | 829 | 0 | 0 | 7 | 0 | 0 |
| gap-in-zone | 1602 | 1602 | 0 | 0 | 0 | 0 | 0 |
| gap-in-zone:old | 1392 | 1386 | 0 | 0 | 3 | 3 | 3 |
| gap-local | 1602 | 1602 | 0 | 0 | 0 | 0 | 0 |
| gap-local:old | 1392 | 1386 | 0 | 0 | 3 | 3 | 3 |
| old-date-to-zone | 836 | 805 | 31 | 0 | 0 | 0 | 0 |
| overlap-in-zone | 1593 | 210 | 1383 | 0 | 0 | 0 | 0 |
| overlap-in-zone:old | 696 | 354 | 342 | 0 | 0 | 0 | 0 |
| overlap-in-zone@july | 1593 | 1419 | 174 | 0 | 0 | 0 | 0 |
| overlap-in-zone@july:old | 696 | 410 | 286 | 0 | 0 | 0 | 0 |
| overlap-local | 1593 | 1593 | 0 | 0 | 0 | 0 | 0 |
| overlap-local:old | 696 | 696 | 0 | 0 | 0 | 0 | 0 |
| parse-permissive | 121 | 35 | 80 | 0 | 6 | 0 | 0 |
| parse-strict | 9247 | 9247 | 0 | 0 | 0 | 0 | 0 |
| same-day | 2130 | 2047 | 83 | 0 | 0 | 0 | 0 |
| same-day:old | 1392 | 1338 | 54 | 0 | 0 | 0 | 0 |
| start-of-plain | 2742 | 2742 | 0 | 0 | 0 | 0 | 0 |
| start-of-zoned | 6808 | 6469 | 339 | 0 | 0 | 0 | 0 |
| start-of-zoned:old | 4176 | 3038 | 1137 | 1 | 0 | 0 | 1 |
| two-digit-year | 300 | 231 | 0 | 0 | 0 | 69 | 0 |
| validate-permissive | 2310 | 1827 | 483 | 0 | 0 | 0 | 0 |
| validate-strict | 2310 | 2310 | 0 | 0 | 0 | 0 | 0 |
| zone-to-date | 1483 | 1482 | 1 | 0 | 0 | 0 | 0 |
| zone-to-date:old | 696 | 678 | 18 | 0 | 0 | 0 | 0 |
| zone-to-date@new-york | 1065 | 1064 | 1 | 0 | 0 | 0 | 0 |
| zone-to-date@new-york:old | 696 | 678 | 18 | 0 | 0 | 0 | 0 |
| zone-to-date@paris | 1065 | 1064 | 1 | 0 | 0 | 0 | 0 |
| zone-to-date@paris:old | 696 | 678 | 18 | 0 | 0 | 0 | 0 |
| zone-to-utc | 1065 | 1064 | 1 | 0 | 0 | 0 | 0 |
| zone-to-utc:old | 696 | 678 | 18 | 0 | 0 | 0 | 0 |
| zone-to-zone | 1065 | 1064 | 1 | 0 | 0 | 0 | 0 |
| zone-to-zone:old | 696 | 666 | 30 | 0 | 0 | 0 | 0 |
| zoned-add-days | 2130 | 531 | 1068 | 531 | 0 | 0 | 0 |
| zoned-add-days:old | 1392 | 221 | 937 | 230 | 0 | 4 | 2 |
| zoned-add-hours | 6390 | 2128 | 4262 | 0 | 0 | 0 | 0 |
| zoned-add-hours:old | 4176 | 1318 | 2854 | 4 | 0 | 0 | 4 |
| zoned-add-months | 1065 | 705 | 360 | 0 | 0 | 0 | 0 |
| zoned-add-months:old | 696 | 68 | 627 | 1 | 0 | 0 | 1 |
| zoned-diff-days | 1065 | 1065 | 0 | 0 | 0 | 0 | 0 |
| zoned-diff-days:old | 696 | 692 | 4 | 0 | 0 | 0 | 0 |
| zoned-diff-hours | 1065 | 1063 | 2 | 0 | 0 | 0 | 0 |
| zoned-diff-hours:old | 696 | 690 | 4 | 0 | 1 | 1 | 1 |
| **All** | 161636 | 138494 | 22237 | 767 | 45 | 93 | 28 |

## How to read it

- A stamp is the wall clock and the instant. The table of stamps counts those where only the wall clock is wrong (the instant is right: what is displayed is false), those where only the instant differs (same wall clock: the other side of an overlap, or a sub-minute offset), and those where both differ.
- `overlap-in-zone`: which side of an overlap `dayjs.tz(wall, zone)` takes depends on the offset of the zone on the day the code runs: `overlap-in-zone` runs with a machine clock of 15 January, `overlap-in-zone@july` of 15 July, and the counts differ. `dayjs(wall)` in a process set to that zone, the native `Date`, Temporal and `atZone` of java.time always take the earlier instant (`overlap-local` agrees).
- `date-to-zone@paris`, `date-to-zone@new-york`: the same call as `date-to-zone`, on a machine set to another zone: under UTC dayjs agrees everywhere on recent dates, and not there: its answer depends on the time zone of the machine.
- `zoned-add-*`, "Temporal differs": landing in an overlap, Temporal takes the earlier instant (`compatible`), and `ZonedDateTime.plus*` of java.time keeps the offset of its start when it can. Both are documented conventions; dayjs agrees with java.time on these cases by what its offset was, not by that rule.
- `diff-months`, `diff-years`: from 29 January to 28 February, dayjs counts one month, as adding a month to the 29th lands on the 28th; Temporal and java.time count none. A convention too, where those two agree.
- `two-digit-year`: no truth, only pivots: dayjs reads 69 as 1969, java.time as 2069, Temporal reads no such text.
- `parse-strict`, `validate-strict`: with a format and `true`, dayjs agrees everywhere: a project that always uses its strict mode does not meet the errors of `validate-permissive`.
- `parse-strict` is answered by Temporal only for `YYYY-MM-DD`: it reads ISO 8601 and nothing else.
- Time zones where the native Temporal and the polyfill differ, read from the results: Africa/El_Aaiun.
- Time zones where Temporal differs by more than the side of an overlap, read from the results: America/Bogota. The time zone data of Node are newer than those of Java.

## How the stamps differ

| Family | dayjs: only the wall clock | dayjs: only the instant | dayjs: both | Temporal: only the instant |
|---|---:|---:|---:|---:|
| date-to-zone:old | 0 | 855 | 0 | 0 |
| date-to-zone@new-york | 0 | 0 | 9 | 0 |
| date-to-zone@new-york:old | 0 | 993 | 11 | 0 |
| date-to-zone@paris | 0 | 0 | 172 | 0 |
| date-to-zone@paris:old | 0 | 1485 | 8 | 0 |
| end-of-zoned:old | 0 | 4 | 2496 | 0 |
| old-date-to-zone | 0 | 31 | 0 | 0 |
| overlap-in-zone | 0 | 1383 | 0 | 0 |
| overlap-in-zone:old | 42 | 300 | 0 | 0 |
| overlap-in-zone@july | 0 | 174 | 0 | 0 |
| overlap-in-zone@july:old | 42 | 244 | 0 | 0 |
| start-of-zoned | 38 | 287 | 14 | 0 |
| start-of-zoned:old | 282 | 300 | 555 | 0 |
| zone-to-utc | 0 | 0 | 1 | 0 |
| zone-to-utc:old | 0 | 0 | 18 | 0 |
| zone-to-zone | 0 | 0 | 1 | 0 |
| zone-to-zone:old | 0 | 12 | 18 | 0 |
| zoned-add-days | 534 | 0 | 534 | 531 |
| zoned-add-days:old | 477 | 0 | 460 | 229 |
| zoned-add-hours | 4256 | 2 | 4 | 0 |
| zoned-add-hours:old | 2746 | 36 | 72 | 0 |
| zoned-add-months | 360 | 0 | 0 | 0 |
| zoned-add-months:old | 347 | 0 | 280 | 0 |

## The smallest example of each disagreement

### between

- `dayjs \| java.time=native=polyfill`, 444 cases. `["2009-06-19T20:00:00","2009-06-19T19:00:00","2009-06-20T03:00:00","Asia/Dhaka","()"]` → dayjs: `outside`; java.time: `between`; native: `between`; polyfill: `between`

### between:old

- `dayjs \| java.time=native=polyfill`, 296 cases. `["1977-12-31T21:00:00","1977-12-31T20:00:00","1978-01-01T04:00:00","Asia/Hovd","()"]` → dayjs: `outside`; java.time: `between`; native: `between`; polyfill: `between`

### compare

- `dayjs \| java.time=native=polyfill`, 307 cases. `["2002-04-06T21:00:00","Asia/Karachi","2002-04-07T02:00:00","Asia/Chita"]` → dayjs: `before`; java.time: `same`; native: `same`; polyfill: `same`
- `dayjs=native=polyfill \| java.time`, 2 cases. `["2026-10-31T23:00:00","America/Nome","2026-11-01T07:00:00","Africa/Casablanca"]` → dayjs: `same`; java.time: `after`; native: `same`; polyfill: `same`

### compare:old

- `dayjs \| java.time=native=polyfill`, 359 cases. `["1981-09-30T21:00:00","Asia/Atyrau","1981-09-30T21:00:00","Asia/Baku"]` → dayjs: `before`; java.time: `same`; native: `same`; polyfill: `same`

### date-to-zone:old

- `dayjs \| java.time=native=polyfill`, 855 cases. `[-719636811999,"Asia/Aden"]` → dayjs: `1947-3-13T23:53:8.1 -719636810999`; java.time: `1947-3-13T23:53:8.1 -719636811999`; native: `1947-3-13T23:53:8.1 -719636811999`; polyfill: `1947-3-13T23:53:8.1 -719636811999`
- `dayjs=java.time=native \| polyfill`, 3 cases. `[198291600000,"Africa/El_Aaiun"]` → dayjs: `1976-4-14T1:0:0.0 198291600000`; java.time: `1976-4-14T1:0:0.0 198291600000`; native: `1976-4-14T1:0:0.0 198291600000`; polyfill: `1976-4-14T0:0:0.0 198291600000`
- `dayjs=native=polyfill \| java.time`, 3 cases. `[704782800000,"America/Bogota"]` → dayjs: `1992-5-2T1:0:0.0 704782800000`; java.time: `1992-5-2T0:0:0.0 704782800000`; native: `1992-5-2T1:0:0.0 704782800000`; polyfill: `1992-5-2T1:0:0.0 704782800000`

### date-to-zone@new-york

- `dayjs \| java.time=native=polyfill`, 9 cases. `[1018123200000,"Asia/Karachi"]` → dayjs: `2002-4-7T3:0:0.0 1018126800000`; java.time: `2002-4-7T2:0:0.0 1018123200000`; native: `2002-4-7T2:0:0.0 1018123200000`; polyfill: `2002-4-7T2:0:0.0 1018123200000`

### date-to-zone@new-york:old

- `dayjs \| java.time=native=polyfill`, 1004 cases. `[-719636811999,"Asia/Aden"]` → dayjs: `1947-3-13T23:53:8.1 -719636810999`; java.time: `1947-3-13T23:53:8.1 -719636811999`; native: `1947-3-13T23:53:8.1 -719636811999`; polyfill: `1947-3-13T23:53:8.1 -719636811999`
- `dayjs=java.time=native \| polyfill`, 3 cases. `[198291600000,"Africa/El_Aaiun"]` → dayjs: `1976-4-14T1:0:0.0 198291600000`; java.time: `1976-4-14T1:0:0.0 198291600000`; native: `1976-4-14T1:0:0.0 198291600000`; polyfill: `1976-4-14T0:0:0.0 198291600000`
- `dayjs=native=polyfill \| java.time`, 3 cases. `[704782800000,"America/Bogota"]` → dayjs: `1992-5-2T1:0:0.0 704782800000`; java.time: `1992-5-2T0:0:0.0 704782800000`; native: `1992-5-2T1:0:0.0 704782800000`; polyfill: `1992-5-2T1:0:0.0 704782800000`

### date-to-zone@paris

- `dayjs \| java.time=native=polyfill`, 172 cases. `[1679785200000,"Asia/Beirut"]` → dayjs: `2023-3-26T3:0:0.0 1679788800000`; java.time: `2023-3-26T2:0:0.0 1679785200000`; native: `2023-3-26T2:0:0.0 1679785200000`; polyfill: `2023-3-26T2:0:0.0 1679785200000`

### date-to-zone@paris:old

- `dayjs \| java.time=native=polyfill`, 1493 cases. `[-719636811999,"Asia/Aden"]` → dayjs: `1947-3-13T23:53:8.1 -719636810999`; java.time: `1947-3-13T23:53:8.1 -719636811999`; native: `1947-3-13T23:53:8.1 -719636811999`; polyfill: `1947-3-13T23:53:8.1 -719636811999`
- `dayjs=java.time=native \| polyfill`, 3 cases. `[198291600000,"Africa/El_Aaiun"]` → dayjs: `1976-4-14T1:0:0.0 198291600000`; java.time: `1976-4-14T1:0:0.0 198291600000`; native: `1976-4-14T1:0:0.0 198291600000`; polyfill: `1976-4-14T0:0:0.0 198291600000`
- `dayjs=native=polyfill \| java.time`, 3 cases. `[704782800000,"America/Bogota"]` → dayjs: `1992-5-2T1:0:0.0 704782800000`; java.time: `1992-5-2T0:0:0.0 704782800000`; native: `1992-5-2T1:0:0.0 704782800000`; polyfill: `1992-5-2T1:0:0.0 704782800000`

### diff-months

- `dayjs \| java.time=native=polyfill`, 162 cases. `["1900-02-28","1900-01-29"]` → dayjs: `1`; java.time: `0`; native: `0`; polyfill: `0`

### diff-years

- `dayjs \| java.time=native=polyfill`, 2 cases. `["2001-02-28","2000-02-29"]` → dayjs: `1`; java.time: `0`; native: `0`; polyfill: `0`

### end-of-zoned

- `dayjs=native=polyfill \| java.time`, 7 cases. `["2026-03-08T06:00:00","America/Inuvik","year"]` → dayjs: `2026-12-31T23:59:59.999 1798783199999`; java.time: `2026-12-31T23:59:59.999 1798786799999`; native: `2026-12-31T23:59:59.999 1798783199999`; polyfill: `2026-12-31T23:59:59.999 1798783199999`

### end-of-zoned:old

- `dayjs \| java.time=native=polyfill`, 2500 cases. `["1900-10-01T02:42:08","Asia/Gaza","day"]` → dayjs: `1900-10-2T0:0:0.999 -2185322398001`; java.time: `1900-10-1T23:59:59.999 -2185322400001`; native: `1900-10-1T23:59:59.999 -2185322400001`; polyfill: `1900-10-1T23:59:59.999 -2185322400001`
- `dayjs=java.time=native \| polyfill`, 4 cases. `["1976-04-14T04:00:00","Africa/El_Aaiun","day"]` → dayjs: `1976-4-14T23:59:59.999 198374399999`; java.time: `1976-4-14T23:59:59.999 198374399999`; native: `1976-4-14T23:59:59.999 198374399999`; polyfill: `1976-4-14T23:59:59.999 198377999999`
- `dayjs=native=polyfill \| java.time`, 2 cases. `["1992-05-02T04:00:00","America/Bogota","day"]` → dayjs: `1992-5-2T23:59:59.999 704865599999`; java.time: `1992-5-2T23:59:59.999 704869199999`; native: `1992-5-2T23:59:59.999 704865599999`; polyfill: `1992-5-2T23:59:59.999 704865599999`

### extreme-add-month

- `dayjs \| java.time=native=polyfill`, 6 cases. `["0000-01-01"]` → dayjs: `1900-2-1`; java.time: `0-2-1`; native: `0-2-1`; polyfill: `0-2-1`
- `dayjs=native=polyfill \| java.time`, 2 cases. `["+275760-09-13"]` → dayjs: `refused`; java.time: `275760-10-13`; native: `refused`; polyfill: `refused`

### extreme-add-year

- `dayjs \| java.time=native=polyfill`, 6 cases. `["0000-01-01"]` → dayjs: `1901-1-1`; java.time: `1-1-1`; native: `1-1-1`; polyfill: `1-1-1`
- `dayjs=native=polyfill \| java.time`, 2 cases. `["+275760-09-13"]` → dayjs: `refused`; java.time: `275761-9-13`; native: `refused`; polyfill: `refused`

### extreme-read

- `dayjs \| java.time=native=polyfill`, 5 cases. `["0000-01-01"]` → dayjs: `1900-1-1`; java.time: `0-1-1`; native: `0-1-1`; polyfill: `0-1-1`
- `dayjs=native=polyfill \| java.time`, 1 cases. `["+275760-09-14"]` → dayjs: `refused`; java.time: `275760-9-14`; native: `refused`; polyfill: `refused`

### far-date-to-zone

- `dayjs=native=polyfill \| java.time`, 7 cases. `[7258118400000,"America/Inuvik"]` → dayjs: `2199-12-31T18:0:0.0 7258118400000`; java.time: `2199-12-31T17:0:0.0 7258118400000`; native: `2199-12-31T18:0:0.0 7258118400000`; polyfill: `2199-12-31T18:0:0.0 7258118400000`

### gap-in-zone:old

- `dayjs=java.time=native \| polyfill`, 3 cases. `["1976-04-14T00:00:00","Africa/El_Aaiun"]` → dayjs: `1976-4-14T1:0:0.0 198291600000`; java.time: `1976-4-14T1:0:0.0 198291600000`; native: `1976-4-14T1:0:0.0 198291600000`; polyfill: `1976-4-14T0:0:0.0 198291600000`
- `dayjs=native=polyfill \| java.time`, 3 cases. `["1992-05-02T00:00:00","America/Bogota"]` → dayjs: `1992-5-2T1:0:0.0 704782800000`; java.time: `1992-5-2T0:0:0.0 704782800000`; native: `1992-5-2T1:0:0.0 704782800000`; polyfill: `1992-5-2T1:0:0.0 704782800000`

### gap-local:old

- `dayjs=java.time=native \| polyfill`, 3 cases. `["1976-04-14T00:00:00","Africa/El_Aaiun"]` → dayjs: `1976-4-14T1:0:0.0 198291600000`; java.time: `1976-4-14T1:0:0.0 198291600000`; native: `1976-4-14T1:0:0.0 198291600000`; polyfill: `1976-4-14T0:0:0.0 198291600000`
- `dayjs=native=polyfill \| java.time`, 3 cases. `["1992-05-02T00:00:00","America/Bogota"]` → dayjs: `1992-5-2T1:0:0.0 704782800000`; java.time: `1992-5-2T0:0:0.0 704782800000`; native: `1992-5-2T1:0:0.0 704782800000`; polyfill: `1992-5-2T1:0:0.0 704782800000`

### old-date-to-zone

- `dayjs \| java.time=native=polyfill`, 31 cases. `[-2194732800000,"Africa/Lagos"]` → dayjs: `1900-6-15T0:13:35.0 -2194780885000`; java.time: `1900-6-15T0:13:35.0 -2194732800000`; native: `1900-6-15T0:13:35.0 -2194732800000`; polyfill: `1900-6-15T0:13:35.0 -2194732800000`

### overlap-in-zone

- `dayjs \| java.time=native=polyfill`, 1383 cases. `["2023-10-28T01:00:00","Asia/Gaza"]` → dayjs: `2023-10-28T1:0:0.0 1698447600000`; java.time: `2023-10-28T1:0:0.0 1698444000000`; native: `2023-10-28T1:0:0.0 1698444000000`; polyfill: `2023-10-28T1:0:0.0 1698444000000`

### overlap-in-zone:old

- `dayjs \| java.time=native=polyfill`, 342 cases. `["1900-09-30T23:42:08","Asia/Gaza"]` → dayjs: `1900-9-30T23:42:8.0 -2185409872000`; java.time: `1900-9-30T23:42:8.0 -2185410944000`; native: `1900-9-30T23:42:8.0 -2185410944000`; polyfill: `1900-9-30T23:42:8.0 -2185410944000`

### overlap-in-zone@july

- `dayjs \| java.time=native=polyfill`, 174 cases. `["2024-02-29T23:00:00","Asia/Almaty"]` → dayjs: `2024-2-29T23:0:0.0 1709229600000`; java.time: `2024-2-29T23:0:0.0 1709226000000`; native: `2024-2-29T23:0:0.0 1709226000000`; polyfill: `2024-2-29T23:0:0.0 1709226000000`

### overlap-in-zone@july:old

- `dayjs \| java.time=native=polyfill`, 286 cases. `["1947-03-13T23:53:08","Asia/Aden"]` → dayjs: `1947-3-13T23:53:8.0 -719636812000`; java.time: `1947-3-13T23:53:8.0 -719637224000`; native: `1947-3-13T23:53:8.0 -719637224000`; polyfill: `1947-3-13T23:53:8.0 -719637224000`

### parse-permissive

- `dayjs \| java.time=native=polyfill`, 80 cases. `["12"]` → dayjs: `2001-12-1`; java.time: `refused`; native: `refused`; polyfill: `refused`
- `dayjs=native=polyfill \| java.time`, 6 cases. `["20240229"]` → dayjs: `2024-2-29`; java.time: `refused`; native: `2024-2-29`; polyfill: `2024-2-29`

### same-day

- `dayjs \| java.time=native=polyfill`, 83 cases. `["2026-04-05T00:45:00","Pacific/Chatham","2026-04-04T15:30:00","Asia/Kabul"]` → dayjs: `other day`; java.time: `same day`; native: `same day`; polyfill: `same day`

### same-day:old

- `dayjs \| java.time=native=polyfill`, 54 cases. `["1987-05-09T23:00:00","Asia/Seoul","1987-05-09T09:00:00","America/Lima"]` → dayjs: `other day`; java.time: `same day`; native: `same day`; polyfill: `same day`

### start-of-zoned

- `dayjs \| java.time=native=polyfill`, 339 cases. `["2023-04-29T06:00:00","Asia/Gaza","day"]` → dayjs: `2023-4-29T0:0:0.0 1682715600000`; java.time: `2023-4-29T0:0:0.0 1682719200000`; native: `2023-4-29T0:0:0.0 1682719200000`; polyfill: `2023-4-29T0:0:0.0 1682719200000`

### start-of-zoned:old

- `dayjs \| java.time=native=polyfill`, 1136 cases. `["1912-01-01T03:00:00","Asia/Dili","day"]` → dayjs: `1912-1-1T0:0:0.0 -1830412800000`; java.time: `1912-1-1T0:0:0.0 -1830414140000`; native: `1912-1-1T0:0:0.0 -1830414140000`; polyfill: `1912-1-1T0:0:0.0 -1830414140000`
- `dayjs=java.time \| native=polyfill`, 1 cases. `["1992-05-02T04:00:00","America/Bogota","day"]` → dayjs: `1992-5-2T0:0:0.0 704782800000`; java.time: `1992-5-2T0:0:0.0 704782800000`; native: `1992-5-2T1:0:0.0 704782800000`; polyfill: `1992-5-2T1:0:0.0 704782800000`
- `dayjs=polyfill \| java.time=native`, 1 cases. `["1976-04-14T04:00:00","Africa/El_Aaiun","day"]` → dayjs: `1976-4-14T0:0:0.0 198291600000`; java.time: `1976-4-14T1:0:0.0 198291600000`; native: `1976-4-14T1:0:0.0 198291600000`; polyfill: `1976-4-14T0:0:0.0 198291600000`

### two-digit-year

- `dayjs \| java.time`, 69 cases. `["02/01/69"]` → dayjs: `1969-1-2`; java.time: `2069-1-2`

### validate-permissive

- `dayjs \| java.time=native=polyfill`, 483 cases. `["1999-00-00"]` → dayjs: `1998-11-30`; java.time: `refused`; native: `refused`; polyfill: `refused`

### zone-to-date

- `dayjs \| java.time=native=polyfill`, 1 cases. `["2023-03-09T00:00:00","Antarctica/Casey"]` → dayjs: `1678291200000`; java.time: `1678280400000`; native: `1678280400000`; polyfill: `1678280400000`

### zone-to-date:old

- `dayjs \| java.time=native=polyfill`, 18 cases. `["1867-10-19T09:44:35","America/Adak"]` → dayjs: `-3225148127000`; java.time: `-3225234527000`; native: `-3225234527000`; polyfill: `-3225234527000`

### zone-to-date@new-york

- `dayjs \| java.time=native=polyfill`, 1 cases. `["2023-03-09T00:00:00","Antarctica/Casey"]` → dayjs: `1678291200000`; java.time: `1678280400000`; native: `1678280400000`; polyfill: `1678280400000`

### zone-to-date@new-york:old

- `dayjs \| java.time=native=polyfill`, 18 cases. `["1867-10-19T09:44:35","America/Adak"]` → dayjs: `-3225148127000`; java.time: `-3225234527000`; native: `-3225234527000`; polyfill: `-3225234527000`

### zone-to-date@paris

- `dayjs \| java.time=native=polyfill`, 1 cases. `["2023-03-09T00:00:00","Antarctica/Casey"]` → dayjs: `1678291200000`; java.time: `1678280400000`; native: `1678280400000`; polyfill: `1678280400000`

### zone-to-date@paris:old

- `dayjs \| java.time=native=polyfill`, 18 cases. `["1867-10-19T09:44:35","America/Adak"]` → dayjs: `-3225148127000`; java.time: `-3225234527000`; native: `-3225234527000`; polyfill: `-3225234527000`

### zone-to-utc

- `dayjs \| java.time=native=polyfill`, 1 cases. `["2023-03-09T00:00:00","Antarctica/Casey"]` → dayjs: `2023-3-8T16:0:0.0 1678291200000`; java.time: `2023-3-8T13:0:0.0 1678280400000`; native: `2023-3-8T13:0:0.0 1678280400000`; polyfill: `2023-3-8T13:0:0.0 1678280400000`

### zone-to-utc:old

- `dayjs \| java.time=native=polyfill`, 18 cases. `["1867-10-19T09:44:35","America/Adak"]` → dayjs: `1867-10-19T21:31:13.0 -3225148127000`; java.time: `1867-10-18T21:31:13.0 -3225234527000`; native: `1867-10-18T21:31:13.0 -3225234527000`; polyfill: `1867-10-18T21:31:13.0 -3225234527000`

### zone-to-zone

- `dayjs \| java.time=native=polyfill`, 1 cases. `["2023-03-09T00:00:00","Antarctica/Casey","America/Goose_Bay"]` → dayjs: `2023-3-8T12:0:0.0 1678291200000`; java.time: `2023-3-8T9:0:0.0 1678280400000`; native: `2023-3-8T9:0:0.0 1678280400000`; polyfill: `2023-3-8T9:0:0.0 1678280400000`

### zone-to-zone:old

- `dayjs \| java.time=native=polyfill`, 30 cases. `["1900-09-30T21:00:00","Asia/Gaza","Africa/Bangui"]` → dayjs: `1900-9-30T18:55:43.0 -2185468757000`; java.time: `1900-9-30T18:55:43.0 -2185420672000`; native: `1900-9-30T18:55:43.0 -2185420672000`; polyfill: `1900-9-30T18:55:43.0 -2185420672000`

### zoned-add-days

- `dayjs \| java.time=native=polyfill`, 1068 cases. `["2023-04-28T02:30:00","Asia/Gaza",1]` → dayjs: `2023-4-29T2:30:0.0 1682728200000`; java.time: `2023-4-29T3:30:0.0 1682728200000`; native: `2023-4-29T3:30:0.0 1682728200000`; polyfill: `2023-4-29T3:30:0.0 1682728200000`
- `dayjs=java.time \| native=polyfill`, 531 cases. `["2023-10-29T01:30:00","Asia/Gaza",-1]` → dayjs: `2023-10-28T1:30:0.0 1698449400000`; java.time: `2023-10-28T1:30:0.0 1698449400000`; native: `2023-10-28T1:30:0.0 1698445800000`; polyfill: `2023-10-28T1:30:0.0 1698445800000`

### zoned-add-days:old

- `dayjs \| java.time=native=polyfill`, 935 cases. `["1919-11-13T00:03:15","Asia/Omsk",1]` → dayjs: `1919-11-14T0:3:15.0 -1582087815000`; java.time: `1919-11-14T0:9:45.0 -1582087815000`; native: `1919-11-14T0:9:45.0 -1582087815000`; polyfill: `1919-11-14T0:9:45.0 -1582087815000`
- `dayjs=java.time \| native=polyfill`, 230 cases. `["1900-10-01T23:51:04","Asia/Gaza",-1]` → dayjs: `1900-9-30T23:51:4.0 -2185409336000`; java.time: `1900-9-30T23:51:4.0 -2185409336000`; native: `1900-9-30T23:51:4.0 -2185410408000`; polyfill: `1900-9-30T23:51:4.0 -2185410408000`
- `dayjs \| java.time \| native=polyfill`, 4 cases. `["1881-05-12T23:44:18","Africa/Tunis",-1]` → dayjs: `1881-5-12T8:55:57.0 -2797201503000`; java.time: `1881-5-11T23:44:18.0 -2797201503000`; native: `1881-5-11T23:44:18.0 -2797203386000`; polyfill: `1881-5-11T23:44:18.0 -2797203386000`
- `dayjs \| java.time=native \| polyfill`, 1 cases. `["1976-04-15T00:30:00","Africa/El_Aaiun",-1]` → dayjs: `1976-4-14T0:30:0.0 198289800000`; java.time: `1976-4-14T1:30:0.0 198293400000`; native: `1976-4-14T1:30:0.0 198293400000`; polyfill: `1976-4-14T0:30:0.0 198293400000`
- `dayjs=polyfill \| java.time=native`, 1 cases. `["1976-04-13T00:30:00","Africa/El_Aaiun",1]` → dayjs: `1976-4-14T0:30:0.0 198293400000`; java.time: `1976-4-14T1:30:0.0 198293400000`; native: `1976-4-14T1:30:0.0 198293400000`; polyfill: `1976-4-14T0:30:0.0 198293400000`

### zoned-add-hours

- `dayjs \| java.time=native=polyfill`, 4262 cases. `["2023-04-28T23:00:00","Asia/Gaza",3]` → dayjs: `2023-4-29T2:0:0.0 1682726400000`; java.time: `2023-4-29T3:0:0.0 1682726400000`; native: `2023-4-29T3:0:0.0 1682726400000`; polyfill: `2023-4-29T3:0:0.0 1682726400000`

### zoned-add-hours:old

- `dayjs \| java.time=native=polyfill`, 2850 cases. `["1900-09-30T21:00:00","Asia/Gaza",3]` → dayjs: `1900-10-1T0:0:0.0 -2185409872000`; java.time: `1900-9-30T23:42:8.0 -2185409872000`; native: `1900-9-30T23:42:8.0 -2185409872000`; polyfill: `1900-9-30T23:42:8.0 -2185409872000`
- `dayjs=java.time \| native=polyfill`, 4 cases. `["1992-05-01T21:00:00","America/Bogota",3]` → dayjs: `1992-5-2T0:0:0.0 704782800000`; java.time: `1992-5-2T0:0:0.0 704782800000`; native: `1992-5-2T1:0:0.0 704782800000`; polyfill: `1992-5-2T1:0:0.0 704782800000`
- `dayjs=polyfill \| java.time=native`, 4 cases. `["1976-04-13T21:00:00","Africa/El_Aaiun",3]` → dayjs: `1976-4-14T0:0:0.0 198291600000`; java.time: `1976-4-14T1:0:0.0 198291600000`; native: `1976-4-14T1:0:0.0 198291600000`; polyfill: `1976-4-14T0:0:0.0 198291600000`

### zoned-add-months

- `dayjs \| java.time=native=polyfill`, 360 cases. `["2023-03-29T02:30:00","Asia/Gaza",1]` → dayjs: `2023-4-29T2:30:0.0 1682728200000`; java.time: `2023-4-29T3:30:0.0 1682728200000`; native: `2023-4-29T3:30:0.0 1682728200000`; polyfill: `2023-4-29T3:30:0.0 1682728200000`

### zoned-add-months:old

- `dayjs \| java.time=native=polyfill`, 626 cases. `["1900-08-30T23:51:04","Asia/Gaza",1]` → dayjs: `1900-9-1T23:51:4.0 -2187916008000`; java.time: `1900-9-30T23:51:4.0 -2185410408000`; native: `1900-9-30T23:51:4.0 -2185410408000`; polyfill: `1900-9-30T23:51:4.0 -2185410408000`
- `dayjs=java.time \| native=polyfill`, 1 cases. `["1992-04-02T00:30:00","America/Bogota",1]` → dayjs: `1992-5-2T0:30:0.0 704784600000`; java.time: `1992-5-2T0:30:0.0 704784600000`; native: `1992-5-2T1:30:0.0 704784600000`; polyfill: `1992-5-2T1:30:0.0 704784600000`
- `dayjs=polyfill \| java.time=native`, 1 cases. `["1976-03-14T00:30:00","Africa/El_Aaiun",1]` → dayjs: `1976-4-14T0:30:0.0 198293400000`; java.time: `1976-4-14T1:30:0.0 198293400000`; native: `1976-4-14T1:30:0.0 198293400000`; polyfill: `1976-4-14T0:30:0.0 198293400000`

### zoned-diff-days:old

- `dayjs \| java.time=native=polyfill`, 4 cases. `["1953-01-02T19:00:00","1952-12-29T21:00:00","America/Inuvik"]` → dayjs: `4`; java.time: `3`; native: `3`; polyfill: `3`

### zoned-diff-hours

- `dayjs \| java.time=native=polyfill`, 2 cases. `["2010-09-26T04:00:00","2010-09-25T21:00:00","Pacific/Apia"]` → dayjs: `7`; java.time: `6`; native: `6`; polyfill: `6`

### zoned-diff-hours:old

- `dayjs \| java.time=native=polyfill`, 4 cases. `["1965-01-01T00:00:00","1964-12-31T21:00:00","Antarctica/Palmer"]` → dayjs: `3`; java.time: `6`; native: `6`; polyfill: `6`
- `dayjs=java.time=native \| polyfill`, 1 cases. `["1976-04-14T04:00:00","1976-04-13T21:00:00","Africa/El_Aaiun"]` → dayjs: `6`; java.time: `6`; native: `6`; polyfill: `7`
- `dayjs=native=polyfill \| java.time`, 1 cases. `["1992-05-02T04:00:00","1992-05-01T21:00:00","America/Bogota"]` → dayjs: `6`; java.time: `7`; native: `6`; polyfill: `6`
