// Collections by key, ARCHITECTURE.md §7.2 and ADR 0024: splitting, indexing, counting, deduplicating and comparing
// the elements of any iterable by a key computed from each. Every function reads its iterables once, in order; an
// array's holes read as `undefined`, as `for…of` reads them. Keys are any value, compared by SameValueZero, the
// comparison of a `Map`: a result that holds keys is a `Map`, so `1` and `'1'` stay apart and `"__proto__"` is a key
// like any other. The functions that return elements accept `equality: 'SameValue'` to tell `-0` from `0`.
//
// Differences from es-toolkit 1.52.0, each checked on generated inputs by the judge of the tests:
//   - indexBy: a key met twice is an error with the position of both elements; es-toolkit keeps the last element
//   - indexBy, countBy: the result is a `Map`, whose keys keep their type; es-toolkit returns a record, whose keys are
//     strings, so `1` and `'1'` collide
//   - indexBy, countBy: a "__proto__" key is a key like any other; es-toolkit assigns it, which replaces the
//     prototype of its record
//   - intersectionBy: an element of the first collection is kept each time its key is among the others' keys;
//     es-toolkit keeps it once per key
import { err, ok, type Result } from '../result/index.ts';
import type { Path } from '../path/index.ts';

/**
 * The failure of `indexBy`:
 * - `collection.duplicate_key`: the element at the position the path names has the key of the element at `first`.
 * @since 0.1
 * @experimental
 */
export type CollectionIssue = {
  readonly code: 'collection.duplicate_key';
  readonly path: Path;
  readonly params: { readonly first: number };
};

/**
 * How the functions that return elements compare keys.
 * @since 0.1
 * @experimental
 */
export interface KeyOptions {
  /** SameValueZero (`-0` equals `0`, the default) or SameValue (`Object.is`: they differ). */
  readonly equality?: 'SameValueZero' | 'SameValue';
}

// The stand-in for `-0` under SameValue: a `Set` would merge it with `0`. An object no caller can reach, so no key of
// theirs can equal it.
const NEGATIVE_ZERO = {};

type KeyOf = (key: unknown) => unknown;

function checkFunction(name: string, value: unknown): void {
  if (typeof value !== 'function') {
    throw new TypeError(`${name}: not a function`);
  }
}

function keyOf(options: KeyOptions): KeyOf {
  const { equality = 'SameValueZero' } = options;
  if (equality !== 'SameValueZero' && equality !== 'SameValue') {
    throw new TypeError(`equality: ${String(equality)}`);
  }
  return equality === 'SameValue' ? (key) => (Object.is(key, -0) ? NEGATIVE_ZERO : key) : (key) => key;
}

/**
 * The elements that pass `predicate` and those that fail it, each in input order: every element lands in exactly
 * one of the two. A type guard narrows both sides.
 * @pure
 * @sharing structural
 * @complexity O(n) (n = elements)
 * @throws TypeError when `predicate` is not a function, or `items` is not iterable
 * @throws what `predicate` or the iteration throws, unchanged
 * @since 0.1
 * @experimental
 * @example partition([1, 2, 3, 4], (n) => n % 2 === 0)
 */
export function partition<T, S extends T>(
  items: Iterable<T>,
  predicate: (item: T, index: number) => item is S,
): [passed: S[], failed: Exclude<T, S>[]];
export function partition<T>(
  items: Iterable<T>,
  predicate: (item: T, index: number) => unknown,
): [passed: T[], failed: T[]];
export function partition<T>(items: Iterable<T>, predicate: (item: T, index: number) => unknown): [T[], T[]] {
  checkFunction('predicate', predicate);
  const passed: T[] = [];
  const failed: T[] = [];
  let index = 0;
  for (const item of items) {
    (predicate(item, index++) ? passed : failed).push(item);
  }
  return [passed, failed];
}

/**
 * Each element under its key, keys in input order; `collection.duplicate_key` when two elements share a key, where
 * the second stands, so that no element is lost unseen.
 * @pure
 * @sharing structural
 * @complexity O(n) (n = elements)
 * @throws TypeError when `key` is not a function, or `items` is not iterable
 * @throws what `key` or the iteration throws, unchanged
 * @since 0.1
 * @experimental
 * @example indexBy([{ id: 7, name: 'Ada' }], (user) => user.id)
 */
