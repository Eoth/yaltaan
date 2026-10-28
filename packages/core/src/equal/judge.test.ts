// `equal` against `isEqual` of es-toolkit, on generated pairs (see the judge in @yaltaan/testing). A pair is a value
// and either itself, a copy by `structuredClone`, a blurred copy (what two libraries may read alike or not: holes
// become `undefined`, 0 becomes -0, a record without prototype an `Object` one), or another value drawn alike.
// Blind spot: cycles, symbol keys and class instances are not drawn.
import { isEqual } from 'es-toolkit';

import { createJudge, fc } from '@yaltaan/testing';

import { equal } from './index.ts';

const judge = createJudge(new URL('./index.ts', import.meta.url), 'es-toolkit');

const values = fc.anything({
  maxDepth: 3,
  maxKeys: 4,
  withBigInt: true,
  withDate: true,
  withMap: true,
  withSet: true,
  withNullPrototype: true,
  withSparseArray: true,
  withTypedArray: true,
});
// Records and arrays are copied with their ambiguities blurred; any other object is kept as is.
function blur(value: unknown): unknown {
  if (Object.is(value, 0)) {
    return -0;
  }
  if (Array.isArray(value)) {
    return Array.from(value, blur);
  }
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === null) {
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, blur(field)]));
  }
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const copy: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      Object.defineProperty(copy, key, { value: blur(field), writable: true, enumerable: true, configurable: true });
    }
    return copy;
  }
  return value;
}

const KINDS = ['same', 'copy', 'blurred', 'other'] as const;
const pairs = fc.tuple(values, fc.constantFrom(...KINDS), values).map(([value, kind, other]): [unknown, unknown] => {
  switch (kind) {
    case 'same':
      return [value, value];
    case 'copy':
      return [value, structuredClone(value)];
    case 'blurred':
      return [value, blur(value)];
    case 'other':
      return [value, other];
  }
});

// Whether `test` holds for an object reachable from one of `values`: fields, elements, map keys and values.
function anywhere(test: (value: object) => boolean, ...values: unknown[]): boolean {
  const seen = new Set<object>();
  const visit = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null || seen.has(value)) {
      return false;
    }
    seen.add(value);
    if (test(value)) {
      return true;
    }
    if (value instanceof Map) {
      return [...value].some(([key, item]) => visit(key) || visit(item));
    }
    if (value instanceof Set) {
      return [...value].some(visit);
    }
    return Reflect.ownKeys(value).some((key) => visit((value as Record<PropertyKey, unknown>)[key]));
  };
  return values.some(visit);
}
const setOfObjects = (value: object): boolean =>
  value instanceof Set && [...value].some((element) => typeof element === 'object' && element !== null);

const withHole = (value: object): boolean =>
  Array.isArray(value) && Array.from(value.keys()).some((index) => !(index in value));

const HOLES =
  'a hole of an array differs from `undefined`, as a missing key from an `undefined` field; ' +
  'es-toolkit takes both alike';
const SET_ELEMENTS =
  'elements of a `Set` match by SameValueZero, as `has` reads them; es-toolkit also pairs equal objects';

judge.compare('equal', {
  input: pairs,
  ours: ([a, b]) => equal(a, b),
  theirs: ([a, b]) => isEqual(a, b),
  differences: [
    { text: HOLES, applies: (pair) => anywhere(withHole, ...pair) },
    { text: SET_ELEMENTS, applies: (pair) => anywhere(setOfObjects, ...pair) },
  ],
});
