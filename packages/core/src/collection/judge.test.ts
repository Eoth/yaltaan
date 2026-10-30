// The collection functions against their es-toolkit equivalents (`partition`, `keyBy`, `countBy`, `uniqBy`,
// `intersectionBy`, `differenceBy`), on generated arrays of elements whose keys collide often: the values SameValueZero
// merges (`0` and `-0`, `NaN`), the ones a record merges (`1` and `'1'`) and `"__proto__"`. A `Map` of ours is read
// as the record es-toolkit would build, each key written as its own property, so that the two can be compared.
// Blind spots: only arrays are drawn (es-toolkit reads no other iterable), keys are primitives (an object key is
// compared by identity on both sides, and a record would turn it into "[object Object]"), and `equality: 'SameValue'`
// has no es-toolkit equivalent.
import {
  countBy as theirCountBy,
  differenceBy as theirDifferenceBy,
  intersectionBy as theirIntersectionBy,
} from 'es-toolkit';
import { keyBy, partition as theirPartition, uniqBy } from 'es-toolkit';

import { createJudge, fc, type Difference } from '@yaltaan/testing';

import { countBy, differenceBy, indexBy, intersectionBy, partition, uniqueBy } from './index.ts';

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

function assertSameElements(actual: unknown, expected: readonly Element[]): void {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((item, i) => item !== expected[i])) {
    throw new Error('es-toolkit no longer keeps the first element of each key');
  }
}
