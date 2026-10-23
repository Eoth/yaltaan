import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertType, CallbackError, declareAdversarial, fc, type Callback, type Equal } from '@yaltaan/testing';

import { err, mapResult, ok, unwrapOr, type Err, type Ok, type Result } from './index.ts';

const SUBPATH = '@yaltaan/core/result';

// A Result of either side, holding any value fast-check draws.
// Widens a result to its declared union: the compiler narrows a variable to its initializer otherwise.
const widen = <T, E>(result: Result<T, E>): Result<T, E> => result;

const anyResult: fc.Arbitrary<Result<unknown, unknown>> = fc.oneof(fc.anything().map(ok), fc.anything().map(err));

test('ok and err build the two sides, told apart by ok', () => {
  assert.deepEqual(ok(1), { ok: true, value: 1 });
  assert.deepEqual(err('empty'), { ok: false, error: 'empty' });
  assert.deepEqual(Object.keys(ok(1)), ['ok', 'value']);
  assert.deepEqual(Object.keys(err(1)), ['ok', 'error']);
});

test('ok and err hold what they are given, never a copy', () => {
  const value = { nested: [1] };
  assert.equal(ok(value).value, value);
  assert.equal(err(value).error, value);
  assert.ok(Object.is(ok(-0).value, -0));
  assert.ok(Object.is(err(Number.NaN).error, Number.NaN));
  assert.equal(ok(undefined).value, undefined);
});

test('mapResult maps a success and returns a failure as it is, without calling map', () => {
  assert.deepEqual(
    mapResult(ok(2), (n) => n * 10),
    ok(20),
  );
  const failure = widen<number, string>(err('empty'));
  let calls = 0;
  const mapped = mapResult(failure, (n) => {
    calls += 1;
    return n * 10;
  });
  assert.equal(mapped, failure);
  assert.equal(calls, 0);
});

test('mapResult passes the value alone to map', () => {
  const seen: unknown[][] = [];
  mapResult(ok('a'), (...args: unknown[]) => seen.push(args));
  assert.deepEqual(seen, [['a']]);
});

test('mapResult lets an exception of map out unchanged', () => {
  const thrown = new Error('bug in map');
  assert.throws(
    () =>
      mapResult(ok(1), () => {
        throw thrown;
      }),
    (error) => error === thrown,
  );
});

test('unwrapOr returns the value of a success, or the fallback as it is', () => {
  assert.equal(unwrapOr(ok(1), 0), 1);
  assert.equal(unwrapOr(err('empty'), 0), 0);
  const fallback = (): number => 1;
  assert.equal(unwrapOr(err('empty'), fallback), fallback);
  assert.equal(unwrapOr(ok(undefined), 0), undefined);
});

test('mapResult with the identity changes nothing, and a failure keeps its reference', () => {
  fc.assert(
    fc.property(anyResult, (result) => {
      const mapped = mapResult(result, (value) => value);
      assert.deepEqual(mapped, result);
      if (!result.ok) {
        assert.equal(mapped, result);
      }
    }),
  );
});

test('mapResult composes: mapping by f then g equals mapping by g after f', () => {
  fc.assert(
    fc.property(anyResult, fc.func(fc.anything()), fc.func(fc.anything()), (result, f, g) => {
      assert.deepEqual(
        mapResult(mapResult(result, f), g),
        mapResult(result, (value) => g(f(value))),
      );
    }),
  );
});

test('unwrapOr agrees with the side of the result', () => {
  fc.assert(
    fc.property(anyResult, fc.anything(), (result, fallback) => {
      const expected = result.ok ? result.value : fallback;
      assert.ok(Object.is(unwrapOr(result, fallback), expected));
    }),
  );
});

test('types: ok narrows the union, and each function keeps its types', () => {
  const parsed = ((text: string): Result<number, 'empty'> => (text === '' ? err('empty') : ok(text.length)))('ab');
  if (parsed.ok) {
    assertType<Equal<typeof parsed, Ok<number>>>();
    assertType<Equal<typeof parsed.value, number>>();
    // @ts-expect-error a success has no error
    void parsed.error;
  } else {
    assertType<Equal<typeof parsed, Err<'empty'>>>();
    assertType<Equal<typeof parsed.error, 'empty'>>();
    // @ts-expect-error a failure has no value
    void parsed.value;
  }
  // @ts-expect-error the value is read only after narrowing by ok
  void parsed.value;

  assertType<Equal<ReturnType<typeof ok<number>>, Ok<number>>>();
  assertType<Equal<ReturnType<typeof err<string>>, Err<string>>>();
  const success = widen<number, string>(ok(1));
  const failure = widen<number, string>(err('no'));
  assertType<
    Equal<
      typeof mapResult<number, string, boolean>,
      (r: Result<number, string>, m: (v: number) => boolean) => Result<boolean, string>
    >
  >();
  const mapped = mapResult(success, (n) => n > 0);
  assertType<Equal<typeof mapped, Result<boolean, string>>>();
  const unwrapped = unwrapOr(failure, null);
  assertType<Equal<typeof unwrapped, number | null>>();

  // @ts-expect-error a Result is read-only
  success.ok = false;
  // @ts-expect-error a success is not a failure
  const wrong: Err<string> = ok('no');
  void wrong;
  // @ts-expect-error map receives the value's type
  mapResult(success, (text: string) => text);
});

