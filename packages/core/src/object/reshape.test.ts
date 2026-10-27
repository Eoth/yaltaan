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

import { defaults, mapKeys, mapValues, merge, type ArrayStrategy, type Defaulted, type Merged } from './index.ts';

const SUBPATH = '@yaltaan/core/object';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const STRATEGIES: readonly ArrayStrategy[] = ['replace', 'concat'];

// fast-check defines dictionary keys as own data properties and draws objects without a prototype too, so the data
// holds "__proto__" as a key and dictionaries that are not plain Object instances.
const keyNames = fc.constantFrom('a', 'b', 'c', '__proto__', 'constructor', 'toString', '0');
const list = fc.array(fc.integer(), { maxLength: 3 });
const leafOf = (withUndefined: boolean): fc.Arbitrary<unknown> =>
  fc.oneof(fc.integer(), fc.string(), fc.constant(null), list, ...(withUndefined ? [fc.constant(undefined)] : []));
const dataOf = (withUndefined: boolean): fc.Arbitrary<unknown> =>
  fc.letrec((tie) => ({
    value: fc.oneof(
      { depthSize: 'small' },
      leafOf(withUndefined),
      fc.dictionary(keyNames, tie('value'), { maxKeys: 4 }),
    ),
  })).value;
const data = dataOf(true);
const definedData = dataOf(false);
const records = fc.dictionary(keyNames, data, { maxKeys: 4 });

const MISSING = Symbol('missing');
type Key = string | symbol;

function isRecord(value: unknown): value is Record<Key, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/**
 * Checks what laying `upper` over `lower` gave, place by place: where both hold a record, a new record with the keys
 * of both and the prototype of `prototypeOf`'s; where `upper` lacks a key, or holds a value `absent` says is none, the
 * value of `lower` itself; anywhere else the value of `upper` itself, or both arrays joined when `concat`.
 */
function assertLaidOver(
  result: unknown,
  lower: unknown,
  upper: unknown,
  rules: {
    readonly concat: boolean;
    readonly absent: (value: unknown) => boolean;
    readonly prototypeOf: 'lower' | 'upper';
  },
  path: readonly Key[] = [],
): void {
  const here = String(path);
  if (rules.absent(upper)) {
    assert.ok(Object.is(result, lower), here);
  } else if (isRecord(lower) && isRecord(upper)) {
    assert.ok(isRecord(result) && result !== lower && result !== upper, here);
    const prototype: unknown = Object.getPrototypeOf(rules.prototypeOf === 'lower' ? lower : upper);
    assert.equal(Object.getPrototypeOf(result), prototype, here);
    assert.deepEqual(new Set(Object.keys(result)), new Set([...Object.keys(lower), ...Object.keys(upper)]), here);
    for (const key of Object.keys(result)) {
      const inLower = Object.prototype.hasOwnProperty.call(lower, key);
      const inUpper = Object.prototype.hasOwnProperty.call(upper, key);
      if (inUpper && inLower) {
        assertLaidOver(result[key], lower[key], upper[key], rules, [...path, key]);
      } else {
        assert.ok(Object.is(result[key], inUpper ? upper[key] : lower[key]), String([...path, key]));
      }
    }
  } else if (rules.concat && Array.isArray(lower) && Array.isArray(upper)) {
    assert.deepEqual(result, [...(lower as unknown[]), ...(upper as unknown[])], here);
    assert.ok(result !== lower && result !== upper, here);
  } else {
    assert.ok(Object.is(result, upper), here);
  }
}

const never = (): boolean => false;

/** A plain description of a value, its keys sorted, to compare values before and after a call, or across calls. */
function shape(value: unknown, prototypes = true): unknown {
  if (Array.isArray(value)) {
    return { array: value.map((element) => shape(element, prototypes)) };
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    const prototype = prototypes ? Object.getPrototypeOf(value) === null : 'not compared';
    return { prototype, fields: keys.map((key) => [key, shape(value[key], prototypes)]) };
  }
  return { primitive: value };
}

/** A data property, so that "__proto__" is a key and never the prototype. */
function withField(record: object, key: Key, value: unknown): Record<Key, unknown> {
  const copy = Object.create(Object.getPrototypeOf(record) as object | null, Object.getOwnPropertyDescriptors(record));
  Object.defineProperty(copy, key, { value, writable: true, enumerable: true, configurable: true });
  return copy as Record<Key, unknown>;
}

