# ADR 0034 — `@yaltaan/rules`: rules across fields, on any schema and any engine

- Date: 2026-11-02
- Status: accepted (design choices delegated by the owner; the first rules API, `@experimental` until the contracts are frozen; the budget of 1,550 bytes is signalled to the owner and undone by one line)

## Context

ARCHITECTURE.md §6 and §7.10 place rules in a package of their own, above `schema`: declarative, pure, each declaring what it reads and where it marks, a required field derived and never written, usable as a Standard Schema refinement. A new package needs a record. §7.10 leaves open what the first version must settle, since every later rule inherits it: what a blank field is, how a rule reaches the elements of a list, how a condition says what it reads, how an application writes a rule of its own, and how "in test mode, the actual reads are traced" is reached.

The ticket asks for "the five rules the pilot requires". The pilot, written since, requires seven: of its 23 relational rules, `required_if` 11, `ordered` 5, `unique` 2, `at_least` 2, `exactly`, `all_or_none` and `mutually_exclusive` 1 each. Its scenarios cannot be green on five, and `atMost` is the only one of §7.10's eight it never uses.

## Options

1. **Native, or do nothing.** No rules: an application keeps `if` statements after its schema, and the differentiator of §2 does not exist. Rejected.
2. **Five rules, as written.** The three that are one line each from `atLeast` would wait for T5.6, which comes after the pilot they are needed for. Rejected: seven.

For the elements of a list:

1. **A wildcard in every path of every rule.** `requiredIf(cond, [['products', '*', 'rate']])`. Each rule must then walk lists, and pair the elements its condition read with the ones it marks. Rejected.
2. **`each(list, rules, { identity })`.** The rules inside see one element as their values, and their paths are relative to it. Every rule stays simple, lists nest, and an issue comes back with the element's path in front. `anyElement`, a `{ key }` segment without a key, says "every element" in what a rule declares, so that a declared path stays a `Path`. Kept.

For what a callback receives:

1. **The whole values, or a whole element, with `reads` beside it**, the `keyFn` of §7.10. `reads` and the code can disagree, and only a test would say so; a row a user has just added makes `contact.email.toLowerCase()` throw inside a validator. Written first, and refused by the review below.
2. **Only the value of a declared path, never a blank one, typed `unknown`.** `{ reads, when }` for a condition, which alone meets a blank, since absent is an answer there; `unique(list, at, { by })`; `{ list, at, where }` for a count; `compare` for `ordered`. A built-in rule cannot read what it does not declare, a blank cannot reach a callback, and an annotation such as `(iban: string)`, which promises what a form does not hold, does not compile. Kept: `unique(arrayPath, atPath)` replaces §7.10's `unique(arrayPath, keyFn)`.

For the test mode:

1. **A global switch, or `NODE_ENV`.** A hidden state in a package that promises none, and a branch in every read. Rejected.
2. **`assertDeclaredReads(rule, values)`**, a function a test calls: it runs the rule on a view of the values that notes each read and refuses each write. Nothing is paid unless it is called, and a bundler drops it. Kept.

For what `ordered` does with two values it cannot compare:

1. **Nothing**, as "another rule's to say". Written first, and refused by the review: dates given in the wrong order passed, in silence.
2. **The issue.** A rule that cannot tell does not pass. Kept, with dates and bigints ordered. A number against a bigint is such a pair, though `<` could order it: a form holds one type per field.

## Measurements

On 2026-11-02, Ubuntu 26.04 x64, Node 24.21.0, under load from other work.

**Size**, `node scripts/size-report.ts`, scenario `yaltaan/rules-five` (`requiredIf`, `allOrNone`, `atLeast` over a list, `unique`, `ordered`, `checkRules`): 1,533 / 1,548 bytes brotli (esbuild / Rollup), of which 120 to 172 are the scenario's own code. The first version weighed 1,402 / 1,414, 1,329 / 1,342 once shorter, and the fixes of the review brought it here. The whole package: 2,238 / 2,267. No library does this, so no reference exists. The hypothesis of ADR 0010 was 1,000 bytes: reaching it means dropping limits or declarations the contracts require. Reading a value through `get` of `@yaltaan/core/object` instead of the eight lines of `readPath` weighed 1,740 / 1,747 against 1,341 / 1,352 at the time, and allocates a `Result` per read: refused, for the same own keys.

