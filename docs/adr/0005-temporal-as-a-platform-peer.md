# ADR 0005 — Temporal as a platform peer, and the polyfill to recommend

- Date: 2026-10-12
- Status: proposed — recommendation, awaiting the owner

## Context

`@yaltaan/temporal` adds what Temporal lacks (intervals, declared-format parsing, boundary conversions, business days) and nothing Temporal does (time zones, daylight saving, calendars, formatting). It therefore needs Temporal itself.

Facts checked on 2026-10-12: Temporal reached Stage 4 at the March 2026 TC39 plenary and belongs to ECMAScript 2027 (not 2026). Chrome and Edge 144+, Firefox 139+, Node 26, Deno 2.7 and Bun 1.4 ship it; stable Safari and iOS do not (Technology Preview only, release not announced), nor do Node 22 and 24. `web-features` marks it Limited. Under ADR 0004 it is outside the baseline for years.

## Options

1. **Do nothing: wait for Temporal to be Widely available.** At best 30 months after the last Safari release that ships it: `@yaltaan/temporal` would not exist before 2029.
2. **Embed a polyfill.** Every user pays its weight (about 19 kB minified and compressed for the lighter one), including users whose platform already has Temporal; two copies end up in an application that installs its own polyfill.
3. **Treat Temporal as a platform peer.** The library reads `globalThis.Temporal` when a function is called (never when a module loads), and fails with an explicit error naming the recommended polyfill when it is absent. The application installs the polyfill where its platforms need it.

Which polyfill to recommend:

1. **`temporal-polyfill`** 1.0.5 (2026-09-11), MIT, by the FullCalendar authors: 19.3 kB minified + brotli for the main entry (ISO and Gregorian calendars; 21.0 kB with all calendars), follows the September 2026 specification, tested on Node 16 to 26, about 4.8 million weekly downloads.
2. **`@js-temporal/polyfill`** 0.5.1 (2025-03-31), ISC, by the proposal's champions: 38.9 kB minified + brotli (including `jsbi`), no release since March 2025 although its repository is active, about 4.3 million weekly downloads.

## Measurements

Sizes measured on jsDelivr's minified ESM builds with their dependency chunks, compressed with brotli quality 11 (and checked against bundlephobia's minified and gzip figures: 58.9 kB / 19.9 kB and 157.8 kB / 45.2 kB). Release dates and versions from the npm registry. Platform support from `@mdn/browser-compat-data` 8.1.5 and the WebKit, Node, Deno and Bun release notes.

## Decision

Recommended: option 3, and `temporal-polyfill` as the polyfill named in errors and documentation. `@yaltaan/temporal` declares no dependency on either polyfill; its tests run against the native implementation (Node 26, Chromium, Firefox) and against `temporal-polyfill`, and against `@js-temporal/polyfill` as long as it remains widely installed.

## Consequences

- An application on Safari, iOS or Node 22/24 installs `temporal-polyfill` itself, once, for all its code.
- Importing `@yaltaan/temporal` never fails on a platform without Temporal; only calling one of its functions does, with an error that says what to install.
- The library's tests depend on the polyfills as development dependencies, each justified by its own record when the Temporal package is started.

## Review condition

Temporal shipping in stable Safari and iOS (re-examine the error message and the documentation); `temporal-polyfill` falling behind the specification or ceasing maintenance; `@js-temporal/polyfill` publishing a maintained release.
