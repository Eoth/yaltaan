# Architecture

Yaltaan is a TypeScript standard library for applications: native-first, frugal, with zero runtime dependencies. This document is its design reference: the thesis, what is out of scope, the target platform, the contracts every package shares, the packages and their domains, and the rules for types, measurement, quality and the supply chain.

The product is named Yaltaan and its packages are published under the npm scope `@yaltaan` (ADR 0001).

Status: no package is published and no API exists yet. ROADMAP.md tracks what is built and in which order; this document states the rules the code follows as it lands.

## 1. How to read this document

The document runs from the most stable to the most variable:

1. Thesis and non-goals (§2, §3): what does not move.
2. Target platform and cross-cutting contracts (§4, §5): the backbone every domain shares.
3. Packages and domains (§6, §7): scope, decisions, invariants.
4. Types, measurement, quality, supply chain (§8 to §11).
5. Decisions and contributions (§12), priorities in case of conflict (§13).

Every rule comes with its reason. When a situation is not covered, the answer is reasoned from the reasons rather than from the closest-looking rule. A rule whose reason does not apply to the case at hand is challenged through a decision record (§12); it is never bypassed silently.

This document changes only through a decision record in `docs/adr/`.

## 2. Thesis

### The problem

A modern TypeScript application typically assembles 6 to 10 utility libraries: collections, dates, validation, immutable updates, concurrency, caching, forms. Each has its own error shape, its own path notation, its own mutation convention and its own handling of `null` and `undefined`. The real cost is not the size of each library. It is:

