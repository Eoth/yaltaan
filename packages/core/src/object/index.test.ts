import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertType, declareAdversarial, fc, HostileError, type Equal } from '@yaltaan/testing';

import { equal } from '../equal/index.ts';
import { omit, pick, redact, type Mask, type Omitted, type Picked, type Redacted, type UntypedMask } from './index.ts';

const SUBPATH = '@yaltaan/core/object';

interface User {
  readonly id: number;
  readonly name: string;
  readonly password: string;
  readonly email?: string;
  readonly address: { readonly city: string; readonly geo: readonly [number, number] | null };
  readonly lines: readonly { readonly sku: string; readonly price: number }[];
  readonly since: Date;
}

const ada: User = {
  id: 1,
  name: 'Ada',
  password: 's3cret',
  address: { city: 'Paris', geo: [48.8, 2.3] },
  lines: [
    { sku: 'a', price: 3 },
    { sku: 'b', price: 5 },
  ],
  since: new Date(0),
};

test('pick keeps the fields a mask names, walking into nested records and into each element of an array', () => {
  assert.deepEqual(pick(ada, { name: true, address: { city: true }, lines: { sku: true } }), {
    name: 'Ada',
    address: { city: 'Paris' },
    lines: [{ sku: 'a' }, { sku: 'b' }],
  });
  // A field the value lacks stays absent; the order is the mask's.
  assert.deepEqual(Object.keys(pick(ada, { since: true, email: true, id: true })), ['since', 'id']);
  assert.equal(pick(ada, { since: true }).since, ada.since);
});

test('omit drops the fields a mask names true, keeps the order of the value, and walks where the mask nests', () => {
  const result = omit(ada, { password: true, address: { geo: true }, lines: { price: true } });
  assert.deepEqual(result, {
    id: 1,
    name: 'Ada',
    address: { city: 'Paris' },
    lines: [{ sku: 'a' }, { sku: 'b' }],
    since: ada.since,
  });
  assert.deepEqual(Object.keys(result), ['id', 'name', 'address', 'lines', 'since']);
  assert.deepEqual(omit(ada, {}), ada);
});

test('redact replaces the fields a mask names true, and leaves absent fields absent', () => {
  assert.deepEqual(redact(ada, { password: true, email: true, lines: { price: true } }), {
    ...ada,
    password: '***',
    lines: [
      { sku: 'a', price: '***' },
      { sku: 'b', price: '***' },
    ],
  });
  assert.deepEqual(redact({ token: 'abc' }, { token: true }, { replacement: null }), { token: null });
  assert.deepEqual(redact({ token: 'abc' }, { token: true }, { replacement: undefined }), { token: undefined });
});

test('what a mask does not walk into is shared, and taken whole', () => {
  const result = omit(ada, { password: true });
  assert.equal(result.address, ada.address);
  assert.equal(result.lines, ada.lines);
  const map = new Map([['k', { a: 1 }]]);
  class Point {
    x = 1;
    y = 2;
  }
  const point = new Point();
  const value = { map, point, at: new Date(0), list: Object.assign(new (class extends Array<number> {})(), [1]) };
  const masked = { map: { a: true }, point: { x: true }, at: {}, list: { length: true } } as const;
  assert.deepEqual(omit(value as unknown, masked), value);
  const picked = pick(value as unknown, masked) as typeof value;
  assert.equal(picked.map, map);
  assert.equal(picked.point, point);
  assert.equal(picked.list, value.list);
  assert.equal(omit(5 as unknown, { a: true }), 5);
});

test('arrays keep their holes and their length; records keep a null prototype', () => {
  const sparse = [{ a: 1, b: 2 }, , { a: 3, b: 4 }];
  const result = omit(sparse, { b: true });
  assert.equal(result.length, 3);
  assert.equal(1 in result, false);
  assert.deepEqual(result[2], { a: 3 });
  const dictionary = Object.assign(Object.create(null) as Record<string, number>, { a: 1, b: 2 });
  assert.equal(Object.getPrototypeOf(omit(dictionary, { b: true })), null);
  assert.equal(Object.getPrototypeOf(pick(dictionary, { a: true })), null);
  assert.equal(Object.getPrototypeOf(omit({ a: 1 }, {})), Object.prototype);
});