// The README's example, so that it stays true.
test('the example of the README runs', () => {
  const parseAge = (text: string): Result<number, 'not_a_number'> => {
    const age = Number(text);
    return Number.isInteger(age) ? ok(age) : err('not_a_number');
  };
  const nextYear = mapResult(parseAge('41'), (age) => age + 1);
  assert.deepEqual(nextYear, { ok: true, value: 42 });
  assert.equal(unwrapOr(parseAge('forty'), 0), 0);
});

// The values of every category are held or returned by reference: none of the four functions reads, copies or calls
// them, so a hostile Proxy, a deep cycle or a throwing function must come back untouched.
const holdsAsIs = (value: unknown): void => {
  assert.ok(Object.is(ok(value).value, value));
  assert.ok(Object.is(err(value).error, value));
};

declareAdversarial(SUBPATH, 'ok', {
  boundary: holdsAsIs,
  structures: holdsAsIs,
  hostile: holdsAsIs,
  unicode: holdsAsIs,
  callbacks: holdsAsIs,
  async: { na: 'ok is synchronous and takes no signal' },
});

declareAdversarial(SUBPATH, 'err', {
  boundary: holdsAsIs,
  structures: holdsAsIs,
  hostile: holdsAsIs,
  unicode: holdsAsIs,
  callbacks: holdsAsIs,
  async: { na: 'err is synchronous and takes no signal' },
});

const mapsAsIs = (value: unknown): void => {
  assert.ok(
    Object.is(
      unwrapOr(
        mapResult(ok(value), (held) => held),
        undefined,
      ),
      value,
    ),
  );
  const failure = err(value);
  assert.equal(
    mapResult(failure, () => assert.fail('map called on a failure')),
    failure,
  );
};

// map is called once, with the value alone; whatever it returns is the new value, whatever it throws comes out as it
// is, and on a failure it is never called.
const callsMapOnce = (callback: Callback): void => {
  const value = [1, 2, 3];
  let calls = 0;
  let outcome: { readonly returned: unknown } | { readonly thrown: unknown } = { returned: undefined };
  const map = (held: unknown): unknown => {
    calls += 1;
    try {
      const returned = callback(held);
      outcome = { returned };
      return returned;
    } catch (error) {
      outcome = { thrown: error };
      throw error;
    }
  };
  let mapped: Result<unknown, never> | undefined;
  try {
    mapped = mapResult(ok(value), map);
  } catch (error) {
    assert.ok('thrown' in outcome && Object.is(error, outcome.thrown), String(error));
    assert.ok(error instanceof CallbackError || typeof error === 'string', String(error));
  }
  if (mapped !== undefined) {
    assert.ok('returned' in outcome && mapped.ok && Object.is(mapped.value, outcome.returned));
  }
  assert.equal(calls, 1);
  mapResult(err(value), () => assert.fail('map called on a failure'));
};

declareAdversarial(SUBPATH, 'mapResult', {
  boundary: mapsAsIs,
  structures: mapsAsIs,
  hostile: mapsAsIs,
  unicode: mapsAsIs,
  callbacks: callsMapOnce,
  async: { na: 'mapResult is synchronous and takes no signal; a map that returns a promise is a callbacks case' },
});

const unwrapsAsIs = (value: unknown): void => {
  assert.ok(Object.is(unwrapOr(ok(value), 'fallback'), value));
  assert.ok(Object.is(unwrapOr(err('failure'), value), value));
};

declareAdversarial(SUBPATH, 'unwrapOr', {
  boundary: unwrapsAsIs,
  structures: unwrapsAsIs,
  hostile: unwrapsAsIs,
  // A function fallback is returned, never called: unwrapOr has no lazy form.
  callbacks: unwrapsAsIs,
  unicode: unwrapsAsIs,
  async: { na: 'unwrapOr is synchronous and takes no signal' },
});
