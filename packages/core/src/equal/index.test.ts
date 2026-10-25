import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import { DEEP, declareAdversarial, fc, HostileError } from '@yaltaan/testing';
import { Temporal } from 'temporal-polyfill';

import { equal, type EqualOptions } from './index.ts';

const SUBPATH = '@yaltaan/core/equal';
const SAME_VALUE: EqualOptions = { equality: 'SameValue' };

// A copy that `equal` must find equal to its original: records keep their prototype and every own key (defined, so a
// "__proto__" key stays a key), arrays their holes, Map keys and Set elements their identity, cycles their shape; any
// other object is shared. Iterative, so that it copies a structure 10,000 levels deep.
function twin<T>(value: T): T {
  const copies = new Map<object, object>();
  const work: (() => void)[] = [];
  const copyOf = (source: unknown): unknown => {
    if (typeof source !== 'object' || source === null) {
      return source;
    }
    const known = copies.get(source);
    if (known !== undefined) {
      return known;
    }
    const prototype: unknown = Object.getPrototypeOf(source);
    let copy: object;
    if (Array.isArray(source)) {
      const array = new Array<unknown>(source.length);
      work.push(() => {
        source.forEach((element, index) => {
          array[index] = copyOf(element);
        });
      });
      copy = array;
    } else if (source instanceof Map) {
      const map = new Map<unknown, unknown>();
      work.push(() => {
        source.forEach((element, key) => map.set(key, copyOf(element)));
      });
      copy = map;
    } else if (source instanceof Set) {
      copy = new Set(source);
    } else if (source instanceof Date) {
      copy = new Date(source.getTime());
    } else if (prototype === null || prototype === Object.prototype) {
      const record = Object.create(prototype as object | null) as object;
      work.push(() => {
        for (const key of Reflect.ownKeys(source)) {
          const descriptor = Object.getOwnPropertyDescriptor(source, key);
          if (descriptor?.enumerable === true) {
            const element: unknown = (source as Record<PropertyKey, unknown>)[key];
            Object.defineProperty(record, key, { value: copyOf(element), enumerable: true, writable: true });
          }
        }
      });
      copy = record;
    } else {
      return source;
    }
    copies.set(source, copy);
    return copy;
  };
  const root = copyOf(value) as T;
  for (let next = work.pop(); next !== undefined; next = work.pop()) {
    next();
  }
  return root;
}

function nested(depth: number, leaf: unknown): object {
  let node: object = { leaf };
  for (let level = 1; level < depth; level += 1) {
    node = { child: node };
  }
  return node;
}

test('primitives compare by SameValueZero, or by Object.is', () => {
  assert.equal(equal(1, 1), true);
  assert.equal(equal('a', 'a'), true);
  assert.equal(equal(1n, 1n), true);
  assert.equal(equal(Number.NaN, Number.NaN), true);
  assert.equal(equal(0, -0), true);
  assert.equal(equal(0, -0, SAME_VALUE), false);
  assert.equal(equal(Number.NaN, Number.NaN, SAME_VALUE), true);
  assert.equal(equal(1, '1'), false);
  assert.equal(equal(1, 1n), false);
  assert.equal(equal(null, undefined), false);
  assert.equal(equal(Symbol('a'), Symbol('a')), false);
  assert.equal(equal({}, null), false);
  assert.equal(equal([], ''), false);
});

