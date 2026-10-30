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

import { liveCodes } from '../../../../scripts/check-issue-codes.ts';
import {
  countBy,
  differenceBy,
  indexBy,
  intersectionBy,
  partition,
  uniqueBy,
  type CollectionIssue,
  type KeyOptions,
} from './index.ts';

const SUBPATH = '@yaltaan/core/collection';
const SAME_VALUE: KeyOptions = { equality: 'SameValue' };

// Elements whose keys collide often, with the values SameValueZero and SameValue tell apart (`0`, `-0`, `NaN`) and the
// ones a record would merge (`1` and `'1'`, `"__proto__"`).
const keys = fc.constantFrom<unknown>(0, -0, Number.NaN, 1, '1', '__proto__', 'a', undefined, null, true);
const elements = fc.array(fc.record({ key: keys, tag: fc.nat(3) }), { maxLength: 12 });
const keyOfElement = (element: { readonly key: unknown }): unknown => element.key;

// A generator, read at most once: a second read finds it exhausted.
function* once<T>(items: readonly T[]): Generator<T> {
  yield* items;
}

test('partition splits by the predicate and keeps the order on both sides', () => {
  assert.deepEqual(
    partition([1, 2, 3, 4, 5], (n) => n % 2 === 0),
    [
      [2, 4],
      [1, 3, 5],
    ],
  );
  assert.deepEqual(
    partition(['a', 'b', 'c'], (_item, index) => index === 1),
    [['b'], ['a', 'c']],
  );
  assert.deepEqual(
    partition([], () => true),
    [[], []],
  );
});

test('partition narrows both sides with a type guard', () => {
  const [strings, others] = partition(['a', 1, 'b', null], (item): item is string => typeof item === 'string');
  assertType<Equal<typeof strings, string[]>>();
  assertType<Equal<typeof others, (number | null)[]>>();
  assert.deepEqual(strings, ['a', 'b']);
  assert.deepEqual(others, [1, null]);
});

test('a hole reads as undefined and counts as a position', () => {
  // eslint-free sparse array: the hole at 1 is never assigned.
  const sparse: (number | undefined)[] = [1, , 3]; // prettier-ignore
  assert.deepEqual(
    partition(sparse, (item) => item === undefined),
    [[undefined], [1, 3]],
  );
  assert.deepEqual(
    [...countBy(sparse, (item) => item).entries()],
    [
      [1, 1],
      [undefined, 1],
      [3, 1],
    ],
  );
});

test('any iterable is read once, in order', () => {
  assert.deepEqual(
    partition(once([1, 2, 3]), (n) => n > 1),
    [[2, 3], [1]],
  );
  assert.deepEqual(
    uniqueBy(new Set([1, 2, 3]), (n) => n % 2),
    [1, 2],
  );
  assert.deepEqual(
    [...countBy('banana', (letter) => letter).entries()],
    [
      ['b', 1],
      ['a', 3],
      ['n', 2],
    ],
  );
  const others = once([2, 3]);
  assert.deepEqual(
    intersectionBy(once([1, 2, 3, 2]), others, (n) => n),
    [2, 3, 2],
  );
  assert.deepEqual([...others], []);
});

test('indexBy keys each element, and refuses a key met twice with both positions', () => {
  const users = [
    { id: 7, name: 'Ada' },
    { id: 9, name: 'Grace' },
  ];
  const index = indexBy(users, (user) => user.id);
  assertType<
    Equal<typeof index, import('../result/index.ts').Result<Map<number, { id: number; name: string }>, CollectionIssue>>
  >();
  assert.ok(index.ok);
  assert.deepEqual(
    [...index.value.entries()],
    [
      [7, users[0]],
      [9, users[1]],
    ],
  );
  assert.equal(index.value.get(9), users[1]);
  const duplicate = indexBy([{ id: 1 }, { id: 2 }, { id: 1 }], (item) => item.id);
  assert.deepEqual(duplicate, {
    ok: false,
    error: { code: 'collection.duplicate_key', path: [2], params: { first: 0 } },
  });
});

