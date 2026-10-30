# ADR 0025 — Collections by order: minBy, maxBy, topK, sortBy, paginate

- Date: 2026-10-30
- Status: accepted (design choices delegated by the owner, reported for review)

## Context

ARCHITECTURE.md §7.2 puts in `core/collection` what the platform lacks, and settles the rules ADR 0024 already applies (SameValueZero, holes read as `undefined`, iterables read once) plus two for this half: a non-transitive comparator gives an unspecified order but never an infinite loop or an exception, and `topK(xs, k)` equals `xs.toSorted(cmp).slice(0, k)`. Its native table (§4) adds that a multi-criteria `sortBy` is built on the stable native sort. This record decides the ordering half of the module: `minBy`/`maxBy`, `topK` (a heap), multi-criteria `sortBy`, and `paginate`.

The nearest implementations are es-toolkit's `minBy`, `maxBy`, `sortBy` and `orderBy`, the judge of these functions (ADR 0022), and its `chunk`, whose chunks are the pages of `paginate`. es-toolkit has no `topK`: its judge is the platform, `toSorted` then `slice`.

## Options

1. **Native, or do nothing.** `toSorted` with a hand-written comparator sorts; `toSorted(cmp)[0]` finds a minimum in O(n log n) and `toSorted(cmp).slice(0, k)` the k first in O(n log n) time and O(n) memory; a multi-criteria comparator is a chain of `||` that calls each key function twice per comparison, and gets missing values and `NaN` wrong unless written with care; a page is a `slice` plus the arithmetic of the page count.
2. **es-toolkit's semantics.** Familiar, but `minBy` returns the first element whose key is `NaN`, `null` counts as `0` in `minBy` and as last in `sortBy`, and `orderBy` compares keys with `<`, so a `NaN` key is equal to every key: the comparator is no longer transitive and the result is not sorted at all (measurements below).
3. **One order on keys for the four functions, missing keys last.** Kept, with the rules below.

## Measurements

es-toolkit 1.52.0 and the platform, Node 24.21.0, 2026-10-30:

- `minBy([3, NaN, 1], (x) => x)` → `NaN`; `maxBy([1, NaN, 5], (x) => x)` → `NaN`; `minBy([{ k: 1 }, { k: null }], (x) => x.k)` → `{ k: null }`.
- `sortBy` of the keys `[3, NaN, 1, 2, NaN, 0]` → `[3, NaN, 1, 2, NaN, 0]`, unchanged: each `NaN` compares equal to its neighbours, so the native sort sees a non-transitive comparator.
- `orderBy` of the keys `[1, null, undefined, 2]` in descending order → `[null, undefined, 2, 1]`: missing keys come first; in ascending order they come last.
- `sortBy` of 1 000 elements by one key called the key function 17 050 times, twice per comparison.
- `[3, undefined, 1].toSorted((a, b) => a - b)` → `[1, 3, undefined]`, and the comparator is never called with `undefined`; a comparator returning `NaN` counts as `0`, and one returning a `bigint` makes `toSorted` throw a `TypeError` (ToNumber); `[1, 2, 3].slice(0, -1)` → `[1, 2]`.

Size: see the commit of the functions.

## Decision

- **Input**: as ADR 0024. Any `Iterable`, read once, in order, holes as `undefined`; callbacks receive the element and its position.
- **Order on keys** (`minBy`, `maxBy`, `sortBy`): a key is a number, a `bigint`, a boolean or a string. Numbers, `bigint`s and booleans compare by value, exactly across types (as `<` compares them), `-0` equal to `0`, and come before strings, which compare by UTF-16 code unit (a locale order is a `compare` of the criterion, `Intl.Collator` for instance). `undefined`, `null` and `NaN` are **missing** keys: after every present key, in both directions, equal to each other. A key of any other type (an object, a symbol, a function) is a `TypeError`: comparing objects through `valueOf` would guess; a date is sorted by its `getTime()`. This order is total, so the native sort under `sortBy` always sees a consistent comparator unless the caller gives one that is not.
- **`minBy(items, key)` and `maxBy(items, key)`** return the first element with the smallest (largest) present key, or `undefined` when no element has one; an element whose key is missing is never chosen. So `minBy` is the first element of `sortBy` over the elements with a present key, and `maxBy` the first of the same in descending order. A comparator instead of a key: `topK(items, 1, compare)[0]`.
- **`sortBy(items, criteria)`**: one criterion or an array of them, each a key function or `{ key, order?: 'asc' | 'desc', compare? }`. Each key is computed once per element and criterion, before sorting; positions are then sorted by the native stable `Array.prototype.sort`, so equal elements keep their input order. `compare`, when given, orders the present keys of its criterion in place of the default order, its result read as the platform reads a comparator's (ToNumber, `NaN` as `0`); missing keys stay last and never reach it. A comparator that is not consistent gets the native sort's implementation-defined order: still a permutation of the input, never a loop.
- **`topK(items, k, compare)`** returns the `k` first elements of `toSorted(compare)`, in that order, equal elements in input order: elements that are `undefined` come after every other and never reach `compare`, its result is read as `toSorted` reads it. It keeps a max-heap of at most `k` elements ordered by `compare` then position: O(n log k) comparisons and O(k) memory, for a stream as for an array. Each step of the heap moves strictly up or strictly down, so an inconsistent comparator ends after at most O(n log k) calls and returns `min(k, n)` elements of the input, each position at most once. `k` is a non-negative safe integer, otherwise a `RangeError`, where `slice` would read a negative `k` from the end; with `k` 0, `items` is not read.
- **`paginate(items, { pageIndex, pageSize })`** returns `{ items, pageIndex, pageSize, length, pageCount }`: the page numbered from 0, as Spring Data and the paginator of Angular Material number it, under the names of that paginator, so that its page event can be passed as it is and the result bound back (`length` is the number of elements of the whole collection). A page past the end has no items and keeps the index asked; `pageCount` is `⌈length / pageSize⌉`, 0 for an empty collection. `pageIndex` is a non-negative safe integer and `pageSize` a positive one, otherwise a `RangeError`. An array is read only over the page, its length known; any other iterable is read whole, to count it, and only the page is kept.
- **Not here**: sorting in place (`sort` is native), criteria named by a property string (a key function is typed and needs no path), a locale order by default (it depends on the caller's locale).

## Consequences

- One order serves the four functions: `minBy`, `maxBy` and `sortBy` agree on which key is smallest and on where `NaN`, `null` and `undefined` go, and `topK` agrees with `toSorted`.
- `sortBy` calls each key function n times instead of about 2 n log₂ n, and holds n keys per criterion and n positions.
- Unlike es-toolkit, a `NaN` key is never a minimum or a maximum, `null` is never `0`, missing keys stay last in descending order, and a number sorts before a string instead of being compared to it with `<`.
- A key that is a `Date` throws until mapped to a number; a key of mixed numbers and strings sorts the numbers first.

## Review condition

A pilot that needs missing keys first in descending order (an option then, not a change of default); a native top-k or keyed sort reaching Widely available; a benchmark where computing the keys before sorting costs more than calling them in the comparator.
