// Selecting fields by a mask, ARCHITECTURE.md §7.1 and ADR 0021. A mask names fields the way the value nests them:
// `true` takes a field whole, a nested mask walks into it, and a mask on an array applies to each element. The
// compiler checks every key of a mask against the type of the value, at every depth, so a field renamed in the model
// breaks the build instead of a comparison or a log line. Then merging, defaults and mapping, ARCHITECTURE.md §7.1:
// one record laid over or mapped into another.
//
// Support table, for every function of this module:
//   records (prototype Object.prototype or null)  own enumerable string keys, symbols opt-in; the copy keeps the
//                                                  prototype, and a "__proto__" key stays a key
//   arrays (prototype Array.prototype)             by a mask: each element by the same mask; merged: joined or
//                                                  replaced, never walked; holes stay holes
//   anything else (Map, Set, Date, class instances, arrays of another realm or subclass)  taken whole, as the value
// A getter is read once, and only when its field is kept; an exception it throws is propagated.
//
// Differences from es-toolkit 1.52.0, each checked on generated inputs by the judge of the tests:
//   - pick, omit, mapValues, mapKeys, merge, defaults: a dictionary without prototype stays one; es-toolkit returns an
//     `Object` instance
//   - pick, mapValues, mapKeys: a "__proto__" key stays a key; es-toolkit assigns it, which replaces the prototype of
//     the copy
//   - omit: a symbol key counts only with `symbols: true`; es-toolkit always copies it
//   - merge, defaults: a "__proto__" key stays a key; es-toolkit skips it
//   - merge: an array that meets an array or a record is replaced, or joined by `arrays: 'concat'`; es-toolkit merges
//     them by index
//   - merge: an `undefined` field of the overrides is copied, as a spread does; es-toolkit skips it
//   - merge, defaults: symbol keys of both values count only with `symbols: true`; es-toolkit keeps those of the first
//     and ignores the second
//   - defaults: an array is a value, kept whole; es-toolkit fills its missing indexes from the fallback
//   - mapValues, mapKeys: `symbols: true` maps symbol keys too; es-toolkit never reads them
import { checkMask, isPlainArray, isRecord, keysOf, maskEntry } from './mask.ts';

// The values a mask cannot walk into: a mask names them whole. A built-in that has a `Symbol.toStringTag` (Map, Set,
// typed arrays, Temporal objects, promises) is one, as are dates, regular expressions and functions.
type Opaque = Date | RegExp | ((...args: never[]) => unknown) | { readonly [Symbol.toStringTag]: string };

/**
 * A mask on a value whose type is unknown: any key, any depth.
 * @since 0.1
 * @experimental
 */
export interface UntypedMask {
  readonly [key: string]: true | UntypedMask;
  readonly [key: symbol]: true | UntypedMask;
}

/**
 * The fields of a `T` a function selects: `true` for a whole field, a nested mask to walk into it; a mask on an array
 * applies to each element. Only the fields of `T` are allowed, at every depth; on `unknown`, any key is.
 * @since 0.1
 * @experimental
 * @example const mask: Mask<User> = { password: true, address: { geo: true } };
 */
export type Mask<T> = unknown extends T
  ? UntypedMask
  : T extends readonly (infer Element)[]
    ? Mask<Element>
    : T extends Opaque
      ? never
      : T extends object
        ? { readonly [K in keyof T]?: true | Mask<T[K]> }
        : never;

// What a mask may be, checked key by key against `T`: a key `T` does not have becomes `never`, which the literal's
// `true` cannot satisfy, so that a misspelt key is an error even beside a correct one (a constraint alone checks no
// excess key once the literal is inferred as the mask's own type). The records a mask reaches are those of `T`, through
// arrays, `null` and `undefined`, and a key of any member of a union is a key; a mask with an index signature (a wide
// or untyped one) is left to the constraint.
type Fields<T> = T extends readonly (infer E)[] ? Fields<E> : T extends object ? T : never;
type FieldKeys<T> = T extends unknown ? keyof T : never;
type FieldValue<T, K> = T extends unknown ? (K extends keyof T ? T[K] : never) : never;
type Exact<M, T> = unknown extends T
  ? M
  : string extends keyof M
    ? M
    : {
        readonly [K in keyof M]: K extends FieldKeys<Fields<T>>
          ? M[K] extends true
            ? true
            : Exact<M[K], FieldValue<Fields<T>, K>>
          : never;
      };

/**
 * What `pick(value, mask)` returns: the fields the mask names, walked into where it nests. Exact for a mask written
 * as a literal; a mask typed wider (`Mask<T>`) keeps every field of `T`.
 * @since 0.1
 * @experimental
 */
