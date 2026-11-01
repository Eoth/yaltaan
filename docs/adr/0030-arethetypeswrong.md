# ADR 0030 — No arethetypeswrong: the supported compilers judge the published types

- Date: 2026-11-01
- Status: proposed — recommendation, awaiting the owner

## Context

ARCHITECTURE.md §11 names `arethetypeswrong` among the judges of a release: it resolves every entry point of a tarball the way TypeScript would under each module resolution, and reports types that do not match the JavaScript (masquerading ESM or CJS, missing types, a `node10` resolution that fails). The question it answers is real: can a TypeScript user import each subpath and get the right types. Who answers it is the choice.

## Options

1. **Native, or do nothing.** The type tests of the repository compile against the sources, not the tarball: a declaration left out of the tarball, or an `exports` condition TypeScript reads wrong, would pass. Rejected.
2. **`@arethetypeswrong/cli` 0.18.5 as a development dependency.** The tool the ecosystem knows; its verdict reads well in a review. Its cost and its compiler are measured below.
3. **Our supported compilers on the real tarball**: the tarballs installed into an empty project, an importer of every subpath of `exports` compiled by TypeScript 7.0.2 and 6.0.3 (both already installed, ADR 0014) under `nodenext` and `bundler` resolution, and every subpath loaded by Node through `import` and `require`. Recommended.

## Measurements

On 2026-11-01, Ubuntu 26.04 x64, Node 24.21.0, npm 11.19.0, in a throwaway folder with the repository's `.npmrc`:

- **Footprint of option 2**: 56 lock entries (MIT 44, ISC 9, BSD-3-Clause 1, BlueOak-1.0.0 1, Apache-2.0 1), no install script, 34 324 474 bytes installed: `node_modules` would grow from 95 862 726 bytes by about 36 %. Most of it is the compiler `@arethetypeswrong/core` pins to the exact version `typescript` 5.6.1-rc.
- **Its verdict on `@yaltaan/core`**: every subpath resolves under `node16` from ESM and under `bundler`; it reports "ESM (dynamic import only)" from CommonJS, which TypeScript 5.6 believes and which Node ≥ 22.12, the floor of ADR 0006, contradicts by loading ES modules through `require`. 0.43 s.
- **The compiler it judges with** is outside the versions the packages support (TypeScript 6.0 and 7.x, ADR 0006): a declaration that only TypeScript 6.0 or 7 reads differently would pass it, and its CommonJS verdict is already wrong for our floor.

## Decision

Recommended: option 3, implemented by the release script (ADR 0029): the compilers and the runtime the packages promise to support are the judges, on the bytes of the tarball, with no package added. `arethetypeswrong` is not installed.

## Consequences

- No package added; the question attw answers is answered by TypeScript 7.0.2 and 6.0.3 themselves, and by Node.
- What option 3 does not see: resolutions outside `nodenext` and `bundler` (`node10`, which ignores `exports`, is not supported by the packages anyway; a `classic` resolution neither); TypeScript versions other than the two installed; a CommonJS consumer compiled by TypeScript (the packages are ES modules only, and Node's `require` is checked at run time instead).
- ARCHITECTURE.md §11 keeps its promise of a type check of the published tarball; its wording changes once the owner decides.

## Review condition

`arethetypeswrong` judging with a supported TypeScript version at a cost below 5 MB; a consumer reporting a type resolution the two compilers accepted; a CommonJS build of the packages.