- the glue code between them (turning a validator's errors into form errors, one library's paths into another's…);
- the duplicates in the bundle;
- the code that reimplements what the platform now provides (`groupBy`, `Set` operations, lazy iterators, Temporal…).

### The thesis

The value of the library does not come from the number of its primitives. It comes from three things:

1. One shared set of contracts — `Result`, `Issue`, `Path`, schema, reactive node (§5) — used identically by every domain.
2. Only the code the platform does not provide (§4).
3. Contracts that are written down, checked in CI and measured: mutation, complexity, errors, import cost.

Success is not counted in functions shipped but in the amount of application code, dependencies and bytes the library lets its users delete.

### Positioning

The library does not try to beat es-toolkit on `chunk`, valibot on the size of an object schema, or Temporal on time zones. It wins when the pieces talk to each other: an `Issue` produced by a schema, a date parser, a relational rule or an imported server error has the same shape and the same `Path`; a typed `Path` serves `get`, `set`, `diff`, errors and form fields alike.

The strongest differentiator is probably `@yaltaan/rules` (§7.10): declarative relational rules ("at least N", "all or none", "required if…") that work in any form engine. No library does this well today.

### Relevance test for any new function

1. Does the platform do it within the baseline? Then it is not written, and the native equivalent is documented.
2. Does an existing library do it better, in isolation? Then it is written only if its integration with the cross-cutting contracts brings demonstrable value.
3. Is it a primitive or a composition? A composition goes into the documentation first, as a recipe. It enters the API only if the recipe is used often and is hard to write correctly.

## 3. Non-goals

The authoritative list, with each verdict, is ROADMAP.md §4; a new exclusion needs the owner's explicit agreement. The reasons, one line each:

| Non-goal | Reason |
|---|---|
| Reimplementing time zones, daylight saving time, calendars | Temporal (ES2027) does it with the runtime's time-zone data; reimplementing it would cost tens of kB and permanent maintenance. |
| Cryptography | A home-made implementation is a risk, not a saving; Web Crypto exists. |
| i18n catalogues and natural-language error messages | Messages belong to the application; the core produces stable codes and parameters (§5.2). |
| Aliases of native APIs | A function that is only an alias adds bytes and an API to learn, and brings nothing. |
| General-purpose state manager, HTTP client, request cache | Mature ecosystems, outside the thesis. |
| CommonJS | Every supported Node line can `require()` an ES module; a dual build complicates `exports` and tree-shaking. |
| `Option<T>` | `T \| undefined` is enough in TypeScript; one more type is a cognitive cost with no gain. |
| Rust or WebAssembly | Out of the plan; reopened only by a decision record with figures (§9.4). |
| Runtime decorators, reflection, `new Function`, `eval` | Opaque, incompatible with a strict Content Security Policy, costly at startup. |
| Global registries, self-registering plugins | Incompatible with tree-shaking and determinism. |
| Generic deep clone, immer-style immutability proxies | `structuredClone` exists; the real need is a localized update with structural sharing (§7.1). |
| Arbitrary-precision decimal arithmetic | The domain of a dedicated library; `core/number` refuses any lossy conversion (§7.4). |
| Date and number formatting | `Intl.*` does it; only a locale-resolution recipe is provided. |

## 4. Target platform: native-first

### Baseline

Decided in ADR 0004:

- browsers: "Baseline Widely available" (web-features) at the date of each major release;
- Node: every LTS line that has not reached its end of life at that date (on 2026-10-12: 22, 24 and 26), from the first release that loads ES modules through `require()` by default (22.12, ADR 0006); recent Deno and Bun; workers and edge runtimes that conform to WinterTC, wherever no runtime-specific API is required;
- Temporal is the exception, treated as a platform peer (§7.8, ADR 0005), because stable Safari and iOS do not ship it, nor do Node 22 and 24.

An API is Widely available when every core browser (Chrome, Edge, Firefox and Safari, on desktop and mobile) has shipped it for at least 30 months. Node, Deno and Bun are outside Baseline, so an API must also exist on every supported Node line before the library relies on it.

### Platform state on 2026-10-12

- Temporal reached Stage 4 at the March 2026 TC39 plenary and belongs to ES2027 (not ES2026). Chrome and Edge 144+ and Firefox 139+ ship it; stable Safari and iOS do not (only Safari Technology Preview has it). Node 22 and 24 do not ship it; Node 26, Deno 2.7 and Bun 1.4 do.
- Node lines: 22 is in maintenance until 2027-04-30; 24 is LTS until 2028-04-30 (maintenance from 2026-10-20); 26 becomes LTS on 2026-10-28 (end of life 2029-04-30).

### Rule

A primitive ships only if it is absent from the baseline. When the native equivalent exists but is newer than the baseline, the library does not polyfill it implicitly: it documents the recommended polyfill and, if needed, provides an isolated ponyfill in `@yaltaan/core/compat/*`, never imported by another function, so that only an application that imports it pays for it.

Consequence: until an API is Widely available at the date of a major release (and present on every supported Node line), the library neither uses it internally nor tells users to rely on it without a polyfill. Lazy iteration helpers, for instance, are written as generators that do not depend on Iterator helpers.

### Native → library table

Baseline statuses measured on 2026-10-12 with web-features 3.42.0; Node availability from @mdn/browser-compat-data 8.1.5. "Widely (date)" means Widely available since that date. "Newly; Widely on (date)" means Newly available today (every core browser ships it) and projected to become Widely available on that date. "Limited" means at least one core browser lacks it.

| Need | Native | Baseline on 2026-10-12 | What the library adds |
|---|---|---|---|
| Grouping | `Object.groupBy`, `Map.groupBy` | Widely (2026-09-05) | `indexBy` (unique key, a collision is an explicit error), `countBy` |
| Non-mutating sort and edit | `toSorted`, `toReversed`, `toSpliced`, `with`, `findLast` | Widely (`toSorted` family 2026-01-04, `findLast` 2025-02-23) | Multi-criteria `sortBy` (built on the stable native sort) |
| Set operations | `Set.prototype.union`, `intersection`, `difference`, … | Newly; Widely on 2026-12-11 | Key-based variants on arrays (`intersectionBy`, `differenceBy`) |
| Lazy iteration | Iterator helpers (`map`, `filter`, `take`, `drop`, `flatMap`, `toArray`, …), `Iterator.from` | Newly; Widely on 2027-09-30 | The missing helpers: lazy `chunk`, `window`, `zip`, `partition` |
| Deep clone | `structuredClone` | Widely (2024-09-14) | Nothing. The real need is a localized update with structural sharing (§7.1). |
| Graphemes | `Intl.Segmenter` | Newly; Widely on 2026-10-16 | `graphemeLength`, grapheme-aware `truncate` |
| Ill-formed Unicode | `isWellFormed`, `toWellFormed` | Widely (2026-04-24) | Nothing |
| Regular expression escaping | `RegExp.escape` | Newly; Widely on 2027-11-01; absent from Node 22 | Nothing |
| Cancellation | `AbortSignal.timeout`, `AbortSignal.any` | `timeout`: Newly, Widely on 2026-10-18; `any`: Widely (2026-09-19) | Nothing: every async API accepts a signal |
| Promises | `Promise.withResolvers`, `Promise.try` | `withResolvers`: Widely (2026-09-05); `try`: Newly, Widely on 2027-07-07, absent from Node 22 | Nothing |
| Exact floating-point sum | `Math.sumPrecise` | Newly; Widely on 2028-10-10; in no Node release | Nothing: statistics rely on it, so they wait for it to enter the baseline |
| Binary Base64 | `Uint8Array.fromBase64`, `toBase64` | Newly; Widely on 2028-03-05; absent from Node 22 and 24 | Nothing |
| Dates and durations | Temporal | Limited (no stable Safari or iOS; absent from Node 22 and 24) | Intervals, parsing of declared formats, `Date` ↔ Temporal guard rails (§7.8) |
| Formatting | `Intl.*` (DateTimeFormat, NumberFormat, PluralRules, ListFormat, RelativeTimeFormat, DurationFormat, Collator) | Widely, except `Intl.DurationFormat`: Newly, Widely on 2027-09-04, absent from Node 22 | Nothing beyond a locale-resolution recipe |
| Equality | `Object.is` | Widely | Configurable deep equality (absent from the platform) |

This table is a living document: each new ECMAScript edition can remove functions from the library (deprecation, then removal in a major release). The statuses move with time and are measured again for each major release.

## 5. Cross-cutting contracts: the backbone

Delivered first, validated end to end by the vertical slice (a real form built through every layer, see ROADMAP.md), then frozen. Any later change goes through a decision record and a major version.

### 5.1 `Result`

```ts
type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

- A plain object literal, no class, no chained methods: methods cannot be tree-shaken. Free functions instead: `ok`, `err`, `mapResult`, `unwrapOr`…
- Exceptions are reserved for bugs (a violated programmer precondition). Expected failures (invalid input, impossible parse) return a `Result`.
- A throwing variant (`…OrThrow`) exists only where a real need at a boundary is demonstrated.

### 5.2 `Issue`

```ts
interface Issue {
  readonly code: string;            // stable, namespaced: 'schema.too_small', 'temporal.ambiguous_format'
  readonly path: Path;              // empty = root / global
  readonly params?: Readonly<Record<string, unknown>>; // data to build a message from
  readonly severity?: 'error' | 'warning';             // default: 'error'
  readonly cause?: unknown;
}
```

- The same shape everywhere: schemas, parsers, rules, forms, imported server errors.
- The core produces no message. The application provides a formatter `(issue) => string`, and that is where i18n lives. A minimal English formatter is provided as a recipe.
- Codes are a public SemVer contract, listed in a documented registry per package.
- Conversion to the Standard Schema issue format (`message` + `path`) is provided at the boundary.

### 5.3 `Path`

```ts
type PathSegment = string | number | symbol | { readonly key: unknown };
type Path = readonly PathSegment[];
```

- The `{ key }` segment designates an array element by stable identity rather than by index. This is what lets errors and form state follow a moved element, and lets server errors survive a reordering.
- The text notation (`'items[3].name'`) exists only at the boundaries (`parsePath`, `formatPath`), with defined escaping rules. Never internally.
- Typed `Path<T>` and `PathValue<T, P>`, with a bounded depth of 8 levels (a hypothesis to calibrate by measurement); beyond it, an explicit and documented degradation to an untyped path.
- On writes, the segments `__proto__`, `constructor` and `prototype` are refused by default, with an explicit error, never silently ignored.

### 5.4 Schema = Standard Schema

- Every schema of `@yaltaan/schema` implements the Standard Schema interface (`~standard`, interface version 1, specification 1.1.0). This gives immediate interoperability with the engines that consume it: TanStack Form reads it natively, react-hook-form through `standardSchemaResolver` from `@hookform/resolvers`, and Angular Signal Forms, stable in Angular 22, through `validateStandardSchema`.
- The interface's types are copied into the library rather than taken as a dependency: the specification allows it, and the zero runtime dependency rule (§11) holds.
- Conversely, `@yaltaan/rules` and `@yaltaan/form` accept any Standard Schema schema (zod, valibot, arktype…). No lock-in: Yaltaan's own schema can lose a comparison without breaking the rest of the library.

### 5.5 Reactive node

```ts
interface ReadableNode<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}
```

- This is exactly the contract of React's `useSyncExternalStore`, and it converts trivially to an Angular signal or a Vue `customRef`.
- Internal implementation: a push-pull graph, lazy and glitch-free, with explicit batching, topological evaluation order and cycle detection at construction. Budget: at most 1 kB minified + brotli, below the reactive libraries measured ([ADR 0010](docs/adr/0010-import-size-budgets.md)).
- No global scheduler: batching is carried by an instance or by an explicit call.
- Why not reuse the framework's signals: the core's semantics (timing, glitches, effects) would then depend on the framework, which contradicts the framework-agnostic principle.
- Why not wait for TC39 Signals: the proposal is still at Stage 1, where it has stood since April 2024. The interface is designed to switch to it the day it is standardized.

### 5.6 Mutation contract and checked metadata

Every public export carries normalized JSDoc tags, checked by the verification gate on the published declarations: an export without its tags, an unknown tag or a `@mutates` that names no parameter fails CI ([ADR 0012](docs/adr/0012-contract-tag-checker.md)).

```ts
/**
 * Removes `keys` from `target`.
 * @mutates target
 * @sharing identity-preserving
 * @complexity O(k) (k = number of keys)
 * @throws never
 * @since 0.3
 * @experimental
 */
