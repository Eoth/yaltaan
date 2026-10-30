// The collection functions against their es-toolkit equivalents (`partition`, `keyBy`, `countBy`, `uniqBy`,
// `intersectionBy`, `differenceBy`, `minBy`, `maxBy`, `orderBy`, and `chunk` for the pages of `paginate`), on generated
// arrays of elements whose keys collide often: the values SameValueZero merges (`0` and `-0`, `NaN`), the ones a
// record merges (`1` and `'1'`) and `"__proto__"`, and for the order the missing keys and the keys of mixed types. A
// `Map` of ours is read as the record es-toolkit would build, each key written as its own property, so that the two
// can be compared.
// Blind spots: only arrays are drawn (es-toolkit reads no other iterable), keys are primitives (an object key is
// compared by identity on both sides, and a record would turn it into "[object Object]"), `equality: 'SameValue'`
// and the `compare` of a sort criterion have no es-toolkit equivalent, es-toolkit's `minBy` and `maxBy` are typed for
// numbers and get only numbers, and `topK` has no equivalent: its judge is `toSorted`, in the laws of the tests.
import {
  countBy as theirCountBy,
  differenceBy as theirDifferenceBy,
  intersectionBy as theirIntersectionBy,
} from 'es-toolkit';
import {
  chunk,
  keyBy,
  maxBy as theirMaxBy,
  minBy as theirMinBy,
  orderBy,
  partition as theirPartition,
  uniqBy,
} from 'es-toolkit';

import { createJudge, fc, type Difference } from '@yaltaan/testing';

import {
  countBy,
  differenceBy,
  indexBy,
  intersectionBy,
  maxBy,
  minBy,
  paginate,
  partition,
  sortBy,
  uniqueBy,
  type SortKey,
} from './index.ts';

const judge = createJudge(new URL('./index.ts', import.meta.url), 'es-toolkit');

interface Element {
  readonly key: unknown;
  readonly tag: number;
}

const keys = fc.constantFrom<unknown>(0, -0, Number.NaN, 1, '1', '__proto__', 'a', undefined, null, true);
const element = fc.record({ key: keys, tag: fc.nat(3) });
// Short arrays for the functions whose differences are drawn often, so that a quarter of the inputs stays compared.
const short = fc.array(element, { maxLength: 4 });
const long = fc.array(element, { maxLength: 12 });
const keyOf = (item: Element): unknown => item.key;

function asRecord(map: ReadonlyMap<unknown, unknown>): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, value] of map) {
    Object.defineProperty(record, String(key), { value, writable: true, enumerable: true, configurable: true });
  }
  return record;
}

const hasRepeatedKey = (items: readonly Element[]): boolean => new Set(items.map(keyOf)).size < items.length;
const recordCollision: Difference<readonly Element[]> = {
  text:
    'the result is a `Map`, whose keys keep their type; es-toolkit returns a record, whose keys are strings, ' +
    "so `1` and `'1'` collide",
  applies: (items) => {
    const distinct = [...new Set(items.map(keyOf))];
    return new Set(distinct.map(String)).size < distinct.length;
  },
};
const protoKey: Difference<readonly Element[]> = {
  text: 'a "__proto__" key is a key like any other; es-toolkit assigns it, which replaces the prototype of its record',
  applies: (items) => items.some((item) => item.key === '__proto__'),
};

judge.compare('partition', {
  input: long,
  ours: (items) => partition(items, (item) => item.tag === 0),
  theirs: (items) => theirPartition(items, (item) => item.tag === 0),
});

judge.compare('indexBy', {
  input: short,
  ours: (items) => {
    const index = indexBy(items, keyOf);
    return index.ok ? asRecord(index.value) : index;
  },
  theirs: (items) => keyBy(items, (item) => item.key as PropertyKey),
  differences: [
    {
      text: 'a key met twice is an error with the position of both elements; es-toolkit keeps the last element',
      applies: hasRepeatedKey,
    },
    recordCollision,
    protoKey,
  ],
});

judge.compare('countBy', {
  input: short,
  ours: (items) => asRecord(countBy(items, keyOf)),
  theirs: (items) => theirCountBy(items, (item) => item.key as PropertyKey),
  differences: [recordCollision, protoKey],
});

judge.compare('uniqueBy', {
  input: long,
  ours: (items) => uniqueBy(items, keyOf),
  theirs: (items) => uniqBy(items, keyOf),
});

const pairs = fc.tuple(long, long);

judge.compare('intersectionBy', {
  input: pairs,
  ours: ([items, others]) => intersectionBy(items, others, keyOf),
  theirs: ([items, others]) => theirIntersectionBy(items, others, keyOf),
  differences: [
    {
      text:
        "an element of the first collection is kept each time its key is among the others' keys; " +
        'es-toolkit keeps it once per key',
      applies: ([items, others]) => {
        const shared = new Set(others.map(keyOf));
        return hasRepeatedKey(items.filter((item) => shared.has(item.key)));
      },
      // Theirs is ours without the repeats: the first element of each key, in order.
      expected: (theirs, [items, others]) => {
        const shared = new Set(others.map(keyOf));
        const kept = items.filter((item) => shared.has(item.key));
        assertSameElements(theirs, uniqBy(kept, keyOf));
        return kept;
      },
    },
  ],
});