test('a "__proto__" key stays a key of the copy, and a mask never answers through Object.prototype', () => {
  const parsed = JSON.parse('{ "__proto__": { "isAdmin": true }, "constructor": 1, "toString": 2 }') as Record<
    string,
    unknown
  >;
  for (const copy of [omit(parsed, {}), pick(parsed, { ['__proto__']: true, constructor: true, toString: true })]) {
    assert.equal(Object.getPrototypeOf(copy), Object.prototype);
    assert.deepEqual(Object.keys(copy), ['__proto__', 'constructor', 'toString']);
    assert.equal((copy as { isAdmin?: unknown }).isAdmin, undefined);
  }
  assert.deepEqual(Object.keys(redact(parsed, { ['__proto__']: true })), ['__proto__', 'constructor', 'toString']);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'isAdmin'), false);
  // An empty mask names neither "constructor" nor "toString", which it inherits.
  assert.deepEqual(pick({ constructor: 1, toString: 2 } as unknown, {}), {});
});

test('a getter is read once, only when its field is kept, and what it throws is propagated', () => {
  let reads = 0;
  const value = {
    get kept() {
      reads += 1;
      return 1;
    },
    get dropped(): number {
      throw new HostileError('dropped is read');
    },
  };
  assert.deepEqual(omit(value, { dropped: true }), { kept: 1 });
  assert.deepEqual(pick(value, { kept: true }), { kept: 1 });
  assert.deepEqual(redact(value, { dropped: true }), { kept: 1, dropped: '***' });
  assert.equal(reads, 3);
  assert.throws(() => omit(value, {}), HostileError);
  assert.throws(() => pick(value, { dropped: true }), HostileError);
});

test('symbol keys count only when asked, in the value and in the mask', () => {
  const secret = Symbol('secret');
  const value = { a: 1, [secret]: 2 };
  assert.deepEqual(Reflect.ownKeys(omit(value, {})), ['a']);
  assert.deepEqual(Reflect.ownKeys(omit(value, {}, { symbols: true })), ['a', secret]);
  assert.deepEqual(Reflect.ownKeys(omit(value, { [secret]: true }, { symbols: true })), ['a']);
  assert.deepEqual(Reflect.ownKeys(pick(value, { [secret]: true })), []);
  assert.deepEqual(Reflect.ownKeys(pick(value, { [secret]: true }, { symbols: true })), [secret]);
  assert.equal(redact(value, { [secret]: true }, { symbols: true })[secret], '***');
});

test('a mask that refers to itself walks a tree to any depth, and ends with a RangeError on a cyclic value', () => {
  interface Node {
    readonly id: number;
    readonly label: string;
    readonly children: readonly Node[];
  }
  const tree: Node = { id: 1, label: 'root', children: [{ id: 2, label: 'leaf', children: [] }] };
  const mask: { id: true; children?: unknown } = { id: true };
  mask.children = mask;
  assert.deepEqual(omit(tree, mask as UntypedMask), { label: 'root', children: [{ label: 'leaf', children: [] }] });
  const cyclic: Record<string, unknown> = { id: 1 };
  cyclic['children'] = [cyclic];
  assert.throws(() => omit(cyclic, mask as UntypedMask), RangeError);
});

test('a mask that is not one, or an option of the wrong type, is a TypeError', () => {
  for (const mask of [null, undefined, 1, 'a', [], new Map(), true]) {
    assert.throws(() => omit({ a: 1 }, mask as never), TypeError, String(mask));
    assert.throws(() => pick({ a: 1 }, mask as never), TypeError, String(mask));
  }
  for (const entry of [false, 1, 'yes', null, ['a']]) {
    assert.throws(() => pick({ a: { b: 1 } }, { a: entry } as never), TypeError, String(entry));
    assert.throws(() => omit({ a: { b: 1 } }, { a: entry } as never), TypeError, String(entry));
  }
  // omit reads only the entries of the keys the value has.
  assert.deepEqual(omit({ a: 1 }, { b: false } as never), { a: 1 });
  assert.throws(() => omit({}, {}, { symbols: 'yes' as never }), TypeError);
});

test('the types: a mask names only fields of the value, at every depth, and the result has the fields it keeps', () => {
  assertType<
    Equal<
      Picked<User, { readonly name: true; readonly lines: { readonly sku: true } }>,
      {
        readonly name: string;
        readonly lines: readonly { readonly sku: string }[];
      }
    >
  >();
  assertType<
    Equal<
      Omitted<User, { readonly password: true; readonly address: { readonly geo: true } }>,
      {
        readonly id: number;
        readonly name: string;
        readonly email?: string;
        readonly address: { readonly city: string };
        readonly lines: readonly { readonly sku: string; readonly price: number }[];
        readonly since: Date;
      }
    >
  >();
  assertType<
    Equal<
      Redacted<{ readonly token: string; readonly n: number }, { readonly token: true }, null>,
      {
        readonly token: null;
        readonly n: number;
      }
    >
  >();
  const picked = pick(ada, { email: true, address: { city: true } });
  assertType<Equal<typeof picked, { readonly email?: string; readonly address: { readonly city: string } }>>();
  const redacted = redact(ada, { password: true });
  assertType<Equal<(typeof redacted)['password'], '***'>>();
  assertType<Equal<Mask<unknown>, UntypedMask>>();
  assertType<Equal<Mask<Date>, never>>();
  // Checked by the compiler only: each call is wrong, and is never made.
  const wrong = (): void => {
    // @ts-expect-error a field the value does not have
    pick(ada, { nam: true });
    // @ts-expect-error a misspelt field beside a correct one
    omit(ada, { name: true, passwrd: true });
    // @ts-expect-error a misspelt field of a nested record
    omit(ada, { address: { cty: true } });
    // @ts-expect-error a misspelt field of the elements of an array
    pick(ada, { lines: { skus: true } });
    // @ts-expect-error a date is named whole, never walked into
    pick(ada, { since: { getTime: true } });
    // @ts-expect-error an entry is true or a mask, never false
    omit(ada, { password: false });
  };
  assert.equal(typeof wrong, 'function');
  // Any key goes on a value of unknown type.
  omit(JSON.parse('{}') as unknown, { anything: { nested: true } });
});

