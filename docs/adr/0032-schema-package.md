# ADR 0032 — `@yaltaan/schema`: a minimal Standard Schema engine

- Date: 2026-11-01
- Status: accepted (design choices delegated by the owner; the first schema API, `@experimental` until the contracts are frozen)

## Context

ARCHITECTURE.md §6 and §7.9 place schemas in a package of their own, above `core`; the graph, the budgets and the release workflow already expect it. A new package needs a record (docs/adr/README.md). The first version must carry a real login form inside its budget of 1 500 bytes (ADR 0010), be consumed by Angular Signal Forms and TanStack Form without a bridge, and speak `Result`, `Issue` and `Path`. Its judges are in place (ADR 0031).

Three things §7.9 leaves open must be settled now, since every later schema inherits them: what the message of a Standard Schema issue says when the library writes no message (§5.2); what counts as an object; and what the login scenario may use, since its reference checks an email and a length, and the combinators of this first version do not include refinements.

## Options

1. **Native, or do nothing.** No schema: applications keep the checks they write by hand, and `rules` and `form` take only foreign schemas (§5.4 allows it). Rejected: this is the vertical slice's next layer, and without it the pilot has no issues with our codes.
2. **Refinements now**, a `pipe` and validators as functions, as valibot does. Rejected for this version: T5.1 brings refinements, and a `pipe` in the minimal engine costs more bytes than a login needs.
3. **Bounds as options of the schema they bound.** `string({ minLength, maxLength, pattern })`, `number({ min, max, integer })`, `array(element, { minLength, maxLength })`, the names of HTML's constraint attributes. Kept: they cover every `schema.*` code the pilot names, and the login scenario does the same work as its reference.

For an object:

1. **Any object, read through `in`**, as valibot does: an array, a `Date` or a `Map` passes `object({})` and loses its content; a key is read through the prototype, so that `Object.prototype.isAdmin = true`, written by any other bug, satisfies `object({ isAdmin: literal(true) })`.
2. **Own keys of a plain object**, the same `isRecord` as `@yaltaan/core/object`: an object whose prototype is `Object.prototype` or `null`. Kept. A class instance is refused rather than silently flattened.

For the message:

1. **An English default.** Rejected by §5.2: the library writes no message.
2. **The code as the message**, and `withMessages(schema, format)` to give the application's words to the one schema an engine reads. Kept: an engine always has a non-empty, stable string, and the words stay with the application.
3. **`libraryOptions.format`.** Kept out: the engines call `validate` with no options, so it would never be read.

## Measurements

On 2026-11-01, Ubuntu 26.04 x64, Node 24.21.0, by `node scripts/size-report.ts`: see the commit that adds the scenario `yaltaan/schema-login` and the baseline it writes. The reference: valibot 1.5.0, 1 285 / 1 254 bytes brotli (esbuild / Rollup); the budget, 1 500 bytes.

A reviewer given only the question and the code, and told to look for reasons to refuse, refused the first version as a reader of untrusted input. Before and after (`--max-old-space-size=2048`, a 2 GB heap): `array(object(20 strings))` on 2.9 MB of `[{},{},…]` aborted the process, which no `catch` can stop, and now gives 1,001 issues; `array(number(), { maxLength: 10 })` on one element at index 4 294 967 294 aborted it too, and now answers at once. The issue limit and the array limit come from that review, in this version and not in T5.5, whose planned 1,000,000 elements would have let the first input through; so do the required `maxLength`, the data property, the refusal of a literal `__proto__` and a law over what the judge's differences leave out, after 12 of its 13 aimed mutants passed every test.

## Decision