judge.compare('differenceBy', {
  input: pairs,
  ours: ([items, others]) => differenceBy(items, others, keyOf),
  theirs: ([items, others]) => theirDifferenceBy(items, others, keyOf),
});

interface Ranked {
  readonly key: number;
  readonly id: number;
}

// Mostly numbers that are not `NaN`, so that most inputs reach no difference.
const ranked = fc
  .array(
    fc.oneof(
      {
        weight: 12,
        arbitrary: fc.constantFrom(0, -0, 1, 2, -1, 0.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
      },
      { weight: 1, arbitrary: fc.constant(Number.NaN) },
    ),
    { maxLength: 8 },
  )
  .map((keys) => keys.map((key, id): Ranked => ({ key, id })));
const rankOf = (item: Ranked): number => item.key;
const nanKey: Difference<readonly Ranked[]> = {
  text: 'an element whose key is `NaN` is never chosen; es-toolkit returns the first element whose key is `NaN`',
  applies: (items) => items.some((item) => Number.isNaN(item.key)),
};

judge.compare('minBy', {
  input: ranked,
  ours: (items) => minBy(items, rankOf),
  theirs: (items) => theirMinBy(items, rankOf),
  differences: [nanKey],
});

judge.compare('maxBy', {
  input: ranked,
  ours: (items) => maxBy(items, rankOf),
  theirs: (items) => theirMaxBy(items, rankOf),
  differences: [nanKey],
});

interface Row {
  readonly a: SortKey;
  readonly b: SortKey;
  readonly id: number;
}

const numericKeys = fc.constantFrom<SortKey>(0, -0, 1, 2, -1, Number.POSITIVE_INFINITY, 1n, true, false);
const textKeys = fc.constantFrom<SortKey>('', 'a', 'b', '10', 'é');
const missingKeys = fc.constantFrom<SortKey>(undefined, null, Number.NaN);
// Each column of an input draws from one pool: numeric or text keys alone, or mixed with the other kind or with
// missing keys, so that two inputs in five or so reach no difference.
const pool = fc.constantFrom(
  numericKeys,
  numericKeys,
  textKeys,
  textKeys,
  fc.oneof(numericKeys, textKeys),
  fc.oneof(numericKeys, missingKeys),
  fc.oneof(textKeys, missingKeys),
);
const order = fc.constantFrom<'asc' | 'desc'>('asc', 'desc');
const rows = fc
  .tuple(pool, pool)
  .chain(([a, b]) => fc.array(fc.record({ a, b }), { maxLength: 7 }))
  .map((records) => records.map((record, id): Row => ({ ...record, id })));
const columnsOf = (items: readonly Row[]): SortKey[][] => [items.map((item) => item.a), items.map((item) => item.b)];

judge.compare('sortBy', {
  input: fc.tuple(rows, order, order),
  ours: ([items, first, second]) =>
    sortBy(items, [
      { key: (item) => item.a, order: first },
      { key: (item) => item.b, order: second },
    ]),
  theirs: ([items, first, second]) => orderBy(items, [(item) => item.a, (item) => item.b], [first, second]),
  differences: [
    {
      text:
        '`NaN` is a missing key, after every present key; es-toolkit compares it with `<`, so it equals every key ' +
        'and the input may come back unsorted',
      applies: ([items]) => columnsOf(items).some((keys) => keys.some((key) => Number.isNaN(key))),
    },
    {
      text:
        '`undefined` and `null` sort last in both orders, equal to each other; es-toolkit sorts `null` before ' +
        '`undefined`, and both first in descending order',
      applies: ([items]) => columnsOf(items).some((keys) => keys.some((key) => key === undefined || key === null)),
    },
    {
      text: 'a number sorts before a string; es-toolkit compares them with `<`, which converts the string to a number',
      applies: ([items]) =>
        columnsOf(items).some(
          (keys) =>
            keys.some((key) => typeof key === 'string') &&
            keys.some((key) => typeof key === 'number' || typeof key === 'bigint' || typeof key === 'boolean'),
        ),
    },
  ],
});

judge.compare('paginate', {
  input: fc.tuple(fc.array(fc.nat(9), { maxLength: 20 }), fc.nat(6), fc.integer({ min: 1, max: 6 })),
  ours: ([items, pageIndex, pageSize]) => paginate(items, { pageIndex, pageSize }).items,
  theirs: ([items, pageIndex, pageSize]) => chunk(items, pageSize)[pageIndex] ?? [],
});

function assertSameElements(actual: unknown, expected: readonly Element[]): void {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((item, i) => item !== expected[i])) {
    throw new Error('es-toolkit no longer keeps the first element of each key');
  }
}