```

An export that runs (a function, a constant that can be called, a class) carries the whole contract: `@pure` or one `@mutates` per mutated parameter, then sharing, complexity, thrown errors, the version that added it, and its stability level, `@experimental` or `@stable` (§10.5). An export that never runs (a constant, an interface, a type alias) carries `@since` and its stability level only. The admitted tags and their values are defined once, in `scripts/lib/contract-tags.ts`, and the [reference documentation](docs/reference/README.md) is generated from the tags. The promise "every function documents its mutation" thus becomes checkable instead of a wish.

By default, functions do not mutate. A mutating variant exists only if a benchmark shows a significant gain, and it is named explicitly (suffix `InPlace`).

### 5.7 API conventions

- Data-first only. No dual data-first and data-last API: it doubles the surface of types, tests and documentation.
- At most two positional arguments, then an options object. Never a positional boolean.
- Strict by default, coercion opt-in.
- Naming: `parse*` returns a `Result`; `*OrThrow` throws; `is*` is a predicate; `create*` builds an instance with state (cache, limiter…).
- No overload whose runtime behaviour changes with the type of an argument.
- Every API with a timer accepts an injectable clock (`clock`), for deterministic tests.

## 6. Packages

```text
@yaltaan/core       data primitives, one subpath per domain:
                   /result /path /object /collection /string /number /equal /diff /async /cache /reactive