**Judges.** The pilot's scenarios, fixed as data before this package had a line: 23 rules of `rules.*` codes, 42 scenarios, every expected issue and no other (`packages/rules/src/pilot.test.ts`). Angular Signal Forms 22.2.4 and TanStack Form 1.33.5, reading `refine` of a schema of ours, with no bridge: each issue on its field (`bash tests/interop/run.sh`, outside the gate). Angular has no node for a field its model leaves out, so an application holds an empty string there, which a rule reads as blank. A table of every field filled or blank, for every count, for the four rules over a group.

**Mutations by hand**: 162 on `index.ts`, all caught, each run with fast-check's shrinking off and under a 150 s limit, with an unmutated control that stays green. The first campaign read 122 of 122, with a control that failed: a relative import broke in the copies, and every run was red. Corrected, 25 survived: a bound never met exactly, equal values the laws rarely draw, a read by `Reflect.ownKeys` alone, a cap masked by another, and three pieces of dead code, removed. Each now has its test.

**Performance**: not measured. No competitor runs these rules, and no scenario of `bench/perf/` holds them; the pilot's measurements (T2.6) will.

**A reviewer** given only the question and the code, and told to look for reasons to refuse, refused the first version, 16 of 32 of its aimed mutants passing every test. Before and after:

- `unique` was quadratic: V8 hashes a string over 16,383 code units by its length alone, so that same-length keys all collide in a `Map`. A 204 MB body killed at 110 s now takes 442 ms, keys being compared on their first 16,000 code units. `uniqueBy` and `indexBy` of `core` have the same defect (T3.13).
- `c => c.email.toLowerCase()` threw on a row just added: see the options above.
- Dates in the wrong order passed: see the options above.
- `resolveKey` received no value, so that two reads under way at once could answer for each other: it now receives the value of its read.
- A shared empty array could be poisoned through what one check returned; `assertDeclaredReads` let a write through a descriptor, compared two reads of one field as different, and refused a frozen list; a list and its length were read more than once, so that a getter walked past the limit; a warning blocked a valid value and could crowd out an error; a thenable could make `validate` answer `undefined`. All fixed, each with its test.

Its second pass on the corrected version refused on two points, both then fixed and tested, which it has not read since: a blank answer of `by` was compared, and warnings filled the limit of errors.

## Decision

