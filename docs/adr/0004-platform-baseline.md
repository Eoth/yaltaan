# ADR 0004 — Platform baseline

- Date: 2026-10-12
- Status: proposed — recommendation, awaiting the owner

## Context

The library ships only what the platform lacks. That rule needs a precise definition of "the platform": which browsers, which server runtimes, at which date. Without it, a function is either duplicated needlessly (the platform has it) or relies on an API that part of the users lack.

Baseline, as defined by the W3C WebDX group's `web-features` project, is the common definition: a feature is **Newly available** when every current stable release of the core browsers (Chrome, Edge and Firefox, desktop and Android; Safari, macOS and iOS) supports it, and **Widely available** 30 months after that date. Node, Deno and Bun are not part of Baseline.

## Options

1. **Do nothing: target "modern browsers and Node".** Undefined; each contributor decides alone, and nothing can be checked.
2. **Baseline Widely available at the date of each major release; every Node LTS line that has not reached its end of life at that date; current Deno and Bun.** Checkable from data (`web-features`), stable for the 30-month window users expect, and the same rule for every API.
3. **Baseline Newly available.** Earlier access to recent APIs (iterator helpers, `RegExp.escape`), at the price of breaking users whose browsers are up to 30 months old.
4. **A fixed list of browser versions (browserslist query).** Precise, but a second list kept by hand, which drifts from the facts it encodes.

## Measurements

`web-features` 3.42.0 (2026-10-09) and `@mdn/browser-compat-data` 8.1.5 (2026-10-08), queried on 2026-10-12, cross-checked against TC39, WebKit, Node, Deno and Bun sources:

| API | Baseline on 2026-10-12 | Node 22 | Node 24 |
|---|---|---|---|
| `Object.groupBy`, `Map.groupBy` | Widely (2026-09-05) | yes | yes |
| `toSorted`, `toReversed`, `toSpliced`, `with` | Widely (2026-01-04) | yes | yes |
| `findLast`, `findLastIndex` | Widely (2025-02-23) | yes | yes |
| Set methods (`union`, `intersection`, …) | Newly, Widely on 2026-12-11 | yes | yes |
| Iterator helpers (`map`, `filter`, `take`, `Iterator.from`, …) | Newly, Widely on 2027-09-30 | yes | yes |
| `Iterator.concat` | Newly, Widely on 2028-09-24 | no | no |
| `structuredClone` | Widely (2024-09-14) | yes | yes |
| `Intl.Segmenter` | Newly, Widely on 2026-10-16 | yes | yes |
| `isWellFormed`, `toWellFormed` | Widely (2026-04-24) | yes | yes |
| `RegExp.escape` | Newly, Widely on 2027-11-01 | no | yes |
| `AbortSignal.timeout` | Newly, Widely on 2026-10-18 | yes | yes |
| `AbortSignal.any` | Widely (2026-09-19) | yes | yes |
| `Promise.withResolvers` | Widely (2026-09-05) | yes | yes |
| `Promise.try` | Newly, Widely on 2027-07-07 | no | yes |
| `Math.sumPrecise` | Newly, Widely on 2028-10-10 | no | no (not in Node 26 either) |
| `Uint8Array.fromBase64`, `toBase64`, hex | Newly, Widely on 2028-03-05 | no | no |
| `Intl.DurationFormat` | Newly, Widely on 2027-09-04 | no | yes |
| `Array.fromAsync` | Widely (2026-07-25) | yes | yes |
| `Error.isError` | Limited (Safari returns false for `DOMException`) | no | 24.3 and later |
| Temporal | Limited: not in stable Safari or iOS | no | no |

Node lines on 2026-10-12: 22 in maintenance until 2027-04-30; 24 in active LTS, maintenance from 2026-10-20, end of life 2028-04-30; 26 current, LTS from 2026-10-28, end of life 2029-04-30. From Node 27, one major release a year, each becoming LTS.

## Decision

Recommended: option 2.

- An API is used inside the library only if it is in the baseline of the release being prepared; it is never polyfilled implicitly. When a missing API is truly needed, a ponyfill is isolated in `@pienjs/core/compat/*` and never imported by another function of the library.
- The documentation's native-to-library table states each API's status, so users know what they can rely on.
- When an API becomes Widely available, the library function it replaces is deprecated, then removed in the next major release.
- Temporal is the one exception, treated as a platform peer (ADR 0005).
- The table becomes a data file checked against `web-features` by the gate, as a development dependency justified by its own record.

## Consequences

- Lazy iteration helpers (`chunk`, `window`, `zip`) are written as generators that do not depend on iterator helpers until those are Widely available (2027-09-30).
- Set methods may be used inside the library for a major release dated on or after 2026-12-11.
- `Math.sumPrecise`, which no Node release has yet, cannot back the statistics functions before 2028; until then they need an exact summation of their own or wait.
- The minimum Node version of a release is the oldest LTS line still supported at its date (22 today); dropping a line is a major release.

## Review condition

Every major release (the dates move by themselves); a change of the Baseline definition by the WebDX group; a user population that measurably needs a wider target.