export function indexBy<T, K>(
  items: Iterable<T>,
  key: (item: T, index: number) => K,
): Result<Map<K, T>, CollectionIssue> {
  checkFunction('key', key);
  const index = new Map<K, T>();
  const firsts = new Map<K, number>();
  let position = 0;
  for (const item of items) {
    const itemKey = key(item, position);
    const first = firsts.get(itemKey);
    if (first !== undefined) {
      return err({ code: 'collection.duplicate_key', path: [position], params: { first } });
    }
    firsts.set(itemKey, position++);
    index.set(itemKey, item);
  }
  return ok(index);
}

/**
 * How many elements have each key, keys in order of first appearance.
 * @pure
 * @sharing structural
 * @complexity O(n) (n = elements)
 * @throws TypeError when `key` is not a function, or `items` is not iterable
 * @throws what `key` or the iteration throws, unchanged
 * @since 0.1
 * @experimental
 * @example countBy(['apple', 'avocado', 'banana'], (word) => word[0])
 */
export function countBy<T, K>(items: Iterable<T>, key: (item: T, index: number) => K): Map<K, number> {
  checkFunction('key', key);
  const counts = new Map<K, number>();
  let index = 0;
  for (const item of items) {
    const itemKey = key(item, index++);
    counts.set(itemKey, (counts.get(itemKey) ?? 0) + 1);
  }
  return counts;
}

/**
 * The first element of each key, in input order; applied to its own result, it changes nothing.
 * @pure
 * @sharing structural
 * @complexity O(n) (n = elements)
 * @throws TypeError when `key` is not a function, `equality` is neither 'SameValueZero' nor 'SameValue', or `items`
 *   is not iterable
 * @throws what `key` or the iteration throws, unchanged
 * @since 0.1
 * @experimental
 * @example uniqueBy([1.2, 1.7, 2.1], Math.floor)
 */
export function uniqueBy<T>(
  items: Iterable<T>,
  key: (item: T, index: number) => unknown,
  options: KeyOptions = {},
): T[] {
  checkFunction('key', key);
  const normalize = keyOf(options);
  const seen = new Set<unknown>();
  const unique: T[] = [];
  let index = 0;
  for (const item of items) {
    const itemKey = normalize(key(item, index++));
    if (!seen.has(itemKey)) {
      seen.add(itemKey);
      unique.push(item);
    }
  }
  return unique;
}

function keysOf<T, U>(others: Iterable<U>, key: (item: T | U) => unknown, normalize: KeyOf): Set<unknown> {
  const keys = new Set<unknown>();
  for (const other of others) {
    keys.add(normalize(key(other)));
  }
  return keys;
}

function filterBy<T, U>(
  items: Iterable<T>,
  others: Iterable<U>,
  key: (item: T | U) => unknown,
  options: KeyOptions,
  keep: boolean,
): T[] {
  checkFunction('key', key);
  const normalize = keyOf(options);
  const keys = keysOf(others, key, normalize);
  const kept: T[] = [];
  for (const item of items) {
    if (keys.has(normalize(key(item))) === keep) {
      kept.push(item);
    }
  }
  return kept;
}

/**
 * The elements of `items` whose key is among the keys of `others`, in input order, duplicates included: with
 * `differenceBy`, it splits `items` in two. `others` is read first.
 * @pure
 * @sharing structural
 * @complexity O(n + m) (n = items, m = others)
 * @throws TypeError when `key` is not a function, `equality` is neither 'SameValueZero' nor 'SameValue', or a
 *   collection is not iterable
 * @throws what `key` or the iteration throws, unchanged
 * @since 0.1
 * @experimental
 * @example intersectionBy([{ id: 1 }, { id: 2 }], [{ id: 2 }], (item) => item.id)
 */
export function intersectionBy<T, U>(
  items: Iterable<T>,
  others: Iterable<U>,
  key: (item: T | U) => unknown,
  options: KeyOptions = {},
): T[] {
  return filterBy(items, others, key, options, true);
}

/**
 * The elements of `items` whose key is not among the keys of `others`, in input order, duplicates included: with
 * `intersectionBy`, it splits `items` in two. `others` is read first.
 * @pure
 * @sharing structural
 * @complexity O(n + m) (n = items, m = others)
 * @throws TypeError when `key` is not a function, `equality` is neither 'SameValueZero' nor 'SameValue', or a
 *   collection is not iterable
 * @throws what `key` or the iteration throws, unchanged
 * @since 0.1
 * @experimental
 * @example differenceBy([{ id: 1 }, { id: 2 }], [{ id: 2 }], (item) => item.id)
 */
export function differenceBy<T, U>(
  items: Iterable<T>,
  others: Iterable<U>,
  key: (item: T | U) => unknown,
  options: KeyOptions = {},
): T[] {
  return filterBy(items, others, key, options, false);
}
