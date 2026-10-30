// Collections by key and by order, ARCHITECTURE.md §7.2 and ADRs 0024 and 0025: splitting, indexing, counting,
// deduplicating and comparing the elements of any iterable by a key computed from each, and finding, sorting and
// paging them by an order. Every function reads its iterables once, in order; an array's holes read as `undefined`,
// as `for…of` reads them. Keys are any value, compared by SameValueZero, the comparison of a `Map`: a result that holds
// keys is a `Map`, so `1` and `'1'` stay apart and `"__proto__"` is a key like any other. The functions that return
// elements accept `equality: 'SameValue'` to tell `-0` from `0`.
//
// One order on keys serves `minBy`, `maxBy` and `sortBy`: numbers, bigints and booleans by value, before strings by
// UTF-16 code unit; `undefined`, `null` and `NaN` are missing, after every present key in both directions. `topK`
// orders as `toSorted` does, so its judge is the platform; `paginate` is judged against es-toolkit's `chunk`.
//
// Differences from es-toolkit 1.52.0, each checked on generated inputs by the judge of the tests:
//   - indexBy: a key met twice is an error with the position of both elements; es-toolkit keeps the last element
//   - indexBy, countBy: the result is a `Map`, whose keys keep their type; es-toolkit returns a record, whose keys are
//     strings, so `1` and `'1'` collide
//   - indexBy, countBy: a "__proto__" key is a key like any other; es-toolkit assigns it, which replaces the
//     prototype of its record
//   - intersectionBy: an element of the first collection is kept each time its key is among the others' keys;
//     es-toolkit keeps it once per key
//   - minBy, maxBy: an element whose key is `NaN` is never chosen; es-toolkit returns the first element whose key is
//     `NaN`
//   - sortBy: `NaN` is a missing key, after every present key; es-toolkit compares it with `<`, so it equals every
//     key and the input may come back unsorted
//   - sortBy: `undefined` and `null` sort last in both orders, equal to each other; es-toolkit sorts `null` before
//     `undefined`, and both first in descending order
//   - sortBy: a number sorts before a string; es-toolkit compares them with `<`, which converts the string to a
//     number
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

/**
 * A key of `minBy`, `maxBy` and `sortBy`. Numbers, bigints and booleans compare by value (`-0` equals `0`) and come
 * before strings, which compare by UTF-16 code unit; `undefined`, `null` and `NaN` are missing keys, after every
 * present key in both directions.
 * @since 0.1
 * @experimental
 */
export type SortKey = number | bigint | boolean | string | null | undefined;

/**
 * A criterion of `sortBy` in the order of `SortKey`, ascending unless `order` is 'desc'.
 * @since 0.1
 * @experimental
 */
export interface KeyCriterion<T> {
  readonly key: (item: T, index: number) => SortKey;
  readonly order?: 'asc' | 'desc';
  readonly compare?: undefined;
}

/**
 * A criterion of `sortBy` whose present keys `compare` orders, `Intl.Collator`'s for a locale order; missing keys
 * (`undefined`, `null`, `NaN`) stay last and never reach it.
 * @since 0.1
 * @experimental
 */
export interface ComparedCriterion<T> {
  readonly key: (item: T, index: number) => unknown;
  readonly order?: 'asc' | 'desc';
  // A method, so that a comparator of narrower keys, `(a: string, b: string) => number`, is accepted.
  compare(a: unknown, b: unknown): number;
}

/**
 * A criterion of `sortBy`: a key function, ascending, or a criterion object.
 * @since 0.1
 * @experimental
 */
export type SortCriterion<T> = ((item: T, index: number) => SortKey) | KeyCriterion<T> | ComparedCriterion<T>;

/**
 * Which page `paginate` returns: `pageIndex` from 0, `pageSize` elements per page, as a paginator's page event gives
 * them.
 * @since 0.1
 * @experimental
 */
export interface PageRequest {
  readonly pageIndex: number;
  readonly pageSize: number;
}

/**
 * A page of `paginate`: its elements, the request, `length` the number of elements of the whole collection, and
 * `pageCount` the number of pages, 0 when the collection is empty.
 * @since 0.1
 * @experimental
 */
