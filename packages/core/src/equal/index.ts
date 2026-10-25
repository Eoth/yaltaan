// Deep equality, ARCHITECTURE.md §7.5 and ADR 0020. Two values are equal when walking them in step never finds a
// difference (bisimulation): a pair of objects already met counts as equal, which ends every cycle and compares an
// aliased subtree once. The walk keeps its own stack, so 10,000 levels cost heap, not call stack.
//
// Support table, both values having the same prototype (`Object.prototype` and `null` count as one):
//   records (prototype Object.prototype or null)  own enumerable string keys, symbols opt-in
//   arrays                                         length, then each index; a hole differs from `undefined`
//   Map                                            same size, keys by SameValueZero (`has`), values deeply
//   Set                                            same size, elements by SameValueZero (`has`)
//   Date                                           time values, as numbers
//   typed arrays                                   length, then each element, as numbers
//   Temporal objects                               their `equals`; Temporal.Duration, which has none, field by field
//   anything else (class instances, functions, RegExp, ArrayBuffer, objects of another realm)  identity

/**
 * Options of `equal`.
 * @since 0.1
 * @experimental
 */
export interface EqualOptions {
  /**
   * How two primitives compare, and two numbers of a typed array or two time values of a `Date`: `'SameValueZero'`
   * (the default, what `Map`, `Set` and `includes` use: `NaN` equals `NaN`, `0` equals `-0`) or `'SameValue'`
   * (`Object.is`: `0` and `-0` differ).
   */
  readonly equality?: 'SameValueZero' | 'SameValue';
  /** Whether own enumerable symbol keys of records count too; `false` by default, as for every object function. */
  readonly symbols?: boolean;
}

// A cycle is unrolled at most this many object pairs before pairs are remembered; below it, comparing a value of a
// form allocates no memory table.
const REMEMBER_AFTER = 64;

const DURATION_FIELDS = [
  'years',
  'months',
  'weeks',
  'days',
  'hours',
  'minutes',
  'seconds',
  'milliseconds',
  'microseconds',
  'nanoseconds',
] as const;

type Same = (x: unknown, y: unknown) => boolean;