- **Package**: `@yaltaan/schema`, one entry point, a dependency on `@yaltaan/core` at the exact version of the workspace, and nothing else. Tree-shaking is by function: nothing runs on import.
- **API**: `string`, `number`, `literal`, `optional`, `nullable`, `array`, `object`, `discriminatedUnion`, `parse` (a `Result` of the output or of every issue), `withMessages`; `InferInput` and `InferOutput`. Every schema implements `~standard`, version 1, vendor `yaltaan`, synchronously; the interface's types are copied.
- **Absence, `undefined` and `null` are three states.** A key that is absent fails with `schema.missing` unless its schema is `optional`; `optional` also takes an explicit `undefined`, unless `{ exactOptional: true }`; `nullable` takes `null`. `nullable(optional(x))` still requires the key, as in valibot: the two states are stated one by one.
- **A failed read reports everything it can, within limits an input cannot move**: every field and every element, each with its own issue, up to 1,000 issues, then `schema.too_many_issues` and the walk stops. An array over `maxLength`, 1,000,000 by default, gets that one issue, and no element is read; `minLength` is checked after the elements. `pattern` requires `maxLength` (a `TypeError` and a type error) and is not tested on a text over it: a pattern that backtracks quadratically stays cheap, and one that backtracks exponentially stays the application's to avoid.
- **`number()` takes finite numbers only**, as Zod 4 does and valibot does not: JSON cannot carry an infinity, and an infinite amount is a defect in every form we have seen.
- **Literals** are strings, numbers, booleans and `null`, compared by `===`; `NaN` is refused when the schema is built, since it could never match, and a bigint since no schema of numbers reads one and an issue that holds one cannot be written as JSON.
- **`__proto__`, `constructor` and `prototype`**, the keys the `Path` contract refuses on a write, cannot be declared (a `TypeError` when the schema is built, an `entries` object whose prototype was set by `{ __proto__: x }` included), and `passthrough` never copies them among the keys of the object it reads (ADR 0008). A value `passthrough` keeps is not walked: what it holds is its own, and it is shared with the input. Every container a schema declares is fresh, and a name the prototype holds is written as a data property, so that a setter planted on `Object.prototype` takes nothing, and a frozen one makes nothing throw.
- **A bad argument is a bug**: an entry that is not a schema, a bound that is not a number, `min` over `max`, a `pattern` with the `g` or `y` flag (its `lastIndex` would break determinism), two options of a union with the same literal: `TypeError` when the schema is built. An input throws only what its own getters or proxy traps throw.
- **Codes**: `schema.invalid_type`, `schema.invalid_value`, `schema.missing`, `schema.unknown_key`, `schema.too_short`, `schema.too_long`, `schema.too_small`, `schema.too_large`, `schema.not_integer`, `schema.invalid_format`, `schema.too_many_issues`, in `docs/issue-codes/schema.md`. String lengths count UTF-16 code units, as HTML's `maxlength` and every engine do; `graphemeLength` of `core` remains for what a reader sees.
- **The other limits** wait for T5.5, which also makes these two options of a read: this version has no recursion (`lazy` comes with T5.1), so its depth is that of the schema; its time is linear in the input; what a failing read holds is bounded by the 1,000 issues.

## Consequences

- `@yaltaan/schema` is a second published package: `release.ts` and the rehearsal pick it up by themselves, and its name must exist on npm before its first release, like `core`'s (ADR 0029).
- A class instance, or a plain object of another realm (an `iframe`, `vm`), must be read through a plain copy; an array of another realm passes `Array.isArray` and is read. The differences from valibot are written in the module's header and checked by the judge.
- A field named like a member of `Object.prototype` and left out reads as that member on the output: `object({ toString: optional(string()) })` on `{}` gives an object whose `toString` is the inherited function, though its type says `string | undefined`. A hole of an array reads through `Array.prototype`. Both come with plain objects and arrays, and neither lets an unchecked value in unless the prototype was polluted first.
- A message in an engine reads `schema.too_short` until the application calls `withMessages`.
- The API is `@experimental`: bounds as options may give way to refinements when T5.1 measures them.

## Review condition

T5.1's refinements cost less than the options on the login scenario; the pilot (T2.6) needs a class instance read directly; an engine turns out to pass `libraryOptions`; the login scenario leaves its budget.