export interface Page<T> {
  readonly items: T[];
  readonly pageIndex: number;
  readonly pageSize: number;
  readonly length: number;
  readonly pageCount: number;
}

// The rank of a key in the order of `SortKey`: present keys by type first, missing keys last and equal to each other.
const NUMERIC = 0;
const TEXT = 1;
const MISSING = 2;

function rankOf(key: unknown): number {
  switch (typeof key) {
    case 'number':
      return Number.isNaN(key) ? MISSING : NUMERIC;
    case 'bigint':
    case 'boolean':
      return NUMERIC;
    case 'string':
      return TEXT;
    case 'undefined':
      return MISSING;
    default:
      if (key === null) {
        return MISSING;
      }
      throw new TypeError(`key: not a number, bigint, boolean or string`);
  }
}

// Missing whatever the criterion: with a `compare`, the other keys are its own to order.
function isMissing(key: unknown): boolean {
  return key === undefined || key === null || Number.isNaN(key);
}

// Two present keys of the same rank: `<` compares numbers, bigints and booleans by their exact value, and strings by
// code unit, so this order is transitive.
function compareRanked(a: unknown, rankA: number, b: unknown, rankB: number): number {
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
}

function extremeBy<T>(items: Iterable<T>, key: (item: T, index: number) => SortKey, direction: 1 | -1): T | undefined {
  checkFunction('key', key);
  let best: T | undefined;
  let bestKey: unknown;
  let bestRank = MISSING;
  let index = 0;
  for (const item of items) {
    const itemKey = key(item, index++);
    const rank = rankOf(itemKey);
    // Strictly before the best so far: of equal keys, the first stays.
    if (rank !== MISSING && (bestRank === MISSING || direction * compareRanked(itemKey, rank, bestKey, bestRank) < 0)) {
      best = item;
      bestKey = itemKey;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * The first element with the smallest key in the order of `SortKey`, `undefined` when no key is present: an element
 * whose key is missing (`undefined`, `null`, `NaN`) is never chosen.
 * @pure
 * @sharing structural
 * @complexity O(n) (n = elements)
 * @throws TypeError when `key` is not a function, returns a key that is not a `SortKey`, or `items` is not iterable
 * @throws what `key` or the iteration throws, unchanged
 * @since 0.1
 * @experimental
 * @example minBy([{ age: 30 }, { age: 26 }, { age: 28 }], (person) => person.age)
 */
export function minBy<T>(items: Iterable<T>, key: (item: T, index: number) => SortKey): T | undefined {
  return extremeBy(items, key, 1);
}

/**
 * The first element with the largest key in the order of `SortKey`, `undefined` when no key is present: an element
 * whose key is missing (`undefined`, `null`, `NaN`) is never chosen.
 * @pure
 * @sharing structural
 * @complexity O(n) (n = elements)
 * @throws TypeError when `key` is not a function, returns a key that is not a `SortKey`, or `items` is not iterable
 * @throws what `key` or the iteration throws, unchanged
 * @since 0.1
 * @experimental
 * @example maxBy([{ age: 30 }, { age: 26 }, { age: 28 }], (person) => person.age)
 */
export function maxBy<T>(items: Iterable<T>, key: (item: T, index: number) => SortKey): T | undefined {
  return extremeBy(items, key, -1);
}

interface Column {
  readonly key: (item: unknown, index: number) => unknown;
  readonly direction: 1 | -1;
  readonly compare: ((a: unknown, b: unknown) => number) | undefined;
  readonly keys: unknown[];
  readonly ranks: number[];
}

function columnOf(criterion: unknown): Column {
  // A key function is a criterion without options; `null` fails to destructure, and a primitive on its `key`.
  const {
    key,
    order = 'asc',
    compare,
  } = (typeof criterion === 'function' ? { key: criterion } : criterion) as Partial<ComparedCriterion<unknown>>;
  checkFunction('key', key);
  if (order !== 'asc' && order !== 'desc') {
    throw new TypeError(`order: ${String(order)}`);
  }
  if (compare !== undefined) {
    checkFunction('compare', compare);
  }
  return { key: key as Column['key'], direction: order === 'asc' ? 1 : -1, compare, keys: [], ranks: [] };
}

function compareColumns(columns: readonly Column[], i: number, j: number): number {
  for (const { direction, compare, keys, ranks } of columns) {
    const rankI = ranks[i]!;
    const rankJ = ranks[j]!;
    if (rankI === MISSING || rankJ === MISSING) {
      if (rankI !== rankJ) {
        return rankI === MISSING ? 1 : -1;
      }
      continue;
    }
    // Read as the platform reads a comparator's result: ToNumber, `NaN` as equal.
    const result = compare === undefined ? compareRanked(keys[i], rankI, keys[j], rankJ) : +compare(keys[i], keys[j]);
    if (result < 0) {
      return -direction;
    }
    if (result > 0) {
      return direction;
    }
  }
  return 0;
}

/**
 * A new array of the elements sorted by the first criterion, then by the next among equals, and so on; elements equal
 * on every criterion keep their input order. Each key is computed once per element and criterion, then the positions
 * are sorted by the native stable sort; a `compare` that is not consistent gives an unspecified order, never a loop.
 * @pure
 * @sharing structural
 * @complexity O(n log n) comparisons, n calls of each key (n = elements)
 * @throws TypeError when a criterion is neither a key function nor an object with one, `order` is neither 'asc' nor
 *   'desc', `compare` is given and not a function, a key without `compare` is not a `SortKey`, or `items` is not
 *   iterable
 * @throws what a key, `compare` or the iteration throws, unchanged
 * @since 0.1
 * @experimental
 * @example sortBy([{ name: 'Lin', age: 30 }, { name: 'Ada', age: 26 }], [(p) => p.age, (p) => p.name])
 */
export function sortBy<T>(items: Iterable<T>, criteria: SortCriterion<T> | readonly SortCriterion<T>[]): T[] {
  const columns = (Array.isArray(criteria) ? (criteria as readonly unknown[]) : [criteria]).map(columnOf);
  const list: T[] = [];
  const positions: number[] = [];
  let index = 0;
  for (const item of items) {
    for (const { key, compare, keys, ranks } of columns) {
      const itemKey = key(item, index);
      keys.push(itemKey);
      ranks.push(compare === undefined ? rankOf(itemKey) : isMissing(itemKey) ? MISSING : NUMERIC);
    }
    list.push(item);
    positions.push(index++);
  }
  positions.sort((i, j) => compareColumns(columns, i, j));
  return positions.map((position) => list[position] as T);
}

// Whether `a`, met at position `positionA`, sorts after `b`: by `compare` read as `toSorted` reads it (ToNumber, `NaN`
// as equal), then by position, so that the heap orders as the stable sort does and no two entries are equal.
function sortsAfter<T>(compare: (a: T, b: T) => number, a: T, positionA: number, b: T, positionB: number): boolean {
  const result = +compare(a, b);
  return result > 0 || (!(result < 0) && positionA > positionB);
}

function swap<T>(heap: T[], positions: number[], i: number, j: number): void {
  const item = heap[i]!;
  heap[i] = heap[j]!;
  heap[j] = item;
  const position = positions[i]!;
  positions[i] = positions[j]!;
  positions[j] = position;
}

// The two moves of the heap: each step goes strictly up or strictly down, so a comparator that is not consistent
// still ends after O(log k) calls per move.
function siftUp<T>(heap: T[], positions: number[], compare: (a: T, b: T) => number, start: number): void {
  let i = start;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!sortsAfter(compare, heap[i]!, positions[i]!, heap[parent]!, positions[parent]!)) {
      return;
    }
    swap(heap, positions, i, parent);
    i = parent;
  }
}

function siftDown<T>(heap: T[], positions: number[], compare: (a: T, b: T) => number, size: number): void {
  let i = 0;
  for (let child = 1; child < size; child = 2 * i + 1) {
    const right = child + 1;
    if (right < size && sortsAfter(compare, heap[right]!, positions[right]!, heap[child]!, positions[child]!)) {
      child = right;
    }
    if (!sortsAfter(compare, heap[child]!, positions[child]!, heap[i]!, positions[i]!)) {
      return;
    }
    swap(heap, positions, i, child);
    i = child;
  }
}

/**
 * The `k` first elements of `items.toSorted(compare)`, in that order, equal elements in input order: `undefined`
 * elements come after every other and never reach `compare`. A heap of at most `k` elements keeps the memory at O(k)
 * for a stream; a `compare` that is not consistent gives an unspecified choice of `min(k, n)` elements, never a loop.
 * @pure
 * @sharing structural
 * @complexity O(n log k) comparisons, O(k) memory (n = elements)
 * @throws TypeError when `compare` is not a function, or `items` is not iterable
 * @throws RangeError when `k` is not a non-negative safe integer
 * @throws what `compare`, the conversion of its result to a number, or the iteration throws, unchanged
 * @since 0.1
 * @experimental
 * @example topK([5, 1, 4, 2, 3], 2, (a, b) => a - b)
 */
export function topK<T>(items: Iterable<T>, k: number, compare: (a: T, b: T) => number): T[] {
  checkFunction('compare', compare);
  if (!Number.isSafeInteger(k) || k < 0) {
    throw new RangeError(`k: ${String(k)}`);
  }
  if (k === 0) {
    return [];
  }
  // A max-heap of the k first elements met so far: its root sorts last among them, and a new element, met after all
  // of them, enters only when it sorts strictly before the root.
  const heap: T[] = [];
  const positions: number[] = [];
  let undefinedCount = 0;
  let position = 0;
  for (const item of items) {
    if (item === undefined) {
      undefinedCount += 1;
    } else if (heap.length < k) {
      heap.push(item);
      positions.push(position);
      siftUp(heap, positions, compare, heap.length - 1);
    } else if (+compare(item, heap[0]!) < 0) {
      heap[0] = item;
      positions[0] = position;
      siftDown(heap, positions, compare, heap.length);
    }
    position += 1;
  }
  const first: T[] = [];
  for (let size = heap.length; size > 0; size--) {
    first.push(heap[0]!);
    swap(heap, positions, 0, size - 1);
    siftDown(heap, positions, compare, size - 1);
  }
  first.reverse();
  for (; undefinedCount > 0 && first.length < k; undefinedCount--) {
    first.push(undefined as T);
  }
  return first;
}

function checkCount(name: string, value: unknown, least: number): void {
  if (!Number.isSafeInteger(value) || (value as number) < least) {
    throw new RangeError(`${name}: ${String(value)}`);
  }
}

/**
 * The page `pageIndex` (from 0) of `pageSize` elements, with the number of elements and of pages of the whole
 * collection; a page past the end has no element. An array is read only over the page; any other iterable is read
 * whole, to count it, and only the page is kept.
 * @pure
 * @sharing structural
 * @complexity O(pageSize) for an array, O(n) for another iterable (n = elements)
 * @throws TypeError when `request` is not an object, or `items` is not iterable
 * @throws RangeError when `pageIndex` is not a non-negative safe integer, or `pageSize` not a positive one
 * @throws what the iteration throws, unchanged
 * @since 0.1
 * @experimental
 * @example paginate(['a', 'b', 'c', 'd', 'e'], { pageIndex: 1, pageSize: 2 })
 */
export function paginate<T>(items: Iterable<T>, request: PageRequest): Page<T> {
  const { pageIndex, pageSize } = request;
  checkCount('pageIndex', pageIndex, 0);
  checkCount('pageSize', pageSize, 1);
  const start = pageIndex * pageSize;
  const end = start + pageSize;
  const page: T[] = [];
  let length = 0;
  if (Array.isArray(items)) {
    const array: readonly T[] = items;
    length = array.length;
    for (let i = start; i < end && i < length; i++) {
      page.push(array[i] as T);
    }
  } else {
    for (const item of items) {
      if (length >= start && length < end) {
        page.push(item);
      }
      length += 1;
    }
  }
  return { items: page, pageIndex, pageSize, length, pageCount: Math.ceil(length / pageSize) };
}
