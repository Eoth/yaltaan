import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertType, CallbackError, declareAdversarial, fc, HostileError, type Equal } from '@yaltaan/testing';

import type { Path } from '../path/index.ts';
import type { Result } from '../result/index.ts';
import { get, has, remove, set, update, type AccessIssue, type WriteIssue } from './index.ts';

const SUBPATH = '@yaltaan/core/object';
const SYMBOL = Symbol('s');

// Values of records and arrays, and paths drawn half from the places a value has, half from the segments that may or
// may not fit, so that every law meets present, missing and mismatched segments.
const segments = fc.constantFrom<string | number | symbol>('a', 'b', '0', 0, 1, 2, SYMBOL);
const data: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.integer(),
    fc.constant(undefined),
    fc.constant(null),
    fc.array(tie('value'), { maxLength: 3 }),
    fc.dictionary(fc.constantFrom('a', 'b', '0'), tie('value'), { maxKeys: 3 }),
    fc
      .tuple(fc.dictionary(fc.constantFrom('a', 'b'), tie('value'), { maxKeys: 2 }), tie('value'))
      .map(([record, value]) => Object.assign(record, { [SYMBOL]: value })),
  ),
})).value;

/** A path of `value` drawn by walking it, `steps` picking the field or element at each level. */
function walk(value: unknown, steps: readonly number[]): Path {
  const path: (string | number | symbol)[] = [];
  let current = value;
  for (const step of steps) {
    if (typeof current !== 'object' || current === null) {
      break;
    }
    const keys: (string | number | symbol)[] = Array.isArray(current)
      ? current.map((_, index) => index)
      : Reflect.ownKeys(current);
    if (keys.length === 0) {
      break;
    }
    const key = keys[step % keys.length]!;
    path.push(key);
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return path;
}

const valueAndPath = fc
  .tuple(data, fc.array(fc.nat(), { maxLength: 4 }), fc.array(segments, { maxLength: 3 }), fc.boolean())
  .map(([value, steps, drawn, walked]): [unknown, Path] => [value, walked ? walk(value, steps) : drawn]);

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
  }
  return value;
}

/** What `path` reaches in `value`, level by level: the containers, then the value at the end. */
function along(value: unknown, path: Path): unknown[] {
  const levels = [value];
  for (const segment of path) {
    levels.push((levels[levels.length - 1] as Record<PropertyKey, unknown>)[segment as PropertyKey]);
  }
  return levels;
}

// Every key of each container along the path, but the one the path follows, holds the same value in the copy.
function assertShared(before: unknown, after: unknown, path: Path): void {
  const old = along(before, path);
  const copied = along(after, path);
  path.forEach((segment, depth) => {
    const container = old[depth] as Record<PropertyKey, unknown>;
    for (const key of Reflect.ownKeys(container)) {
      if (key !== segment && key !== 'length' && !(Array.isArray(container) && Number(key) === segment)) {
        assert.ok(Object.is((copied[depth] as Record<PropertyKey, unknown>)[key], container[key]), String(key));
      }
    }
  });
}

test('laws: what set writes, get reads back, and set copies only the containers along the path', () => {
  fc.assert(
    fc.property(valueAndPath, data, ([value, path], next) => {
      const written = set(deepFreeze(value), path, next);
      if (!written.ok) {
        return;
      }
      assert.deepEqual(get(written.value, path), { ok: true, value: next });
      if (path.length > 0 && has(value, path)) {
        assertShared(value, written.value, path);
      }
    }),
  );
});

test('laws: set of the value a path holds, and update by the identity, give back the value itself', () => {
  fc.assert(
    fc.property(valueAndPath, ([value, path]) => {
      const current = get(deepFreeze(value), path);
      const same = update(value, path, (held) => held);
      const rewritten = set(value, path, current.ok ? current.value : undefined);
      if (current.ok) {
        assert.ok(same.ok && same.value === value);
        assert.ok(rewritten.ok && rewritten.value === value);
      } else {
        assert.equal(same.ok, false);
      }
    }),
  );
});

test('laws: update applies its change once to what get reads, and fails where get fails', () => {
  fc.assert(
    fc.property(valueAndPath, data, ([value, path], next) => {
      const read = get(deepFreeze(value), path);
      const calls: unknown[] = [];
      const updated = update(value, path, (held) => {
        calls.push(held);
        return next;
      });
      if (read.ok) {
        assert.deepEqual(calls, [read.value]);
        assert.deepEqual(updated, set(value, path, next));
      } else {
        assert.deepEqual(calls, []);
        assert.deepEqual(updated, read);
      }
    }),
  );
});