test('merge: records met on both sides are merged into a new one, and anything else is taken as it is', () => {
  fc.assert(
    fc.property(data, data, fc.constantFrom(...STRATEGIES), (base, overrides, arrays) => {
      const rules = { concat: arrays === 'concat', absent: never, prototypeOf: 'lower' } as const;
      assertLaidOver(merge(base, overrides, { arrays }), base, overrides, rules);
    }),
    { numRuns: 1000 },
  );
});

test('merge: a record merged with itself, or with an empty one on either side, is the same record', () => {
  fc.assert(
    fc.property(data, records, fc.constantFrom(...STRATEGIES), (value, record, arrays) => {
      assert.deepEqual(shape(merge(value, value, { arrays: 'replace' })), shape(value));
      assert.deepEqual(shape(merge(record, {}, { arrays })), shape(record));
      assert.deepEqual(shape(merge({}, record, { arrays }), false), shape(record, false));
    }),
  );
});

// Associativity holds when the three values agree on what is a record at each place: an override that is no record
// discards the base below it, and which base it discards depends on the grouping.
type Layout = 'number' | 'list' | { readonly [key: string]: Layout };
const layouts: fc.Arbitrary<Layout> = fc.letrec((tie) => ({
  layout: fc.dictionary(
    keyNames,
    fc.oneof({ depthSize: 'small' }, fc.constant('number' as const), fc.constant('list' as const), tie('layout')),
    { maxKeys: 3 },
  ),
})).layout as fc.Arbitrary<Layout>;
function laidOut(layout: Layout): fc.Arbitrary<unknown> {
  if (layout === 'number') {
    return fc.integer();
  }
  if (layout === 'list') {
    return list;
  }
  const keys = Object.keys(layout);
  return fc
    .tuple(...keys.map((key) => fc.option(laidOut(layout[key] as Layout), { nil: MISSING })))
    .map((values) =>
      values.reduce<Record<Key, unknown>>(
        (record, value, index) => (value === MISSING ? record : withField(record, keys[index] as string, value)),
        {},
      ),
    );
}

test('merge is associative on values laid out alike, for both array strategies', () => {
  fc.assert(
    fc.property(
      layouts.chain((layout) => fc.tuple(laidOut(layout), laidOut(layout), laidOut(layout))),
      fc.constantFrom(...STRATEGIES),
      ([a, b, c], arrays) => {
        assert.deepEqual(
          shape(merge(merge(a, b, { arrays }), c, { arrays })),
          shape(merge(a, merge(b, c, { arrays }), { arrays })),
        );
      },
    ),
    { numRuns: 500 },
  );
});

test('defaults: a value missing or undefined takes the fallback, at every depth where both are records', () => {
  fc.assert(
    fc.property(data, data, (value, fallback) => {
      const rules = { concat: false, absent: (field: unknown) => field === undefined, prototypeOf: 'upper' } as const;
      assertLaidOver(defaults(value, fallback), fallback, value, rules);
    }),
    { numRuns: 1000 },
  );
});

test('defaults is merge with the roles swapped and the arrays replaced, when no field is undefined', () => {
  fc.assert(
    fc.property(definedData, definedData, (value, fallback) => {
      // The prototype is the value's for defaults and the base's for merge: only the fields are compared.
      assert.deepEqual(
        shape(defaults(value, fallback), false),
        shape(merge(fallback, value, { arrays: 'replace' }), false),
      );
    }),
    { numRuns: 1000 },
  );
});

test('mapValues: the identity copies the record, and two maps compose', () => {
  fc.assert(
    fc.property(records, fc.func(data), fc.func(data), (record, f, g) => {
      const copy = mapValues(record, (value) => value);
      assert.notEqual(copy, record);
      assert.deepEqual(shape(copy), shape(record));
      assert.deepEqual(
        shape(mapValues(mapValues(record, f), g)),
        shape(mapValues(record, (value, key) => g(f(value, key), key))),
      );
    }),
  );
});

test('mapKeys: the identity copies the record, a rename undone gives the record back, and renames compose', () => {
  fc.assert(
    fc.property(records, fc.string(), fc.string(), (record, first, second) => {
      assert.deepEqual(shape(mapKeys(record, (key) => key)), shape(record));
      const renamed = mapKeys(record, (key) => `${first}${key}`);
      assert.deepEqual(shape(mapKeys(renamed, (key) => key.slice(first.length))), shape(record));
      assert.deepEqual(
        shape(mapKeys(renamed, (key) => `${second}${key}`)),
        shape(mapKeys(record, (key) => `${second}${first}${key}`)),
      );
    }),
  );
});

