// The Result contract of ARCHITECTURE.md §5.1: every expected failure of the library is a value, never an exception.
// Plain object literals and free functions, no class and no method: a bundler drops a function nobody imports, never a
// method. The objects are read-only by type only: freezing each one would cost every call on a hot path (a schema
// returns one per field) to guard against a write the compiler already refuses.

/**
 * The success side of a `Result`: holds the value.
 * @since 0.1
 * @experimental
 */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/**
 * The failure side of a `Result`: holds the error, an expected failure that the caller handles.
 * @since 0.1
 * @experimental
 */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * The outcome of an operation that can fail in an expected way: a value, or an error, told apart by `ok`.
 * @since 0.1
 * @experimental
 */
export type Result<T, E> = Ok<T> | Err<E>;

/**
 * A success holding `value`. It is assignable to `Result<T, E>` whatever `E`.
 * @pure
 * @sharing structural
 * @complexity O(1)
 * @throws never
 * @since 0.1
 * @experimental
 * @example ok(42) // { ok: true, value: 42 }
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * A failure holding `error`. It is assignable to `Result<T, E>` whatever `T`.
 * @pure
 * @sharing structural
 * @complexity O(1)
 * @throws never
 * @since 0.1
 * @experimental
 * @example err('empty') // { ok: false, error: 'empty' }
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Applies `map` to the value of a success; a failure is returned as it is, and `map` is not called.
 * @pure
 * @sharing identity-preserving
 * @complexity O(1), plus one call of `map` on a success
 * @throws what `map` throws, unchanged
 * @since 0.1
 * @experimental
 * @example mapResult(ok(2), (n) => n * 10) // { ok: true, value: 20 }
 */
export function mapResult<T, E, U>(result: Result<T, E>, map: (value: T) => U): Result<U, E> {
  return result.ok ? ok(map(result.value)) : result;
}

/**
 * The value of a success, or `fallback` for a failure. `fallback` is returned as it is, never called.
 * @pure
 * @sharing structural
 * @complexity O(1)
 * @throws never
 * @since 0.1
 * @experimental
 * @example unwrapOr(err('empty'), 0) // 0
 */
export function unwrapOr<T, E, F>(result: Result<T, E>, fallback: F): T | F {
  return result.ok ? result.value : fallback;
}