test('records compare by their own enumerable string keys, in any order', () => {
  assert.equal(equal({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }), true);
  assert.equal(equal({ a: 1 }, { a: 2 }), false);
  assert.equal(equal({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(equal({ a: 1, b: 2 }, { a: 1 }), false);
  // A key holding undefined is still a key.
  assert.equal(equal({ a: undefined }, {}), false);
  assert.equal(equal({ a: undefined }, { b: undefined }), false);
  // Same number of keys, but the key of one side is not enumerable on the other.
  const hidden = Object.defineProperty({ b: 1 }, 'a', { value: 1, enumerable: false });
  assert.equal(equal({ a: 1, b: 1 }, hidden), false);
  assert.equal(equal(Object.assign(Object.create(null) as object, { a: 1 }), { a: 1 }), true);
});

test('symbol keys count only when asked for', () => {
  const key = Symbol('k');
  assert.equal(equal({ [key]: 1 }, { [key]: 2 }), true);
  assert.equal(equal({ [key]: 1 }, { [key]: 2 }, { symbols: true }), false);
  assert.equal(equal({ [key]: 1 }, {}, { symbols: true }), false);
  assert.equal(equal({ [key]: { a: 1 } }, { [key]: { a: 1 } }, { symbols: true }), true);
  const hidden = Object.defineProperty({}, key, { value: 1, enumerable: false });
  assert.equal(equal(hidden, {}, { symbols: true }), true);
});

test('arrays compare by length and index, and a hole differs from undefined', () => {
  assert.equal(equal([1, [2, { a: 3 }]], [1, [2, { a: 3 }]]), true);
  assert.equal(equal([1, 2], [2, 1]), false);
  assert.equal(equal([1], [1, 2]), false);
  // A hole written through Array(n): the formatter would turn `[, 1]` into something else.
  const holed = new Array<unknown>(2);
  holed[1] = 1;
  assert.equal(equal(holed, [undefined, 1]), false);
  assert.equal(equal([undefined, 1], holed), false);
  assert.equal(equal(holed, twin(holed)), true);
  assert.equal(equal([], {}), false);
  assert.equal(equal({ length: 0 }, []), false);
});

test('Map values compare deeply, Map keys and Set elements by identity', () => {
  assert.equal(equal(new Map([['a', { b: 1 }]]), new Map([['a', { b: 1 }]])), true);
  assert.equal(equal(new Map([['a', 1]]), new Map([['a', 2]])), false);
  assert.equal(equal(new Map([['a', 1]]), new Map([['b', 1]])), false);
  assert.equal(equal(new Map([['a', 1]]), new Map()), false);
  assert.equal(equal(new Map([[Number.NaN, 1]]), new Map([[Number.NaN, 1]])), true);
  assert.equal(equal(new Map([[{ k: 1 }, 1]]), new Map([[{ k: 1 }, 1]])), false);
  const key = { k: 1 };
  assert.equal(equal(new Map([[key, [1]]]), new Map([[key, [1]]])), true);
  assert.equal(equal(new Set([1, 'a', Number.NaN]), new Set(['a', Number.NaN, 1])), true);
  assert.equal(equal(new Set([1]), new Set([2])), false);
  assert.equal(equal(new Set([1]), new Set([1, 2])), false);
  assert.equal(equal(new Set([{ a: 1 }]), new Set([{ a: 1 }])), false);
  assert.equal(equal(new Set([key]), new Set([key])), true);
  assert.equal(equal(new Map(), new Set()), false);
  assert.equal(equal(new Map(), {}), false);
});

test('dates compare by time value, invalid dates included', () => {
  assert.equal(equal(new Date(0), new Date(0)), true);
  assert.equal(equal(new Date(0), new Date(1)), false);
  assert.equal(equal(new Date(Number.NaN), new Date(Number.NaN)), true);
  assert.equal(equal({ at: new Date(5) }, { at: new Date(5) }), true);
  assert.equal(equal(new Date(0), 0), false);
  assert.equal(equal(new Date(0), {}), false);
});

test('typed arrays compare element by element, of the same type only', () => {
  assert.equal(equal(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(equal(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
  assert.equal(equal(new Uint8Array([1]), new Uint8Array([1, 0])), false);
  assert.equal(equal(new Uint8Array([1]), new Int8Array([1])), false);
  assert.equal(equal(new Float64Array([Number.NaN, 0]), new Float64Array([Number.NaN, -0])), true);
  assert.equal(equal(new Float64Array([0]), new Float64Array([-0]), SAME_VALUE), false);
  assert.equal(equal(new BigInt64Array([1n]), new BigInt64Array([1n])), true);
  assert.equal(equal(new Uint8Array([1]), [1]), false);
});

test('class instances, functions and unlisted built-ins compare by identity', () => {
  class Point {
    readonly x: number;
    constructor(x: number) {
      this.x = x;
    }
  }
  const point = new Point(1);
  assert.equal(equal(point, point), true);
  assert.equal(equal(new Point(1), new Point(1)), false);
  assert.equal(equal({ at: point }, { at: point }), true);
  assert.equal(equal(/a/g, /a/g), false);
  assert.equal(equal(new ArrayBuffer(1), new ArrayBuffer(1)), false);
  assert.equal(equal(new DataView(new ArrayBuffer(1)), new DataView(new ArrayBuffer(1))), false);
  assert.equal(equal(new Error('a'), new Error('a')), false);
  assert.equal(
    equal(
      () => 1,
      () => 1,
    ),
    false,
  );
  // A subclass of Map is not a Map of the support table.
  class Registry extends Map<string, number> {}
  assert.equal(equal(new Registry([['a', 1]]), new Registry([['a', 1]])), false);
  // An object posing as a Temporal object without an equals method.
  const tagged = (): object => Object.create({ [Symbol.toStringTag]: 'Temporal.Fake' }) as object;
  const fake = tagged();
  assert.equal(equal(fake, Object.create(Object.getPrototypeOf(fake) as object) as object), false);
});

test('Temporal objects compare by their equals, durations field by field', () => {
  const day = Temporal.PlainDate.from('2026-10-25');
  assert.equal(equal(day, Temporal.PlainDate.from('2026-10-25')), true);
  assert.equal(equal(day, Temporal.PlainDate.from('2026-10-26')), false);
  assert.equal(equal({ due: day }, { due: Temporal.PlainDate.from('2026-10-25') }), true);
  assert.equal(equal(day, Temporal.PlainDateTime.from('2026-10-25T00:00')), false);
  const instant = Temporal.Instant.from('2026-10-25T10:00:00Z');
  assert.equal(equal(instant.toZonedDateTimeISO('UTC'), instant.toZonedDateTimeISO('UTC')), true);
  // The same instant in another zone is another ZonedDateTime, as its own equals says.
  assert.equal(equal(instant.toZonedDateTimeISO('UTC'), instant.toZonedDateTimeISO('Europe/Paris')), false);
  assert.equal(equal(Temporal.Duration.from('PT1H'), Temporal.Duration.from({ hours: 1 })), true);
  assert.equal(equal(Temporal.Duration.from('PT1H'), Temporal.Duration.from('PT60M')), false);
  assert.equal(
    equal(Temporal.Duration.from({ seconds: 1, milliseconds: 500 }), Temporal.Duration.from({ milliseconds: 1500 })),
    false,
  );
});

test('cycles end, and two cycles that no walk tells apart are equal', () => {
  const self = (name: string): object => {
    const node: Record<string, unknown> = { name };
    node['self'] = node;
    return node;
  };
  assert.equal(equal(self('a'), self('a')), true);
  assert.equal(equal(self('a'), self('b')), false);
  // { self: a } against { self: { self: b } }: both unfold to the same infinite chain.
  const one: Record<string, unknown> = {};
  one['self'] = one;
  const two: Record<string, unknown> = {};
  two['self'] = { self: two };
  assert.equal(equal(one, two), true);
  assert.equal(equal(two, one), true);
  const list: unknown[] = [1];
  list.push(list);
  assert.equal(equal(list, twin(list)), true);
  const map = new Map<string, unknown>();
  map.set('self', map);
  assert.equal(equal(map, twin(map)), true);
  // A long cycle, unrolled beyond the pairs compared before any is remembered.
  const ring = (length: number, last: number): object => {
    const head: Record<string, unknown> = { value: 0 };
    let node = head;
    for (let index = 1; index < length; index += 1) {
      const next: Record<string, unknown> = { value: index === length - 1 ? last : index };
      node['next'] = next;
      node = next;
    }
    node['next'] = head;
    return head;
  };
  assert.equal(equal(ring(500, 499), ring(500, 499)), true);
  assert.equal(equal(ring(500, 499), ring(500, -1)), false);
});

test('an aliased subtree is compared once, not once per path that reaches it', () => {
  // Each level points twice to the next: 2^60 paths, 60 objects.
  const ladder = (levels: number, leaf: number): object => {
    let node: object = { leaf };
    for (let level = 0; level < levels; level += 1) {
      node = { left: node, right: node };
    }
    return node;
  };
  const started = performance.now();
  assert.equal(equal(ladder(60, 1), ladder(60, 1)), true);
  assert.equal(equal(ladder(60, 1), ladder(60, 2)), false);
  assert.ok(performance.now() - started < 1000, 'the walk followed every path');
});

test('a structure 10,000 levels deep is compared without overflowing the call stack', () => {
  assert.equal(equal(nested(DEEP, 1), nested(DEEP, 1)), true);
  assert.equal(equal(nested(DEEP, 1), nested(DEEP, 2)), false);
});

test('each property is read once on each side', () => {
  let reads = 0;
  const counted = (): object =>
    Object.defineProperty({}, 'a', {
      enumerable: true,
      get: () => {
        reads += 1;
        return { b: 1 };
      },
    });
  assert.equal(equal(counted(), counted()), true);
  assert.equal(reads, 2);
});

test('options outside their type are a bug of the caller', () => {
  assert.throws(() => equal(1, 1, { equality: 'loose' as unknown as 'SameValue' }), TypeError);
  assert.throws(() => equal(1, 1, { symbols: 'yes' as unknown as boolean }), TypeError);
  assert.equal(equal(1, 1, { equality: 'SameValueZero', symbols: false }), true);
});

const primitive = fc.oneof(fc.double(), fc.integer(), fc.bigInt(), fc.string(), fc.boolean(), fc.constant(undefined));
const anything = fc.anything({ maxDepth: 3, withMap: true, withSet: true, withDate: true, withTypedArray: true });

test('equal is reflexive on copies, and symmetric', () => {
  fc.assert(
    fc.property(anything, (value) => {
      assert.equal(equal(value, twin(value)), true);
      assert.equal(equal(twin(value), value, SAME_VALUE), true);
    }),
  );
  fc.assert(
    fc.property(anything, anything, (left, right) => {
      assert.equal(equal(left, right), equal(right, left));
      assert.equal(equal(left, right, SAME_VALUE), equal(right, left, SAME_VALUE));
    }),
  );
});

test('equal agrees with Object.is on primitives, and with SameValueZero by default', () => {
  fc.assert(
    fc.property(primitive, primitive, (left, right) => {
      assert.equal(equal(left, right, SAME_VALUE), Object.is(left, right));
      assert.equal(equal(left, right), Object.is(left, right) || (left === 0 && right === 0));
    }),
  );
});

test('equal agrees with Node isDeepStrictEqual on JSON data', () => {
  // A second, independent implementation: on JSON data the two semantics coincide under SameValue.
  const json = fc.jsonValue({ maxDepth: 3 });
  const pair = fc.oneof(
    fc.tuple(json, json),
    json.map((value) => [value, twin(value)] as const),
  );
  fc.assert(
    fc.property(pair, ([left, right]) => {
      assert.equal(equal(left, right, SAME_VALUE), isDeepStrictEqual(left, right));
    }),
    { numRuns: 500 },
  );
});

// A value of any category: equal to itself and to its copy, in both directions, or what a hostile object throws.
function equalToItsCopy(value: unknown): void {
  assert.equal(equal(value, value), true);
  let copy: unknown;
  try {
    copy = twin(value);
  } catch (error) {
    // The copy could not read it: equal may throw the same, or answer.
    assert.ok(error instanceof HostileError || error instanceof TypeError, String(error));
    try {
      assert.equal(typeof equal(value, {}), 'boolean');
    } catch (thrown) {
      assert.ok(thrown instanceof HostileError || thrown instanceof TypeError, String(thrown));
    }
    return;
  }
  // Compared without deepEqual: a failing one would print a structure 10,000 levels deep, for minutes.
  assert.ok(equal(value, copy) && equal(copy, value), 'a value differs from its copy');
  assert.ok(equal(value, copy, SAME_VALUE), 'a value differs from its copy under SameValue');
  assert.equal(equal(value, [value]), false);
}

declareAdversarial(SUBPATH, 'equal', {
  boundary: (value) => {
    equalToItsCopy(value);
    for (const other of [undefined, null, 0, -0, Number.NaN, '', [], {}]) {
      assert.equal(equal(value, other), equal(other, value));
    }
  },
  structures: equalToItsCopy,
  hostile: (value) => {
    equalToItsCopy(value);
    try {
      assert.equal(equal(value, value, { symbols: true }), true);
      assert.equal(typeof equal(value, { a: 1 }, { symbols: true }), 'boolean');
    } catch (error) {
      assert.ok(error instanceof HostileError || error instanceof TypeError, String(error));
    }
  },
  unicode: (text) => {
    // Code units, never a normalization: a decomposed text differs from its composed form.
    assert.equal(equal(text, text.normalize('NFC')), text === text.normalize('NFC'));
    assert.equal(equal({ [text]: [text] }, { [text]: [text] }), true);
    assert.equal(equal({ [text]: 1 }, { [`${text}x`]: 1 }), false);
  },
  callbacks: { na: 'equal takes no callback; the equals method of a Temporal object belongs to the value compared' },
  async: { na: 'equal is synchronous and takes no signal' },
});
