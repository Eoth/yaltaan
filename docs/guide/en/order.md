# Collections by order: smallest, first k, sort, page

`import { minBy, maxBy, topK, sortBy, paginate } from '@yaltaan/core/collection';`

## The problem

The platform sorts (`toSorted`), but each step around it is written by hand. Finding the cheapest offer sorts the whole list to keep one element. Keeping the ten best scores of a long stream holds the whole stream in memory. A sort by several fields is a chain of `||` in a comparator that calls each key twice per comparison, and gets `NaN`, `null` and `undefined` wrong unless written with care: a comparator that says `NaN` equals every number is no longer an order, and the list can come back unsorted. And a page of a table is a `slice` plus the arithmetic of the page count, rewritten in every project.

## The smallest and the largest

```ts
import { maxBy, minBy } from '@yaltaan/core/collection';

const offers = [
  { shop: 'A', price: 30 },
  { shop: 'B', price: 26 },
  { shop: 'C', price: Number.NaN },
];
minBy(offers, (offer) => offer.price)?.shop; // → 'B'
maxBy(offers, (offer) => offer.price)?.shop; // → 'A'
minBy([], (n: number) => n); // → undefined
```

Of equal keys, the first element wins. A missing key (`undefined`, `null` or `NaN`) is never chosen.

## The first k

```ts
import { topK } from '@yaltaan/core/collection';

const scores = [12, 87, 45, 99, 60, 87];
topK(scores, 3, (a, b) => b - a); // → [99, 87, 87]
```

`topK(items, k, compare)` gives exactly `items.toSorted(compare).slice(0, k)`, equal elements in input order, but keeps only `k` elements in memory: it reads a generator or a stream without holding it whole.

## Sorting by several keys

```ts
import { sortBy } from '@yaltaan/core/collection';

const people = [
  { name: 'Lin', age: 30 },
  { name: 'Ada', age: 26 },
  { name: 'Joe', age: 30 },
];
sortBy(people, [{ key: (person) => person.age, order: 'desc' }, (person) => person.name]).map((person) => person.name); // → ['Joe', 'Lin', 'Ada']

const words = ['zèbre', 'été', 'ete'];
sortBy(words, { key: (word) => word, compare: new Intl.Collator('fr').compare }); // → ['ete', 'été', 'zèbre']
```

Each key is computed once per element, then the elements are sorted by the stable native sort: equal elements keep their order. Numbers, bigints and booleans come before strings, strings compare by code unit unless a criterion gives a `compare` (a collator for a language's order), and missing keys come last, in both orders.

## A page

```ts
import { paginate } from '@yaltaan/core/collection';

const rows = ['a', 'b', 'c', 'd', 'e'];
paginate(rows, { pageIndex: 1, pageSize: 2 }); // → { items: ['c', 'd'], pageIndex: 1, pageSize: 2, length: 5, pageCount: 3 }
paginate(rows, { pageIndex: 9, pageSize: 2 }).items; // → []
```

Pages are numbered from 0, under the names of Angular Material's paginator: its page event can be passed as it is, and the result bound back to it (`length` is the number of elements of the whole collection). An array is read only over the page.

## Good to know

- A key is a number, a bigint, a boolean or a string; anything else is a `TypeError`. Sort dates by `date.getTime()`.
- A comparator that is not consistent (one that says `a < b`, `b < c` and `c < a`) gives an unspecified order, never an endless loop nor an exception of ours.
- Every function takes any iterable and reads it once; an array's holes read as `undefined`, which `topK`, like `toSorted`, puts last without calling `compare`.