test('mapKeys: when fields get the same name, the last in the order of the record wins', () => {
  fc.assert(
    fc.property(records, (record) => {
      const values = Object.values(record);
      assert.deepEqual(Object.values(mapKeys(record, () => 'one')), values.slice(-1));
    }),
  );
});

test('mapValues and mapKeys call back once per field, in the order of the record, with the value and the key', () => {
  fc.assert(
    fc.property(records, (record) => {
      const entries = Object.keys(record).map((key) => [record[key], key]);
      const seen: unknown[][] = [];
      mapValues(record, (...args: unknown[]) => seen.push(args));
      assert.deepEqual(seen, entries);
      seen.length = 0;
      mapKeys(record, (...args: unknown[]) => String(seen.push(args)));
      assert.deepEqual(
        seen,
        entries.map(([value, key]) => [key, value]),
      );
    }),
  );
});

test('no function changes what it is given, and no key of the data reaches a prototype', () => {
  const before = Object.getOwnPropertyNames(Object.prototype).sort();
  fc.assert(
    fc.property(data, data, records, keyNames, (left, right, record, key) => {
      const snapshot = [shape(left), shape(right), shape(record)];
      const results = [
        ...STRATEGIES.map((arrays) => merge(left, right, { arrays })),
        defaults(left, right),
        mapValues(record, () => right),
        mapKeys(record, () => key),
      ];
      assert.deepEqual([shape(left), shape(right), shape(record)], snapshot);
      for (const result of results) {
        const seen: unknown[] = [result];
        for (let node = seen.pop(); node !== undefined; node = seen.pop()) {
          if (typeof node === 'object' && node !== null) {
            const prototype: unknown = Object.getPrototypeOf(node);
            assert.ok(prototype === null || prototype === Object.prototype || prototype === Array.prototype);
            seen.push(...Object.values(node));
          }
        }
      }
    }),
    { numRuns: 1000 },
  );
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), before);
});

test('options outside their type, a value that is no record, a key that is no key: a TypeError', () => {
  fc.assert(
    fc.property(fc.anything(), (arrays) => {
      fc.pre(arrays !== 'replace' && arrays !== 'concat');
      assert.throws(() => merge({}, {}, { arrays } as never), TypeError);
      assert.throws(() => merge({}, {}, arrays as never), TypeError);
      if (!isRecord(arrays)) {
        assert.throws(() => mapValues(arrays as object, () => 1), TypeError);
        assert.throws(() => mapKeys(arrays as object, () => 'a'), TypeError);
      }
    }),
  );
  for (const key of [undefined, null, true, {}, 1n]) {
    assert.throws(() => mapKeys({ a: 1 }, () => key as never), TypeError, String(key));
  }
  assert.throws(() => defaults({}, {}, { symbols: 'yes' as never }), TypeError);
  assert.throws(() => mapValues([1] as object, () => 1), TypeError);
});

test('a getter is read once, a cycle on both sides ends with a RangeError, and symbols count when asked', () => {
  let reads = 0;
  const base = {
    get counted() {
      reads += 1;
      return { a: 1 };
    },
  };
  merge(base, { counted: { b: 2 } }, { arrays: 'replace' });
  defaults({ counted: undefined }, base);
  mapValues(base, (value) => value);
  assert.equal(reads, 3);
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  assert.throws(() => merge(cyclic, cyclic, { arrays: 'replace' }), RangeError);
  assert.throws(() => defaults(cyclic, cyclic), RangeError);
  const secret = Symbol('secret');
  assert.deepEqual(Reflect.ownKeys(merge({}, { [secret]: 1 }, { arrays: 'replace' })), []);
  assert.deepEqual(Reflect.ownKeys(merge({}, { [secret]: 1 }, { arrays: 'replace', symbols: true })), [secret]);
  assert.deepEqual(Reflect.ownKeys(mapKeys({ [secret]: 1 }, () => 'a', { symbols: true })), ['a']);
});

