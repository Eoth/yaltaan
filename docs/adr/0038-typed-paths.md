# ADR 0038 — Typed paths, and what bounds their cost

- Date: 2026-11-03
- Status: accepted by delegation of the owner (design choices), with one reservation on the ticket, to be read by the owner

## Context

`ARCHITECTURE.md` §5.3 promises `Path<T>` and `PathValue<T, P>`, with a bounded depth of 8 and an explicit degradation beyond it; the ticket adds a cap on the number of paths generated. The harness of [ADR 0014](0014-type-cost-harness-and-typescript-6.md) and the budget per usage of [ADR 0033](0033-type-cost-of-the-schema.md) judge the cost.

## Options

1. **Native, or do nothing.** `readonly PathSegment[]` as it is: a typo in a path waits for the test or the user.
2. **A second name, `TypedPath<T>`.** Leaves `Path` alone, and doubles what a reader meets. Rejected: `Path` with a default parameter is the same type for every existing use.
3. **A union of every path of `T`.** A value is checked by assignment, an error names what was expected, nothing else to import. Its cost follows the number of paths.
4. **A check along one path only, a generic `ValidPath<T, P>`.** Its cost follows the length of the path, not the width of the model; every function that takes a path needs a type parameter, and an annotation `const p: Path<Order>` no longer exists. Not now: a ticket, if a real model needs it.

Kept: 3, with a depth the application may lower.

## Measurements

TypeScript 7.0.2 and 6.0.3, `node scripts/type-cost.ts`, 2026-11-03, on the `Model` of `bench/types/model.ts` in `bench/types/usages/path.ts`: what the usage adds to a fixture, and its time alone in each of 2,000 files: 21,867 instantiations under TypeScript 7 and 8,812 under 6.0 (`schema-object`: 14,466 and 11,544); +855 % against the budget of +900 %, so that this usage has little room left. The step of the gate grows by about 5 s.

Errors read: `Type '"adress"' is not assignable to type 'number | "address" | "email" | "name" | KeySegment | undefined'. Did you mean '"address"'?` for a typo in the third segment; the same list without the suggestion for a field of an array.

The number of paths, one model of each shape, TypeScript 7:

| Fields per level, levels | Paths | Instantiations | Check | Memory | Result |
|---:|---:|---:|---:|---:|---|
| 100, 2 | 10,100 | 177,764 | 1.3 s | 172 MB | fine |
| 30, 3 | 27,930 | 534,575 | 2.8 s | 419 MB | fine |
| 20, 4 | 168,420 | 3,463,606 | 16 s | 2.3 GB | compiles, and hurts |
| 30, 4 | 837,930 | over 5,000,000 | 13 s | 1.0 GB | error TS2589 |
| 10, 6 | 1,111,110 | over 5,000,000 | 17 s | 2.5 GB | errors TS2589, TS2590 |

## Decision

- `Path<T = unknown, Depth = 8>`: without an argument, the type it was; `unknown` and `any` give it too. Otherwise a union of tuples, the empty one first. An array is entered by an index or a key segment. An optional or nullable field is entered as what it holds. A function, a primitive, a `Date` and a `RegExp` end a path. Past `Depth` segments, any segments.
- `PathValue<T, P>`: `undefined` where a step may hold nothing (optional, nullable, an array element, a field that only some members of a union have); `unknown` for a path that is not a tuple or goes past what is typed.
- Ceilings: the measure plus 10 %, rounded up to the hundred, as ADR 0033 did: 24,100 under TypeScript 7, 9,700 under 6.0.

**The reservation.** The ticket asks for a cap on the number of paths with an explicit degradation. A type cannot count the members of a union without building them. What exists instead: the depth, which the application lowers (`Path<T, 3>`), and the compiler's own refusal, TS2589 or TS2590, around a million paths, or earlier in its memory. A model of 20 fields per level over 4 levels compiles in 16 s and 2.3 GB without a word. The owner may prefer option 4 for that case; T1.7 holds it.

## Consequences

- Every existing use of `Path` is unchanged, and `Path<T>` is assignable to `Path`.
- What the judges do not see: a real model; the time of an editor's language service, which recomputes the union; TypeScript versions other than 7.0.2 and 6.0.3.

## Review condition

A real model that passes 10,000 paths, or a usage that passes its ceiling.
