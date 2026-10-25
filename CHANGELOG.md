# Changelog

All notable changes to the Yaltaan packages are documented in this file. The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and the packages follow [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html): an API marked `@stable` changes incompatibly only in a major version; an API marked `@experimental` may change in a minor version, and such a change is marked **Breaking**.

No entry predates the first published version; user-visible changes only.

## [Unreleased]

### Added

- `@yaltaan/core/result`: the `Result<T, E>` type, a read-only object discriminated by `ok`, and the free functions `ok`, `err`, `mapResult` and `unwrapOr` (`@experimental`).
- `@yaltaan/core/path`: the `Path` and `PathSegment` types, with the `{ key }` segment; `parsePath` and `formatPath` for the text form, bounded in length and depth; `checkWritablePath`, which refuses `__proto__`, `constructor` and `prototype` before a write; issues `path.syntax`, `path.too_long`, `path.too_deep`, `path.not_textual` and `path.forbidden_segment` (`@experimental`).
- `@yaltaan/core/issue`: the `Issue` type, one shape for every expected failure (stable code, `Path`, parameters, severity, cause), and `IssueFormatter`; `toStandardIssue`, which builds the Standard Schema issue with the application's formatter and resolves `{ key }` segments to indexes; `fromStandardIssue`, which reads the issue of another Standard Schema validator as `issue.external` (`@experimental`).
- Registry of the issue codes of `@yaltaan/core`, and an English formatter to copy.
