# ADR 0021 — Field masks: how pick, omit, redact and equal name the fields they select

- Date: 2026-10-25
- Status: accepted

## Context

ARCHITECTURE.md §7.1 lists `pick`, `omit` and `redact`; comparing a form value with its saved copy while ignoring `updatedAt`, or comparing only the fields a screen shows, needs the same thing from `equal` (§7.5). All four name fields of a value, often nested (`address.geo`) or inside the elements of an array (`lines[*].id`). Applications type their values, so the compiler can check those names: a field renamed in the model should break the build, not silently stop being ignored by a comparison or start leaking into a log. Three questions:

1. How a selection is written.
2. How far a misspelt field is caught.
3. What a deep selection may weigh, against the 150 B budget calibrated on es-toolkit's shallow `omit` (ADR 0010).

## Options

### Writing a selection

1. **Do nothing: arrays of keys, one level (es-toolkit, `omit(x, ['a', 'b'])`).** Smallest; nested fields need one call per level, and `equal` gains nothing.
2. **Text paths (`'address.geo'`, `'lines[].id'`, lodash, AssertJ `ignoringFields`).** A path grammar per call, a template-literal type of every path of `T`, whose count grows with the model (ARCHITECTURE.md §8 caps generated paths), and a second text form beside `Path` (§5.3).
3. **A mask: a literal shaped like the value (`{ password: true, address: { geo: true } }`), the form of Zod's and Prisma's `pick`/`omit`/`select`.** `true` takes a field whole, a nested mask walks into it, a mask on an array applies to each element. Its type is a mapped type of `T`, expanded only where the literal goes: no union of paths, editors complete each level.

### Catching a misspelt field

1. **A constraint (`M extends Mask<T>`).** Catches a mask whose keys are all wrong; a wrong key beside a right one passes, since a literal inferred as its own type is no longer checked for excess keys.
2. **A constraint plus a check of each key of the literal against `T` (`mask: M & Exact<M, T>`).** A wrong key becomes `never`, at any depth, through arrays, `null`, `undefined` and unions; the literal keeps its exact type, from which the result type is computed.
3. **For `equal`, no inference at all: `omit?: Mask<T>`.** Its answer is a boolean, so the mask needs no type of its own and the compiler's excess-key check applies as written.

### Size

1. **Keep 150 B.** Only a shallow omit fits; no deep selection.
2. **One and a half times a deep reference (ADR 0010's rule).** es-toolkit's `compat` omit, the one that walks nested paths, weighs 2 741 B: a budget of 4 110 B would stop nothing.
3. **The measurement of the deep omit, rounded up with a margin for the fixes still to come.**

## Measurements

On 2026-10-25, TypeScript 7.0.2, `strict` and `exactOptionalPropertyTypes`, a model with nested records, an array of records and a date:

| Mask | Constraint only | Constraint and key check | `Mask<T>` without inference |
|---|---|---|---|
| `{ passwrd: true }` | error | error | error |
| `{ passwrd: true, name: true }` | accepted | error | error |
| `{ address: { cty: true, city: true } }` | accepted | error | error |
| `{ since: { getTime: true } }` (a `Date`) | error | error | error |

Size, minified and brotli-compressed, the larger of esbuild and Rollup (`node scripts/size-report.ts`, and esbuild alone for es-toolkit's `compat` and `pick`): es-toolkit `omit` 90 B, `pick` 110 B; es-toolkit `compat` `omit` 2 741 B, `compat` `pick` 1 455 B; Yaltaan `omit` 547 B (532 B once the error messages were shortened), `pick` 521 B, `pick`, `omit` and `redact` together 631 B. `equal` grows from 948 B to 1 303 B with both masks, its walk without masks kept apart so that it does no more work (see its commit). A shorter safe write of a `"__proto__"` key saved 8 B and was refused for readability.

## Decision

- Writing: option 3, one type `Mask<T>` exported by `@yaltaan/core/object` and used by every function that selects fields. Records (prototype `Object.prototype` or `null`) and arrays of prototype `Array.prototype` are walked; any other value is taken whole, and its mask type is `never` for dates, regular expressions, functions and built-ins with a `Symbol.toStringTag`. On a value of type `unknown`, any key goes (`UntypedMask`). Entries are `true` or a nested mask; `false` and other values are a `TypeError`, and only own enumerable entries count. A mask may refer to itself to walk a tree.
- Misspelt fields: option 2 for `pick`, `omit` and `redact`; option 3 for `equal`, through `EqualMasks<T>` beside the unchanged `EqualOptions`, checked against the type of the first value only (`NoInfer`), so a constant typed `EqualOptions` is still accepted.
- `equal` takes `pick` or `omit`, never both. Its memory of pairs is kept per mask: a pair equal under one mask may differ under another.
- `redact` writes `'***'` by default, a marker in no language, since the library writes no message, or the `replacement` the caller gives.
- Size: option 3. The budget of `yaltaan/core-omit` becomes 600 B, basis `references/es-toolkit-compat-omit`, a scenario added to keep the deep reference measured; `equal` stays within its 1 750 B.

## Consequences

- Users write one shape for four functions, and the schema and form packages can take the same masks later.
- The result types of `pick`, `omit` and `redact` are exact for a literal mask; a mask typed wider (a variable of type `Mask<T>`) gives a result typed as the input, since which fields it drops is known at run time only.
- The ten-primitives budget (1 000 B, ADR 0010) assumed shallow `pick` and `omit`: the two now weigh about 630 B together, so the budget will be measured again when its scenario exists.
- A mask that refers to itself, on a value that is cyclic or deeper than the call stack, ends with the engine's `RangeError` in `pick`, `omit` and `redact`; `equal` walks with its own stack and ends on cycles.

## Review condition

A model whose masks cost more type-check time than the budget of ARCHITECTURE.md §8 allows; a need to select fields inside `Map` values; a measurement showing that the shared walk can fit a smaller budget.