test('keys keep their type and compare by SameValueZero, "__proto__" included', () => {
  assert.deepEqual(
    [...countBy([1, '1', 1], (item) => item).entries()],
    [
      [1, 2],
      ['1', 1],
    ],
  );
  assert.deepEqual(
    [...countBy([0, -0, Number.NaN, Number.NaN], (item) => item).entries()],
    [
      [0, 2],
      [Number.NaN, 2],
    ],
  );
  const index = indexBy(['__proto__', 'a'], (item) => item);
  assert.ok(index.ok);
  assert.deepEqual([...index.value.keys()], ['__proto__', 'a']);
  assert.equal(Object.getPrototypeOf(index.value), Map.prototype);
});

test('uniqueBy keeps the first element of each key; SameValue tells -0 from 0', () => {
  assert.deepEqual(uniqueBy([1.2, 1.7, 2.1], Math.floor), [1.2, 2.1]);
  assert.deepEqual(
    uniqueBy([0, -0, Number.NaN, Number.NaN], (n) => n),
    [0, Number.NaN],
  );
  assert.deepEqual(
    uniqueBy([0, -0, Number.NaN, Number.NaN], (n) => n, SAME_VALUE),
    [0, -0, Number.NaN],
  );
});

test('intersectionBy and differenceBy keep duplicates of the first collection, in its order', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 1 }, { id: 3 }];
  const others = [{ id: 1 }, { id: 1 }];
  assert.deepEqual(
    intersectionBy(items, others, (item) => item.id),
    [{ id: 1 }, { id: 1 }],
  );
  assert.deepEqual(
    differenceBy(items, others, (item) => item.id),
    [{ id: 2 }, { id: 3 }],
  );
  assert.deepEqual(
    differenceBy([0, -0], [0], (n) => n),
    [],
  );
  assert.deepEqual(
    differenceBy([0, -0], [0], (n) => n, SAME_VALUE),
    [-0],
  );
  assert.deepEqual(
    intersectionBy([Number.NaN], [Number.NaN], (n) => n, SAME_VALUE),
    [Number.NaN],
  );
});

test('a callback that is not a function, or an unknown equality, is a TypeError', () => {
  for (const call of [
    () => partition([1], undefined as never),
    () => indexBy([1], 'id' as never),
    () => countBy([1], null as never),
    () => uniqueBy([1], {} as never),
    () => uniqueBy([1], (n) => n, { equality: 'loose' as never }),
    () => intersectionBy([1], [1], 1 as never),
    () => differenceBy([1], [1], (n) => n, { equality: 'SameValueZero ' as never }),
    () => partition(1 as never, () => true),
  ]) {
    assert.throws(call, TypeError);
  }
});

// Laws over generated collections, judged by the platform: Array.prototype.filter for the order, a Map for
// SameValueZero, Object.is for SameValue.
const PROPERTIES = { numRuns: 300 };

test('partition: every element on exactly one side, each side in input order', () => {
  fc.assert(
    fc.property(elements, fc.nat(3), (items, tag) => {
      const keep = (element: { readonly tag: number }): boolean => element.tag === tag;
      const [passed, failed] = partition(items, keep);
      assert.deepEqual(passed, items.filter(keep));
      assert.deepEqual(
        failed,
        items.filter((element) => !keep(element)),
      );
    }),
    PROPERTIES,
  );
});

test('uniqueBy: idempotent, keys distinct, every key of the input kept, as new Set does for keys', () => {
  fc.assert(
    fc.property(elements, fc.boolean(), (items, sameValue) => {
      const options: KeyOptions = sameValue ? SAME_VALUE : {};
      const unique = uniqueBy(items, keyOfElement, options);
      assert.deepEqual(uniqueBy(unique, keyOfElement, options), unique);
      const uniqueKeys = unique.map(keyOfElement);
      if (sameValue) {
        assert.ok(uniqueKeys.every((key, i) => uniqueKeys.findIndex((other) => Object.is(other, key)) === i));
        assert.ok(items.every((item) => uniqueKeys.some((key) => Object.is(key, item.key))));
      } else {
        // A Set holds -0 as 0: compared as the Set would hold them.
        assert.deepEqual([...new Set(uniqueKeys)], [...new Set(items.map(keyOfElement))]);
        assert.equal(new Set(uniqueKeys).size, uniqueKeys.length);
      }
    }),
    PROPERTIES,
  );
});

