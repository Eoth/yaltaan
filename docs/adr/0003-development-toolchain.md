# ADR 0003 — Development toolchain

- Date: 2026-10-12
- Status: accepted

## Context

The verification gate needs a package manager, a compiler, a test runner and a formatter. None of them ships to users (the packages have no runtime dependency), but each enters the gate, so each is a dependency to justify: weight installed on every clone and CI run, transitive packages to trust, install scripts, licence, maintenance.

Facts checked on 2026-10-12: TypeScript 7.0 (native compiler) is generally available as `typescript@7.0.2` (published 2026-07-08) and ships no compiler API; TypeScript 6.0.3 is the last JavaScript-based release. Node runs `.ts` files directly by erasing types: on by default without a warning since 22.18, stable since 24.12; Node 26 no longer transforms non-erasable syntax (enums, namespaces, parameter properties).

## Options

Package manager:

1. **npm workspaces** (bundled with Node). Lockfile v3 with a `sha512` integrity per package; `.npmrc` hardens it: `ignore-scripts=true` (no dependency install script runs), `save-exact=true`, `min-release-age=7` (no version younger than 7 days is picked), `allow-git=none`, `engine-strict=true`.
2. **pnpm 12.** Stricter defaults (build scripts refused unless allowed, a one-day minimum release age), but a native binary of about 43 MB to install and pin, and a second tool for every contributor. Its main advantage, refusing phantom dependencies, matters for runtime dependencies, which these packages do not have.

Compiler:

1. **TypeScript 7.0.2.** Declaration emit, `isolatedDeclarations`, build mode and `--extendedDiagnostics` (check time, instantiations, memory) verified on 7.0.2; about ten times faster than 6.0. Costs a 2.5 MB package plus one platform binary of about 28 MB.
2. **TypeScript 6.0.3.** Has the compiler API, but is the end of its line; users moving to 7 would be checked by a compiler this repository does not use.

Test runner:

1. **`node:test` on `.ts` files.** Zero dependencies; mock timers and snapshots stable on Node 24 and later; coverage still experimental. Runs on Node 22, 24 and 26 unchanged; Deno implements `node:test`, Bun partially.
2. **Vitest 5.0.3.** 35 packages and 37.7 MB installed (Vite, rolldown and lightningcss binaries), 65 packages and 64.2 MB with browser mode and Playwright. Brings browser runs, which the test matrix needs later.

Formatter:

1. **Prettier 3.9.9**, pinned exactly. One package, no dependency, 9.7 MB. 3.9.10 exists but was published on 2026-10-10, inside the 7-day minimum release age.
2. **Biome 2.5.15.** Formatter and linter in one native binary of 67 to 79 MB.
3. **dprint 0.63.0.** Runs an install script and fetches its plugins by URL.

Linter:

1. **None for now.** The compiler's strict options (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, `noUnused*`, `noImplicitReturns`, `isolatedDeclarations`, `erasableSyntaxOnly`) catch the type errors; repository-specific rules (contract tags, dependency graph, baseline) become scripts of the gate.
2. **ESLint 10 with typescript-eslint 8.71.** 95 packages, and typescript-eslint accepts only `typescript < 6.1`: it cannot run with the compiler chosen above.
3. **oxlint 1.87.** Its JavaScript plugin API, needed for custom rules, is still alpha.

Node types: **`@types/node` 22.20.5** (with `undici-types` 6.21.0) for the scripts and tests only, pinned to the oldest supported Node line so that no test or script uses an API Node 22 lacks; the library sources compile with `"types": []`.

## Measurements

`npm install` on Windows x64, Node 24.17.0, npm 11.13.0, 2026-10-12:

- 6 packages installed (`typescript`, its `win32-x64` binary, `prettier`, `@types/node`, `undici-types`, the workspace link); `node_modules` 43.4 MB, of which 28 MB is the compiler binary, 9.7 MB Prettier, 2.6 MB Node types.
- `package-lock.json`: 24 third-party entries (20 are the compiler's per-platform binaries, one installed per machine); licences MIT (3) and Apache-2.0 (21); no install script; all resolved from `registry.npmjs.org` with a `sha512` integrity.
- `npm audit`: 0 vulnerabilities.

## Decision

npm workspaces, TypeScript 7.0.2, `node:test` run on `.ts` files, Prettier 3.9.9, no general-purpose linter, `@types/node` 22.20.5; every version pinned exactly, every update in a commit of its own that states what changed and why.

## Consequences

- Sources use erasable syntax only, relative imports carry the `.ts` extension (rewritten to `.js` on emit), type-only imports use `import type`.
- A tool that needs a compiler API (contract-tag checker, documentation generator) uses its own parser or `@typescript/typescript6`, decided by its own record.
- Browser test runs (Chromium, Firefox, WebKit) are decided by measurement when the test matrix is built: a minimal runner on Playwright, or Vitest if the measurement favours it.
- The gate (`scripts/verify.sh`) checks that the lockfile keeps registry sources, integrity hashes, allowed licences and no install script.

## Review condition

typescript-eslint or oxlint supporting TypeScript 7 with custom rules, and a class of defect a lint rule would have caught; Node's test runner lacking a feature the matrix needs; npm losing a protection pnpm has (or a runtime dependency appearing, which would make phantom dependencies matter).
