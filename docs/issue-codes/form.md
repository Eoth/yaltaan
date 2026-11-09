# Issue codes of `@yaltaan/form`

Every code that `@yaltaan/form` can put in an `Issue` of its own. The issues a schema gives keep their codes: those of `@yaltaan/schema`, or `issue.external` for another engine's ([`@yaltaan/core`](core.md)). A code is part of the package's public contract: an application matches on it to choose a message, so a code is never renamed, and it is removed only in a major version (from 1.0 on). Read [ADR 0019](../adr/0019-issue-and-code-registry.md) for the rules the verification gate applies to this table.

A row is never deleted: a removed code keeps its row, with the version that removed it in `Removed`.

| Code | Parameters | Meaning | Since | Removed |
|---|---|---|---|---|
| `form.validation_failed` | | A schema gave nothing to show for the raw value of this node: its promise rejected, the reason in `cause`, or it failed without an issue. | 0.3 | |
