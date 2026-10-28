// Reading and writing one place of a value by its `Path`, ARCHITECTURE.md §7.1 and ADR 0023. Segments are strict: a
// string or a symbol names an own enumerable property of a record, a number an index of a plain array, a `{ key }`
// segment the element of a plain array whose `keyOf` is that key (SameValueZero). Anything else designates nothing.
// A write copies the records and arrays along the path and shares everything else; nothing is ever mutated.
//
// Support table:
//   records (prototype Object.prototype or null)  walked by string and symbol segments; a copy keeps the prototype
//                                                  and every own enumerable key, symbols included
//   arrays (prototype Array.prototype)             walked by number and `{ key }` segments; a copy keeps the holes,
//                                                  a removed element is spliced out, no write creates a hole
//   anything else (Map, Set, Date, class instances, arrays of another realm or subclass, primitives)  not walked
// A getter is read once, and only on the path; an exception it throws is propagated.
//
// Differences from es-toolkit 1.52.0, each checked on generated inputs by the judge of the tests:
//   - get, has, set, update: an empty path designates the value itself; es-toolkit reads or writes nothing there
//   - remove: a field that holds `undefined` is removed; es-toolkit leaves it
//   - get, has, set, update, remove: a number segment designates an index of an array, a string a field of a record,
//     nothing else; es-toolkit reads either as a property name
//   - get: only own enumerable fields of records and arrays are read; es-toolkit also reads what a value inherits, a
//     primitive's included
//   - set, update: a value in the way that is no record or array is never replaced; es-toolkit replaces it
//   - set, update: no write creates a hole; es-toolkit leaves holes before an index past the end
//   - set, update: a missing container is created as an array for a number segment only; es-toolkit also for a string
//     that reads as one, such as '0'
//   - remove: an array element is spliced out, the elements after it moving down; es-toolkit leaves a hole
import type { KeySegment, Path, PathIssue } from '../path/index.ts';
import { checkWritablePath } from '../path/index.ts';
import { err, ok, type Result } from '../result/index.ts';
import { blank, isPlainArray, isRecord, keysOf, put } from './mask.ts';

/**
 * Why a path designates nothing in a value; `index` is the segment where the walk stopped, `path` the path given.
 * - `path.missing`: the container is there, but holds nothing at that segment (a field absent, an index at or past
 *   the end or on a hole, no element with that key).
 * - `path.not_traversable`: the value at that point cannot be walked by that segment (a primitive, a `Map`, a class
 *   instance, a number on a record, a string on an array).
 * @since 0.1
 * @experimental
 */
export type AccessIssue = {
  readonly code: 'path.missing' | 'path.not_traversable';
  readonly path: Path;
  readonly params: { readonly index: number };
};

/**
 * Why a write failed: the path designates nothing, or one of its segments is refused for a write.
 * @since 0.1
 * @experimental
 */
export type WriteIssue = AccessIssue | Extract<PathIssue, { readonly code: 'path.forbidden_segment' }>;

/**
 * Options of every function that reads a value by a path.
 * @since 0.1
 * @experimental
 */
export interface AccessOptions {
  /** The stable key of an array element, which a `{ key }` segment is matched against; required by such a segment. */
  readonly keyOf?: (element: unknown) => unknown;
}

/**
 * Options of `set` and `update`.
 * @since 0.1
 * @experimental
 */
export interface WriteOptions extends AccessOptions {
  /**
   * Creates what the path misses instead of failing: `'object'` creates records, `'array-if-numeric'` an array where
   * the next segment is a number. Never a hole: an index past the end still fails.
   */
  readonly createMissing?: 'object' | 'array-if-numeric';
}

type Container = Readonly<Record<PropertyKey, unknown>> | readonly unknown[];
// Where a segment lands in its container: a key of a record or an index of an array, and whether it holds a value.
type Slot = { readonly key: PropertyKey; readonly present: boolean };
type Located = Slot | 'path.missing' | 'path.not_traversable';

