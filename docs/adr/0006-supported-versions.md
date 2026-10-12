# ADR 0006 — Supported TypeScript, Angular and Node versions

- Date: 2026-10-12
- Status: proposed — recommendation, awaiting the owner

## Context

The packages ship JavaScript and type declarations. Users compile against the declarations with their own TypeScript version, run the JavaScript on their own Node version, and use the Angular adapter with their own Angular version. Each range promised is a range tested; each range dropped is a breaking change.

Facts checked on 2026-10-12:

- TypeScript 7.0.2 (native compiler) is the current release; 6.0.3 is the last JavaScript-based one, maintained as `@typescript/typescript6`. TypeScript 7.0 does not yet support the editor tooling of embedded languages, Angular templates included: Angular projects stay on 6.0 for now.
- Angular 22 (2026-06-03) is the current major; from 22 on, one major a year, each supported 24 months (12 active, 12 LTS). Angular 21 is in LTS until 2027-06, Angular 20 until 2026-11-28. Signal Forms is stable in 22 (`form()` and `validateStandardSchema()` are public API since 22.0) and accepts any Standard Schema validator.
- Node: see ADR 0004 (22, 24 and 26 are the supported LTS lines from 2026-10-28).

## Options

1. **Do nothing: support "the latest".** Untestable as a promise, and Angular users on TypeScript 6.0 would be left out.
2. **TypeScript 6.0 and 7.x; Angular from 22 for the Signal Forms bridge, then every active and LTS Angular major; Node from 22, following ADR 0004.** Covers the users the vertical slice targets, with a test matrix of reasonable size.
3. **TypeScript 7 only.** Simpler type tests, but excludes every Angular project until Angular's tooling moves to 7.
4. **Angular from 21 with Reactive Typed Forms.** Reaches LTS users, but Signal Forms, the bridge the vertical slice is built on, is not stable there.

## Measurements

Not measured: version facts from the npm registry (dist-tags, publication dates), the TypeScript 7.0 announcement, angular.dev's release page and the `@angular/forms` 22.2.2 type declarations, read on 2026-10-12.

## Decision

Recommended: option 2.

- Type declarations are tested under TypeScript 6.0 and 7.x, with and without `exactOptionalPropertyTypes`.
- `@pienjs/angular` requires Angular 22 or later and targets Signal Forms; an interop with Reactive Typed Forms is added only if a pilot project needs it.
- Node: every LTS line not past its end of life at the date of a release (ADR 0004).
- Dropping a TypeScript, Angular or Node line is a major release, announced in the changelog.

## Consequences

- The type-cost harness and the type tests run twice (TypeScript 6.0 and 7.x): `@typescript/typescript6` becomes a development dependency when those harnesses are built, justified by their record.
- Types avoid features that TypeScript 6.0 lacks.

## Review condition

Angular's tooling moving to TypeScript 7 (TypeScript 6.0 may then be dropped in the next major); an Angular LTS user population with a real need for Reactive Forms.
