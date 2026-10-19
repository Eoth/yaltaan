# ADR 0015 — Shallow install strategy, so that one compiler owns `tsc`

- Date: 2026-10-19
- Status: accepted (technical choice, corrects the installation fact of ADR 0014)

## Context

ADR 0014 adds `@typescript/typescript6` 6.0.2 and states that it "installs its command as `tsc6`, so it sits beside `typescript` 7 without touching `tsc`". That was measured in an empty folder, without TypeScript 7 beside it, and it is wrong in this repository. The wrapper depends on `@typescript/old`, an alias of `typescript@6.0.3`, which ships the commands `tsc` and `tsserver`. With npm's default strategy (`hoisted`) the alias lands at `node_modules/@typescript/old`, at the top of `node_modules`, and npm links the commands of every package placed there: after `npm install --save-dev @typescript/typescript6@6.0.2`, `node_modules/.bin/tsc` pointed to `../@typescript/old/bin/tsc` and `npx tsc -v` printed `Version 6.0.3`. The gate builds, type-checks and reads declarations with `npx tsc`: it would have run TypeScript 6.0 in place of 7.0.2, and passed.

Option 3 of ADR 0014, an alias of the compiler as a direct dependency, was rejected for this very reason; option 2, the one accepted, had the same defect in another form.

## Options

1. **Do nothing.** The repository's `tsc` is TypeScript 6.0.3; the reference compiler of ARCHITECTURE.md §8 no longer runs. Rejected.
2. **Call TypeScript 7 by its file everywhere** (`node node_modules/typescript/bin/tsc`), and leave `.bin/tsc` to 6.0. The gate would be right, but `npx tsc` in a terminal, an editor task or a contributor's habit would silently run another compiler. Rejected.
3. **`install-strategy=shallow`** in the repository's `.npmrc`: only the direct dependencies of the workspace are placed at the top of `node_modules`; their own dependencies are installed under them, where npm links no command. `@typescript/old` lands at `node_modules/@typescript/typescript6/node_modules/@typescript/old`, and the wrapper still finds it (Node resolves `@typescript/old` from the wrapper's folder). Kept.
4. **`install-strategy=linked`**, the isolated layout of pnpm style. Also places only direct dependencies at the top, but npm 11 documents it as experimental and it changes the layout of every package. Rejected for now.

## Measurements

On 2026-10-19, Ubuntu 26.04 x64, Node 24.21.0, npm 11.19.0:

- **Default strategy**: `.bin/tsc` → `../@typescript/old/bin/tsc`, `.bin/tsserver` → `../@typescript/old/bin/tsserver`; `npx tsc -v` → `Version 6.0.3`.
- **Shallow strategy**, `npm install --save-dev @typescript/typescript6@6.0.2`, then `rm -rf node_modules` and `npm ci`: `.bin/tsc` → `../typescript/bin/tsc`, `.bin/tsc6` → `../@typescript/typescript6/bin/tsc6`; `npx tsc -v` → `Version 7.0.2`, `npx tsc6 -v` → `Version 6.0.3`; `require('@typescript/typescript6').version` → `6.0.3`. 44 lock entries either way, the only nested one being `@typescript/old`; `node_modules` 95,862,726 bytes against 95,862,668 under the default strategy. `npm ls --all` clean.
- npm keeps the locations already recorded in the lock file: the strategy only places packages added or moved after it is set. Entries locked before it (such as `undici-types`, a dependency of `@types/node`, at `node_modules/undici-types`) stay at the top until they are reinstalled; none of them ships a command.

## Decision

Option 3: `install-strategy=shallow` in `.npmrc`, with a comment that says why.

The lockfile check gains a rule, so that this class of error fails the gate whatever the strategy: no two packages placed at the top of `node_modules` (a workspace package included) may ship a command of the same name. It reads the `bin` field that the lock records for each entry, so it judges the tree `npm ci` will install, before anything is installed.

## Consequences

- `tsc` is TypeScript 7.0.2 again, and stays so: a dependency of a dependency that ships `tsc` is placed under its parent, and a hoisted one fails the lockfile check.
- A dependency shared by two direct dependencies may now be installed twice, once under each, when it is added or reinstalled. Not measured beyond this change, where no package is duplicated; the size of `node_modules` is measured at every change of the lock, as before.
- How the strategy places the dependencies of a workspace package (the adapters' frameworks, when they arrive) is not measured; it is checked when the first workspace package gains a dependency.

## Review condition

npm placing a package's commands by priority of direct dependencies (the hoisted layout then becomes safe again); `install-strategy=linked` leaving its experimental status; a duplicated package making `node_modules` grow by more than a tenth.
