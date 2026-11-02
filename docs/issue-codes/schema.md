# Issue codes of `@yaltaan/schema`

Every code that `@yaltaan/schema` can put in an `Issue`. A code is part of the package's public contract: an application matches on it to choose a message, so a code is never renamed, and it is removed only in a major version (from 1.0 on). Read [ADR 0019](../adr/0019-issue-and-code-registry.md) for the rules the verification gate applies to this table.

A row is never deleted: a removed code keeps its row, with the version that removed it in `Removed`.

| Code | Parameters | Meaning | Since | Removed |
|---|---|---|---|---|
| `schema.invalid_type` | `expected` | The value is not what `expected` names: a `string`, a finite `number`, an `array` or a plain `object`. | 0.2 | |
| `schema.invalid_value` | `expected` | The value is none of the literals `expected` lists. | 0.2 | |
| `schema.missing` | | The object has no own key here, and the schema of the key is not optional. | 0.2 | |
| `schema.unknown_key` | | The object has this key, which its schema does not declare, under `unknownKeys: 'reject'`. | 0.2 | |
| `schema.too_short` | `length`, `minimum` | The text has `length` UTF-16 code units, under `minimum`. | 0.2 | |
| `schema.too_long` | `length`, `maximum` | The text has `length` UTF-16 code units, over `maximum`. | 0.2 | |
| `schema.too_small` | `minimum` | The number, or the number of elements of the array, is under `minimum`. | 0.2 | |
| `schema.too_large` | `maximum` | The number, or the number of elements of the array, is over `maximum`. | 0.2 | |
| `schema.not_integer` | | A whole number was required, and this one has a fraction. | 0.2 | |
| `schema.invalid_format` | `pattern` | The text does not match the regular expression whose source is `pattern`. | 0.2 | |
| `schema.too_many_issues` | `maximum` | The read stopped after `maximum` issues; this one comes last, at the root. | 0.2 | |