export type Picked<T, M> = unknown extends T
  ? T
  : T extends readonly unknown[]
    ? { [I in keyof T]: Picked<T[I], M> }
    : T extends Opaque
      ? T
      : T extends object
        ? {
            [K in keyof T as K extends keyof M ? K : never]: K extends keyof M
              ? M[K] extends true
                ? T[K]
                : Picked<T[K], M[K]>
              : never;
          }
        : T;

/**
 * What `omit(value, mask)` returns: every field but those the mask names `true`, walked into where it nests. Exact
 * for a mask written as a literal; a mask typed wider (`Mask<T>`) keeps every field of `T`.
 * @since 0.1
 * @experimental
 */
export type Omitted<T, M> = unknown extends T
  ? T
  : T extends readonly unknown[]
    ? { [I in keyof T]: Omitted<T[I], M> }
    : T extends Opaque
      ? T
      : T extends object
        ? {
            [K in keyof T as K extends keyof M ? (M[K] extends true ? never : K) : K]: K extends keyof M
              ? Omitted<T[K], M[K]>
              : T[K];
          }
        : T;

/**
 * What `redact(value, mask, { replacement })` returns: every field, those the mask names `true` holding `R` instead.
 * @since 0.1
 * @experimental
 */
export type Redacted<T, M, R> = unknown extends T
  ? T
  : T extends readonly unknown[]
    ? { [I in keyof T]: Redacted<T[I], M, R> }
    : T extends Opaque
      ? T
      : T extends object
        ? {
            [K in keyof T]: K extends keyof M ? (M[K] extends true ? R : Redacted<T[K], M[K], R>) : T[K];
          }
        : T;

/**
 * The option every function of this module takes: which keys of a record count.
 * @since 0.1
 * @experimental
 */
export interface KeyOptions {
  /** Whether own enumerable symbol keys of records count too; `false` by default, as for every object function. */
  readonly symbols?: boolean;
}

/**
 * Options of `pick` and `omit`.
 * @since 0.1
 * @experimental
 */
export interface MaskOptions extends KeyOptions {}

/**
 * Options of `redact`.
 * @since 0.1
 * @experimental
 */
export interface RedactOptions<R> extends MaskOptions {
  /** What a redacted field holds; `'***'` by default. */
  readonly replacement?: R;
}

function symbolsOf(options: KeyOptions): boolean {
  const { symbols = false } = options;
  if (typeof symbols !== 'boolean') {
    throw new TypeError(`symbols: ${String(symbols)}`);
  }
  return symbols;
}

/** An empty record with the prototype of `record`, so that a dictionary without prototype stays one. */
function blank(record: object): Record<PropertyKey, unknown> {
  return Object.getPrototypeOf(record) === null ? (Object.create(null) as Record<PropertyKey, unknown>) : {};
}

// A data property, never a setter: assigning "__proto__" on an ordinary object would replace its prototype instead.
function put(target: Record<PropertyKey, unknown>, key: PropertyKey, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
  } else {
    target[key] = value;
  }
}

/** Applies `walk` to each element of an array, holes kept. */
function each(array: readonly unknown[], walk: (element: unknown) => unknown): unknown[] {
  const copy = new Array<unknown>(array.length);
  for (let index = 0; index < array.length; index += 1) {
    if (index in array) {
      copy[index] = walk(array[index]);
    }
  }
  return copy;
}

function choose(value: unknown, mask: object, symbols: boolean): unknown {
  if (isPlainArray(value)) {
    return each(value, (element) => choose(element, mask, symbols));
  }
  if (!isRecord(value)) {
    return value;
  }
  const copy = blank(value);
  for (const key of keysOf(mask, symbols)) {
    const entry = maskEntry(mask, key);
    if (entry !== undefined && Object.prototype.propertyIsEnumerable.call(value, key)) {
      put(copy, key, entry === true ? value[key] : choose(value[key], entry, symbols));
    }
  }
  return copy;
}

// omit and redact walk alike: a field named `true` is dropped, or replaced when `redacting`.
function strip(value: unknown, mask: object, symbols: boolean, redacting: boolean, replacement: unknown): unknown {
  if (isPlainArray(value)) {
    return each(value, (element) => strip(element, mask, symbols, redacting, replacement));
  }
  if (!isRecord(value)) {
    return value;
  }
  const copy = blank(value);
  for (const key of keysOf(value, symbols)) {
    const entry = maskEntry(mask, key);
    if (entry !== true) {
      put(copy, key, entry === undefined ? value[key] : strip(value[key], entry, symbols, redacting, replacement));
    } else if (redacting) {
      put(copy, key, replacement);
    }
  }
  return copy;
}