function keyOfOption(options: AccessOptions): AccessOptions['keyOf'] {
  const { keyOf } = options;
  if (keyOf !== undefined && typeof keyOf !== 'function') {
    throw new TypeError(`keyOf: ${String(keyOf)}`);
  }
  return keyOf;
}

function checkPath(path: unknown): Path {
  if (!Array.isArray(path)) {
    throw new TypeError(`not a path: ${String(path)}`);
  }
  return path as Path;
}

function isKeySegment(segment: unknown): segment is KeySegment {
  return typeof segment === 'object' && segment !== null;
}

function sameValueZero(a: unknown, b: unknown): boolean {
  return a === b || (a !== a && b !== b);
}

function locate(container: unknown, segment: unknown, keyOf: AccessOptions['keyOf']): Located {
  if (isRecord(container)) {
    if (typeof segment !== 'string' && typeof segment !== 'symbol') {
      return 'path.not_traversable';
    }
    return { key: segment, present: Object.prototype.propertyIsEnumerable.call(container, segment) };
  }
  if (!isPlainArray(container)) {
    return 'path.not_traversable';
  }
  if (typeof segment === 'number') {
    if (!Number.isSafeInteger(segment) || segment < 0) {
      return 'path.not_traversable';
    }
    return { key: segment, present: segment < container.length && segment in container };
  }
  if (!isKeySegment(segment)) {
    return 'path.not_traversable';
  }
  if (keyOf === undefined) {
    throw new TypeError('a { key } segment needs the keyOf option');
  }
  for (let index = 0; index < container.length; index += 1) {
    if (index in container && sameValueZero(keyOf(container[index]), segment.key)) {
      return { key: index, present: true };
    }
  }
  return 'path.missing';
}

function issue(code: AccessIssue['code'], path: Path, index: number): Result<never, AccessIssue> {
  return err({ code, path, params: { index } });
}

/**
 * The value at `path` in `value`, or why there is none: a field that holds `undefined` is a value, a missing one is
 * not. An empty path designates `value` itself.
 * @pure
 * @sharing identity-preserving
 * @complexity O(d) (d = segments), plus O(n) per `{ key }` segment (n = elements of its array)
 * @throws TypeError when `path` is not an array, `keyOf` is not a function, or a `{ key }` segment meets no `keyOf`
 * @throws what a getter, a Proxy trap or `keyOf` throws, unchanged
 * @since 0.1
 * @experimental
 * @example get({ lines: [{ qty: 2 }] }, ['lines', 0, 'qty']) // { ok: true, value: 2 }
 */
export function get(value: unknown, path: Path, options: AccessOptions = {}): Result<unknown, AccessIssue> {
  const segments = checkPath(path);
  const keyOf = keyOfOption(options);
  let current = value;
  for (let index = 0; index < segments.length; index += 1) {
    const slot = locate(current, segments[index], keyOf);
    if (typeof slot === 'string') {
      return issue(slot, path, index);
    }
    if (!slot.present) {
      return issue('path.missing', path, index);
    }
    current = (current as Readonly<Record<PropertyKey, unknown>>)[slot.key];
  }
  return ok(current);
}

/**
 * Whether `path` designates a value in `value`: `get(value, path, options).ok`.
 * @pure
 * @sharing identity-preserving
 * @complexity O(d) (d = segments), plus O(n) per `{ key }` segment (n = elements of its array)
 * @throws TypeError when `path` is not an array, `keyOf` is not a function, or a `{ key }` segment meets no `keyOf`
 * @throws what a getter, a Proxy trap or `keyOf` throws, unchanged
 * @since 0.1
 * @experimental
 * @example has({ note: undefined }, ['note']) // true
 */
export function has(value: unknown, path: Path, options: AccessOptions = {}): boolean {
  return get(value, path, options).ok;
}

