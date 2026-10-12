# ADR 0009 — Size harness: bundlers and reference libraries

- Date: 2026-10-12
- Status: accepted

## Context

The bytes an application ships because of the library are its central argument (ARCHITECTURE.md §9), and the budgets of §9.1 were hypotheses. Measuring them takes three things the repository did not have: real bundlers that tree-shake an import the way applications do, honour `"sideEffects"` and minify; reference libraries measured by the same harness, so that a budget is calibrated rather than guessed; compression at fixed settings. Each of them enters the verification gate, so each is a dependency to justify: weight on every clone and CI run, transitive packages, install scripts, licences.

Facts checked on 2026-10-12, npm 11.13.0 with the repository's `.npmrc` (`ignore-scripts`, `min-release-age=7`):

- **esbuild 0.28.2** (2026-08-08), MIT. The `esbuild` package declares `"postinstall": "node install.js"`. That script checks that the binary of the platform package (`@esbuild/<platform>`, one of 26 optional dependencies) resolves; if it does not, it runs `npm install` for it, then downloads the tarball straight from the registry; on systems other than Windows it hard-links the binary over the JavaScript launcher to save a process start; it then runs the binary to check its version. With `ignore-scripts=true` none of that runs, and esbuild still works: its API resolves the binary from the platform package that npm installed from the lockfile, integrity checked. **`esbuild-wasm` 0.28.2** is the same Go source compiled to WebAssembly: one package, no dependency, no install script.
- **Rollup 4.64.0** (2026-10-02; 4.64.5, published 2026-10-10, is inside the seven-day window). `rollup` ships its parser as a native binary per platform (26 optional packages; on Windows npm installs both the GNU and the MSVC x64 builds). **`@rollup/wasm-node`** is the same JavaScript with the parser compiled to WebAssembly. Both declare two more optional dependencies: `fsevents` 2.3.3 (macOS only, for watch mode; its lockfile entry has `"hasInstallScript": true`, a script that `ignore-scripts` keeps from running, and it ships its compiled binary) and `@napi-rs/lzma-linux-x64-gnu` 1.5.1 (Linux x64 glibc only, MIT, no install script), listed since Rollup 4.63.0 and never loaded: the only `lzma` in Rollup's distribution is an entry of its watcher's list of binary file extensions.
- Rollup neither minifies nor resolves packages from `node_modules` by itself. `@rollup/plugin-node-resolve` 16.0.3 and `@rollup/plugin-terser` 1.0.0 together install 29 packages (5.1 MB), three of them under BSD-2-Clause or BSD-3-Clause, which the lockfile check does not allow today.
- **Vite 8.3.4** bundles with Rolldown 1.2.13: a 0.9 MB package plus a platform binding (21.4 MB on Windows x64, one of 15 optional packages), and Vite brings PostCSS, Lightning CSS, picomatch and tinyglobby.

## Options

1. **Do nothing: sum the sizes of the built files.** No dependency, but no tree-shaking: an import leak, a module with side effects or a `sideEffects` field written wrong would go unseen, and the figure would not be what an application ships.
2. **Ask a public service (bundlejs, bundlephobia).** No dependency, but the gate would depend on the network and on a third party, and unpublished code cannot be measured. Kept as the independent second method for the reference figures, outside the gate.
3. **Native `esbuild` and `rollup`, with the two Rollup plugins.** The fastest run. Costs 27 + 29 lockfile entries of platform binaries, an install script to allow for esbuild, 29 plugin packages and three new licences; a different binary runs on each operating system.
4. **`esbuild-wasm` and `@rollup/wasm-node`, a resolver of the harness's own for Rollup, and esbuild's minifier on Rollup's output.** Five lockfile entries for both bundlers, two of them optional; no install script to allow but fsevents'; the same WebAssembly bytes run on Windows, Linux and macOS. Costs about twice the run time of option 3 and a resolver to maintain.
5. **Add Vite or Rolldown as a third bundler.** Vite up to version 7 bundles with Rollup and minifies with esbuild, which option 4 already covers; Rolldown follows Rollup's tree-shaking semantics. Costs a 21 MB platform binding per machine for a column that would repeat the Rollup one today.

## Measurements

On Windows 11 x64, Node 24.17.0, npm 11.13.0, 2026-10-12, in scratch folders and then in this repository:

