# ADR 0012 — Contract tag checker and generated reference

- Date: 2026-10-13
- Status: accepted

## Context

ARCHITECTURE.md §5.6 makes every public export carry normalized JSDoc tags: `@pure` or `@mutates <param>`, `@sharing`, `@complexity`, `@throws`, `@since`, and a stability level, `@experimental` or `@stable` (§10.5). The promise "every function documents its mutation" holds only if an export without its tags fails the gate, and the reference documentation is built from the same tags.

Checking this needs three readings that only a compiler does well:

- **the public surface**: every name that each `exports` subpath of a package makes importable, through `export *`, renamed re-exports and merged declarations;
- **the JSDoc tags of each export**, wherever the export was declared;
- **the parameters of each callable export**, since `@mutates target` must name a real parameter.

TypeScript 7 rewrote the compiler in Go and ships no stable compiler API: the `typescript` 7.0.2 package exports `./unstable/sync`, `./unstable/async` and `./unstable/ast/*`, which drive the native compiler of the same package through pipes ("the protocol is unversioned; both sides must be built from the same tree", in its own source). `parseAst` of Rollup, used by the dependency graph check (ADR 0011), reads JavaScript only and drops comments.

The tag list itself needs one source. ARCHITECTURE.md §5.6 lists the tags in a commented example; a checker that kept its own list beside it would let the two drift.

## Options

1. **Do nothing.** Tags stay a review habit. The first export merged without them breaks the promise silently, and the reference documentation is written by hand, then drifts.
2. **An analyzer of our own**, on the emitted `.d.ts` files or on the sources: a lexer for comments, strings and template types, and a parser for `export` statements, `declare` forms, overloads and parameter lists, plus the resolution of `export *` and renamed re-exports across files. Zero dependency, but several hundred lines that reimplement what the compiler already installed does, with their own bugs and no second reading to catch them: a missed `export *` would make exports vanish from the check without a failure.
3. **`@typescript/typescript6`**: TypeScript 6.0, the last JavaScript compiler, with its stable compiler API (`createProgram`, `getExportsOfModule`, `getAliasedSymbol`, `Symbol.getJsDocTags`, signatures). Stable and complete, but a second compiler in the repository.
4. **The `unstable/sync` entry point of `typescript` 7.0.2**, already installed: the same checker queries (`getExportsOfModule`, `getAliasedSymbol`, `getJsDocTagsOfSymbol`, `getSignaturesOfType`), answered by the compiler that builds the packages. No new byte, but an API that may change in any release.

## Measurements

On 2026-10-13, Windows, Node 24.17.0, on a probe package of three files (a renamed re-export, an `export *`, two overloads each with its own `@mutates`, a function, an arrow function in a `const`, a class with a destructured constructor parameter, an interface, a type alias, a constant without tags, a namespace re-export):

- **`@typescript/typescript6` 6.0.2**: depends on `@typescript/old` (`npm:typescript@^6`, resolved to 6.0.3): 2 packages, 24 363 101 bytes installed, Apache-2.0, no install script, `npm audit` 0. Releases: `typescript` 6.0.3 on 2026-04-16, the wrapper last published on 2026-07-06. Loading the compiler 123 to 127 ms, building the program and checker 253 to 259 ms, reading the exports 4 to 5 ms.
- **`typescript/unstable/sync` 7.0.2**: 0 byte added. Loading the client 38 ms (1 021 ms on the first run, disk cache cold), opening the project 59 ms, reading 5 ms; reading the emitted declarations through a configuration written in a temporary folder: 153 ms in all, process spawn included.
- **Same answers**: both readings list the same exports and the same tags, in the same order within each export. TypeScript 7 follows the `export *` and the renamed re-export, leaves the `default` export of the re-exported module out (ECMA-262, GetExportedNames: `export *` never provides a default export), merges the tags of the two overloads (`@mutates a`, `@mutates b`) and their parameters (`[a]`, `[a, b]`), names the destructured constructor parameter `__1`, and keeps every JSDoc comment in the emitted `.d.ts`.
- **Rate of change of `unstable/sync`**: `api.d.ts` grows from 299 lines in 7.0.1-rc (2026-06-18) to 528 in 7.0.2 (2026-07-08) and 1 673 in 7.1.0-dev.20261012.1; the diff between 7.0.2 and that 7.1 build is 1 603 lines. Of the fourteen calls the checker needs, `getExportsOfModule`, `getAliasedSymbol`, `getJsDocTagsOfSymbol` and `getDocumentationCommentOfSymbol` did not exist in 7.0.1-rc; in the 7.1 build, `API.updateSnapshot`, which opens a project, is private and replaced by `createSnapshot` and `createProgram`, and the checker methods become getters that return a callable (same call syntax). An upgrade to 7.1 will break the checker; the fix is a rewrite of the calls, not of the rules.
- **The analyzer of our own** was not written: its cost is estimated from the grammar it would need (comments, strings and template literal types, `export` and `declare` forms, overloads, parameter lists with destructuring and rest, `export *` and re-export resolution across files), several hundred lines before its tests.

