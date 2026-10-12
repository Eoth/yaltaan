<p align="center"><img src="docs/logo.svg" alt="" width="96" height="96"></p>

# Yaltaan

Yaltaan is a native-first TypeScript standard library for applications. Its value is not a long list of functions but one shared model — `Result`, `Issue`, `Path`, schemas that implement [Standard Schema](https://standardschema.dev), and reactive nodes — used the same way by every domain: an error from a schema, a date parser, a relational rule or a server has the same shape and the same `Path`, and one typed `Path` serves reading, writing, diffs, errors and form fields alike. It ships only what the platform lacks, has no runtime dependency, and its contracts (mutation, complexity, errors, import cost) are written down, checked in CI and measured.

**Status: pre-release. Nothing is published and there is no API yet.**

## Packages

Dependencies flow one way and never back: `core ← temporal`, and `core ← schema ← rules ← form ← angular | react | vue`. No adapter depends on another.

| Package | Status | Purpose |
|---|---|---|
| [`@yaltaan/core`](packages/core/README.md) | empty | The shared contracts (`Result`, `Issue`, `Path`, reactive nodes) and the data primitives the platform lacks: objects, collections, strings, numbers, deep equality, diff, async control, bounded caches. |
| `@yaltaan/temporal` | planned | What Temporal does not provide: intervals, parsing of declared formats, `Date` conversions that require an explicit time zone. Temporal itself comes from the platform or from a polyfill the application installs. |
| `@yaltaan/schema` | planned | Schemas and reversible codecs implementing Standard Schema v1, usable by any engine that reads it. |
| `@yaltaan/rules` | planned | Declarative relational rules (required if, all or none, at least n of) that work in any form engine, with or without `@yaltaan/form`. |
| `@yaltaan/form` | planned | A form model on reactive nodes, conditional: built only if a vertical slice on a real form shows its value over Angular Signal Forms and TanStack Form, a go/no-go decision recorded in [docs/adr/](docs/adr/). |
| `@yaltaan/angular` | planned | Bridge to Angular Signal Forms. |
| `@yaltaan/react` | planned | Bridge to React through `useSyncExternalStore`. |
| `@yaltaan/vue` | planned | Bridge to Vue, later, after the Angular and React ones. |

## Principles

- **Native-first.** A function exists only if the platform lacks it on the supported runtimes. Each candidate passes a relevance test: if the platform does it, the native equivalent is documented instead; if an existing library does it better on its own, Yaltaan writes it only when fitting it to the shared contracts brings a demonstrable gain; a composition of primitives starts as a documented recipe and enters the API only if it is common and hard to write correctly.
- **Zero third-party runtime dependencies** in `core`, `temporal`, `schema`, `rules` and `form`: a package depends only on the Yaltaan packages below it; an adapter also has a peer dependency on its framework.
- **`Result` for expected failures, exceptions for bugs.** Invalid input returns a `Result`; an exception means the caller broke a documented precondition.
- **Data-first API.** Free functions that take the data first, at most two positional arguments then an options object, never a positional boolean; no classes with chained methods, which bundlers cannot tree-shake. Strict by default, coercion on request.
- **ESM only**, `"sideEffects": false`, an explicit `exports` entry per sub-path, and no code run when a module loads.
- **Codes, not messages.** The library reports stable, namespaced codes with parameters (`schema.too_small`); wording and translation belong to the application. Codes are part of the public contract under semantic versioning.

## What it will not do

- Time zones, daylight saving time, calendars: Temporal does it, with the runtime's time zone data.
- Cryptography: Web Crypto exists, and a home-made implementation is a risk, not a saving.
- Natural-language messages and translation catalogues.
- Aliases of native APIs, a generic deep clone (`structuredClone` exists), date and number formatting (`Intl` does it).
- A general-purpose state manager, an HTTP client, a request cache.
- CommonJS, an `Option<T>` type, runtime decorators, reflection, `eval` or `new Function`, global registries.

Each exclusion and its reason is listed in [ROADMAP.md](ROADMAP.md), section 4 (in French).

## Developing

Node.js 22.18 or later and npm 10.9 or later. Scripts and tests are TypeScript that Node runs directly, with no build step.

```sh
npm ci                                # the repository's .npmrc runs no install script
git config core.hooksPath githooks    # once per clone: pre-commit, commit-msg and pre-push hooks
bash scripts/verify.sh                # the gate: prints OK, or the steps that failed
npm test                              # the tests alone
```

On Windows, run the bash scripts from Git Bash. [CONTRIBUTING.md](CONTRIBUTING.md) gives the definition of done, and [SECURITY.md](SECURITY.md) how to report a vulnerability privately.

## Decisions

The design in force is described in [ARCHITECTURE.md](ARCHITECTURE.md). Each decision behind it (a package, a dependency, a shared contract, an exception to a rule, a promotion to stable) is an architecture decision record in [docs/adr/](docs/adr/), with the options weighed, the measurements and the condition that would reopen it. The planned work is in [ROADMAP.md](ROADMAP.md) (in French).

## License

MIT, see [LICENSE](LICENSE).