/**
 * A copy of `value` with only the fields `mask` names: `true` keeps a field whole, a nested mask walks into it, a
 * mask on an array applies to each element. A field the value lacks stays absent. Fields are written in the order of
 * the mask; what the mask cannot walk into (see the support table) is kept whole.
 * @pure
 * @sharing structural
 * @complexity O(m) (m = mask entries reached, over every element of the arrays walked)
 * @throws TypeError when `mask` or one of its entries is neither `true` nor a plain object
 * @throws TypeError when `symbols` is not a boolean
 * @throws what a getter or a Proxy trap throws, unchanged
 * @throws RangeError when the mask refers to itself and the value is cyclic or deeper than the call stack
 * @since 0.1
 * @experimental
 * @example pick({ id: 1, address: { city: 'Paris', zip: '75001' } }, { address: { city: true } })
 */
export function pick<T, const M extends Mask<T>>(
  value: T,
  mask: M & Exact<M, T>,
  options: MaskOptions = {},
): Picked<T, M> {
  const symbols = symbolsOf(options);
  return choose(value, checkMask(mask, 'mask'), symbols) as Picked<T, M>;
}

/**
 * A copy of `value` without the fields `mask` names `true`; a nested mask walks into its field, a mask on an array
 * applies to each element. Fields keep the order of the value; what the mask cannot walk into is kept whole.
 * @pure
 * @sharing structural
 * @complexity O(n) (n = keys of the records walked)
 * @throws TypeError when `mask` or one of the entries read is neither `true` nor a plain object
 * @throws TypeError when `symbols` is not a boolean
 * @throws what a getter or a Proxy trap throws, unchanged
 * @throws RangeError when the mask refers to itself and the value is cyclic or deeper than the call stack
 * @since 0.1
 * @experimental
 * @example omit({ name: 'Ada', password: 's3cret', lines: [{ id: 1 }] }, { password: true, lines: { id: true } })
 */
export function omit<T, const M extends Mask<T>>(
  value: T,
  mask: M & Exact<M, T>,
  options: MaskOptions = {},
): Omitted<T, M> {
  const symbols = symbolsOf(options);
  return strip(value, checkMask(mask, 'mask'), symbols, false, undefined) as Omitted<T, M>;
}

/**
 * A copy of `value` where each field `mask` names `true` holds `replacement` (`'***'` by default), for a log or an
 * error report; a field the value lacks stays absent. Walks as `omit` does.
 * @pure
 * @sharing structural
 * @complexity O(n) (n = keys of the records walked)
 * @throws TypeError when `mask` or one of the entries read is neither `true` nor a plain object
 * @throws TypeError when `symbols` is not a boolean
 * @throws what a getter or a Proxy trap throws, unchanged
 * @throws RangeError when the mask refers to itself and the value is cyclic or deeper than the call stack
 * @since 0.1
 * @experimental
 * @example redact({ card: { number: '4970 1012', expiry: '12/29' } }, { card: { number: true } })
 */
export function redact<T, const M extends Mask<T>, const R = '***'>(
  value: T,
  mask: M & Exact<M, T>,
  options: RedactOptions<R> = {},
): Redacted<T, M, R> {
  const symbols = symbolsOf(options);
  const replacement = 'replacement' in options ? options.replacement : '***';
  return strip(value, checkMask(mask, 'mask'), symbols, true, replacement) as Redacted<T, M, R>;
}

// The key a callback receives for a field of `T`: a number key is a string at run time.
type KeyName<T> = keyof T extends infer K ? (K extends number ? `${K}` : K) : never;

// `T` with each optional field present: under `exactOptionalPropertyTypes`, `T[K]` of an optional field also holds
// the `undefined` of a missing field, which `-?` removes and an `undefined` the field declares survives.
type Present<T> = { [K in keyof T]-?: T[K] };

// An intersection of mapped types, shown as one object type with the modifiers of each part.
type Flat<T> = { [K in keyof T]: T[K] };

/**
 * How `merge` combines two arrays at the same place: `'replace'` takes the second whole, `'concat'` joins both.
 * @since 0.1
 * @experimental
 */
export type ArrayStrategy = 'replace' | 'concat';

/**
 * Options of `merge`. The array strategy has no default: whether a list of overrides replaces or extends the base one
 * is a choice of the caller, and a silent default would make one of them a surprise.
 * @since 0.1
 * @experimental
 */