- **Package**: `@yaltaan/rules`, one entry point, declaring both `@yaltaan/core` (`Path`, `Issue`, `toStandardIssue`) and `@yaltaan/schema` (the type `StandardSchema` only: no byte of it at run time), at the exact version of the workspace, and nothing else. `refine` takes any Standard Schema (§5.4).
- **A rule is a plain object**, `{ reads, targets, check, required? }`, which an application can write. `check` returns issues, and holds no state.
- **The rules**: `requiredIf`, `allOrNone`, `atLeast`, `exactly`, `mutuallyExclusive`, `unique`, `ordered`, and the walk `each`; `checkRules`, `requiredPaths`, `refine`, `assertDeclaredReads`.
- **Blank** is `undefined`, `null`, an empty string or an empty array. `0` and `false` are values, a string of spaces is a value (a schema trims it), an absent key is blank, and a key is read only if it is the object's own: `toString` is not a field unless the object has its own.
- **Who gets the issue**: `requiredIf` and `allOrNone`, each blank field; `atLeast`, each blank field, since any of them would do; `exactly`, each blank one under the count, each filled one over it; `mutuallyExclusive`, each filled one; a count over a list, the list; `unique`, every element that shares a key; `ordered`, the end. A field is required, by `requiredPaths`, only when the rule cannot hold without it: `atLeast(1, [a, b])` requires neither.
- **`unique`** compares by SameValueZero, a string on its first 16,000 code units; a blank is not compared, before or after `by`.
- **An element's name in a path** is `{ key }` when `identity` names the field that holds its stable key, so that an issue follows it when the list is reordered, and its index when that field is absent or blank. At the Standard Schema boundary, `refine` applies `toStandardIssue`: an index passes, a `{ key }` needs `resolveKey`, or the issue stops at the list.
- **`refine`** runs the rules only on a value the schema accepted, and is asynchronous when the schema is. The message of an issue is its code, unless `format` says otherwise, as in ADR 0032. A `warning` stays out: it blocks nothing, and the interface has no other kind of issue.
- **Limits**: 1,000 errors, then `rules.too_many_issues` at the root and the walk stops; the first 1,000 warnings, which end nothing; 1,000 required paths; a list over 1,000,000 elements gets `rules.too_large`, none of its elements read. A list and its length are read once. No recursion on data: the depth is that of the rules.
- **The budget** of `yaltaan/rules-five` goes from its hypothesis of 1,000 bytes to the measured 1,550, rounded up to ten, until the pilot is measured (T2.6). Undone by one line of `bench/size/budgets.tsv`.
- **Codes**: `rules.required_if`, `rules.all_or_none`, `rules.at_least`, `rules.exactly`, `rules.mutually_exclusive`, `rules.unique`, `rules.ordered`, `rules.too_large`, `rules.too_many_issues`, in `docs/issue-codes/rules.md`.
- **The build order**: `scripts/build.sh` builds a package after the packages it declares, read from the manifests, since `rules` would otherwise compile before `schema`, whose declarations it reads.

## Consequences

- `@yaltaan/rules` is a third published package: `release.ts`, the graph and the rehearsal pick it up. Its SBOM lists both its dependencies, which it declares, so `writeSbom` unpacks both.
- Three rules of the pilot need what no built-in gives: `first-tier-above-minimum` (the first element of a list against a field of the element around it) and `tiers-increasing`, `discounts-increasing` (each element against the one before it), and `kbis-for-france` is conditional. They are written as an application writes them, in `packages/rules/src/pilot.test.ts`, as `Rule`s of 5 to 15 lines. T5.6 decides, with `when`, whether a built-in earns its bytes.
- What the judges do not see: `assertDeclaredReads` sees one run, so that a branch the values do not take, what a closure reads, the inside of a `Date`, a `Map` or a class instance, and a decision on a value a declared path only goes through are not seen, and two paths to one object compare as different under it. The pilot's scenarios hold full shapes; a law breaks them field by field, with no throw, and judges nothing of what comes out. The real engines run outside the gate.
- Costs an input can still reach: a value that shares one list many times multiplies a nested `each`, which `JSON.parse` cannot build, and neither can a request. A `resolveKey` by `findIndex` costs up to 1,000 walks of the list (35 MB of JSON: 6.8 s against 334 ms): an application with long lists builds its index once.
- Two keys that share their first 16,000 code units are the same key. Two elements with the same `identity` have the same path, and a `findIndex` gives both the first index: `unique` on that field is how a form says so.
- `atLeast` is monotonic but for one case: a list that passes the limit of 1,000,000 elements goes from no issue to `rules.too_large`.
- A list element is named by a value of the input: `{ key }` holds whatever the input's field holds. It goes into an issue's path and nowhere else.
- `requiredPaths` stops at 1,000 paths and says nothing: it is what a form shows, and `checkRules` decides.

## Review condition

The pilot's executable scenarios (T2.1 b) needing a built-in these do not give; T2.6 measuring a budget this leaves; an engine that keeps a `{ key }` rather than an index; `when` (T5.6) replacing the custom rules above; a JavaScript engine that hashes differently from V8 at 16,000 code units.
