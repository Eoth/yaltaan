import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertType,
  CallbackError,
  declareAdversarial,
  fc,
  HostileError,
  type Callback,
  type Equal,
} from '@yaltaan/testing';

import {
  maxBy,
  minBy,
  paginate,
  sortBy,
  topK,
  type Page,
  type PageRequest,
  type SortCriterion,
  type SortKey,
} from './index.ts';

const SUBPATH = '@yaltaan/core/collection';

interface Element {
  readonly key: SortKey;
  readonly id: number;
}

// A generator, read at most once: a second read finds it exhausted.
function* once<T>(items: readonly T[]): Generator<T> {
  yield* items;
}

const ids = (items: readonly ({ readonly id: number } | undefined)[]): (number | undefined)[] =>
  items.map((item) => item?.id);
const keyOf = (item: Element): SortKey => item.key;

test('minBy and maxBy find the first element with the smallest or largest key', () => {
  const people = [
    { name: 'Lin', age: 30 },
    { name: 'Joe', age: 26 },
    { name: 'Ada', age: 30 },
  ];
  assert.equal(
    minBy(people, (person) => person.age),
    people[1],
  );
  assert.equal(
    maxBy(people, (person) => person.age),
    people[0],
  );
  assert.equal(
    minBy([], () => 1),
    undefined,
  );
  assert.equal(
    minBy([0, -0], (n) => n),
    0,
  );
  assert.ok(
    Object.is(
      maxBy([-0, 0], (n) => n),
      -0,
    ),
  );
  assert.equal(
    maxBy(['b', 2, 'a'], (item) => item),
    'b',
  );
  assert.equal(
    minBy([5n, 4, true], (item) => item),
    true,
  );
});

test('minBy and maxBy never choose a missing key, and find nothing when no key is present', () => {
  assert.equal(
    minBy([3, Number.NaN, 1], (n) => n),
    1,
  );
  assert.equal(
    maxBy([Number.NaN, 1, 5], (n) => n),
    5,
  );
  assert.equal(minBy([{ k: 1 }, { k: null }], (item) => item.k)?.k, 1);
  assert.equal(
    minBy([Number.NaN, null, undefined], (item) => item),
    undefined,
  );
});

test('sortBy orders numbers, bigints and booleans before strings, and missing keys last in both orders', () => {
  const keys: SortKey[] = [3, Number.NaN, 'b', 1, null, 2n, 'a', -0, undefined, true, 0];
  assert.deepEqual(
    sortBy(keys, (key) => key),
    [-0, 0, 1, true, 2n, 3, 'a', 'b', Number.NaN, null, undefined],
  );
  assert.deepEqual(sortBy(keys, { key: (key) => key, order: 'desc' }), [
    'b',
    'a',
    3,
    2n,
    1,
    true,
    -0,
    0,
    Number.NaN,
    null,
    undefined,
  ]);
});

test('sortBy sorts by each criterion in turn, equal elements in input order', () => {
  const people = [
    { name: 'Lin', age: 30 },
    { name: 'Ada', age: 26 },
    { name: 'Ada', age: 30 },
    { name: 'Joe', age: 26 },
  ];
  assert.deepEqual(sortBy(people, [{ key: (person) => person.age, order: 'desc' }, (person) => person.name]), [
    people[2],
    people[0],
    people[1],
    people[3],
  ]);
  assert.deepEqual(sortBy(people, []), people);
  assert.notEqual(sortBy(people, []), people);
});

test('sortBy takes a compare for a locale order, which never sees a missing key', () => {
  const words = ['zèbre', undefined, 'été', 'Été', 'ete', null];
  const seen: unknown[] = [];
  const collator = new Intl.Collator('fr-FR');
  const sorted = sortBy(words, {
    key: (word) => word,
    compare: (a: string, b: string) => {
      seen.push(a, b);
      return collator.compare(a, b);
    },
  });
  assert.deepEqual(sorted, ['ete', 'été', 'Été', 'zèbre', undefined, null]);
  assert.ok(seen.every((word) => typeof word === 'string'));
  assert.deepEqual(sortBy(words, { key: (word) => word, order: 'desc', compare: collator.compare }), [
    'zèbre',
    'Été',
    'été',
    'ete',
    undefined,
    null,
  ]);
  // A comparator's result is read as the platform reads it: a numeric string as its number, `NaN` as equal.
  assert.deepEqual(
    sortBy([2, 1, 3], { key: (n) => n, compare: (a, b) => String((a as number) - (b as number)) as unknown as number }),
    [1, 2, 3],
  );
  assert.deepEqual(sortBy([2, 1, 3], { key: (n) => n, compare: () => Number.NaN }), [2, 1, 3]);
});

