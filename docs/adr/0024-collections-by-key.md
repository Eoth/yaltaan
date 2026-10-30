# ADR 0024 — Collections by key: partition, indexBy, countBy, uniqueBy, intersectionBy, differenceBy

- Date: 2026-10-30
- Status: accepted (design choices delegated by the owner, reported for review)

## Context

ARCHITECTURE.md §7.2 puts in `core/collection` what the platform lacks, and settles four rules: equality is SameValueZero by default, holes read as `undefined`, a non-transitive comparator never loops nor throws, and a function over an `Iterable` consumes it once. Its native table (§4) settles two more: `indexBy` takes a unique key and a collision is an explicit error, and `intersectionBy`/`differenceBy` are key-based variants on arrays of the native set operations. This record decides the keyed half of the first step: `partition`, `indexBy`, `countBy`, `uniqueBy`, `intersectionBy`, `differenceBy`. The ordering half (`minBy`/`maxBy`, `topK`, `sortBy`, `paginate`) gets its own record.

The nearest implementations are es-toolkit's (`partition`, `keyBy`, `countBy`, `uniqBy`, `intersectionBy`, `differenceBy`), the judge of these functions (ADR 0022). They read arrays only, pass the array as a third argument to the callback, return records keyed by `PropertyKey` (so `1` and `'1'` collide, and a key `"__proto__"` replaces the prototype of the result), let a later element win silently in `keyBy`, and drop the duplicates of the first array in `intersectionBy` but not in `differenceBy`.

## Options

1. **Native, or do nothing.** `Map.groupBy` (Widely available since 2026-09-05) groups; `new Map(xs.map((x) => [key(x), x]))` indexes, but a collision overwrites without a word; a count is `Map.groupBy` then the length of each group, which allocates every group to keep a number; `Set.prototype.intersection` (Widely on 2026-12-11) works on sets, not on elements compared by a key.
2. **es-toolkit's semantics.** Familiar, but records as results bring the `PropertyKey` collisions and the `"__proto__"` key above, and the two set operations disagree on duplicates.
3. **Iterables in, `Map` out, one rule for duplicates.** Kept, with the rules below.

## Measurements

Behaviour of es-toolkit 1.52.0 on 2026-10-30 (Node 24.21.0): `keyBy([{ id: 1 }, { id: 1, v: 2 }], (x) => x.id)` → `{ '1': { id: 1, v: 2 } }`, the collision unseen; `countBy([1, '1'], (x) => x)` → `{ '1': 2 }`; `intersectionBy([1, 1, 2], [1], (x) => x)` → `[1]`; `differenceBy([1, 1, 2], [2], (x) => x)` → `[1, 1]`. The differences that remain are measured by the judge and listed in the module (ADR 0022). Size: see the commit of the functions.

## Decision

- **Input**: any `Iterable`, read once, in order; an array's holes read as `undefined`, as `for…of` reads them. The callback receives the element and its position, never the collection: an iterable has none to give.
- **Keys** are any value, compared by SameValueZero: a `Map` compares them so, and the results that hold keys are `Map`s (insertion order, no prototype, `1` and `'1'` distinct). `uniqueBy`, `intersectionBy` and `differenceBy`, which return elements and not keys, accept `equality: 'SameValue'` to tell `-0` from `0`, as `equal` does.
- **`partition(items, predicate)`** returns `[passed, failed]`, each in input order; a type guard narrows both sides.
- **`indexBy(items, key)`** returns `ok(Map)` or, on the first collision, `err` with the code `collection.duplicate_key`, whose path is the position of the second element and whose params give `first`, the position of the first: a collision is a fact of the data, so an expected failure (`Result`), never a silent overwrite.
- **`countBy(items, key)`** returns a `Map` from key to count, keys in order of first appearance.
- **`uniqueBy(items, key)`** keeps the first element of each key, in input order; applied twice, it changes nothing.
- **`intersectionBy(items, others, key)` and `differenceBy(items, others, key)`** keep or drop each element of `items` on its own, by whether its key is among the keys of `others`; duplicates of `items` stay. So the two results are a `partition` of `items` by that membership, and their lengths add up to the length of `items`. One key function serves both collections.
- **Not here**: grouping (`Map.groupBy` is native), and set operations on the elements themselves (`Set.prototype.intersection` and the others).

## Consequences

- An index never loses an element unseen; an application that wants the last element to win writes `new Map(…)` natively, which says so.
- `countBy` allocates one map entry per key and no group.
- A key that is an object is compared by identity, as in a `Map`; a caller who wants keys compared by value maps them to a primitive first.
- Unlike es-toolkit, a result keyed by `1` and one keyed by `'1'` differ, and a `"__proto__"` key is an ordinary key.

## Review condition

A pilot that needs `indexBy` to keep the last element (an option then, not a change of default); the native set operations becoming Widely available with a key-based form; a benchmark showing the `Map` result costing more than a record where keys are strings.
