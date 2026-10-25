// Selecting fields by a mask, ARCHITECTURE.md §7.1 and ADR 0021. A mask names fields the way the value nests them:
// `true` takes a field whole, a nested mask walks into it, and a mask on an array applies to each element. The
// compiler checks every key of a mask against the type of the value, at every depth, so a field renamed in the model
// breaks the build instead of a comparison or a log line.
//
// Support table, for every function of this module:
//   records (prototype Object.prototype or null)  own enumerable string keys, symbols opt-in; the copy keeps the
//                                                  prototype, and a "__proto__" key stays a key
//   arrays (prototype Array.prototype)             each element by the same mask; holes stay holes
//   anything else (Map, Set, Date, class instances, arrays of another realm or subclass)  taken whole, as the value
// A getter is read once, and only when its field is kept; an exception it throws is propagated.
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
 * Options of `pick` and `omit`.
 * @since 0.1
 * @experimental
 */
export interface MaskOptions {
  /** Whether own enumerable symbol keys of records count too; `false` by default, as for every object function. */
  readonly symbols?: boolean;
}

/**
 * Options of `redact`.
 * @since 0.1
 * @experimental
 */
export interface RedactOptions<R> extends MaskOptions {
  /** What a redacted field holds; `'***'` by default. */
  readonly replacement?: R;
}

function symbolsOf(options: MaskOptions): boolean {
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