test('sortBy types its criteria from the elements', () => {
  const sorted = sortBy([{ name: 'Ada' }], (person) => person.name);
  assertType<Equal<typeof sorted, { name: string }[]>>();
  // Never called: the lines below are checked by the compiler only.
  const rejected = (): void => {
    // @ts-expect-error a Date is not a key: sort by its getTime()
    sortBy([new Date()], (date) => date);
    // @ts-expect-error an order is 'asc' or 'desc'
    sortBy([1], { key: (n) => n, order: 'up' });
  };
  assert.equal(typeof rejected, 'function');
});

test('topK returns the k first of toSorted, equal elements and undefined as toSorted places them', () => {
  assert.deepEqual(
    topK([5, 1, 4, 2, 3], 2, (a, b) => a - b),
    [1, 2],
  );
  assert.deepEqual(
    topK([5, 1, 4, 2, 3], 9, (a, b) => b - a),
    [5, 4, 3, 2, 1],
  );
  const tied = [
    { score: 1, id: 0 },
    { score: 2, id: 1 },
    { score: 1, id: 2 },
    { score: 2, id: 3 },
  ];
  assert.deepEqual(ids(topK(tied, 3, (a, b) => b.score - a.score)), [1, 3, 0]);
  const seen: unknown[] = [];
  const sparse: (number | undefined)[] = [2, , undefined, 1]; // prettier-ignore
  assert.deepEqual(
    topK(sparse, 3, (a, b) => {
      seen.push(a, b);
      return a! - b!;
    }),
    [1, 2, undefined],
  );
  assert.ok(seen.every((value) => value !== undefined));
});

test('topK reads nothing for k = 0, and refuses a k that is not a non-negative safe integer', () => {
  let read = false;
  function* watched(): Generator<number> {
    read = true;
    yield 1;
  }
  assert.deepEqual(
    topK(watched(), 0, (a, b) => a - b),
    [],
  );
  assert.equal(read, false);
  for (const k of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '2' as unknown as number]) {
    assert.throws(() => topK([1], k, (a, b) => a - b), RangeError);
  }
});

test('paginate numbers pages from 0 and counts the whole collection', () => {
  const letters = ['a', 'b', 'c', 'd', 'e'];
  const page = paginate(letters, { pageIndex: 1, pageSize: 2 });
  assertType<Equal<typeof page, Page<string>>>();
  assert.deepEqual(page, { items: ['c', 'd'], pageIndex: 1, pageSize: 2, length: 5, pageCount: 3 });
  assert.deepEqual(paginate(letters, { pageIndex: 2, pageSize: 2 }).items, ['e']);
  assert.deepEqual(paginate(letters, { pageIndex: 7, pageSize: 2 }), {
    items: [],
    pageIndex: 7,
    pageSize: 2,
    length: 5,
    pageCount: 3,
  });
  assert.deepEqual(paginate([], { pageIndex: 0, pageSize: 10 }), {
    items: [],
    pageIndex: 0,
    pageSize: 10,
    length: 0,
    pageCount: 0,
  });
  assert.deepEqual(paginate(once(letters), { pageIndex: 1, pageSize: 2 }), page);
  // A paginator's page event carries more fields; it is passed as it is.
  const event = { pageIndex: 0, pageSize: 2, length: 5, previousPageIndex: 1 };
  assert.deepEqual(paginate(letters, event).items, ['a', 'b']);
});

test('paginate refuses a page index or size out of range', () => {
  for (const request of [
    { pageIndex: -1, pageSize: 2 },
    { pageIndex: 0.5, pageSize: 2 },
    { pageIndex: 0, pageSize: 0 },
    { pageIndex: 0, pageSize: Number.POSITIVE_INFINITY },
    { pageIndex: Number.NaN, pageSize: 2 },
  ]) {
    assert.throws(() => paginate([1], request), RangeError);
  }
  assert.throws(() => paginate([1], undefined as never), TypeError);
});

test('a callback that is not a function, or a criterion out of shape, is a TypeError', () => {
  for (const call of [
    () => minBy([1], undefined as never),
    () => maxBy([1], 'age' as never),
    () => sortBy([1], 'age' as never),
    () => sortBy([1], [null as never]),
    () => sortBy([1], { key: 'age' } as never),
    () => sortBy([1], { key: (n) => n, order: 'ascending' as never }),
    () => sortBy([1], { key: (n) => n, compare: 'locale' as never }),
    () => sortBy([{}], (item) => item as never),
    () => minBy([Symbol('k')], (item) => item as never),
    () => topK([1], 1, undefined as never),
    () => minBy(1 as never, () => 1),
  ]) {
    assert.throws(call, TypeError);
  }
});

