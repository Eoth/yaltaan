# ADR 0013 — Shared adversarial catalogue on fast-check

- Date: 2026-10-19
- Status: accepted

## Context

ARCHITECTURE.md §10.1 promises one adversarial catalogue, shared by every domain as generators named `adversarial.*`, in six categories (boundary values, structures, hostile objects, Unicode, callbacks, async), and a gate that checks that each public export declares the categories that concern it, or "N/A" with a reason, and that the matching tests run. §10.2 (properties) and §10.3 (race tests explored with `fc.scheduler()`) already name fast-check, but no record has measured it, and a development dependency that enters the verification gate needs one.

Three questions follow:

- **Which generator library**, if any.
- **Where the catalogue lives** and how the existing checks treat it. Four facts constrain the answer. The manifest check refuses any third-party dependency in a workspace package ("a package has zero third-party runtime dependency"). `@yaltaan/core` is itself `"private": true` at version `0.0.0` until the release workflow, so `private` cannot tell a never-published package from a not-yet-published one. The dependency graph check fails on a package absent from the graph of §6. The contract tag check and the package contents check read every workspace package.
- **Where an export's declaration lives, and what the gate asks of it.** The definition of done asks every export to carry its declaration, while §10.5 lists "adversarial catalogue declared and tested" as required for `@stable` only.

## Options

1. **Native, or do nothing beyond `node:test`.** Each named case written by hand in a shared table, run by `node --test`; random cases from a seeded generator of our own. The named cases of the ticket need nothing more. What it lacks is what §10.2 and §10.3 rely on: shrinking (a failing random input reduced to a minimal one), combinators to build inputs of a domain from smaller ones, replay from a seed and a path, and the scheduler that explores the interleavings of promises. Writing those is writing a second property-testing library, with no second reading to catch its own bugs. Not written; its size is not measured.
2. **fast-check 4.10.2**: arbitraries and combinators, integrated shrinking, seeds and replay paths, `fc.scheduler()`, `fc.sample` to read what a generator yields. Kept.
3. **jsverify 0.8.4**: last publication 2023-09-27, four dependencies, no scheduler. Rejected: unmaintained.
4. **testcheck 1.0.0-rc.2**: last publication 2022-06-27, never released as final. Rejected: unmaintained.
5. **A coverage-guided fuzzer, `@jazzer.js/core` 4.0.0** (2026-04-15): nine dependencies, among them `@jazzer.js/fuzzer`, a native addon built by `cmake-js` through `node-addon-api`, which the repository's `ignore-scripts=true` would not build. It searches for crashes from code coverage; it does not produce named cases nor explore promise interleavings. Rejected for this catalogue; it may complement fast-check on the parsers (review condition).

## Measurements

On 2026-10-19, Ubuntu 26.04 x64, Node 24.21.0, npm 11.19.0, in a scratch folder with the repository's `.npmrc` rules (`ignore-scripts`, `save-exact`, `min-release-age=7`):

- **Footprint**: `fast-check` 4.10.2 depends on `pure-rand` ^8.0.0, resolved to 8.4.2: 2 packages, 1 523 883 + 64 122 = 1 588 005 bytes installed, both MIT, no install script, `npm audit` 0, `npm audit signatures`: both carry verified provenance attestations. The repository's `node_modules` holds 16 packages and 69 914 732 bytes on this machine.
- **Maintenance**: 195 releases since 2017-12-28; 12 releases between 2025-12-06 (4.4.0) and 2026-09-19 (4.10.2); `pure-rand` 8.4.2 on 2026-07-10. One npm maintainer for both: a single point of failure, mitigated by the exact pin, the lockfile's integrity hashes, the provenance attestations and the fact that nothing published depends on it.
- **Cost per test process**: `import('fast-check')` takes 9.3 to 10.3 ms (five runs); `node --test` runs each test file in its own process, so the cost is paid once per test file that imports the catalogue.
- **Cost of its types**: a probe test that uses `fc.property`, `fc.asyncProperty` with `fc.scheduler()` and `fc.sample` type-checks under the repository's options (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `isolatedDeclarations`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `skipLibCheck` off) with TypeScript 7.0.2 in 0.31 to 0.32 s and 167 to 169 MB, against 0.28 to 0.31 s and 164 to 165 MB for the same probe without fast-check: about +0.03 s and +3.5 MB. Its declaration files total 699 666 bytes.
- **Runs as the repository runs tests**: the probe passes under `node --test` with Node's type stripping, no loader and no build step.

