# ADR 0010 — Import size budgets

- Date: 2026-10-12
- Status: accepted

## Context

ARCHITECTURE.md §9.1 listed import budgets as hypotheses, to be calibrated against es-toolkit, valibot and temporal-polyfill in the same harness. The harness of ADR 0009 now measures real bundles of reference scenarios with esbuild and Rollup. A budget is a stop condition: a change that exceeds it stops and is reported, and only a new decision record raises it. Too loose, it never stops anything; too tight, it is raised at every change and stops meaning anything.

The library does not try to beat es-toolkit or valibot on an isolated function (ARCHITECTURE.md §2): its functions carry checks the references skip (only plain objects traversed, own enumerable string keys, dangerous keys refused, codes and paths on every issue). A budget therefore leaves room for those checks while staying in the size class of the best reference.

## Options

1. **Do nothing: keep the hypotheses.** No work, but a budget of 300 B for `omit` is three times what es-toolkit ships, and 1.5 kB for ten primitives more than twice: they would never stop anything.
2. **The reference's size as budget.** The tightest reading of "match the reference", but it leaves no room for the checks the library adds by design, so every primitive would need a decision record to exist.
3. **The tighter of the hypothesis and one and a half times the reference.** Keeps each budget in the reference's size class with room for the added checks, and never loosens a target the design already set.

## Measurements

Reference scenarios of `bench/size/references/`, minified and brotli-compressed, the larger of the esbuild and Rollup figures, from the size baseline of 2026-10-12 (versions pinned in package.json, figures recut by bundlejs.com, ADR 0009):

| Scenario | Reference | Hypothesis | 1.5 × reference | Budget |
|---|---|---|---|---|
| One core primitive (`omit`) | es-toolkit 97 B | 300 B | 150 B | **150 B** |
| Ten core primitives | es-toolkit 661 B | 1 500 B | 1 000 B | **1 000 B** |
| Reactive graph | `@preact/signals-core` 1 562 B | 1 000 B | 2 350 B | **1 000 B** |
| Login form schema | valibot 1 285 B | 1 500 B | 1 930 B | **1 500 B** |
| Temporal layer (an interval and a declared-format parser) | temporal-polyfill 17 876 B | none | — | **1 790 B**, a tenth of the polyfill |
| Five rules | none | 1 000 B | — | **1 000 B**, hypothesis |
| `form`, `rules` and `schema` on a realistic form | none | 7 000 B | — | **7 000 B**, hypothesis |
| Angular adapter, React adapter (framework excluded) | none | 1 500 B | — | **1 500 B** each, hypothesis |

The ten primitives are the same functions on both sides: `chunk`, `clamp`, `countBy`, `indexBy` (es-toolkit's `keyBy`), `mapValues`, `merge`, `omit`, `partition`, `pick`, `uniqueBy` (es-toolkit's `uniqBy`). The reactive budget stays at the hypothesis, below both measured libraries (alien-signals 3.2.1 weighs 1 644 B): cycle detection at construction (ARCHITECTURE.md §5.5) means a node's dependencies are known when it is built, so the graph needs no automatic dependency tracking, which both libraries implement; the module that implements the graph confirms or refutes the hypothesis by measurement.

## Decision

Option 3. Each budget is the smaller of the design's hypothesis and one and a half times the reference's larger figure, rounded up to ten bytes. The temporal layer, which no library matches, gets a tenth of the polyfill it sits on: on a platform without Temporal the layer must stay an order of magnitude below what the application already pays. The scenarios without a reference keep their hypothesis until the pilot form of the vertical slice is measured against the same form written with Angular Signal Forms alone, which calibrates them.

The budgets live in one file, `bench/size/budgets.tsv`, from which the size report enforces them on every bundler; ARCHITECTURE.md §9.1 points to it instead of listing them.

## Consequences

- Every scenario under `bench/size/yaltaan/` needs a budget row, and a budget row names a reference scenario that exists, or says `hypothesis`. A row whose scenario does not exist yet waits for it and is listed by the report.
- A module that exceeds its budget stops its change: shrink it, or write the decision record that raises the budget with the measurement behind it.
- A reference that grows or shrinks does not move a budget: the baseline shows the change, and a decision record decides whether the budget follows.

## Review condition

The pilot form measured against Signal Forms alone (rules, form and adapter budgets); a reference replaced by a smaller library with the same scope; a budget that blocks a function whose checks are required by a contract of ARCHITECTURE.md §5, measured.