export interface MergeOptions<S extends ArrayStrategy> extends KeyOptions {
  readonly arrays: S;
}

/**
 * What `merge(base, overrides, { arrays: S })` returns: `B`, unless both are records (merged field by field) or both
 * arrays joined by `'concat'`. A field `B` declares optional may be missing, so it may hold `A`'s.
 * @since 0.1
 * @experimental
 */
export type Merged<A, B, S extends ArrayStrategy> = unknown extends A
  ? unknown
  : unknown extends B
    ? unknown
    : A extends readonly (infer EA)[]
      ? B extends readonly (infer EB)[]
        ? S extends 'concat'
          ? (EA | EB)[]
          : B
        : B
      : A extends Opaque
        ? B
        : A extends object
          ? B extends readonly unknown[] | Opaque
            ? B
            : B extends object
              ? Flat<
                  Omit<A, keyof B> & {
                    [K in keyof B]: K extends keyof A
                      ? {} extends Pick<B, K>
                        ? A[K] | Merged<A[K], Present<B>[K], S>
                        : Merged<A[K], B[K], S>
                      : Present<B>[K];
                  }
                >
              : B
          : B;

/**
 * What `defaults(value, fallback)` returns: `D` where `T` is `undefined`, the records merged where both are records,
 * `T` anywhere else.
 * @since 0.1
 * @experimental
 */
export type Defaulted<T, D> = unknown extends T
  ? unknown
  : T extends undefined
    ? D
    : T extends readonly unknown[] | Opaque
      ? T
      : T extends object
        ? D extends readonly unknown[] | Opaque
          ? T
          : D extends object
            ? Flat<
                { [K in keyof T as K extends keyof D ? never : K]: T[K] } & Omit<D, keyof T> & {
                    [K in keyof T & keyof D]: Defaulted<T[K], D[K]>;
                  }
              >
            : T
        : T;

/** Throws unless `value` is a record: the functions that take one by type refuse anything else at run time too. */
function checkRecord(value: unknown, name: string): Readonly<Record<PropertyKey, unknown>> {
  if (!isRecord(value)) {
    throw new TypeError(`${name}: not a plain object`);
  }
  return value;
}

function checkKey(key: unknown): PropertyKey {
  if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'symbol') {
    throw new TypeError(`not a property key: ${String(key)}`);
  }
  return key;
}

/**
 * A copy of `record` whose each field holds what `map` returns for its value and key, in the order of the record.
 * The copy keeps the prototype of the record (a dictionary without prototype stays one).
 * @pure
 * @sharing structural
 * @complexity O(n) (n = keys of the record), plus one call of `map` per key
 * @throws TypeError when `record` is not a plain object, or `symbols` not a boolean
 * @throws what `map`, a getter or a Proxy trap throws, unchanged
 * @since 0.1
 * @experimental
 * @example mapValues({ apples: 3, pears: 5 }, (count) => count * 2) // { apples: 6, pears: 10 }
 */
export function mapValues<T extends object, U>(
  record: T,
  map: (value: T[keyof T], key: KeyName<T>) => U,
  options: KeyOptions = {},
): { [K in keyof T]: U } {
  const source = checkRecord(record, 'record');
  const copy = blank(source);
  for (const key of keysOf(source, symbolsOf(options))) {
    put(copy, key, (map as (value: unknown, key: PropertyKey) => U)(source[key], key));
  }
  return copy as { [K in keyof T]: U };
}

/**
 * A copy of `record` whose each field is renamed to what `rename` returns for its key and value. When two fields get
 * the same name, the later one in the order of the record wins, as with `Object.fromEntries`.
 * @pure
 * @sharing structural
 * @complexity O(n) (n = keys of the record), plus one call of `rename` per key
 * @throws TypeError when `record` is not a plain object, `rename` returns no property key, or `symbols` is no boolean
 * @throws what `rename`, a getter or a Proxy trap throws, unchanged
 * @since 0.1
 * @experimental
 * @example mapKeys({ first_name: 'Ada' }, (key) => key.replace('_n', 'N')) // { firstName: 'Ada' }
 */
export function mapKeys<T extends object, K extends PropertyKey>(
  record: T,
  rename: (key: KeyName<T>, value: T[keyof T]) => K,
  options: KeyOptions = {},
): Partial<Record<K, T[keyof T]>> {
  const source = checkRecord(record, 'record');
  const copy = blank(source);
  for (const key of keysOf(source, symbolsOf(options))) {
    const value = source[key];
    put(copy, checkKey((rename as (key: PropertyKey, value: unknown) => unknown)(key, value)), value);
  }
  return copy as Partial<Record<K, T[keyof T]>>;
}

