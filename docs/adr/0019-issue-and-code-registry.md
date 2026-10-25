# ADR 0019 — `Issue`, its code registry, and the Standard Schema boundary

- Date: 2026-10-25
- Status: accepted

## Context

ARCHITECTURE.md §5.2 fixes the shape of `Issue` (`code`, `path`, `params`, `severity`, `cause`), says that the core produces no message, that codes are a SemVer contract listed in a registry per package, and that a conversion to the Standard Schema issue (`message` and `path`) exists at the boundary. Four questions are left open, and every later package (schema, rules, form, the adapters) builds on their answers:

1. Where the registry lives, and how the gate proves that a code is never removed or renamed in a minor version.
2. What becomes of a `{ key }` segment, which designates an array element by identity, in a Standard Schema path, where `{ key }` only wraps a property name (Standard Schema v1, `PathSegment { readonly key: PropertyKey }`).
3. Which code an issue gets when it comes from another Standard Schema validator (zod, valibot, arktype), whose issues carry a message and no code.
4. What the English formatter is: shipped code, or a recipe.

## Options

### Registry

1. **Nothing: codes documented in the JSDoc of each issue type.** No file to keep, but nothing proves that a code still exists, and nothing fails when one disappears.
2. **A registry generated from the declarations.** One source, but a code removed from the code also leaves the registry: the very change to catch passes.
3. **A hand-written registry per package, checked both ways against the published declarations and against every committed version of itself.** Rows are never deleted: a removed code keeps its row, with the version that removed it.

### `{ key }` segments in a Standard Schema path

1. **Pass the segment through.** A consumer (Angular Signal Forms, TanStack Form, react-hook-form) reads `{ key: 'a7' }` as the property `a7`: the error lands on a field that does not exist, silently.
2. **Refuse the conversion (a `Result` or an exception).** Correct, but every boundary must then handle a failure for an issue that is otherwise perfectly displayable.
3. **Resolve the segment to the element's current index through a callback the caller gives (`resolveKey`), and cut the path before any segment that cannot be resolved.** The issue then sits on the array that holds the element, where it stays visible, instead of on a field that does not exist.

### Issues from another validator

1. **A code per foreign vendor code.** Each vendor has its own codes, often none in the Standard Schema form: unbounded and unverifiable.
2. **One code, `issue.external`, its message in `params.message`, the foreign issue in `cause`.** An application formats it by returning that message, or reads `cause` for more.

### English formatter

1. **Shipped in `core`.** Bytes in every bundle that imports it, and a natural-language message in the core, against §5.2.
2. **A recipe in the repository, copied by the application, kept complete by a test.**

## Measurements

- Standard Schema v1 issue types, as valibot 1.5.0 copies them (`node_modules/valibot/dist/index.d.mts`): `message: string`, `path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined`.
- Cost of the registry check: one `git log` and one `git show` per committed version of each registry; not measurable against the 0.3 s of the dependency graph step today (two versions).
- Size of the conversions: see the `yaltaan/core-issue` scenario of `bench/size/` and its commit.

## Decision

- **Registry: option 3.** `docs/issue-codes/<package>.md`, one table per package (code, parameters, meaning, since, removed). `scripts/check-issue-codes.ts` fails the gate when a code of the published declarations has no live row, when a live row names a code the declarations no longer hold, when a code of any committed version of a registry is missing from it, when its `Since` changed, or when a `Removed` version breaks SemVer (from 1.0 on, a removal is a major version). Codes are `<namespace>.<name>`, lowercase, and belong to one registry only. The tests of a module compare the codes they see at run time with the registry: a second reading, independent of the declarations.
- **`{ key }` segments: option 3.** `toStandardIssue(issue, { format, resolveKey })`; `resolveKey(segment, parent)` returns the index of the element, or `-1` or `undefined` when the element is gone (the result of `findIndex` as it is). Without `resolveKey`, every `{ key }` segment cuts the path. A Standard Schema `{ key }` read by `fromStandardIssue` is a property name and is unwrapped: it never becomes an identity.
- **Foreign issues: option 2**, code `issue.external`.
- **English formatter: option 2**, `examples/recipes/format-issue-en.ts`; its test fails when a code of a registry has no message.

## Consequences

- Removing or renaming a code means keeping its row with a `Removed` version: the registry records every code ever written, unreleased ones included. That is the price of a check that needs no release tag and gives the same verdict locally and in CI (full history, `fetch-depth: 0`); in a shallow clone, fewer versions are read, and the step says how many.
- An application that shows errors through a Standard Schema consumer and uses `{ key }` segments passes a `resolveKey` that reads its current data; one that never uses them passes nothing.
- The parameters of a code are documented in the registry but not compared with the declarations.

## Review condition

A consumer of Standard Schema that reads `{ key }` as an identity; a code that needs to be removed in a minor version after 1.0; a registry whose history makes the step measurably slower (over 0.5 s).