// What a write does at the end of the path, given what is there: a new value, or the removal of the slot.
type Change = { readonly value: unknown } | 'remove';
const REMOVE = 'remove';

// A copy of `container` with `slot` replaced by `change`. Every other key is read once, in its order.
function replaced(container: Container, slot: Slot, change: Change): Container {
  if (isPlainArray(container)) {
    const index = slot.key as number;
    const length = change === REMOVE ? container.length - 1 : Math.max(container.length, index + 1);
    const copy = new Array<unknown>(length);
    for (let from = 0, to = 0; from < container.length; from += 1, to += 1) {
      if (from === index) {
        if (change === REMOVE) {
          to -= 1;
        } else {
          copy[to] = change.value;
        }
      } else if (from in container) {
        copy[to] = container[from];
      }
    }
    if (change !== REMOVE && index === container.length) {
      copy[index] = change.value;
    }
    return copy;
  }
  const record = container as Readonly<Record<PropertyKey, unknown>>;
  const copy = blank(record);
  for (const key of keysOf(record, true)) {
    if (key !== slot.key) {
      put(copy, key, record[key]);
    } else if (change !== REMOVE) {
      put(copy, key, change.value);
    }
  }
  if (!slot.present && change !== REMOVE) {
    put(copy, slot.key, change.value);
  }
  return copy;
}

type Made = { readonly value: unknown } | { readonly failed: number; readonly code: AccessIssue['code'] };

// The containers that `createMissing` makes for the segments from `from` on, the last of them holding `leaf`; or the
// first segment that cannot be created: an index other than 0 (a hole), a number in a record, a `{ key }` segment.
function created(segments: Path, from: number, leaf: unknown, mode: 'object' | 'array-if-numeric'): Made {
  let child = leaf;
  for (let index = segments.length - 1; index >= from; index -= 1) {
    const segment = segments[index];
    if (typeof segment === 'string' || typeof segment === 'symbol') {
      const record: Record<PropertyKey, unknown> = {};
      put(record, segment, child);
      child = record;
    } else if (typeof segment === 'number' && mode === 'array-if-numeric') {
      if (segment !== 0) {
        return { failed: index, code: 'path.missing' };
      }
      child = [child];
    } else {
      return { failed: index, code: typeof segment === 'number' ? 'path.not_traversable' : 'path.missing' };
    }
  }
  return { value: child };
}

type Ending = 'set' | 'update' | 'remove';

function write(
  value: unknown,
  path: Path,
  ending: Ending,
  change: (current: unknown) => Change,
  options: WriteOptions,
): Result<unknown, WriteIssue> {
  const segments = checkPath(path);
  const keyOf = keyOfOption(options);
  const { createMissing } = options;
  if (createMissing !== undefined && createMissing !== 'object' && createMissing !== 'array-if-numeric') {
    throw new TypeError(`createMissing: ${String(createMissing)}`);
  }
  const writable = checkWritablePath(segments);
  if (!writable.ok) {
    return err(writable.error as WriteIssue);
  }
  if (segments.length === 0) {
    if (ending === 'remove') {
      return issue('path.missing', path, 0);
    }
    const next = change(value);
    return ok(next === REMOVE ? value : next.value);
  }
  const containers: Container[] = [];
  const slots: Slot[] = [];
  let current = value;
  let leaf: Change | undefined;
  for (let index = 0; index < segments.length; index += 1) {
    const slot = locate(current, segments[index], keyOf);
    if (typeof slot === 'string') {
      return issue(slot, path, index);
    }
    containers.push(current as Container);
    slots.push(slot);
    const last = index === segments.length - 1;
    if (slot.present) {
      current = (current as Readonly<Record<PropertyKey, unknown>>)[slot.key];
      continue;
    }
    // An index past the end would leave a hole; a hole itself, or the length (an append), may be written.
    const fillable = !isPlainArray(current) || (slot.key as number) <= (current as readonly unknown[]).length;
    if (last && ending === 'set' && fillable) {
      break;
    }
    if (createMissing === undefined || !fillable || ending === 'remove') {
      return issue('path.missing', path, index);
    }
    const next = change(undefined);
    const made = created(segments, index + 1, next === REMOVE ? undefined : next.value, createMissing);
    if ('failed' in made) {
      return issue(made.code, path, made.failed);
    }
    leaf = made;
    break;
  }
  if (leaf === undefined) {
    const end = slots[slots.length - 1]!;
    leaf = change(end.present ? current : undefined);
    if (leaf !== REMOVE && end.present && Object.is(leaf.value, current)) {
      return ok(value);
    }
  }
  let child: Change = leaf;
  for (let index = slots.length - 1; index >= 0; index -= 1) {
    child = { value: replaced(containers[index]!, slots[index]!, child) };
  }
  return ok((child as { readonly value: unknown }).value);
}