## Decision

Option 4, under conditions that turn a break into a red gate instead of a silent pass.

- **One adapter**: `scripts/lib/declarations.ts` is the only file that imports `typescript/unstable/*`. It returns plain data (package, subpath, export name, kind, tags, parameter names, declaration text, documentation); the rules and the reference never see a compiler object. A TypeScript upgrade that changes the API is fixed in that file alone.
- **Pinned and tested**: `typescript` stays at an exact version (`save-exact`, checked by the manifest check); its tests build fabricated packages with `tsc` and read them through the adapter, so every call it makes is exercised by the gate that runs on the upgrade commit.
- **No pass on nothing read**: the value exports seen by the compiler are compared with the keys of the module namespace that Node itself loads from the same subpath (a second, independent reading); a subpath that exports nothing, a declaration file the compiler cannot open, or a package with `src/` but no `dist/` fails the check.
- **What is read**: the published declarations, the `.d.ts` file each `exports` subpath maps to (its `types` condition, or the `.d.ts` beside its JavaScript file), since they are what users' editors show; a subpath that maps to a JSON file is not code and is skipped.
- **One source of the tags**: `scripts/lib/contract-tags.ts` holds the admitted tags, the exports each applies to and the values each accepts. The checker reads it; the tag table of `docs/reference/README.md` is generated from it; ARCHITECTURE.md §5.6 keeps an example and points to the generated table.
- **Which export carries what**: an export that runs carries the whole contract: a function, a `const` whose type can be called, a class (its constructor's parameters are the ones `@mutates` may name). An export that never runs, a constant that cannot be called, an interface or a type alias, carries `@since` and its stability only: a mutation, a complexity or a thrown error mean nothing for it, and a tag that means nothing would be refused rather than written for form. Any other kind (a namespace re-export, an enum, a namespace) is refused until a decision record covers it.
- **Values**: `@pure` takes no value and excludes `@mutates`; each `@mutates` names one parameter, once; `@sharing` is `none`, `structural` or `identity-preserving`; `@complexity` starts with `O(`; `@throws` is `never` alone, or one tag per condition; `@since` is `MAJOR.MINOR`, the version whose minor release added the export; `@experimental` and `@stable` take no value, exactly one of them. Documentary tags are admitted where they mean something: `@param` (naming a parameter), `@returns`, `@typeParam`, `@example`, `@see`, `@deprecated`. Every other tag fails: a misspelt contract tag must not pass for a free comment.
- **Overloads**: the compiler merges the tags of all the signatures of an overloaded function, so a contract tag is written once, on the first signature, and `@mutates` may name a parameter of any signature.
- **The reference**: `docs/reference/` is generated by `node scripts/check-contract-tags.ts --update`, committed, and compared byte for byte by the same script in the gate: a tag changed without regenerating fails. Exports are sorted by name in code-unit order and paths are written relative to the repository, so the output does not depend on the machine, its locale or its file system.

## Consequences

- No new dependency. The gate gains one step after the build: one compiler process for all packages, about 0.15 s on the probe, plus one `tsc` build per fabricated package in the tests.
- A TypeScript upgrade can fail the gate on this step alone; the upgrade commit then rewrites the adapter, or, if the new API cannot answer one of the readings, replaces it by option 3 through a new decision record.
- Members of exported classes and interfaces (the methods of an instance returned by a `create*` function) carry no checked tag yet: the check stops at the exports.
- Writers of a constant or a type write two tags, `@since` and the stability level; writers of a function, six or more.

## Review condition

TypeScript 7 publishing a stable compiler API (the adapter then moves to it); an upgrade of `typescript` whose API can no longer list the exports, their tags or the parameters of a signature (then option 3, measured above); or `@typescript/typescript6` entering the repository for another reason, such as type-checking cost under TypeScript 6.0, at which point reading the tags through it costs no byte and its stable API removes the risk measured here.
