# Collections by key: split, index, count, deduplicate, compare

`import { partition, indexBy, countBy, uniqueBy, intersectionBy, differenceBy } from '@yaltaan/core/collection';`

## The problem

The platform groups (`Map.groupBy`) and filters, but stops there. Indexing a list by id with `new Map(list.map((x) => [x.id, x]))` loses an element without a word when two share an id. Counting with `Map.groupBy` builds every group to keep a number. Deduplicating by a field, or keeping the rows of one list whose id appears in another, is a loop written again in every project. And the libraries that do it return records, where the key `1` and the key `'1'` are one key, and a key `"__proto__"` changes the prototype of the result.

## Splitting and indexing

```ts
import { indexBy, partition } from '@yaltaan/core/collection';

partition([1, 2, 3, 4, 5], (n) => n % 2 === 0); // → [[2, 4], [1, 3, 5]]

const users = [
  { id: 7, name: 'Ada' },
  { id: 9, name: 'Grace' },
];
indexBy(users, (user) => user.id).ok; // → true
indexBy([{ id: 1 }, { id: 2 }, { id: 1 }], (item) => item.id); // → { ok: false, error: { code: 'collection.duplicate_key', path: [2], params: { first: 0 } } }
```

`indexBy` returns a `Result`: a key met twice is a fact of the data, reported with the position of both elements, never an element silently replaced. A predicate that is a type guard narrows both sides of `partition`.

## Counting and deduplicating

```ts
import { countBy, uniqueBy } from '@yaltaan/core/collection';

countBy(['apple', 'avocado', 'banana'], (word) => word[0]).get('a'); // → 2
countBy([1, '1', 1], (item) => item).size; // → 2
uniqueBy([1.2, 1.7, 2.1], Math.floor); // → [1.2, 2.1]
uniqueBy([0, -0], (n) => n, { equality: 'SameValue' }); // → [0, -0]
```

Keys are any value, compared as a `Map` compares them (SameValueZero: `NaN` equals `NaN`, `0` equals `-0`), and the results that hold keys are `Map`s, in order of first appearance. `uniqueBy` keeps the first element of each key.

## Comparing two collections

```ts
import { differenceBy, intersectionBy } from '@yaltaan/core/collection';

const cart = [{ sku: 'A' }, { sku: 'B' }, { sku: 'A' }];
const outOfStock = [{ sku: 'A' }];
intersectionBy(cart, outOfStock, (line) => line.sku); // → [{ sku: 'A' }, { sku: 'A' }]
differenceBy(cart, outOfStock, (line) => line.sku); // → [{ sku: 'B' }]
```

Each element of the first collection is kept or dropped on its own: duplicates stay, and the two results always split the first collection in two.

## Good to know

- Every function takes any iterable (an array, a `Set`, a generator, a string) and reads it once, in order; an array's holes read as `undefined`.
- The callback receives the element and its position, never the collection.
- An object key is compared by identity, as in a `Map`: map it to a primitive (`(user) => user.id`) to compare by value.