/**
 * A copy of `value` where `path` holds `next`; the records and arrays along the path are copied, everything else is
 * shared, and `value` is returned itself when `path` already holds `next` (`Object.is`). The last segment may be new
 * (a field, or the index equal to the length of an array); any other missing segment fails, unless `createMissing`.
 * The result is typed as `value`: the caller vouches that the write keeps its shape.
 * @pure
 * @sharing structural
 * @complexity O(d + w) (d = segments, w = keys and elements of the containers copied along the path)
 * @throws TypeError when `path` is not an array, an option has the wrong type, or a `{ key }` segment meets no `keyOf`
 * @throws what a getter, a Proxy trap or `keyOf` throws, unchanged
 * @since 0.1
 * @experimental
 * @example set({ user: { name: 'Ada' } }, ['user', 'name'], 'Grace')
 */
export function set<T>(value: T, path: Path, next: unknown, options: WriteOptions = {}): Result<T, WriteIssue> {
  return write(value, path, 'set', () => ({ value: next }), options) as Result<T, WriteIssue>;
}

/**
 * A copy of `value` where `path` holds what `change` returns for its current value, copied as `set` does; `value`
 * itself when `change` returns the current value (`Object.is`). A missing path fails, unless `createMissing`, which
 * calls `change` with `undefined`.
 * @pure
 * @sharing structural
 * @complexity O(d + w) (d = segments, w = keys and elements of the containers copied along the path)
 * @throws TypeError when `path` is not an array, an option has the wrong type, or a `{ key }` segment meets no `keyOf`
 * @throws what `change`, a getter, a Proxy trap or `keyOf` throws, unchanged
 * @since 0.1
 * @experimental
 * @example update({ count: 1 }, ['count'], (n) => (n as number) + 1) // { ok: true, value: { count: 2 } }
 */
export function update<T>(
  value: T,
  path: Path,
  change: (current: unknown) => unknown,
  options: WriteOptions = {},
): Result<T, WriteIssue> {
  return write(value, path, 'update', (current) => ({ value: change(current) }), options) as Result<T, WriteIssue>;
}

/**
 * A copy of `value` without what `path` designates: a field is dropped, an array element spliced out (the elements
 * after it move down one index). A missing path fails, an empty one too: a value cannot be removed from itself.
 * @pure
 * @sharing structural
 * @complexity O(d + w) (d = segments, w = keys and elements of the containers copied along the path)
 * @throws TypeError when `path` is not an array, `keyOf` is not a function, or a `{ key }` segment meets no `keyOf`
 * @throws what a getter, a Proxy trap or `keyOf` throws, unchanged
 * @since 0.1
 * @experimental
 * @example remove({ tags: ['a', 'b', 'c'] }, ['tags', 1]) // { ok: true, value: { tags: ['a', 'c'] } }
 */
export function remove<T>(value: T, path: Path, options: AccessOptions = {}): Result<T, WriteIssue> {
  return write(value, path, 'remove', () => REMOVE, options) as Result<T, WriteIssue>;
}
