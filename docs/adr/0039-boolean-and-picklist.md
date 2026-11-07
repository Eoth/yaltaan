# ADR 0039 — `boolean` and `picklist` in the minimal schema

- Date: 2026-11-07
- Status: accepted (design choices delegated by the owner; `@experimental` until the contracts are frozen)

## Context

ADR 0032 gave `@yaltaan/schema` the bounds that cover every `schema.*` code the pilot form names. Writing the pilot with it (T2.1 b) shows what that count left out: a field must have a schema even when no scenario expects an issue on it. The pilot has six checkboxes and ten fields chosen from a list (country, legal form, roles, payment term, currency, category, VAT rate, document kind…). Without a schema of booleans, an object that holds a checkbox can only be read with `unknownKeys: 'passthrough'`, which keeps every key unchecked, the `__proto__` of the hostile scenario included. Without a choice among values, a select becomes a `string` with a `pattern`, whose issue says `schema.invalid_format` where the value is simply not an option.

T5.1 a plans `union`, which would make a choice out of literals; it comes after the go/no-go of `form` (T2.7), and the pilot is what that decision is measured on.

## Options

1. **Native, or do nothing.** The pilot reads checkboxes through `passthrough` and choices through patterns. Rejected: the hostile scenario fails, and the measurements of T2.6 would count a workaround no application should write.
2. **`union` now**, and a choice as `union([literal('EUR'), literal('USD')])`. Rejected for now: a general union must say which option's issues it reports, a question for T5.1 a; a choice needs none of it.
3. **`boolean()` and `picklist(options)`**, valibot's names, each a leaf of a few lines. Kept. A value outside the options is `schema.invalid_value` with the options as `expected`, as for a literal; a value that is not a boolean is `schema.invalid_type` with `expected: 'boolean'`.

## Measurements

On 2026-11-07, Ubuntu 26.04 x64, Node 26: the judge against valibot 1.5.0 draws both new shapes as leaves, at every depth; a `boolean` that takes `0` fails 2 tests, a `picklist` that takes `'10'` for `10` fails 6. Import sizes: unchanged for every scenario that does not import them, the functions being dropped by tree-shaking (see the commit that adds them).

## Decision

- `boolean()`: `true` and `false` only; never `0`, `'true'` or a `Boolean` object.
- `picklist(options)`: options are distinct strings or finite numbers, compared by `===` (so `0` and `-0` are one option, and two such options are refused when the schema is built); booleans and `null` are left to `boolean` and `literal`. A read gives back what it read.
- `schema.invalid_type` may now name `boolean`; `schema.invalid_value` lists the options of a picklist.

## Consequences

- The pilot's checkboxes and selects are read by the schema, with issues at their own paths, and its unknown keys are dropped.
- Two more exports judged against valibot, and two more defects the judge must refuse.

## Review condition

T5.1 a's `union` makes `picklist` a shorthand that costs more than it saves, or an engine needs a choice of booleans or `null`.
