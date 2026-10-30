# Issue codes of `@yaltaan/core`

Every code that `@yaltaan/core` can put in an `Issue`. A code is part of the package's public contract: an application matches on it to choose a message, so a code is never renamed, and it is removed only in a major version (from 1.0 on). Read [ADR 0019](../adr/0019-issue-and-code-registry.md) for the rules the verification gate applies to this table.

A row is never deleted: a removed code keeps its row, with the version that removed it in `Removed`.

| Code | Parameters | Meaning | Since | Removed |
|---|---|---|---|---|
| `path.syntax` | `index` | The text of a path breaks the grammar at code unit `index`. | 0.1 | |
| `path.too_long` | `length`, `maximum` | The text of a path is `length` code units long, over `maximum`. | 0.1 | |
| `path.too_deep` | `maximum` | The text of a path holds more than `maximum` segments. | 0.1 | |
| `path.not_textual` | `index` | The segment at `index` has no text form: a symbol, a `{ key }` segment, a number that is no index. | 0.1 | |
| `path.forbidden_segment` | `index`, `segment` | The segment at `index` is `__proto__`, `constructor` or `prototype`, refused for a write. | 0.1 | |
| `path.missing` | `index` | The value holds nothing at the segment at `index` of the path: a field absent, an index at or past the end or on a hole, no element with that key. | 0.1 | |
| `path.not_traversable` | `index` | The value at the segment at `index` cannot be walked by it: a primitive, a `Map`, a class instance, a number on a record, a string on an array. | 0.1 | |
| `issue.external` | `message` | An issue read from another Standard Schema validator; `message` is its message, `cause` the foreign issue. | 0.1 | |
| `collection.duplicate_key` | `first` | Two elements of a collection have the same key: the issue's path gives the position of the second, `first` that of the first. | 0.1 | |