test('laws: has is get(…).ok, and a failure names the first segment where the walk stopped', () => {
  fc.assert(
    fc.property(valueAndPath, ([value, path]) => {
      const read = get(value, path);
      assert.equal(has(value, path), read.ok);
      if (!read.ok) {
        const { index } = read.error.params;
        assert.ok(index < path.length);
        assert.equal(read.error.path, path);
        assert.ok(get(value, path.slice(0, index)).ok);
        assert.ok(!get(value, path.slice(0, index + 1)).ok);
      }
    }),
  );
});

test('laws: remove drops a field, splices an element, shares the rest, and fails where get fails', () => {
  fc.assert(
    fc.property(valueAndPath, ([value, path]) => {
      const removed = remove(deepFreeze(value), path);
      if (path.length === 0 || !has(value, path)) {
        assert.equal(removed.ok, false);
        return;
      }
      assert.ok(removed.ok);
      const parent = path.slice(0, -1);
      const last = path[path.length - 1]!;
      const before = (get(value, parent) as { value: Record<PropertyKey, unknown> }).value;
      const after = (get(removed.value, parent) as { value: Record<PropertyKey, unknown> }).value;
      if (Array.isArray(before)) {
        const expected = before.filter((_, index) => index !== last);
        assert.deepEqual(after, expected);
      } else {
        assert.equal(Object.hasOwn(after, last as PropertyKey), false);
        assert.deepEqual(
          Reflect.ownKeys(after),
          Reflect.ownKeys(before).filter((key) => key !== last),
        );
      }
      if (parent.length > 0) {
        assertShared(value, removed.value, parent);
      }
    }),
  );
});

test('laws: a { key } segment designates the element whose keyOf is the key, as its index does', () => {
  const lines = fc.uniqueArray(fc.record({ id: fc.nat(5), qty: fc.integer() }), {
    selector: (line) => line.id,
    maxLength: 4,
  });
  const keyOf = (line: unknown): unknown => (line as { id: number }).id;
  fc.assert(
    fc.property(lines, fc.nat(5), fc.integer(), (items, id, next) => {
      const index = items.findIndex((line) => line.id === id);
      const value = deepFreeze({ items });
      const byKey: Path = ['items', { key: id }, 'qty'];
      const byIndex: Path = ['items', index, 'qty'];
      if (index === -1) {
        assert.deepEqual(get(value, byKey, { keyOf }), {
          ok: false,
          error: { code: 'path.missing', path: byKey, params: { index: 1 } },
        });
        assert.equal(remove(value, byKey, { keyOf }).ok, false);
        return;
      }
      assert.deepEqual(get(value, byKey, { keyOf }), get(value, byIndex));
      assert.deepEqual(set(value, byKey, next, { keyOf }), set(value, byIndex, next));
      assert.deepEqual(remove(value, ['items', { key: id }], { keyOf }), remove(value, ['items', index]));
    }),
  );
});

test('get reads fields, indexes, symbols and keyed elements; a missing field differs from an undefined one', () => {
  const value = { lines: [{ id: 'x', qty: 2 }, { id: 'y' }], note: undefined, [SYMBOL]: 1 };
  assert.deepEqual(get(value, ['lines', 1, 'id']), { ok: true, value: 'y' });
  assert.deepEqual(get(value, [SYMBOL]), { ok: true, value: 1 });
  assert.deepEqual(get(value, ['note']), { ok: true, value: undefined });
  assert.deepEqual(get(value, []), { ok: true, value });
  const keyOf = (line: unknown): unknown => (line as { id: string }).id;
  assert.deepEqual(get(value, ['lines', { key: 'x' }, 'qty'], { keyOf }), { ok: true, value: 2 });
  const missing = (index: number, path: Path) => ({
    ok: false,
    error: { code: 'path.missing', path, params: { index } },
  });
  const stuck = (index: number, path: Path) => ({
    ok: false,
    error: { code: 'path.not_traversable', path, params: { index } },
  });
  for (const [path, expected] of [
    [['absent'], missing(0, ['absent'])],
    [['lines', 2], missing(1, ['lines', 2])],
    [['lines', 1, 'qty'], missing(2, ['lines', 1, 'qty'])],
    [['toString'], missing(0, ['toString'])],
    [['lines', '0'], stuck(1, ['lines', '0'])],
    [['lines', 'length'], stuck(1, ['lines', 'length'])],
    [['lines', -1], stuck(1, ['lines', -1])],
    [['lines', 0.5], stuck(1, ['lines', 0.5])],
    [['lines', 0, 'qty', 'unit'], stuck(3, ['lines', 0, 'qty', 'unit'])],
    [[0], stuck(0, [0])],
  ] as const) {
    assert.deepEqual(get(value, path as Path), expected, String(path));
  }
  assert.deepEqual(get(value, ['lines', { key: 'z' }], { keyOf }), missing(1, ['lines', { key: 'z' }]));
  assert.deepEqual(get(new Map([['a', 1]]), ['a']), stuck(0, ['a']));
  assert.deepEqual(get([, 1], [0]), missing(0, [0]));
  assert.equal(has(value, ['note']), true);
  assert.equal(has(value, ['absent']), false);
});