- Same output from both builds of each bundler: on the six reference scenarios below, the SHA-256 of every minified bundle is identical between `esbuild` and `esbuild-wasm`, and between `rollup` and `@rollup/wasm-node`.
- Run time of the six scenarios through both bundlers, process start included: 2.0 to 2.1 s with native esbuild, 4.3 to 4.6 s with `esbuild-wasm` (three runs each), Rollup on WebAssembly in both cases.
- Installed (apparent size, `du -sb`): `esbuild-wasm` 14.5 MB; `@rollup/wasm-node` 3.5 MB with `@types/estree`; native esbuild 11.6 MB and native Rollup 7.6 MB on Windows. Downloaded by `npm ci` on Linux x64: `esbuild-wasm` 3.9 MB against 4.8 MB for native esbuild with its Linux binary; `@rollup/wasm-node` 0.8 MB; the stray lzma binary 0.6 MB.
- Compression by `node:zlib` (gzip level 9; brotli quality 11, the input length as size hint): the same sizes for the twelve bundles under Node 22.23.3 (zlib 1.3.1-e00f703, brotli 1.1.0, WSL Ubuntu 22.04) and Node 24.17.0 (same zlib, brotli 1.2.0).
- References, minified with brotli, esbuild / Rollup: es-toolkit 1.52.0 `omit` 90 / 97 B; ten es-toolkit functions (`chunk`, `clamp`, `countBy`, `keyBy`, `mapValues`, `merge`, `omit`, `partition`, `pick`, `uniqBy`) 657 / 661 B; valibot 1.5.0 login schema (`object`, `string`, `email`, `minLength`, `safeParse`) 1 285 / 1 254 B; temporal-polyfill 1.0.5 `Temporal` 17 851 / 17 876 B; `@preact/signals-core` 1.14.4 (`signal`, `computed`, `effect`, `batch`) 1 562 / 1 559 B; alien-signals 3.2.1 (`signal`, `computed`, `effect`, batch) 1 636 / 1 644 B.
- Second method: bundlejs.com (its own esbuild WebAssembly build, packages fetched from unpkg, its own compressors) gives the same raw, gzip and brotli bytes for both es-toolkit scenarios (108 / 116 / 90 and 1 665 / 732 / 657) and for the valibot one (3 472 / 1 408 / 1 285); for temporal-polyfill, the same 57 158 raw bytes, and compressed sizes 0.23 % (gzip) and 0.13 % (brotli) away from node:zlib's. ADR 0005's 19.3 kB for temporal-polyfill was measured on jsDelivr's build of the package, which is not tree-shaken by an application bundler.
- Weight of the chosen set in this repository: 9 packages installed, 25.5 MB (`esbuild-wasm` 14.5, es-toolkit 4.2, `@rollup/wasm-node` 3.5, valibot 1.9, temporal-polyfill with its two dependencies 1.1, `@preact/signals-core` 0.3); `node_modules` from 43.4 to 68.9 MB; lockfile from 24 to 35 third-party entries, licences MIT (13) and Apache-2.0 (22); `npm audit` 0 vulnerabilities, 14 registry signatures and 5 attestations verified.

## Decision

Option 4.

- `esbuild-wasm` and `@rollup/wasm-node`, pinned exactly, bundle every import scenario; the same bytes run on every machine.
- The harness resolves packages for Rollup itself: the `"exports"` field with the conditions esbuild uses for the browser platform (`browser`, `module`, `import`, `default`, in the package's own key order), and `"sideEffects"` read from each module's package.json as `@rollup/plugin-node-resolve` reads it. A form it does not implement (subpath patterns, a glob in `"sideEffects"`) fails the run instead of being approximated.
- Rollup's output is minified by esbuild with the settings of the esbuild bundle: the Rollup column measures Rollup's tree-shaking, not another minifier.
- Compression by `node:zlib`, gzip level 9 and brotli quality 11 with the input length as size hint; sizes are compared to the byte.
- Reference libraries, root development dependencies never imported by a package: es-toolkit (primitives), valibot (schemas), temporal-polyfill (the polyfill ADR 0005 recommends), `@preact/signals-core` (reactive graph; the smaller of the two measured). They are measured on every run, so that a reference that changes shows in the size baseline.
- The lockfile check allows `fsevents` to declare an install script: it is installed on macOS only and never runs under `ignore-scripts`. The licence list does not change.
- ARCHITECTURE.md §9.1 names esbuild and Rollup as the bundlers that judge import leaks.

## Consequences

- Every clone and CI job installs 25.5 MB more and downloads about 6.3 MB more on Linux x64; the size step adds a few seconds to the gate.
- A new version of a bundler or of a reference changes the baseline: it lands in its own commit, with the size differences in its message.
- The resolver is code to maintain; its choices are checked against esbuild's on the reference packages, one of which (`@preact/signals-core`) puts `browser` before `import`.
- Rolldown, which Vite 8 uses, is not measured.

## Review condition

A bundler that application users mostly build with and that tree-shakes differently from esbuild and Rollup (Rolldown once Vite 8 dominates); an esbuild or Rollup release whose WebAssembly build lags or differs from the native one; Rollup adding an install script or a dependency that is loaded; the size step taking more than ten seconds; a reference without a release for a year, or overtaken in size by another library with the same scope.