// Laws over generated collections, judged by the platform: `toSorted`, `Math.min` and `Math.max`, `slice`.
const PROPERTIES = { numRuns: 300 };

const numericKey = fc.constantFrom<SortKey>(0, -0, 1, 2, -1, 0.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY);
const missingKey = fc.constantFrom<SortKey>(undefined, null, Number.NaN);
const anyKey = fc.oneof(
  numericKey,
  fc.constantFrom<SortKey>(1n, -2n, true, false),
  fc.constantFrom<SortKey>('', 'a', 'b', '10', 'é', 'é'),
  missingKey,
);
const withIds = (keys: readonly SortKey[]): Element[] => keys.map((key, id) => ({ key, id }));
const elementsOf = (key: fc.Arbitrary<SortKey>): fc.Arbitrary<Element[]> =>
  fc.array(key, { maxLength: 12 }).map(withIds);
const isPresent = (item: Element): boolean => !(item.key === undefined || item.key === null || Number.isNaN(item.key));

test('minBy and maxBy: the first element whose key is Math.min or Math.max of the keys that are not NaN', () => {
  fc.assert(
    fc.property(elementsOf(fc.oneof(numericKey, fc.constant(Number.NaN))), (items) => {
      const present = items.filter(isPresent);
      const keys = present.map((item) => item.key as number);
      const least = Math.min(...keys);
      const most = Math.max(...keys);
      assert.equal(
        minBy(items, keyOf),
        present.find((item) => item.key === least),
      );
      assert.equal(
        maxBy(items, keyOf),
        present.find((item) => item.key === most),
      );
    }),
    PROPERTIES,
  );
});

test('minBy and maxBy: the first element of sortBy over the present keys, ascending and descending', () => {
  fc.assert(
    fc.property(elementsOf(anyKey), (items) => {
      const present = items.filter(isPresent);
      assert.equal(minBy(items, keyOf), sortBy(present, keyOf)[0]);
      assert.equal(maxBy(items, keyOf), sortBy(present, { key: keyOf, order: 'desc' })[0]);
    }),
    PROPERTIES,
  );
});

test('sortBy: numeric keys as toSorted orders them, missing keys after, in input order, in both orders', () => {
  fc.assert(
    fc.property(elementsOf(fc.oneof(numericKey, missingKey)), fc.boolean(), (items, descending) => {
      const sign = descending ? -1 : 1;
      const present = items.filter(isPresent);
      const expected = [
        ...present.toSorted((a, b) => sign * ((a.key as number) - (b.key as number))),
        ...items.filter((item) => !isPresent(item)),
      ];
      assert.deepEqual(ids(sortBy(items, { key: keyOf, order: descending ? 'desc' : 'asc' })), ids(expected));
    }),
    PROPERTIES,
  );
});

test('sortBy: strings by code unit, as the default toSorted orders them, after every numeric key', () => {
  fc.assert(
    fc.property(elementsOf(anyKey), (items) => {
      const sorted = sortBy(items, keyOf);
      const strings = sorted.filter((item) => typeof item.key === 'string').map(keyOf);
      assert.deepEqual(strings, strings.toSorted());
      const kinds = sorted.map((item) => (!isPresent(item) ? 2 : typeof item.key === 'string' ? 1 : 0));
      assert.deepEqual(kinds, kinds.toSorted());
    }),
    PROPERTIES,
  );
});

interface Pair {
  readonly a: SortKey;
  readonly b: SortKey;
  readonly id: number;
}

const order = fc.constantFrom<'asc' | 'desc'>('asc', 'desc');

test('sortBy: two criteria equal a stable sort by the second, then by the first; each key called once', () => {
  const pairs = fc
    .array(fc.record({ a: anyKey, b: anyKey }), { maxLength: 12 })
    .map((records) => records.map((record, id): Pair => ({ ...record, id })));
  fc.assert(
    fc.property(pairs, order, order, (items, first, second) => {
      const calls: number[] = [];
      const byA: SortCriterion<Pair> = {
        key: (item, index) => {
          calls.push(index);
          return item.a;
        },
        order: first,
      };
      const byB: SortCriterion<Pair> = { key: (item) => item.b, order: second };
      const sorted = sortBy(items, [byA, byB]);
      assert.deepEqual(
        calls,
        items.map((_, index) => index),
      );
      assert.deepEqual(sorted, sortBy(sortBy(items, byB), byA));
    }),
    PROPERTIES,
  );
});