test('set adds a last field or appends, creates the rest only when asked, and never makes a hole', () => {
  assert.deepEqual(set({ a: 1 }, ['b'], 2), { ok: true, value: { a: 1, b: 2 } });
  assert.deepEqual(set({ a: 1, b: 2 }, ['a'], 3), { ok: true, value: { a: 3, b: 2 } });
  assert.deepEqual(set({ xs: [1] }, ['xs', 1], 2), { ok: true, value: { xs: [1, 2] } });
  assert.deepEqual(set([, 1], [0], 0), { ok: true, value: [0, 1] });
  assert.deepEqual(set({ xs: [1] }, ['xs', 2], 3).ok, false);
  assert.deepEqual(set({}, ['a', 'b'], 1).ok, false);
  assert.deepEqual(set({}, ['a', 'b'], 1, { createMissing: 'object' }), { ok: true, value: { a: { b: 1 } } });
  assert.deepEqual(set({}, ['a', 0, 'b'], 1, { createMissing: 'array-if-numeric' }), {
    ok: true,
    value: { a: [{ b: 1 }] },
  });
  const tooFar = set({}, ['a', 1], 1, { createMissing: 'array-if-numeric' });
  assert.deepEqual(tooFar, { ok: false, error: { code: 'path.missing', path: ['a', 1], params: { index: 1 } } });
  const numberInRecord = set({}, ['a', 0], 1, { createMissing: 'object' });
  assert.equal(!numberInRecord.ok && numberInRecord.error.code, 'path.not_traversable');
  assert.deepEqual(set({ a: 5 }, ['a', 'b'], 1, { createMissing: 'object' }).ok, false);
  assert.deepEqual(set(1, [], 2), { ok: true, value: 2 });
  const bare = Object.assign(Object.create(null) as object, { a: 1 });
  const copy = set(bare, ['b'], 2);
  assert.ok(copy.ok && Object.getPrototypeOf(copy.value) === null);
});

test('update creates with undefined when asked; remove splices arrays and refuses the empty path', () => {
  assert.deepEqual(
    update({}, ['n'], (n) => ((n as number | undefined) ?? 0) + 1, { createMissing: 'object' }),
    {
      ok: true,
      value: { n: 1 },
    },
  );
  assert.equal(update({}, ['n'], () => 1).ok, false);
  assert.deepEqual(
    update(2, [], (n) => (n as number) * 2),
    { ok: true, value: 4 },
  );
  assert.deepEqual(remove({ tags: ['a', 'b', 'c'] }, ['tags', 1]), { ok: true, value: { tags: ['a', 'c'] } });
  assert.deepEqual(remove({ a: 1, b: 2 }, ['a']), { ok: true, value: { b: 2 } });
  assert.deepEqual(remove([1, , 3], [2]), { ok: true, value: [1, ,] });
  assert.deepEqual(remove({ a: 1 }, []), {
    ok: false,
    error: { code: 'path.missing', path: [], params: { index: 0 } },
  });
  assert.equal(remove({ a: 1 }, ['b']).ok, false);
});