test('the types: merged, defaulted and mapped records keep the fields of both sides', () => {
  interface Settings {
    readonly retry: { readonly count: number; readonly delay: number };
    readonly tags: readonly string[];
    readonly name?: string;
  }
  assertType<
    Equal<
      Merged<Settings, { readonly retry: { readonly delay: string }; readonly tags: readonly number[] }, 'concat'>,
      {
        readonly retry: { readonly count: number; readonly delay: string };
        readonly tags: (string | number)[];
        readonly name?: string;
      }
    >
  >();
  assertType<Equal<Merged<{ a: number }, { a?: string }, 'replace'>, { a?: number | string }>>();
  assertType<Equal<Merged<{ a: number }, undefined, 'replace'>, undefined>>();
  assertType<Equal<Merged<unknown, { a: 1 }, 'replace'>, unknown>>();
  // A missing field takes the fallback's type and a present one is merged: the union of both reads as one type, which
  // only assignability, both ways, can tell.
  assertType<
    Same<
      Defaulted<{ retry?: { count?: number } } | undefined, { retry: { count: number; delay: number } }>,
      { retry: { count: number; delay: number } }
    >
  >();
  assertType<Equal<Defaulted<{ a: string | null }, { a: number }>, { a: string | null }>>();
  const doubled = mapValues({ apples: 3, pears: 5 } as const, (count, key) => {
    assertType<Equal<typeof count, 3 | 5>>();
    assertType<Equal<typeof key, 'apples' | 'pears'>>();
    return count * 2;
  });
  assertType<Equal<typeof doubled, { readonly apples: number; readonly pears: number }>>();
  const renamed = mapKeys({ first_name: 'Ada' }, (key) => (key === 'first_name' ? 'firstName' : key));
  assertType<Equal<typeof renamed, { firstName?: string }>>();
  const wrong = (): void => {
    // @ts-expect-error the array strategy has no default
    merge({}, {}, {});
    // @ts-expect-error a strategy is one of two words
    merge({}, {}, { arrays: 'append' });
    // @ts-expect-error mapValues takes an object
    mapValues(1, () => 1);
  };
  assert.equal(typeof wrong, 'function');
});

// What every function must do with any value: return, or throw what a hostile object or a getter throws, or the
// TypeError of a value that is no record.
function reshapesSafely(value: unknown): void {
  for (const call of [
    () => merge(value, { a: 1 }, { arrays: 'concat' }),
    () => merge({ a: { b: 1 } }, value, { arrays: 'replace', symbols: true }),
    () => defaults(value, { a: 1 }),
    () => defaults({ a: undefined }, value),
    () => mapValues(value as object, (field) => field),
    () => mapKeys(value as object, (key) => key, { symbols: true }),
  ]) {
    try {
      call();
    } catch (error) {
      assert.ok(
        error instanceof HostileError || error instanceof TypeError || error instanceof RangeError,
        String(error),
      );
    }
  }
}

// The callback is called once per field, with what it is given; what it throws comes out as it is, and what it
// returns is the new value or the new key.
function callsBackOnce(name: 'mapValues' | 'mapKeys'): (callback: Callback) => void {
  return (callback) => {
    const record = { a: [1, 2], b: [3] };
    let calls = 0;
    const counted = (...args: unknown[]): unknown => {
      calls += 1;
      return callback(...args);
    };
    try {
      if (name === 'mapValues') {
        assert.deepEqual(Object.keys(mapValues(record, counted)), ['a', 'b']);
      } else {
        mapKeys(record, counted as () => PropertyKey);
      }
      assert.equal(calls, 2);
    } catch (error) {
      assert.ok(
        error instanceof CallbackError || typeof error === 'string' || error instanceof TypeError,
        String(error),
      );
      assert.ok(calls >= 1 && calls <= 2);
    }
  };
}

for (const name of ['merge', 'defaults', 'mapValues', 'mapKeys'] as const) {
  declareAdversarial(SUBPATH, name, {
    boundary: reshapesSafely,
    structures: reshapesSafely,
    hostile: reshapesSafely,
    unicode: (text) => {
      // Keys are compared by code units, never normalized.
      const record = { [text]: 1 };
      assert.deepEqual(merge(record, { [text.normalize('NFD')]: 2 }, { arrays: 'replace' }), {
        ...record,
        [text.normalize('NFD')]: 2,
      });
      assert.deepEqual(defaults({ [text]: undefined }, record), record);
      assert.deepEqual(
        mapKeys(record, (key) => key),
        record,
      );
      assert.deepEqual(
        mapValues(record, () => text),
        { [text]: text },
      );
    },
    callbacks: name === 'mapValues' || name === 'mapKeys' ? callsBackOnce(name) : { na: `${name} takes no callback` },
    async: { na: `${name} is synchronous and takes no signal` },
  });
}
