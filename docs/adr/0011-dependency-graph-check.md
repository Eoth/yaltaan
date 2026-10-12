# ADR 0011 — Dependency graph check

- Date: 2026-10-13
- Status: accepted

## Context

ARCHITECTURE.md §6 sets the allowed graph between packages (`core ← temporal`; `core ← schema ← rules ← form ← angular | react | vue`), and four publishing rules: no barrel that re-exports another package, no code executed when a module loads other than declarations, `"sideEffects": false`, an explicit `exports` entry per subpath. Tree-shaking and the import budgets of ADR 0010 rest on them: an upward import puts a whole package into a bundle that never asked for it, and a module that runs code when it loads cannot be dropped by a bundler that cannot prove the code harmless. The last two rules are already checked on the manifests; the first two and the graph itself are not checked at all.

The edges of the graph already have one source: the `dependencies` and `peerDependencies` of each package.json. The size report reads them to decide which packages a bundle may contain (ADR 0009). A second list of edges, kept by hand in a tool's configuration, would drift from it.

What has to be read:

- **the manifests**, for the declared edges;
- **the built JavaScript** under `dist/`, which is what bundlers and runtimes load: every import specifier, every re-export, every statement that runs when the module loads;
- **the type-only imports**, which TypeScript erases from the JavaScript but keeps in the published declarations: a declaration file of `core` that imports a type of `schema` breaks every application that installs `core` alone.

TypeScript 7 has no stable compiler API: its `unstable/*` entry points talk to the native compiler and may change in any release (the same constraint T0.6 meets).

## Options

1. **Do nothing.** Review alone keeps the graph. One unnoticed `import` of a higher package, or one `Object.freeze` at module level, and a budget measures the wrong thing without anyone being told.
2. **dependency-cruiser.** The usual tool for graph rules, named as an example by ARCHITECTURE.md §6. It reads JavaScript with acorn and TypeScript through the `typescript` package's compiler API, which TypeScript 7 does not have: version 18.6.0 accepts `typescript` from 2.0.0 to below 7.0.0. With TypeScript 7.0.2 installed it disables `.ts`, `.d.ts`, `.mts` and `.cts`, and run on a folder of `.ts` files it reports zero modules and exits 0: a green verdict on nothing read. On the built `dist/*.js` it would see value imports, but neither type-only imports nor code run at load nor re-exports of imported bindings, so a second checker would still be needed. Weight: 43 packages (MIT 40, ISC 3), 4.8 MB, and a configuration file that holds a second copy of the graph.
3. **A checker on Rollup's parser and TypeScript's file listing.** `@rollup/wasm-node`, already installed for the size harness, exports `parseAst`: an ESTree tree of a JavaScript file, with positions. It is enough to read every import, re-export and module-level statement of `dist/**/*.js`. Type-only imports are read by the compiler itself: `tsc -p <package build config> --listFilesOnly` prints every file the compilation resolves, type-only imports included, without type-checking; a file that belongs to another package is an edge. Both are tools the gate already runs; the rules are a few hundred lines of script.

## Measurements

On 2026-10-13, Windows, Node 24.17.0:

- dependency-cruiser 18.6.0 (published 2026-10-11), installed in a scratch folder with `npm install --ignore-scripts` next to `typescript` 7.0.2: 43 lockfile entries besides TypeScript, 4 756 139 bytes, `npm audit` 0. `depcruise --info` lists `typescript >=2.0.0 <7.0.0` as not found and `.ts` as unsupported; `depcruise src --no-config --output-type json` on a folder holding `a.ts` (an `import type` of `@yaltaan/schema` and a relative import) printed `modules: 0` and exited 0.
- `parseAst` of `@rollup/wasm-node` 4.64.0 on a four-statement module: `ExpressionStatement`, `ExportNamedDeclaration`, `ImportDeclaration`, `ExportNamedDeclaration`, each with `start` and `end`; a `/*#__PURE__*/` call carries its annotation in `_rollupAnnotations`.
- `tsc -p <config> --listFilesOnly` (TypeScript 7.0.2) on a two-package probe where `core` only imports a type of `schema`: 0.125 s; the listing names `schema/src/index.ts` next to the compiler's own `lib.*.d.ts` files.
- Rollup 4.64.0, bundling `import './m.js'` with `moduleSideEffects: true`, drops a module-level `Object.freeze([])`, a call of a local pure function, a spread of an imported object and a member read: Rollup proves them harmless one by one, esbuild keeps an unannotated call. A rule that matches one bundler's analysis would let through what the other keeps; the rule therefore admits no call at all at load, annotated or not.

## Decision

Option 3: `scripts/check-dependency-graph.ts`, a step of the gate after the build.

- **The graph is read from ARCHITECTURE.md §6**, the `text` block after "Allowed dependency graph": each line is a chain `a ← b ← c | d`, where `b` may depend on `a`; a package may depend on everything below it, transitively. A package folder the graph does not name, or a block that cannot be read, fails the check: a new package takes its place in the graph through a decision record, never by default.
- **Edges come from the manifests only**: the `@yaltaan/*` names in `dependencies` and `peerDependencies`. Each must name a workspace package the graph allows. Code never adds an edge: an import of a package the manifest does not declare fails, even an allowed one.
- **Internal edges are `dependencies` on the exact version of the workspace package.** npm links a workspace package only when its version satisfies the spec; otherwise it installs the name from the registry, where the scope is not reserved yet. The manifest check accepts `dependencies` that name workspace packages at their version, and nothing else: zero third-party runtime dependencies stays the rule. A peer dependency between packages would leave the lower package out of every bundle the size report measures, so it is not used for internal edges. The release workflow (T0.10) may replace the exact version by a range in a later record.
- **Every `dist/**/*.js` file** is parsed: a bare import or re-export must name a declared dependency, through a subpath its `exports` lists (never a file inside it, never the package itself); a relative import must stay inside the package; `node:` and other built-in modules are never declared, so never imported; a dynamic `import()` must have a literal specifier and obeys the same rules.
- **No barrel of another package**: `export … from` with a bare specifier, or an `export` of a binding imported from another package, fails.
- **Declarations only at load**: the body of a module holds imports with bindings, exports, function and class declarations, and variable declarations whose initialiser executes nothing. Calls, `new`, tagged templates, assignments, updates, `delete`, `await`, spreads, destructuring, class static blocks, decorators and import statements without bindings fail. Function bodies are not read: they do not run at load.
- **Type-only edges**: for each package with a `tsconfig.build.json`, every file `tsc --listFilesOnly` lists outside the compiler's `lib.*.d.ts` files must belong to the package itself or to a declared dependency.
- A package with `src/` but no `dist/` fails: the check never passes on a package it did not read.

## Consequences

- No new dependency; the step adds the parse of the built files and one `tsc --listFilesOnly` per package (about 0.1 s each).
- ARCHITECTURE.md §6 names the check instead of dependency-cruiser; ARCHITECTURE.md §11, the README and CONTRIBUTING.md say "zero third-party runtime dependencies", since `schema` will depend on `core`.
- A module-level constant built by a call (`Object.freeze`, `new Map`, `Symbol()`) is refused: such a value is built lazily inside a function, or written as a literal with a `readonly` type. If a module needs one, the exception is a decision record, not a widened rule.
- The rules read ESTree as `parseAst` returns it; a Rollup upgrade that changes the tree shows as a test failure of the check.

## Review condition

dependency-cruiser, or another maintained graph checker, reading TypeScript 7 sources including type-only imports, with module-level code and re-export rules, at a weight comparable to its 4.8 MB; or TypeScript 7 publishing a stable compiler API, which would let one parser read sources and declarations alike.