## Decision

Option 2, with the rules below.

- **The dependency**: `fast-check` at an exact version in the root `devDependencies`, beside the other development tools, so the manifest rule "zero third-party dependency in a package" stays unconditional. It is never a dependency of a published package and is imported by test files only, through `@yaltaan/testing`, which re-exports it: one import point, one version.
- **The package**: `packages/testing`, named `@yaltaan/testing`, never published. §6 of ARCHITECTURE.md gains an "internal packages" line beside the graph, which is the single list the checks read. An internal package is outside the graph and is skipped by the contract tag, package contents and import size checks; the graph check then requires that no other package lists it in `dependencies` or `peerDependencies` and that no built production module imports it. Its own tests run in the gate like any other.
- **One generator per category**: `adversarial.boundary`, `.structures`, `.hostile`, `.unicode`, `.callbacks`, `.async`. Each holds named cases, a label and a factory that builds a fresh value on each call (a frozen object, a cycle, a Proxy or an aborted signal must not leak from one test to the next), and an arbitrary that yields every named case before its random ones. A test of the package checks that each category yields the named cases of §10.1, by label.
- **The declaration lives in the export's test file**, as one call per export that names the package subpath and the export and lists the six categories, each with a check run against the category's cases, or with "N/A" and a reason. The declaration and its evidence are then one object: a category cannot be declared as covered without the code that covers it. Rejected: a published `@adversarial` JSDoc tag beside the contract tags of §5.6. It would show the categories in the reference documentation, but it changes a shared contract, adds bytes to every published declaration file, and states a coverage that a later deleted test would leave standing.
- **Experimental and stable**, which reconciles §10.5 with the definition of done: every export that runs declares its six categories from its first day, so the analysis is never skipped; while it is `@experimental`, a category that concerns it may be marked "deferred" (concerned, not yet tested), which the gate counts and prints; once `@stable`, a deferred category fails. §10.5 then splits its row in two: "adversarial categories declared" (yes, yes) and "adversarial categories tested" (no, yes).
- **What the gate checks**, from the events of the test run itself, so that a declaration in a file the runner never loaded counts as missing: every export that runs (a function, a constant that can be called, a class: the exports that carry the whole contract under ADR 0012) has exactly one declaration, while an export that never runs (a constant that cannot be called, an interface, a type alias) has nothing to attack and declares nothing; every declaration names an existing export; every check ran at least one case of its category; no `@stable` export has a deferred category. The export list and the stability levels come from the contract tag reading (ADR 0012), not from a second list.

## Consequences

- 2 packages added to the lockfile, both MIT; 1 588 005 bytes installed (`node_modules` from 69 914 732 to about 71 502 737 bytes on Linux).
- About 10 ms per test file that imports the catalogue, and about +0.03 s of type-checking for the test projects.
- Writers of an export write one declaration in its test file: six entries, each a check, a deferred mark or a reason.
- Nothing published changes: no byte in any package, no tag added to the contract of §5.6.
- §10.2 and §10.3 rely on the same import; a property or race test needs no further record.

## Review condition

fast-check without a release for twelve months, or a major version whose migration costs more than replacing it; a need to publish a package that depends on it (never intended); the first parser (paths, numbers, dates, schemas) whose fast-check runs miss a defect that coverage-guided fuzzing finds, which would reopen option 5 for parsers alone; or the catalogue's tests exceeding a tenth of the gate's test time.