// Both arrays are plain: the copy is built by index, so that no Symbol.isConcatSpreadable or species of the data runs.
function join(first: readonly unknown[], second: readonly unknown[]): unknown[] {
  const joined = new Array<unknown>(first.length + second.length);
  for (let index = 0; index < first.length; index += 1) {
    if (index in first) {
      joined[index] = first[index];
    }
  }
  for (let index = 0; index < second.length; index += 1) {
    if (index in second) {
      joined[first.length + index] = second[index];
    }
  }
  return joined;
}

function combine(base: unknown, overrides: unknown, concat: boolean, symbols: boolean): unknown {
  if (isRecord(base) && isRecord(overrides)) {
    const copy = blank(base);
    for (const key of keysOf(base, symbols)) {
      put(copy, key, base[key]);
    }
    // The copy, never the base, answers whether a key is there: a getter of the base is read once, and a key the base
    // inherits ("constructor", "__proto__") is no field to merge into.
    for (const key of keysOf(overrides, symbols)) {
      const value = overrides[key];
      put(
        copy,
        key,
        Object.prototype.hasOwnProperty.call(copy, key) ? combine(copy[key], value, concat, symbols) : value,
      );
    }
    return copy;
  }
  return concat && isPlainArray(base) && isPlainArray(overrides) ? join(base, overrides) : overrides;
}

/**
 * `overrides` laid over `base`: two records are merged field by field, at every depth, the fields of `overrides`
 * winning; two arrays are joined or replaced as `arrays` says; anything else is `overrides`, even `undefined`, as a
 * spread `{ ...base, ...overrides }` does one level deep. Neither value is changed; what is not merged is shared.
 * @pure
 * @sharing structural
 * @complexity O(n) (n = keys of the records both values hold at the same place), plus the length of joined arrays
 * @throws TypeError when `arrays` is neither `'replace'` nor `'concat'`, or `symbols` is not a boolean
 * @throws what a getter or a Proxy trap throws, unchanged
 * @throws RangeError when both values are cyclic along the same keys, or deeper than the call stack
 * @since 0.1
 * @experimental
 * @example merge({ retry: { count: 3, delay: 100 } }, { retry: { delay: 500 } }, { arrays: 'replace' })
 */
export function merge<A, B, S extends ArrayStrategy>(base: A, overrides: B, options: MergeOptions<S>): Merged<A, B, S> {
  const arrays: unknown = isRecord(options) ? options.arrays : undefined;
  if (arrays !== 'replace' && arrays !== 'concat') {
    throw new TypeError(`arrays: ${String(arrays)}`);
  }
  return combine(base, overrides, arrays === 'concat', symbolsOf(options)) as Merged<A, B, S>;
}

function fill(value: unknown, fallback: unknown, symbols: boolean): unknown {
  if (value === undefined) {
    return fallback;
  }
  if (!isRecord(value) || !isRecord(fallback)) {
    return value;
  }
  const copy = blank(value);
  for (const key of keysOf(value, symbols)) {
    const own = value[key];
    put(copy, key, Object.prototype.propertyIsEnumerable.call(fallback, key) ? fill(own, fallback[key], symbols) : own);
  }
  for (const key of keysOf(fallback, symbols)) {
    if (!Object.prototype.hasOwnProperty.call(copy, key)) {
      put(copy, key, fallback[key]);
    }
  }
  return copy;
}

/**
 * `value` with what it lacks taken from `fallback`: `undefined` gives `fallback`, a field that is missing or
 * `undefined` takes the field of `fallback`, at every depth where both are records. As a default in a destructuring,
 * `null` is a value and is kept; arrays are values too, never joined. Fields keep the order of `value`, then those it
 * lacked follow in the order of `fallback`. Neither value is changed; what is not filled is shared.
 * @pure
 * @sharing structural
 * @complexity O(n) (n = keys of the records both values hold at the same place)
 * @throws TypeError when `symbols` is not a boolean
 * @throws what a getter or a Proxy trap throws, unchanged
 * @throws RangeError when both values are cyclic along the same keys, or deeper than the call stack
 * @since 0.1
 * @experimental
 * @example defaults({ retry: { count: 5 } }, { retry: { count: 3, delay: 9 } }) // { retry: { count: 5, delay: 9 } }
 */
export function defaults<T, D>(value: T, fallback: D, options: KeyOptions = {}): Defaulted<T, D> {
  return fill(value, fallback, symbolsOf(options)) as Defaulted<T, D>;
}
