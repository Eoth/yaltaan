# Issue codes of `@yaltaan/temporal`

Every code that `@yaltaan/temporal` can put in an `Issue`. A code is part of the package's public contract: an application matches on it to choose its message, so a code never changes its meaning and is never reused. No issue holds the text it refused.

A row is never deleted: a removed code keeps its row, with the version that removed it in `Removed`.

| Code | Parameters | Meaning | Since | Removed |
|---|---|---|---|---|
| `temporal.inverted_interval` | `start`, `end` | The start of an interval comes after its end. | 0.3 | |
| `temporal.too_large` | `maximum` | More intervals, holidays or days than `maximum`, or a number of days that is not an integer. | 0.3 | |
| `temporal.ambiguous_format` | | No format says how to read this text, or `yy` has no `pivotYear`. | 0.3 | |
| `temporal.invalid_format` | | The format cannot be read: an unknown letter, a token used twice, a missing field. | 0.3 | |
| `temporal.format_mismatch` | `at` | The text does not follow the format from this code unit. | 0.3 | |
| `temporal.too_long` | `maximum` | The text has more than `maximum` code units. | 0.3 | |
| `temporal.invalid_date` | | No such date or time, or an invalid `Date`. | 0.3 | |
| `temporal.invalid_time_zone` | | Temporal does not know this time zone. | 0.3 | |
| `temporal.invalid_calendar` | | Temporal does not know this calendar. | 0.3 | |
| `temporal.nonexistent_time` | | This wall clock does not exist in this zone: the clock jumps over it. | 0.3 | |
| `temporal.ambiguous_time` | | This wall clock exists twice in this zone: the clock goes back over it. | 0.3 | |
| `temporal.out_of_range` | | The result would fall outside the range of Temporal. | 0.3 | |
| `temporal.no_business_day` | | Every day of the week is in the weekend. | 0.3 | |