test('countBy: counts add up to the length, each the number of elements with that key', () => {
  fc.assert(
    fc.property(elements, (items) => {
      const counts = countBy(items, keyOfElement);
      let total = 0;
      for (const [key, count] of counts) {
        total += count;
        assert.equal(count, items.filter((item) => new Set([key]).has(item.key)).length);
      }
      assert.equal(total, items.length);
      assert.deepEqual([...counts.keys()], [...new Set(items.map(keyOfElement))]);
    }),
    PROPERTIES,
  );
});

test('indexBy: ok exactly when no key repeats, and an error names the first repeat', () => {
  fc.assert(
    fc.property(elements, (items) => {
      const index = indexBy(items, keyOfElement);
      const unique = uniqueBy(items, keyOfElement);
      if (index.ok) {
        assert.equal(unique.length, items.length);
        assert.deepEqual([...index.value.values()], items);
        return;
      }
      const [second] = index.error.path as [number];
      const { first } = index.error.params;
      assert.ok(first < second);
      assert.ok(new Set([items[first]?.key]).has(items[second]?.key));
      // No earlier repeat: the elements before the second have distinct keys.
      assert.equal(uniqueBy(items.slice(0, second), keyOfElement).length, second);
    }),
    PROPERTIES,
  );
});

test('intersectionBy and differenceBy: the two halves of a partition by membership of the key', () => {
  fc.assert(
    fc.property(elements, elements, fc.boolean(), (items, others, sameValue) => {
      const options: KeyOptions = sameValue ? SAME_VALUE : {};
      const member = (item: { readonly key: unknown }): boolean =>
        others.some((other) => (sameValue ? Object.is(other.key, item.key) : new Set([other.key]).has(item.key)));
      assert.deepEqual(
        [intersectionBy(items, others, keyOfElement, options), differenceBy(items, others, keyOfElement, options)],
        partition(items, member),
      );
    }),
    PROPERTIES,
  );
});

test('the codes of this module are the collection codes of the registry', () => {
  // Keyed, so that the compiler checks the list is whole.
  const codes: { readonly [Code in CollectionIssue['code']]: true } = { 'collection.duplicate_key': true };
  const registered = [...liveCodes('core')].filter((code) => code.startsWith('collection.'));
  assert.deepEqual(registered.toSorted(), Object.keys(codes).toSorted());
});

// Adversarial values reach each function as an element, as a key, or as the collection itself; what may come out is
// a result, a TypeError (not iterable), or the error of the hostile value.
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
  partition: (items: unknown, key: Callback) => partition(items as Iterable<unknown>, key),
  indexBy: (items: unknown, key: Callback) => indexBy(items as Iterable<unknown>, key),
  countBy: (items: unknown, key: Callback) => countBy(items as Iterable<unknown>, key),
  uniqueBy: (items: unknown, key: Callback) => uniqueBy(items as Iterable<unknown>, key, SAME_VALUE),
  intersectionBy: (items: unknown, key: Callback) => intersectionBy(items as Iterable<unknown>, [items], key),
  differenceBy: (items: unknown, key: Callback) => differenceBy(items as Iterable<unknown>, [items], key),
} as const;

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
      // A key is compared by code units, never normalized: a text and its NFD form are two keys.
      const result = call([text, text.normalize('NFD')], (item) => item);
      const keyCount = text === text.normalize('NFD') ? 1 : 2;
      if (name === 'countBy' || name === 'uniqueBy') {
        assert.equal(result instanceof Map ? result.size : (result as unknown[]).length, keyCount);
      } else if (name === 'indexBy') {
        assert.equal((result as { ok: boolean }).ok, keyCount === 2);
      }
    },
    callbacks: (callback) => {
      // Called once per element of the collection, then once per element of the others for the set operations;
      // what it throws comes out as it is.
      const items = [1, 2, 3];
      let calls = 0;
      const counted: Callback = (...args) => {
        calls += 1;
        return callback(...args);
      };
      try {
        call(items, counted);
        // indexBy stops at its first repeated key; the set operations read the others first, and a callback that
        // grows the collection it is given adds elements to read.
        assert.ok(calls >= (name === 'indexBy' ? 2 : 3) && calls <= 8, `${String(calls)} calls`);
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