@yaltaan/temporal   layer over Temporal (provided by the platform or by a polyfill the application installs)
@yaltaan/schema     schemas and codecs (Standard Schema, interface version 1)
@yaltaan/rules      declarative relational rules, pure, usable without a form
@yaltaan/form       form state on reactive nodes; conditional on the go/no-go decision that closes the vertical slice
@yaltaan/angular    Signal Forms bridge (plus Reactive Typed Forms interop)
@yaltaan/react      useSyncExternalStore bridge
@yaltaan/vue        later
```

Allowed dependency graph, checked by the verification gate on the manifests, the built modules and the files each build compiles ([ADR 0011](docs/adr/0011-dependency-graph-check.md)):

```text
core ← temporal
core ← schema ← rules ← form ← angular | react | vue
```

Internal packages, never published and outside the graph, imported by test files only ([ADR 0013](docs/adr/0013-adversarial-catalogue-on-fast-check.md)); no package lists one among its `dependencies` or `peerDependencies`, and the checks of published packages (contract tags, package contents, import sizes, production file size) skip them:

```text
testing
```

Nothing points upward. Adapters never depend on one another. A package may depend on every package below it in its chain; each edge is a `dependencies` entry of its package.json, at the exact version of the workspace package, and the code imports nothing its manifest does not declare.

Concerns that get no package of their own:

- codecs, serialization, transformation and mapping → `@yaltaan/schema` (a codec is a bidirectional schema);
- immutable updates, snapshots → `core/object` and `core/diff`;
- configuration → a recipe on `@yaltaan/schema` (no dedicated module);
- localization → out of scope, `Intl` recipes;
- security primitives → spread where they apply: refusal of dangerous keys in `core/path`, `redact` in `core/object`, size and depth limits in the parse options of `@yaltaan/schema`.

Publishing: `"sideEffects": false`, an explicit `exports` field per subpath, no barrel that re-exports another package, no code executed when a module loads other than declarations.

## 7. Domains

Each domain is described by its scope, its decisions, what it does not do, and its invariants. The common adversarial cases are in the catalogue of §10.1 and are not repeated here.

### 7.1 `core/object` and `core/path`

**Scope**: `pick`, `omit`, `merge` (explicit strategy for arrays), `get`/`set`/`has`/`remove` by `Path`, localized `update` with structural sharing, `mapKeys`, `mapValues`, `defaults`, `redact`.

**Decisions**

- Only plain objects (prototype `Object.prototype` or `null`) and arrays are traversed. `Map`, `Set`, `Date`, Temporal objects, typed arrays and class instances are opaque unless the function declares support for them. Each function publishes its support table.
- Own enumerable string-keyed properties by default; symbols opt-in.
- Getters are read once; an exception thrown by a getter is propagated, never swallowed.
- `set`/`update` on a missing path: a `Result` error by default; creation is opt-in (`createMissing: 'object' | 'array-if-numeric'`).
- The `InPlace` variants throw an explicit `TypeError` on a frozen, sealed or non-extensible object.

**Does not do**: generic deep clone (`structuredClone` does it), immer-style immutability proxies.

**Invariants**

- `omit(omit(x, k), k)` equals `omit(x, k)`.
- `update(x, p, v => v) === x` (the same reference when nothing changes).
- The branches an `update` does not touch keep their reference.
- `get(set(x, p, v), p) === v`.
- No prototype pollution, whatever the keys (fuzzed).

### 7.2 `core/collection`

**Scope**, only what the platform lacks: `partition`, `indexBy`, `countBy`, `uniqueBy`, `minBy`/`maxBy`, `topK` (heap, O(n log k)), `chunk`, `window`, `zip` (lazy variants over iterables), `intersectionBy`/`differenceBy`, multi-criteria `sortBy`, `paginate`, `mapConcurrent` (async iterable with a concurrency limit).

**Decisions**

- Default equality: SameValueZero (`NaN` equals `NaN`, `-0` equals `0`), documented and configurable.
- Holes in sparse arrays are treated as `undefined`, as the recent native methods do.
- A non-transitive comparator produces an unspecified order, but never an infinite loop or an exception.
- Functions over an `Iterable` consume it once; this is documented.

**Invariants**: `partition` keeps every element and their relative order; `uniqueBy` is idempotent; `topK(xs, k)` equals `xs.toSorted(cmp).slice(0, k)` (consistency with the platform).

### 7.3 `core/string`

**Scope**: `graphemeLength`, grapheme-aware `truncate`, `slugify` with explicit rules (NFKD normalization, removal of diacritics, allowlist), `normalizeWhitespace`, detection of invisible characters and bidirectional controls (Trojan Source attacks).

**Does not do**: locale-dependent casing beyond the native methods; comparison (`Intl.Collator` does it).

**Invariants**: `slugify` is idempotent; `truncate` never cuts inside a grapheme; `normalizeWhitespace` is idempotent.

### 7.4 `core/number`

**Scope**: strict `parseNumber` (explicit decimal and grouping separators, returns a `Result`), `clamp`, `inRange`, `approxEqual` (explicit absolute and relative tolerances), `round(x, digits, mode)` with named modes (`half-even`, `half-up`…), `number` ↔ `bigint` conversions that are exact or fail.

**Does not do**: arbitrary-precision decimal arithmetic (out of scope; left to a dedicated library).

**Invariants**: no implicit conversion that loses precision; `parseNumber(format(x))` equals `x` for the declared formats.

### 7.5 `core/equal` and `core/diff`

**Decisions**

- Configurable deep `equal`: SameValueZero or `Object.is`; the supported special types are listed (`Map`, `Set`, `Date`, typed arrays, Temporal objects through their `equals`); cycles are detected.
- The patch format uses `Path` (no JSON Pointer internally). Conversion to and from RFC 6902 is provided at the boundary.
- Array diff by index or by key (a key function), producing `move` operations.
- Invertible patches are opt-in (`reversible: true` records the old values).
- `diff` rejects cycles explicitly.

**Invariants**

- `apply(diff(a, b), a)` equals `b` (under the chosen equality).
- `diff(a, a)` is empty.
- `apply(invert(p), apply(p, a))` equals `a`.
- `apply` never mutates its input and keeps the references of the subtrees it does not touch.

### 7.6 `core/async`

**Scope**: `debounce`, `throttle` (options `leading`/`trailing`, `cancel`, `flush`), `withTimeout`, `retry` (`attempts`, `backoff`, `retryIf`, `signal`), `createLimiter(concurrency)`, `latest` (each call aborts the previous one), `dedupe(keyFn)`, `createQueue`.

**Decisions**

- Everything accepts an `AbortSignal`. An abort rejects with `signal.reason`, never with a silent resolution.
- No global timer: each instance owns and releases its timers. Injectable clock.
- A concurrency below 1 throws a `RangeError` at construction.

**Invariants**: a stale result is never delivered; never a double resolution; an already-aborted signal rejects immediately without running the task.

### 7.7 `core/cache`

**Scope**: `createLru({ max, maxWeight?, weigh?, ttl?, clock? })`, `memo(fn, { cache })`, `memoAsync` (deduplication of in-flight calls, stale-while-revalidate, opt-in negative cache), `memoWeak` (object keys through a `WeakMap`).

**Decisions**

- Always an instance, never a global cache.
- A maximum size is mandatory: no cache is unbounded by default. An unbounded cache is a deferred memory leak.
- Strict, deterministic LRU eviction.

### 7.8 `@yaltaan/temporal`

**Scope**, what Temporal does not provide:

- A typed `Interval<T>`, half-open `[start, end)` by default; operations `overlaps`, `contains`, `intersect`, `union`, `gaps`, `mergeAll`. An inverted interval is an error at construction; the empty interval is an explicit value.
- Parsing of declared formats (`parsePlainDate('01/02/03', { format: 'dd/MM/yy', pivotYear: 1970 })` → `Result`). Without an explicit format, an ambiguous string produces the issue `temporal.ambiguous_format`, never a guess.
- Boundary conversions `fromDate(date, { timeZone })` / `toDate(...)` that require an explicit time zone.
- `startOf`/`endOf` (week with an explicit `firstDayOfWeek`, quarter…), business days with an injected holiday calendar (no data embedded).
- `@yaltaan/schema` codecs for the Temporal types, in a separate subpath so as not to create a dependency from `temporal` to `schema`.

**Decisions**

- `globalThis.Temporal` is read at call time, never when the module loads. If it is absent, an explicit error names the recommended polyfill.
- The library embeds no polyfill. The polyfill the documentation recommends (ADR 0005) is `temporal-polyfill` (1.0.5, MIT, 19.3 kB minified + brotli as jsDelivr builds it and 17.9 kB once an application bundler tree-shakes it, ADR 0009; maintained, up to date with the September 2026 specification) rather than `@js-temporal/polyfill` (0.5.1, 38.9 kB as jsDelivr builds it, no release since March 2025). The default entry of `temporal-polyfill` covers the ISO and Gregorian calendars; its full build adds the others.
- Tests run against the native implementation (Chrome, Firefox, Node 26, Deno, Bun) and against both polyfills, `@js-temporal/polyfill` for as long as it remains widely installed.

**Does not do**: time-zone data, daylight saving computation, formatting (`Intl` does it).

**Invariants**: `parse(format(x, f), f)` equals `x` for every declared format; intersection is commutative and associative; the `union` of disjoint intervals keeps the total measure.

### 7.9 `@yaltaan/schema` (schemas and codecs)

**Scope**: primitives, `literal`, `enum`, `object`, `record`, `array`, `tuple`, `map`, `set`, `union`, discriminated union, `intersect`, `lazy` (recursive and mutually recursive), `optional`, `nullable`, `default`, refinements, transformations, bidirectional codecs, versioning and migrations, `partial`/`deepPartial`/`pick`/`omit`/`extend`.

**Decisions**

- An API of functions, not methods, on the pattern of valibot: it is the condition for tree-shaking. valibot is the size reference to beat or to match.
- An interpreted implementation, without `new Function` (compatibility with a strict Content Security Policy).
- Unknown keys: `'strip' | 'reject' | 'passthrough'`. Default `strip`: a field added on the server must not break deployed clients. `reject` is recommended for untrusted input. Decided in ADR 0008.
- A missing key, `undefined` and `null` are three distinct states; `optional` accepts absence, and the `exactOptional` option refuses an explicit `undefined`.
- `codec(schema, encode)`: a transformation without `encode` is marked non-reversible at the type level (calling `encode` on it is a compile error).
- `versioned({ 1: s1, 2: s2 }, migrations)`: chained migrations; an unknown version produces the issue `schema.unknown_version`.
- Async refinements are separate: the synchronous `parse` refuses an async schema at the type level.
- Security limits are parse options with finite defaults: depth 64, 10,000 keys, 1,000,000 elements (hypotheses to calibrate by measurement).
- The evaluation order is documented: structure, then children, then the parent's refinements. An `abortEarly` mode is opt-in.
- Validation never mutates its input. External context is passed explicitly, `parse(schema, input, { context })`, never through a global.

**Invariants**: determinism (the same input and the same context give the same result); `decode(encode(x))` equals `x` for a reversible codec; `parse` of an already valid value without transformation is idempotent.

### 7.10 `@yaltaan/rules`: the differentiator

Declarative relational rules over a set of values. Pure and stateless, they return targeted `Issue`s.

```ts
requiredIf(cond, paths)        allOrNone(paths)
atLeast(n, paths)              atMost(n, paths)          exactly(n, paths)
mutuallyExclusive(paths)       unique(arrayPath, keyFn)  ordered(startPath, endPath)
aggregate(arrayPath, fn, check)  when(discriminantPath, cases)  withContext(ctx => rule)
```

**Decisions**

- Each rule declares its dependencies (the paths it reads) and its targets (the paths where it places issues). This enables targeted invalidation, cycle detection and explanation ("why is this field required?"). In test mode, the actual reads are traced and compared with the declared dependencies.
- Whether a field is required is a derived state (`requiredPaths(rules, values)`), never a mutation of other rules. No rule modifies a rule, so no loop is possible.
- A rule is also usable as a Standard Schema refinement. It therefore works in Angular Signal Forms or TanStack Form without `@yaltaan/form`.

**Invariants**: determinism; a rule reads only its declared dependencies; `atLeast(n)` is monotonic (filling one more field cannot create an error).

### 7.11 `@yaltaan/form`: conditional

**Structure**: a tree of reactive nodes (`field`, `group`, `array`, `record`), a raw value and a parsed value (through a codec), derived states (`dirty`, `touched`, `pending`, `submitted`, `disabled`, `readonly`, `hidden`), local and server issues.

**Design decisions**

- Arrays: each element has a stable identity (a business key or a generated one). Issues and state are attached to the identity, not to the index, and therefore follow moves.
- Async validation: each run carries a generation token and an `AbortSignal`. A result whose token is no longer current is ignored. Removing a node aborts its validations. `pending` is derived: true while a run of the current generation is in progress.
- Targeted revalidation through the dependency graph of `@yaltaan/rules`, never global by default.
- Server errors: import of `Issue`s with their `Path` (`{ key }` segments included); a `clearOn: 'change' | 'submit'` policy; categories (validation, business, authorization, transport) carried by the namespace of the code.
- Drafts: a snapshot is the raw value plus the schema version; restoration goes through the schema's migrations.
- Multi-step forms: a step is a subset of paths; validating a step is filtering issues by path. No dedicated engine.

**Condition for existing**: Angular Signal Forms is stable since Angular 22, and TanStack Form covers React. The added value of `@yaltaan/form` over these engines must be demonstrated by the vertical slice (see ROADMAP.md), then recorded by a decision record. If the answer is no, the product is `schema` + `rules` + bridges to the native engines, which remains a strong product and a much smaller one.

### 7.12 Adapters

**Angular**

- Priority target: Signal Forms, stable in Angular 22, which accepts Standard Schema through `validateStandardSchema`. Reactive Typed Forms as an interop for existing codebases, added when a pilot project needs it (ADR 0006).
- `@yaltaan/rules` is exposed as Signal Forms validators; `@yaltaan/form` nodes are exposed as signals.
- Supported versions follow the Angular support policy (active and LTS versions); decided in ADR 0006: Angular 22 and later. From Angular 22 on, a major version ships every 12 months and is supported for 24 (12 active, 12 LTS).

**React**

- A `useSyncExternalStore` bridge; `useField(form, path, selector?)` to limit re-renders; no mandatory context provider.
- Scope decided in ADR 0007: Yaltaan's own hooks only. TanStack Form already reads Standard Schema natively, so a Yaltaan schema or rule works there without a bridge; a dedicated TanStack Form adapter is reconsidered only if the vertical slice measures glue code that users repeat.

**Vue**: later; the reactive node converts to a `customRef` (§5.5).

**Common rule**: an adapter has no state of its own, brings no notion of its framework into the core, and keeps to its budget (§9.1).

## 8. TypeScript

- Reference compiler: TypeScript 7, the native compiler, GA since July 2026 (7.0.2). Supported versions (ADR 0006): TypeScript 6.0 and 7.x, because Angular template tooling stays on TypeScript 6.0. Dropping a version line is a major release.
- TypeScript 7.0 ships without a stable compiler API. The contract-tag check of §5.6 reads its `unstable/sync` entry point through one adapter ([ADR 0012](docs/adr/0012-contract-tag-checker.md)); the type-cost harness and the type tests also run TypeScript 6.0, from `@typescript/typescript6` installed beside 7 under the command `tsc6` ([ADR 0014](docs/adr/0014-type-cost-harness-and-typescript-6.md)).
- Library settings: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `isolatedDeclarations` (explicit public return types: a stable API, and declaration files that are fast to produce).
- Also `verbatimModuleSyntax` and `erasableSyntaxOnly`: sources and tests run directly through Node's type stripping, which requires type-only imports to say so, and Node 26 removed the transform of non-erasable syntax (`enum`, runtime `namespace`, parameter properties), so such syntax could never run there.
- Public types are tested in a consumer project with and without `exactOptionalPropertyTypes`.

**Type-cost budget**: an API with perfect types that badly slows down the type check of a large project is defective.

- A reference project, produced by a script (about 2,000 files), uses `Path<T>` and schema and form inference intensively.
- Measured by the verification gate through `--extendedDiagnostics`: check time, instantiations, memory, under TypeScript 6.0 and 7, with and without `exactOptionalPropertyTypes` ([ADR 0014](docs/adr/0014-type-cost-harness-and-typescript-6.md)). Instantiation counts are deterministic: they are recorded, and compared with a ceiling per public type and per compiler, since the two compilers count differently.
- At most +10 % check time compared to the same project without the library, judged under TypeScript 7 on the median of five interleaved passes, with the spread printed; the ceilings and the +10 % are hypotheses to calibrate by measurement. A regression blocks.
- Rules: bounded recursion; named interfaces rather than deep intersections; the number of generated paths is capped, with an explicit degradation beyond the cap.

**Type tests**: type-equality assertions in the style of `expectTypeOf`, and `@ts-expect-error` fixtures. Expected compile errors are tested, and their readability is reviewed.

## 9. Measurement: performance and Green IT

The energy consumed by a JavaScript function cannot be measured reliably. What is measured is the proxies that determine it: bytes transferred and parsed, CPU time, allocations and garbage collection, retained memory. Public communication is about these proxies, never about grams of CO₂.

### 9.1 Import budgets

Every import scenario of `bench/size/` is bundled for real, by esbuild and by Rollup, minified with `"sideEffects"` honoured, then measured raw, gzip and brotli. [docs/size-baseline.tsv](docs/size-baseline.tsv) records each figure, and a byte that moves fails the gate until the baseline is rewritten by a commit that explains the change ([ADR 0009](docs/adr/0009-size-harness-bundlers-and-references.md)). Reference libraries are measured by the same harness: es-toolkit (primitives), valibot (schemas), temporal-polyfill (the polyfill of ADR 0005), `@preact/signals-core` (reactive graph).

The budgets, in bytes minified and brotli-compressed under every bundler, live in one file, [bench/size/budgets.tsv](bench/size/budgets.tsv). Each is the tighter of the design's first hypothesis and one and a half times the reference for the same scenario; the temporal layer gets a tenth of the polyfill it sits on; the rules, the form and the adapters, which no library matches, keep their hypothesis until the pilot form is measured against the same form written with Angular Signal Forms alone ([ADR 0010](docs/adr/0010-import-size-budgets.md)).

Parse time and execution time at cold start are to be measured for the same scenarios.

A scenario's bundle holds code only from the packages the scenario imports and their declared dependencies, under both bundlers; in particular:

- `omit` pulls in nothing from `temporal`, `schema`, `rules`, `form` or the adapters;
- `@yaltaan/schema` pulls in neither `rules` nor `form`;
- an adapter pulls in no other adapter.

### 9.2 Benchmarks

- Tool: a harness written in the repository, with no dependency: samples of batched calls lasting at least 10 µs each, the empty loop timed in the same run and subtracted ([ADR 0017](docs/adr/0017-timed-benchmark-harness.md)). Runtimes: Node LTS, Bun, Deno; browsers through Playwright for the critical hot paths.
- Mandatory comparison: native / best reference library / Yaltaan.
- Seeded datasets: micro, realistic, pathological (deep, wide, very large).
- Published with: CPU, OS, runtime and version, command, dataset, warmup, iterations, dispersion (p50, p99, spread).
- Regression detection: shared machines are noisy, hence instruction counting. `scripts/perf-count.sh <A> <B>` counts one call of every scenario of `bench/perf/scenarios/` at both commits under Callgrind, with V8 made deterministic, and calls a change of more than 0.10 % of the instructions per call more or less work ([ADR 0016](docs/adr/0016-instruction-count-for-ab-decisions.md)). More work on a hot path is explained in the message of the commit that brings it, or fixed by a separate commit; above 5 % it blocks, unless a decision record documents it.
- Allocations: bytes allocated per operation on the hot paths (heap snapshots, `--trace-gc`).

### 9.3 Levers, in order

1. Not executing: early exit, lazy evaluation, short-circuit, targeted revalidation.
2. Not copying: structural sharing, iteration rather than materialization.
3. Not shipping: native-first, tree-shaking.
4. Bounding: caches, depths, sizes.
5. Only then, micro-optimization, measured before and after.

### 9.4 Rust and WebAssembly

Out of the plan. Reopened only by a decision record with: an optimized JavaScript reference benchmark, the cost of initialization and of memory transfer, the size impact, and a measurement on a real case, not only on a microbenchmark. The only plausible candidates: parsing or validating very large volumes, diffing very large datasets.

## 10. Quality

### 10.1 Shared adversarial catalogue

One catalogue, implemented as shared fast-check generators (`adversarial.*`) in the internal package `@yaltaan/testing` ([ADR 0013](docs/adr/0013-adversarial-catalogue-on-fast-check.md)):

| Category | Examples |
|---|---|
| Boundary values | empty, `null`, `undefined`, `NaN`, `±Infinity`, `-0`, `BigInt`, very large, very small |
| Structures | very deep, very wide, sparse arrays, cycles, aliasing (the same reference in several branches) |
| Hostile objects | frozen, sealed, non-extensible, null prototype, `__proto__` and `constructor` keys, getters that throw, Proxy |
| Unicode | combining characters, ZWJ sequences, right-to-left text, bidirectional controls, lone surrogates, invisible characters |
| Callbacks | that throw, that mutate the input, that mutate the collection during iteration |
| Async | already-aborted signal, abort just before or just after resolution, concurrency 0, 1 or very high, configuration change while running |

Each public export that runs (a function, a constant that can be called, a class) declares, in its test file, each of the six categories: a check run against every named case and against random ones, "N/A" with a reason, or "deferred" while the export is `@experimental`. The verification gate reads the declarations from the events of the test run and fails on an export without one, a declaration that names no export, a check that failed or did not run, and a `@stable` export that defers a category. "Every domain must test its adversarial cases" thus becomes checkable.

### 10.2 Properties

With fast-check, where applicable: idempotence, round trip, inverse, conservation, absence of mutation, determinism, stability, associativity, commutativity, monotonicity, consistency with the platform and between equivalent APIs. The invariants listed in §7 are tests, not intentions.

### 10.3 Race tests

Clock and scheduling are injectable; async interleavings are explored with fast-check's `fc.scheduler()`. A race that is found becomes a test, replayable from its seed.

### 10.4 Test matrix

| Level | Scope |
|---|---|
| Unit | Every public export |
| Properties and fuzzing | Domains with invariants, parsers, codecs, dates, schemas, paths, diff |
| Types | Inference, expected compile errors |
| Bundle | Import leaks, side effects, budgets |
| Type cost | Reference project |
| Benchmarks | Hot paths |
| Integration | Interactions between packages, vertical slice |
| Adapters | Angular and React, on real components |
| Non-regression | A fixed bug comes with a test in the same change |

### 10.5 Two levels of "done"

Requiring every criterion from a function's first day amounts to shipping nothing. Maximum rigour is required at promotion to stable.

| Criterion | `@experimental` | `@stable` |
|---|---|---|
| API, types, contract tags (§5.6) | yes | yes |
| Nominal and boundary tests | yes | yes |
| Bundle budget met | yes | yes |
| Adversarial categories declared (§10.1) | yes | yes |
| Adversarial categories tested | no | yes |
| Property tests | no | yes, if it has invariants |
| Benchmark | no | yes, if it is a hot path |
| Complete documentation, including "what it does not do" | no | yes |
| Used in a real case (vertical slice or pilot project) | no | yes |
| API review through a promotion decision record | no | yes |

An `@experimental` API can change in a minor version; a `@stable` API follows SemVer strictly.

## 11. Supply chain and publishing

- Zero third-party runtime dependencies in `core`, `temporal`, `schema`, `rules` and `form`: a package depends only on the packages below it in the graph (§6). The adapters also have peer dependencies on their framework.
- Lockfile under version control; no Git dependency; licence check; vulnerability scan; secret detection.
- The repository's `.npmrc` enforces part of this at install time: no dependency lifecycle script runs, versions are saved exactly, nothing is installed from Git, and a version published less than seven days ago is never picked.
- Publishing through trusted publishing (OIDC) with npm provenance; an SBOM with every release; two-factor authentication mandatory.
- CI runs `publint` and `arethetypeswrong`, and inspects the actual content of the published tarball.
- No `postinstall` script, no telemetry, no network call.

## 12. Decisions, contributions and plan

- Decisions are recorded in `docs/adr/`, one record per decision; [docs/adr/README.md](docs/adr/README.md) lists when a record is required (among others: a change to a cross-cutting contract of §5, reopening WebAssembly, §9.4, a promotion to stable, §10.5) and gives its format.
- CONTRIBUTING.md describes how to propose, verify and record a change.
- ROADMAP.md holds the plan: the vertical slice comes first, so that the contracts of §5 are validated end to end on a real form before they are frozen; the domains widen afterwards.

## 13. Priorities in case of conflict

1. Correctness and data integrity.
2. Security.
3. Determinism and clarity of contracts.
4. Compatibility of the public API.
5. Frugality (bytes shipped, CPU, memory).
6. Simplicity of the code.
7. Measured raw performance.
8. Ergonomics of the API.

Simplicity comes before raw performance: a gain of a few percent that makes the code hard to maintain will be lost at the next refactoring. Frugality stays above both, because most of its gains come from structural decisions (native-first, tree-shaking, targeted evaluation), not from micro-optimizations.

An optimization can never make a behaviour ambiguous or incorrect.
