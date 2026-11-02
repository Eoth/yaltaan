# Issue codes of `@yaltaan/rules`

Every code that `@yaltaan/rules` can put in an `Issue`. A code is part of the package's public contract: an application matches on it to choose a message, so a code is never renamed, and it is removed only in a major version (from 1.0 on). Read [ADR 0019](../adr/0019-issue-and-code-registry.md) for the rules the verification gate applies to this table.

A row is never deleted: a removed code keeps its row, with the version that removed it in `Removed`.

| Code | Parameters | Meaning | Since | Removed |
|---|---|---|---|---|
| `rules.required_if` | | The condition of the rule holds, and this field is blank. | 0.2 | |
| `rules.all_or_none` | | Another field of the group is filled, and this one is blank. | 0.2 | |
| `rules.at_least` | `minimum`, `count` | `count` fields or elements count, under `minimum`: on each blank field, or on the list. | 0.2 | |
| `rules.exactly` | `expected`, `count` | `count` fields or elements count, not `expected`: on each blank field under it, each filled one over it, or on the list. | 0.2 | |
| `rules.mutually_exclusive` | | Another field of the group is filled, and so is this one. | 0.2 | |
| `rules.unique` | | Another element of the list has the same key. | 0.2 | |
| `rules.ordered` | | This value comes before the value it must follow, or cannot be compared with it. | 0.2 | |
| `rules.too_large` | `maximum` | The list has more than `maximum` elements; none of them was read. | 0.2 | |
| `rules.too_many_issues` | `maximum` | The check stopped after `maximum` errors; this one comes last, at the root. | 0.2 | |