test('a write never reaches a prototype, and works on frozen data', () => {
  for (const segment of ['__proto__', 'constructor', 'prototype']) {
    const path = ['a', segment, 'polluted'];
    for (const written of [
      set({ a: {} }, path, true, { createMissing: 'object' }),
      update({ a: {} }, path, () => true, { createMissing: 'object' }),
      remove({ a: { [segment]: 1 } }, path),
    ]) {
      assert.deepEqual(written, {
        ok: false,
        error: { code: 'path.forbidden_segment', path, params: { index: 1, segment } },
      });
    }
  }
  assert.equal((Object.prototype as Record<string, unknown>)['polluted'], undefined);
  const frozen = deepFreeze({ a: { b: [1, 2] } });
  assert.deepEqual(set(frozen, ['a', 'b', 0], 9), { ok: true, value: { a: { b: [9, 2] } } });
  // Reading "__proto__" is no write: an own "__proto__" field is read as any other.
  const own = JSON.parse('{"__proto__": 1}') as unknown;
  assert.deepEqual(get(own, ['__proto__']), { ok: true, value: 1 });
});

test('a getter is read once, only on the path; keyOf and change are called as documented', () => {
  let reads = 0;
  const value = {
    get a() {
      reads += 1;
      return { b: 1 };
    },
    c: 2,
  };
  assert.deepEqual(set(value, ['a', 'b'], 3), { ok: true, value: { a: { b: 3 }, c: 2 } });
  assert.equal(reads, 1);
  set(value, ['c'], 4);
  assert.equal(reads, 2);
  assert.throws(() => get({ xs: [1] }, ['xs', { key: 1 }]), TypeError);
  assert.throws(
    () =>
      get({ xs: [1] }, ['xs', { key: 1 }], {
        keyOf: () => {
          throw new CallbackError();
        },
      }),
    CallbackError,
  );
});

test('options and paths outside their type are a bug of the caller', () => {
  for (const call of [
    () => get({}, 'a' as unknown as Path),
    () => get({}, [], { keyOf: 1 as unknown as () => unknown }),
    () => set({}, ['a'], 1, { createMissing: 'array' as 'object' }),
    () => remove({}, null as unknown as Path),
  ]) {
    assert.throws(call, TypeError);
  }
});

test('types: get gives unknown, the writes the type of their input, issues narrow by code', () => {
  const value = { a: 1 };
  assertType<Equal<ReturnType<typeof get>, Result<unknown, AccessIssue>>>();
  const written = set(value, ['a'], 2);
  assertType<Equal<typeof written, Result<{ a: number }, WriteIssue>>>();
  if (!written.ok && written.error.code === 'path.forbidden_segment') {
    assertType<Equal<typeof written.error.params.segment, string>>();
  }
});

function accessesSafely(value: unknown): void {
  for (const call of [
    () => get(value, ['a', 0]),
    () => has(value, ['a']),
    () => set(value, ['a', 0], 1, { createMissing: 'array-if-numeric' }),
    () => update(value, ['a'], () => 1),
    () => remove(value, ['a']),
  ]) {
    try {
      const result = call();
      assert.ok(typeof result === 'boolean' || typeof result.ok === 'boolean');
    } catch (error) {
      assert.ok(
        error instanceof HostileError || error instanceof TypeError || error instanceof RangeError,
        String(error),
      );
    }
  }
}

for (const name of ['get', 'has', 'set', 'update', 'remove'] as const) {
  declareAdversarial(SUBPATH, name, {
    boundary: accessesSafely,
    structures: accessesSafely,
    hostile: accessesSafely,
    unicode: (text) => {
      // Keys are compared by code units, never normalized.
      const value = { [text]: 1 };
      assert.deepEqual(get(value, [text]), { ok: true, value: 1 });
      assert.equal(has(value, [text.normalize('NFD')]), text === text.normalize('NFD'));
      const written = set(value, [text], 2);
      if (['__proto__', 'constructor', 'prototype'].includes(text)) {
        assert.equal(!written.ok && written.error.code, 'path.forbidden_segment');
      } else {
        assert.deepEqual(written, { ok: true, value: { [text]: 2 } });
      }
    },
    callbacks:
      name === 'update'
        ? (callback) => {
            try {
              const result = update({ a: 1 }, ['a'], callback);
              assert.ok(result.ok);
            } catch (error) {
              assert.ok(error instanceof CallbackError || typeof error === 'string', String(error));
            }
          }
        : { na: `${name} takes no callback but keyOf, whose errors propagate as the getter's do` },
    async: { na: `${name} is synchronous and takes no signal` },
  });
}
