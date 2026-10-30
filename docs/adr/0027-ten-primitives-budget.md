# ADR 0027 — The ten-primitives budget, measured

- Date: 2026-10-30
- Status: proposed — recommendation, awaiting the owner

## Context

ADR 0010 set the budget of ten core primitives to 1 000 B, minified and brotli-compressed, from one and a half times es-toolkit's 661 B, before any of them existed. Its review condition is a budget that blocks a function whose checks a contract of ARCHITECTURE.md §5 requires, measured. The scenario exists now that `clamp` does, and it weighs half as much again as its budget. ADR 0021 already warned that deep `pick` and `omit` weigh about 630 B together.

The scenario holds the same ten functions as es-toolkit's, `paginate` standing for `chunk` (ADR 0025 judges the pages of `paginate` against `chunk`) until a `chunk` of the library exists.

## Options

1. **Keep 1 000 B.** The gate refuses the scenario, so it cannot be recorded; meeting the budget means removing about 470 B of checks that accepted records decided: the `Result` and the `Issue` of `indexBy` (§5.1, §5.2), keys held in a `Map` (ADR 0024), masks at every depth (ADR 0021), the explicit array strategy of `merge` (decided with T3.1 b), the type and range checks of `clamp` (ADR 0026, §5.7).
2. **The measured size, rounded up to ten bytes: 1 480 B.** The budget becomes a ceiling at today's figure: any growth needs a record, and the size baseline already shows every byte that moves. A size pass looks for what can go without a decided behaviour.
3. **A budget per function, or a scenario without the costly functions.** More numbers to keep, and a scenario that no longer matches the reference loses the comparison it exists for.

## Measurements

`node scripts/size-report.ts` and the same harness on each export alone, esbuild / Rollup, 2026-10-30:

| Part | Yaltaan | es-toolkit |
|---|---|---|
| The ten | 1 472 / 1 466 B | 657 / 661 B |
| `pick`, `omit`, `merge`, `mapValues` together | 818 / 804 B | `pick` 110, `omit` 90, `merge` 278, `mapValues` 105 B alone |
| `partition`, `indexBy`, `countBy`, `uniqueBy`, `paginate` together | 649 / 656 B | `partition` 103, `keyBy` 96, `countBy` 101, `uniqBy` 122, `chunk` 165 B alone |
| `clamp` alone | 228 / 229 B, 270 / 272 B before the review below | 82 / 84 B |

Alone, `omit` weighs 531 B and `pick` 517 B (masks at every depth, the refusal of `__proto__`, arrays walked element by element), `merge` 523 B, `mapValues` 377 B, `uniqueBy` 263 B, `paginate` 267 B, `indexBy` 236 B. Shared code (the copy helpers, `ok` and `err`) makes the ten 1 472 B instead of the sum.

A contradictor, given the question and the code without this record, measured each function's share of the bundle (esbuild): `clamp` 178 B, `paginate` 166, `merge` 146, `uniqueBy` 137, `indexBy` 100, `omit` 65, `pick` 58, `mapValues` 56, `partition` 37, `countBy` 27; shortening every error message to one character would save only 76 B. It refused 1 510 B before the savings that change no behaviour were taken, and put them near 1 440 B: a shorter `clamp` with the same errors (taken here: shorter messages, `Infinity` for `Number.POSITIVE_INFINITY`, no array of the two bounds, 1 509 → 1 472 B), then `propertyIsEnumerable` read once in `object` (−8 B) and `${x}` for `${String(x)}` (−4 B), left to the size pass. It agrees that about 440 B are decided behaviour, and notes that es-toolkit's ten do less work (keys as a list for `pick` and `omit`, bare chunks): the reference gives a ratio, not a judge.

## Decision

Option 2, as a recommendation: the budget of `yaltaan/core-ten-primitives` becomes 1 480 B, the larger figure rounded up to ten bytes, with es-toolkit's ten as its basis still. The bytes over es-toolkit are the decided behaviours listed above, not slack. A size pass (ROADMAP.md T7.6) looks for bytes that no decision requires, before the first stable version, and lowers this budget to what it measures.

Until the owner rules, the budget line is applied, since it changes no published byte and is undone by one line of `bench/size/budgets.tsv`.

## Consequences

- An application that imports these ten functions ships 1.5 kB brotli, about 2.2 times es-toolkit's, for strict checks, `Result` failures, deep masks and `Map` results.
- The promise of ARCHITECTURE.md §9.1, one and a half times the reference, no longer holds for this scenario: its figure is the decided behaviours' cost.

## Review condition

A `chunk` of the library, which replaces `paginate` in the scenario; the size pass of T7.6; a refusal by the owner, which reopens option 1 with the list of behaviours to remove.