// Consistent comparators, some read only after ToNumber or with `NaN` for equal elements, on elements that may be
// `undefined` or holes.
const consistent = fc.constantFrom<(a: Element, b: Element) => number>(
  (a, b) => (a.key as number) - (b.key as number),
  (a, b) => (b.key as number) - (a.key as number),
  () => 0,
  (a, b) => Math.sign((a.key as number) - (b.key as number)) * Number.POSITIVE_INFINITY,
  (a, b) => String((a.key as number) - (b.key as number)) as unknown as number,
  (a, b) => ((a.key as number) % 3) - ((b.key as number) % 3),
);
const smallKey = fc.integer({ min: -3, max: 3 });
const sparseElements = fc
  .sparseArray(fc.option(fc.record({ key: smallKey, id: fc.constant(0) }), { nil: undefined }), { maxLength: 14 })
  .map((items) => {
    const copy: (Element | undefined)[] = [];
    copy.length = items.length;
    items.forEach((item, id) => {
      copy[id] = item === undefined ? undefined : { key: item.key, id };
    });
    return copy;
  });

test('topK: the k first elements of toSorted, for an array with holes and for a generator', () => {
  fc.assert(
    fc.property(sparseElements, fc.nat(16), consistent, (items, k, byKey) => {
      const compare = byKey as (a: Element | undefined, b: Element | undefined) => number;
      const expected = ids(items.toSorted(compare).slice(0, k));
      assert.deepEqual(ids(topK(items, k, compare)), expected);
      assert.deepEqual(ids(topK(once(Array.from(items)), k, compare)), expected);
    }),
    PROPERTIES,
  );
});

// Comparators that are not consistent: answers drawn per pair, answers that change from one call to the next, and
// `a > b` read as a number. Each counts its calls and throws past the bound of the heap, so a loop fails the test.
const inconsistent = fc.oneof(
  fc
    .func(fc.oneof(fc.integer({ min: -2, max: 2 }), fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, -0)))
    .map((answer) => (a: Element, b: Element) => answer(a.id, b.id)),
  fc.array(fc.integer({ min: -1, max: 1 }), { minLength: 1, maxLength: 5 }).map((answers) => {
    let call = 0;
    return () => answers[call++ % answers.length]!;
  }),
  fc.constant((a: Element, b: Element) => Number((a.key as number) > (b.key as number))),
);

class TooManyCalls extends Error {}

function bounded<T>(compare: (a: T, b: T) => number, bound: number): { compare: (a: T, b: T) => number } {
  let calls = 0;
  return {
    compare: (a, b) => {
      calls += 1;
      if (calls > bound) {
        throw new TooManyCalls(`${calls} calls`);
      }
      return compare(a, b);
    },
  };
}

test('topK: a comparator that is not consistent ends within O(n log k) calls and returns min(k, n) elements', () => {
  fc.assert(
    fc.property(sparseElements, fc.nat(16), inconsistent, (items, k, compare) => {
      const n = items.length;
      const depth = Math.ceil(Math.log2(k + 1));
      const counted = bounded(
        compare as (a: Element | undefined, b: Element | undefined) => number,
        n * (1 + 2 * depth) + 2 * k * depth,
      );
      const top = topK(items, k, counted.compare);
      const defined = Array.from(items).filter((item) => item !== undefined);
      const shown = top.filter((item) => item !== undefined);
      assert.equal(shown.length, Math.min(k, defined.length));
      assert.equal(top.length, Math.min(k, n));
      assert.deepEqual(top.slice(shown.length), Array.from({ length: top.length - shown.length }));
      assert.equal(new Set(shown).size, shown.length);
      assert.ok(shown.every((item) => defined.includes(item)));
    }),
    PROPERTIES,
  );
});

test('sortBy: a compare that is not consistent still returns a permutation of the input', () => {
  fc.assert(
    fc.property(elementsOf(numericKey), inconsistent, (items, compare) => {
      const sorted = sortBy(items, { key: (item) => item, compare: compare as (a: unknown, b: unknown) => number });
      assert.deepEqual(ids(sorted).toSorted(), ids(items).toSorted());
    }),
    PROPERTIES,
  );
});