// ECMA-262 §7.2.10 SameValueZero: `===`, except that NaN equals NaN.
function sameValueZero(x: unknown, y: unknown): boolean {
  return x === y || (x !== x && y !== y);
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** Whether two values may still be equal: decided now for primitives and identical values, pushed for objects. */
function step(x: unknown, y: unknown, same: Same, pending: unknown[]): boolean {
  if (same(x, y)) {
    return true;
  }
  if (!isObject(x) || !isObject(y)) {
    return false;
  }
  pending.push(x, y);
  return true;
}

/** Whether two objects, never the same one, may still be equal; their children are pushed on `pending`. */
function compare(x: object, y: object, same: Same, symbols: boolean, pending: unknown[]): boolean {
  const prototype: unknown = Object.getPrototypeOf(x);
  const other: unknown = Object.getPrototypeOf(y);
  if (prototype === null || prototype === Object.prototype) {
    return (other === null || other === Object.prototype) && record(x, y, same, symbols, pending);
  }
  if (prototype !== other) {
    return false;
  }
  if (Array.isArray(x)) {
    return array(x, y as unknown[], same, pending);
  }
  if (prototype === Map.prototype) {
    return map(x as Map<unknown, unknown>, y as Map<unknown, unknown>, same, pending);
  }
  if (prototype === Set.prototype) {
    return set(x as Set<unknown>, y as Set<unknown>);
  }
  if (prototype === Date.prototype) {
    return same((x as Date).getTime(), (y as Date).getTime());
  }
  if (ArrayBuffer.isView(x)) {
    return (
      'BYTES_PER_ELEMENT' in x &&
      typedArray(x as unknown as ArrayLike<unknown>, y as unknown as ArrayLike<unknown>, same)
    );
  }
  return temporal(x, y);
}

function keysOf(object: object, symbols: boolean): PropertyKey[] {
  const keys: PropertyKey[] = Object.keys(object);
  if (symbols) {
    for (const symbol of Object.getOwnPropertySymbols(object)) {
      if (Object.prototype.propertyIsEnumerable.call(object, symbol)) {
        keys.push(symbol);
      }
    }
  }
  return keys;
}

function record(x: object, y: object, same: Same, symbols: boolean, pending: unknown[]): boolean {
  const keys = keysOf(x, symbols);
  if (keys.length !== keysOf(y, symbols).length) {
    return false;
  }
  const left = x as Record<PropertyKey, unknown>;
  const right = y as Record<PropertyKey, unknown>;
  for (const key of keys) {
    // Same number of keys, and each key of x an own enumerable key of y: the same keys.
    if (!Object.prototype.propertyIsEnumerable.call(y, key) || !step(left[key], right[key], same, pending)) {
      return false;
    }
  }
  return true;
}

function array(x: readonly unknown[], y: readonly unknown[], same: Same, pending: unknown[]): boolean {
  if (x.length !== y.length) {
    return false;
  }
  for (let index = 0; index < x.length; index += 1) {
    const left = x[index];
    const right = y[index];
    // `in` only where both read undefined: a hole and an undefined element differ, as a missing key does.
    if (left === undefined && right === undefined ? index in x !== index in y : !step(left, right, same, pending)) {
      return false;
    }
  }
  return true;
}

function map(x: Map<unknown, unknown>, y: Map<unknown, unknown>, same: Same, pending: unknown[]): boolean {
  if (x.size !== y.size) {
    return false;
  }
  for (const [key, value] of x) {
    if (!y.has(key) || !step(value, y.get(key), same, pending)) {
      return false;
    }
  }
  return true;
}

function set(x: Set<unknown>, y: Set<unknown>): boolean {
  if (x.size !== y.size) {
    return false;
  }
  for (const element of x) {
    if (!y.has(element)) {
      return false;
    }
  }
  return true;
}

function typedArray(x: ArrayLike<unknown>, y: ArrayLike<unknown>, same: Same): boolean {
  if (x.length !== y.length) {
    return false;
  }
  for (let index = 0; index < x.length; index += 1) {
    if (!same(x[index], y[index])) {
      return false;
    }
  }
  return true;
}

// Temporal objects are told by their tag, which every implementation sets on its prototypes: the library cannot name
// a global that may be missing, nor import a polyfill. The prototypes are already known to be the same.
function temporal(x: object, y: object): boolean {
  const tag: unknown = (x as { readonly [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];
  if (typeof tag !== 'string' || !tag.startsWith('Temporal.')) {
    return false;
  }
  if (tag === 'Temporal.Duration') {
    const left = x as Record<string, unknown>;
    const right = y as Record<string, unknown>;
    return DURATION_FIELDS.every((field) => left[field] === right[field]);
  }
  const equals: unknown = (x as { readonly equals?: unknown }).equals;
  return typeof equals === 'function' && equals.call(x, y) === true;
}

/**
 * Whether the pair was met before, once the walk remembers pairs; remembers it if not. `first` holds the first partner
 * of each object, `more` the others, so that comparing two trees allocates no set.
 */
function met(x: object, y: object, first: Map<object, object>, more: Map<object, Set<object>>): boolean {
  const partner = first.get(x);
  if (partner === undefined) {
    first.set(x, y);
    return false;
  }
  if (partner === y) {
    return true;
  }
  const others = more.get(x);
  if (others === undefined) {
    more.set(x, new Set([y]));
    return false;
  }
  if (others.has(y)) {
    return true;
  }
  others.add(y);
  return false;
}

/**
 * Whether `a` and `b` hold the same data: primitives by SameValueZero (or `Object.is`), records, arrays, `Map`, `Set`,
 * `Date`, typed arrays and Temporal objects by content, anything else by identity. Two structures are equal when
 * walking them in step never finds a difference, so cycles end and an aliased subtree is compared once.
 * @pure
 * @sharing none
 * @complexity O(n) (n = values reached), O(n × m) at worst between two cyclic graphs (m = objects of `b`)
 * @throws TypeError when `equality` is neither 'SameValueZero' nor 'SameValue', or `symbols` is not a boolean
 * @throws what a getter, a Proxy trap or the `equals` method of a Temporal object throws, unchanged
 * @throws TypeError when an object borrows the prototype of `Map`, `Set` or `Date` without being one
 * @since 0.1
 * @experimental
 * @example equal({ tags: ['a'], at: new Date(0) }, { tags: ['a'], at: new Date(0) }) // true
 */
export function equal(a: unknown, b: unknown, options: EqualOptions = {}): boolean {
  const { equality = 'SameValueZero', symbols = false } = options;
  if (equality !== 'SameValueZero' && equality !== 'SameValue') {
    throw new TypeError(`equality: ${String(equality)}`);
  }
  if (typeof symbols !== 'boolean') {
    throw new TypeError(`symbols: ${String(symbols)}`);
  }
  const same: Same = equality === 'SameValue' ? Object.is : sameValueZero;
  if (same(a, b)) {
    return true;
  }
  if (!isObject(a) || !isObject(b)) {
    return false;
  }
  // The walk keeps its own stack of pairs still to compare, two entries per pair.
  const pending: unknown[] = [a, b];
  let first: Map<object, object> | undefined;
  let more: Map<object, Set<object>> | undefined;
  let pairs = 0;
  while (pending.length > 0) {
    const y = pending.pop() as object;
    const x = pending.pop() as object;
    if (pairs < REMEMBER_AFTER) {
      pairs += 1;
    } else if (met(x, y, (first ??= new Map()), (more ??= new Map()))) {
      continue;
    }
    if (!compare(x, y, same, symbols, pending)) {
      return false;
    }
  }
  return true;
}