const keyNames = fc.constantFrom('a', 'b', 'c', '__proto__', 'constructor', 'prototype', 'toString', '0');
const data: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.oneof(fc.integer(), fc.string(), fc.constant(null), fc.constant(undefined)),
    fc.array(tie('value'), { maxLength: 3 }),
    fc.dictionary(keyNames, tie('value'), { maxKeys: 4 }),
  ),
})).value;
const masks = fc.letrec((tie) => ({
  mask: fc.dictionary(keyNames, fc.oneof({ depthSize: 'small' }, fc.constant(true as const), tie('mask')), {
    maxKeys: 3,
  }),
})).mask as fc.Arbitrary<UntypedMask>;

// fast-check builds dictionaries with defineProperty, so "__proto__" is an own key of the data and of the masks.
test('properties: pick, omit and redact are idempotent, and equal under a mask equals equal of the selections', () => {
  fc.assert(
    fc.property(data, data, masks, (x, y, mask) => {
      const omitted = omit(x, mask);
      assert.ok(equal(omit(omitted, mask), omitted), 'omit twice');
      const picked = pick(x, mask);
      assert.ok(equal(pick(picked, mask), picked), 'pick twice');
      const redacted = redact(x, mask);
      assert.ok(equal(redact(redacted, mask), redacted), 'redact twice');
      assert.ok(equal(omit(redacted, mask), omitted), 'redact then omit');
      assert.equal(equal(x, y, { omit: mask }), equal(omit(x, mask), omit(y, mask)), 'equal with omit');
      assert.equal(equal(x, y, { pick: mask }), equal(pick(x, mask), pick(y, mask)), 'equal with pick');
      assert.ok(equal(x, x, { pick: mask }) && equal(x, x, { omit: mask }), 'reflexive');
    }),
    { numRuns: 1000 },
  );
});

test('fuzz: no key, in the value or in the mask, reaches a prototype', () => {
  const before = Object.getOwnPropertyNames(Object.prototype).sort();
  fc.assert(
    fc.property(data, masks, (x, mask) => {
      for (const result of [omit(x, mask), pick(x, mask), redact(x, mask)]) {
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
  assert.equal(({} as Record<string, unknown>)['a'], undefined);
});

// What any function of the module must do with any value: return a value whose own keys are those of a copy taken
// key by key, or throw what a hostile object or a getter throws.
function selectsSafely(value: unknown): void {
  for (const call of [
    () => omit(value, { a: true }),
    () => pick(value, { a: true, b: { c: true } }),
    () => redact(value, { a: true }, { symbols: true }),
  ]) {
    try {
      const result = call();
      if (typeof value !== 'object' || value === null) {
        assert.ok(Object.is(result, value));
      }
    } catch (error) {
      assert.ok(
        error instanceof HostileError || error instanceof TypeError || error instanceof RangeError,
        String(error),
      );
    }
  }
}

for (const name of ['pick', 'omit', 'redact']) {
  declareAdversarial(SUBPATH, name, {
    boundary: selectsSafely,
    structures: selectsSafely,
    hostile: selectsSafely,
    unicode: (text) => {
      // Keys are compared by code units, never normalized.
      assert.deepEqual(omit({ [text]: 1, [`${text}x`]: 2 }, { [text]: true }), { [`${text}x`]: 2 });
      assert.deepEqual(
        pick({ [text]: 1 }, { [text.normalize('NFD')]: true }),
        text === text.normalize('NFD') ? { [text]: 1 } : {},
      );
      assert.deepEqual(redact({ [text]: text }, { [text]: true }), { [text]: '***' });
    },
    callbacks: { na: `${name} takes no callback` },
    async: { na: `${name} is synchronous and takes no signal` },
  });
}