test('paginate: the page is the slice of the collection, and the pages put together give it back', () => {
  fc.assert(
    fc.property(
      fc.sparseArray(fc.nat(9), { maxLength: 30 }),
      fc.nat(8),
      fc.integer({ min: 1, max: 7 }),
      (items, pageIndex, pageSize) => {
        const whole = Array.from(items);
        const page = paginate(items, { pageIndex, pageSize });
        assert.deepEqual(page, {
          items: whole.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
          pageIndex,
          pageSize,
          length: whole.length,
          pageCount: Math.ceil(whole.length / pageSize),
        });
        assert.deepEqual(paginate(once(whole), { pageIndex, pageSize }), page);
        const pages = Array.from({ length: page.pageCount }, (_, index) =>
          paginate(items, { pageIndex: index, pageSize }),
        );
        assert.deepEqual(
          pages.flatMap((each) => each.items),
          whole,
        );
      },
    ),
    PROPERTIES,
  );
});

// Adversarial values reach each function as an element, as a key, or as the collection itself; what may come out is
// a result, a TypeError (not iterable, a key that is not a `SortKey`, a result that is no number), a RangeError, or
// the error of the hostile value.
function survives(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    assert.ok(
      error instanceof HostileError || error instanceof TypeError || error instanceof RangeError,
      String(error),
    );
  }
}

const CALLS = {
  minBy: (items: unknown, key: Callback) => minBy(items as Iterable<unknown>, key as () => SortKey),
  maxBy: (items: unknown, key: Callback) => maxBy(items as Iterable<unknown>, key as () => SortKey),
  sortBy: (items: unknown, key: Callback) =>
    sortBy(items as Iterable<unknown>, [key as () => SortKey, { key, compare: key as () => number }]),
  topK: (items: unknown, compare: Callback) => topK(items as Iterable<unknown>, 2, compare as () => number),
} as const;

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

for (const [name, call] of Object.entries(CALLS)) {
  const handles = (value: unknown): void => {
    survives(() => call(value, (item) => item));
    survives(() => call([value, value], (item) => item));
    survives(() => call([1, 2], () => value));
  };
  declareAdversarial(SUBPATH, name, {
    boundary: handles,
    structures: handles,
    hostile: handles,
    unicode: (text) => {
      // A key is compared by code unit, never normalized: as the default `toSorted` orders strings.
      const texts = [text, text.normalize('NFD'), text.normalize('NFC')];
      const expected = texts.toSorted();
      const result =
        name === 'topK' ? topK(texts, 3, byCodeUnit) : (call(texts, (item) => item) as string | string[] | undefined);
      if (name === 'minBy') {
        assert.equal(result, expected[0]);
      } else if (name === 'maxBy') {
        assert.equal(result, expected.at(-1));
      } else {
        assert.deepEqual(result, expected);
      }
    },
    callbacks: (callback) => {
      // A key is called once per element and criterion, a comparator O(n log k) times; what either throws comes out
      // as it is.
      // Bounded, so that a loop fails the check instead of never returning.
      let calls = 0;
      const counted: Callback = (...args) => {
        calls += 1;
        if (calls > 50) {
          throw new TooManyCalls(`${String(calls)} calls`);
        }
        return callback(...args);
      };
      try {
        call([1, 2, 3], counted);
        // sortBy calls both keys three times, and its compare among equal first keys.
        assert.ok(calls >= 1 && calls <= (name === 'sortBy' ? 12 : 3), `${String(calls)} calls`);
      } catch (error) {
        assert.ok(
          error instanceof CallbackError || typeof error === 'string' || error instanceof TypeError,
          String(error),
        );
        assert.ok(calls >= 1);
      }
    },
    async: { na: `${name} is synchronous and takes no signal` },
  });
}

declareAdversarial(SUBPATH, 'paginate', {
  boundary: (value) => {
    survives(() => paginate(value as Iterable<unknown>, { pageIndex: 0, pageSize: 2 }));
    survives(() => paginate([1, 2, 3], { pageIndex: value as number, pageSize: 2 }));
    survives(() => paginate([1, 2, 3], { pageIndex: 0, pageSize: value as number }));
  },
  structures: (value) => {
    survives(() => paginate(value as Iterable<unknown>, { pageIndex: 0, pageSize: 2 }));
    survives(() => paginate([value, value, value], { pageIndex: 1, pageSize: 2 }));
  },
  hostile: (value) => {
    survives(() => paginate(value as Iterable<unknown>, { pageIndex: 0, pageSize: 2 }));
    survives(() => paginate([1, 2], value as PageRequest));
  },
  unicode: (text) => {
    // A string is paged by code point, as its iterator reads it: a surrogate pair is never cut.
    const whole = [...text];
    assert.deepEqual(paginate(text, { pageIndex: 0, pageSize: whole.length + 1 }).items, whole);
  },
  callbacks: { na: 'paginate takes no callback' },
  async: { na: 'paginate is synchronous and takes no signal' },
});
