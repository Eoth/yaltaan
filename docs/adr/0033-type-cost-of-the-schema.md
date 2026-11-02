# ADR 0033 — Type cost of a schema: its ceilings, and what the time budget can judge

- Date: 2026-11-02
- Status: accepted (internal technical choice, reversible by one constant and two lines of a file; ARCHITECTURE.md §8 called both figures hypotheses to calibrate by measurement)

## Context

ADR 0014 built the harness and left its figures to calibrate. `InferOutput` of an `object` is the first public type that computes in depth in the user's project, and no usage measured it. A usage is appended to every file of the reference project, 2,000 of them, and §8 allows "+10 % check time" against the same project without the library. Three things had to be measured: what one schema costs, whether +10 % can hold, and what the step now costs the gate, against the threshold of T0.15 (10 s) and the review condition of ADR 0014 (the 6.0 checks taking more than 10 s).

The usage, `bench/types/usages/schema-object.ts`, has the shapes of the pilot form: nested objects, an array of objects, optional and nullable fields, a discriminated union, both inferred types, a read given to the application's own `Model`, a narrowing, the schema with its messages, and a generic function over any schema with a callback, which is what an engine declares.

## Options

For the time budget:

1. **Native, or do nothing: keep +10 % with a usage in every file.** The gate is red for any schema at all: about +600 %, against about +1,200 % for valibot on the same shape. Rejected.
2. **Keep +10 %, with one usage per 50 files**, the density at which it holds (+10.5 %, 40 schemas). The difference is then 16 ms for a spread of 49 ms between passes: the verdict, which treats a difference within the spread as noise, could never fail. A gate that is green because it cannot measure. Rejected.
3. **Time the usage against the same shape in valibot, at every gate.** About 10 s more per gate, for a figure the counts already give. Rejected.
4. **One ratio over every usage together.** Written first, and refused by the review below: it spends itself as usages arrive, since a second schema per file gives +1,179 % and a `Path` usage +1,272 % with no regression anywhere, and recalibrating at each new usage would hide one that doubles. Rejected.
5. **One ratio per usage, each alone in its project.** The signal is well above the noise, and the ratio holds across loads and core counts. Kept.

For the ceilings:

1. **The reference, valibot's count.** 4.1 and 2.6 times our count: our inference could more than double without a word. Rejected.
2. **Our count, plus 10 %, rounded up to the hundred.** The recorded baseline already fails on any move; the ceiling says what an `--update` may record without a new record. Kept.

## Measurements

On 2026-11-02, Ubuntu 26.04 x64, 20 logical processors, Node 24.21.0, TypeScript 7.0.2 and 6.0.3, `node scripts/type-cost.ts`, under load from other work (load average 5 to 12). Instantiations are identical on every pass.

Instantiations a usage adds to the ten files of a fixture, with and without `exactOptionalPropertyTypes`, which do not differ:

| Usage | TypeScript 7 | TypeScript 6.0 |
|---|---|---|
| `schema-object` | 14,466 | 11,544 |
| The same shape in valibot 1.5.0 | 58,622 | 30,364 |

On the first form of the usage, without `withMessages` and the generic function (14,162 and 11,243): `Flatten` removed from the published declarations, 12,076 and 9,544; a recursion of depth 6 added to `InferOutput`, 19,158 and 15,957; a conditional `InferOutput`, 18,310 and 14,830; a second `Flatten`, 15,288 and 12,342.

Check time of the reference project with the usage in all of its 2,000 files, under TypeScript 7, medians of five interleaved passes:

| Run | Without | With | Ratio |
|---|---|---|---|
| All cores, this usage | 0.133 s | 0.951 s | +615 % |
| All cores, this usage | 0.138 s | 0.994 s | +620 % |
| All cores, 13 windows of the review, first form | | | +488 to +661 % |
| `taskset`, 4 cores, first form | 0.27 s | 1.80 s | +567 % |
| `taskset`, 2 cores, first form | 0.45 s | 3.14 s | +594 % |
| valibot, all cores | 0.131 s | 1.799 s | +1,273 % |
| valibot, `taskset`, 4 cores, first form | 0.28 s | 3.52 s | +1,140 % |

One usage per 50 files: 0.152 s without (0.144 to 0.193), 0.168 s with (0.159 to 0.201), +10.5 %, 155,192 instantiations.

A type that grows check time and leaves the count alone, in the review, 80 and 200 overloads added to `string`: +843 %, green, for a real +29 % of check time; +1,080 %, red.

The whole step: 4 s before the usage, 15 to 21 s with it depending on the load; 27 s when the project with the usage was also checked under 6.0 and without `exactOptionalPropertyTypes`, of which 12 s under 6.0. Those two 6.0 checks took 8.9 to 13.1 s each under load, for 906 to 938 MB of memory; the reference alone, 1 s and 263 MB. From 100 to 2,000 files, the review counted exactly 1,027.0 instantiations per file, the same under both compilers and both option sets.

The valibot usage is not in the repository, since no gate reads it. It is the same file, field for field, written with `v.object`, `v.pipe(v.string(), v.minLength(1))`, `v.exactOptional`, `v.nullable`, `v.variant`, `v.safeParse` and `v.config`.

A reviewer given only the question and the code, and told to look for reasons to refuse, accepted the figure of the budget, the checks dropped and the method of the ceilings, and refused two things, both corrected here: one ratio over all usages (option 4), and a usage without `withMessages` and a generic consumer, on which a recursive return type of `withMessages` left every count unchanged while a caller failed with TS2344.

## Decision

- **The time budget** becomes a ratio of 9, +900 %, for each usage alone in every file: above the highest ratio measured (+661 %) by enough that an 80-overload window, which starts there, does not flake, and under valibot's on the same shape. It reads as: a schema of this size costs at most nine reference files. It is a coarse alarm for what counts do not show (relations between types, which the instantiation count leaves out); counts remain the precise signal.
- **The ceilings** of `schema-object`: 16,000 under TypeScript 7, 12,700 under 6.0.
- **A project with a usage in every file is checked under TypeScript 7 with `exactOptionalPropertyTypes` only**: it is what the time verdict reads. Its other three checks took 13 of the step's 27 s for counts nothing judged, and ADR 0014's measure per fixture stays under both compilers and both option sets.

## Consequences

- The step passes from 4 s to 15 to 21 s, over the 10 s of T0.15, which keeps its place in the order: the gate stays under a minute. Each new usage adds about 5 s (estimated by the review).
- What the gate does not see: a cost that appears only with thousands of files and only under 6.0, or only without `exactOptionalPropertyTypes`, and what 6.0 pays for such a project, no longer printed; a type that slows the check by less than about half and moves no count (+29 % passes); a schema of another shape than the usage's; the check time of a real application, whose files hold more than the 30 lines of a reference file, and its real density of forms, which nobody has measured.
- A real application pays less than this ratio says: 40 such schemas in 2,000 files cost +10.5 %, 16 ms.
- `Flatten` costs 2,086 instantiations under 7 and 1,699 under 6.0 for the tooltip it gives, 15 % of the first form of the usage. Kept: what a user reads in an editor is the reason for the type.

## Review condition

A usage over its ratio on a machine that is not loaded; a compiler version that moves a count; T0.15's work on the step; `lazy` (T5.1), which brings recursion into the inference.
