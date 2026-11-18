# ADR 0049 — The bridge places each error of a rule by a validator of its field

- Date: 2026-11-18
- Status: proposed

## Context

ADR 0048 placed every issue of a rule that `validateRules` reads as a tree error of Signal Forms at the rule's path, on the field its path names. Angular gives each field the tree errors of its ancestors that name it, by filtering them: a keystroke in a list of n rows holding e errors then costs about n × e. Its review measured 254.7 ms per write at 4,000 rows all in error, and T2.10 asked for the cost at n, 2n and 4n rows, beside Signal Forms alone with its validators written by hand (tests/interop/form-rules.mjs) and with no validator, the bridge proportional to n and not above the hand-written validators at 4,000 rows.

A rule says where it may place an issue: every issue lands on one of its `targets`, `rules.too_many_issues` aside (`Rule` of `@yaltaan/rules`).

## Options

1. **Keep the tree errors**: no byte added; a keystroke grows as the rows times the errors.
2. **A validator on every field a target names, reading a table built once per check of the rule**: the issues of a rule are sorted once, by the field they reach, into a map; a field-level validator on each field a target names (an index or `anyElement` standing for every item, through `applyEach`, as the `REQUIRED` metadata already stands) looks its own field up; only the issues that reach no field whole, or no target, stay tree errors. A keystroke costs one lookup per field.
3. **One validator per issue path, built when the issues are known**: Signal Forms defines its logic once, with the schema; it cannot add a validator when a check finds a new path.

## Measurements

The bench `packages/angular/bench/long-lists.ts` (a list of rows whose emails must be unique, `unique` of `@yaltaan/rules`; a keystroke is a space added to or taken from the email of the middle row, then every row's errors read, as a view of the list reads them; CPU time of the process, the fastest of three strokes and of five rounds, each size in turn with the others; Node 24.21.0, Angular 22.2.5, a machine shared with other work at a lower priority), in ms at 1,000 / 2,000 / 4,000 rows:

| Form | One row in ten in error | No row in error | Every row in error |
|---|---|---|---|
| Option 1, tree errors | 12.9 / 32.8 / 115.8 (4n/n 8.95) | 7.6 / 16.5 / 33.6 (4.45) | 56.1 / 104.5 / 208.6 (3.72) |
| Option 2, by field | 12.4 / 26.2 / 47.2 (3.82) | 10.7 / 22.0 / 44.1 (4.13) | 16.7 / 33.3 / 62.9 (3.78) |
| Validators written by hand | 72.2 / 248.9 / 931.5 (12.90) | 70.3 / 246.4 / 961.8 (13.68) | 70.3 / 257.7 / 953.8 (13.56) |
| No validator | 8.4 / 15.8 / 33.0 (3.95) | 9.4 / 20.1 / 40.9 (4.37) | 9.4 / 19.9 / 40.2 (4.27) |

Above Signal Forms with no validator, option 1 costs 5.7 / 16.6 / 81.3 ms with one row in ten in error, the square of the rows; option 2 costs 4.0 / 10.5 / 14.2 ms. With every row in error, a rule stops at 1,000 issues, as `checkRules` does, so that option 1 grows only linearly there, from a cost of 1,000 errors filtered by every field. The validators written by hand each read the whole list, as an application writes them: the square of the rows, whatever the errors. Without errors the two options cost what Angular costs alone, within the spread of the machine (the column of no validator moved from 33.3 to 40.9 ms at 4,000 rows between the two runs).

Size, `node scripts/size-report.ts`, `yaltaan/angular-adapter`, brotli, esbuild / Rollup: 1,488 / 1,491 B → 1,672 / 1,684 B, over the hypothesis budget of 1,500 B. A table that copied a field's list at each issue weighed 14 B less and grew as the square of the issues on one field.

A second reader, given the question and the code, refused a first version, reproducing each fault beside the code before it: an issue on a list item named by the string `"0"` (which `checkPath` accepts) went into the table under a field no validator stands on, since Angular applies no logic of a key to an item, so that the form read valid while the rule failed; a target through an index or a symbol on an object, which `applyEach` applies to every child, gave a field the errors of two targets. The table is now kept by target, each validator reading only its own target's, and a target that names an item by such a string has no validator, its errors staying tree errors; the reader's cases then agree with the code before, but one.

## Decision

Option 2. Each rule keeps its check in one computation; a second computation sorts its issues once, by the field each reaches, into a map for the issues whose path reaches a field whole and matches a target (indexes counted as one key, as the targets' `anyElement` and indexes are), and a list for the others, which stay tree errors at the rule's path; a field-level validator stands on every field a target names, the targets of a rule taken once by their shape, and reads its field in the map. The `REQUIRED` metadata goes through the same walk of the targets as before.

The budget of `yaltaan/angular-adapter` becomes 1,700 B, still a hypothesis, until T2.6 measures the pilot against Signal Forms alone and recalibrates every budget: the measure under Rollup rounded up to the hundred, not plus a twentieth as ADR 0047 set those of the form, since slack there would let the next regression of the bridge pass unseen (the reader's objection).

## Consequences

- A keystroke in a long list costs the bridge a lookup per field: 47.2 ms at 4,000 rows with one in ten in error, against 115.8 before and 931.5 for validators written by hand.
- Errors on a target's field are field-level errors of Signal Forms; those that reach no field whole, or no target (`rules.too_many_issues`), stay tree errors on the deepest field on their way, as before, and still cost every field below a filter.
- The order of a field's errors changes: Angular lists a field's own validators before the tree errors that name it, so that the error of a rule now comes before that of a validator the application wrote on the same field (`validateRules(p, [allOrNone(...)]); required(p.b)`: `required, rules.all_or_none` before, `rules.all_or_none, required` after); an application that shows only `errors()[0]` shows another message. Within the rules, an issue that stays a tree error comes after those of the table.
- 193 B more under Rollup; `checkRules` and the rest of the bridge unchanged.
- The gate does not see a return to tree errors: every test of the bridge passes on both options, which show the same errors. The bench judges it, by hand; the missing judge of scale (T0.19) would.

## Review condition

T2.6 measuring the pilot over the new budget; Signal Forms giving fields their tree errors without a filter per field, or adding validators once a check runs; a rule that places issues outside its targets in a way an application relies on; the bench no longer proportional to the rows.
