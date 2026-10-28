// The path functions against lodash's, from es-toolkit's compat entry, on generated values and paths (see the judge
// in @yaltaan/testing). lodash answers without a Result and writes in place: an issue of ours is read as what lodash
// gives for nothing (`undefined` for `get`, the value unchanged for a removal), and lodash writes into a deep copy.
// Writes are compared with `createMissing: 'array-if-numeric'`, which creates what lodash creates.
// Every difference but one says what ours returns, built from lodash's answer, and is checked to be exactly that.
// Blind spots: `{ key }` segments (lodash has none), symbol segments, records without prototype, the segments refused
// for a write (lodash would write into a prototype of the test process); what a container
// created for a string that reads as an index holds.
import { cloneDeep } from 'es-toolkit';
import { get as theirGet, has as theirHas, set as theirSet, unset, update as theirUpdate } from 'es-toolkit/compat';

import { createJudge, fc } from '@yaltaan/testing';

import type { Path } from '../path/index.ts';
import { get, has, remove, set, update } from './access.ts';

const judge = createJudge(new URL('./access.ts', import.meta.url), 'es-toolkit');

const names = fc.constantFrom('a', 'b', '0');
const data: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.integer(),
    fc.constant(null),
    fc.constant(undefined),
    fc.array(tie('value'), { maxLength: 3 }),
    fc.dictionary(names, tie('value'), { maxKeys: 3, noNullPrototype: true }),
  ),
})).value;
const values = fc.oneof(
  fc.dictionary(names, data, { maxKeys: 3, noNullPrototype: true }),
  fc.array(data, { maxLength: 3 }),
);

/** A path of `value` drawn by walking it, `steps` picking the field or element at each level. */
function walk(value: unknown, steps: readonly number[]): Path {
  const path: (string | number)[] = [];
  let current = value;
  for (const step of steps) {
    if (typeof current !== 'object' || current === null) {
      break;
    }
    const keys: (string | number)[] = Array.isArray(current) ? current.map((_, index) => index) : Object.keys(current);
    if (keys.length === 0) {
      break;
    }
    const key = keys[step % keys.length]!;
    path.push(key);
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return path;
}

// Half the paths walk the value, half are drawn from segments that may not fit it; one in two of the walked ones
// gets one more segment, so that writes meet the end of a path too. Reads also draw an inherited name, which writes
// never do: lodash would write through it into a prototype of the test process.
const pathsOf = (drawn: fc.Arbitrary<string | number>): fc.Arbitrary<[unknown, Path]> =>
  fc
    .tuple(
      values,
      fc.array(fc.nat(), { minLength: 1, maxLength: 3 }),
      fc.array(drawn, { minLength: 1, maxLength: 3 }),
      fc.constantFrom('walked', 'extended', 'drawn'),
      fc.constantFrom<string | number>('a', 'c', 0, 1),
    )
    .map(([value, steps, segments, kind, extra]): [unknown, Path] => {
      if (kind === 'drawn') {
        return [value, segments];
      }
      const path = walk(value, steps);
      return [value, kind === 'extended' ? [...path, extra] : path];
    });
const valueAndPath = pathsOf(fc.constantFrom<string | number>('a', 'b', '0', 'toString', 0, 1, 2));
const valueAndWritablePath = pathsOf(fc.constantFrom<string | number>('a', 'b', '0', 0, 1, 2));
const writeInput = fc.tuple(valueAndWritablePath, data);

// What `path` reaches, read by hand as lodash would read own properties: `MISSING` where it stops.
const MISSING = Symbol('missing');
function at(value: unknown, path: Path): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, segment as PropertyKey)) {
      return MISSING;
    }
    current = (current as Record<PropertyKey, unknown>)[segment as PropertyKey];
  }
  return current;
}

// Whether, along the part of `path` that `value` holds, a number meets a record or a string an array.
function mismatched(value: unknown, path: Path): boolean {
  let current = value;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    if (Array.isArray(current) ? typeof segment !== 'number' : typeof segment === 'number') {
      return true;
    }
    if (!Object.hasOwn(current, segment as PropertyKey)) {
      return false;
    }
    current = (current as Record<PropertyKey, unknown>)[segment as PropertyKey];
  }
  return false;
}

// Whether a write along `path` would stand on a value that is no record or array, before its last segment.
function blocked(value: unknown, path: Path): boolean {
  let current = value;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) {
      return true;
    }
    if (!Object.hasOwn(current, segment as PropertyKey)) {
      return false;
    }
    current = (current as Record<PropertyKey, unknown>)[segment as PropertyKey];
  }
  return false;
}

// Whether a write along `path` reaches an index past the end of an array, existing or to be created.
function holeAhead(value: unknown, path: Path): boolean {
  let current = value;
  for (const segment of path) {
    if (current === MISSING) {
      if (typeof segment === 'number' && segment > 0) {
        return true;
      }
    } else if (typeof current === 'object' && current !== null) {
      if (Array.isArray(current) && typeof segment === 'number' && segment > current.length) {
        return true;
      }
      current = Object.hasOwn(current, segment as PropertyKey)
        ? (current as Record<PropertyKey, unknown>)[segment as PropertyKey]
        : MISSING;
    } else {
      return false;
    }
  }
  return false;
}

// Whether a container to be created along `path` follows a string that reads as an index.
function indexLikeCreated(value: unknown, path: Path): boolean {
  let current = value;
  for (const segment of path) {
    if (current === MISSING) {
      if (typeof segment === 'string' && /^(?:0|[1-9][0-9]*)$/.test(segment)) {
        return true;
      }
    } else if (typeof current === 'object' && current !== null) {
      current = Object.hasOwn(current, segment as PropertyKey)
        ? (current as Record<PropertyKey, unknown>)[segment as PropertyKey]
        : MISSING;
    } else {
      return false;
    }
  }
  return false;
}

const INDEX_LIKE =
  'a missing container is created as an array for a number segment only; ' +
  "es-toolkit also for a string that reads as one, such as '0'";
const SPLICED = 'an array element is spliced out, the elements after it moving down; es-toolkit leaves a hole';
const STRICT =
  'a number segment designates an index of an array, a string a field of a record, nothing else; ' +
  'es-toolkit reads either as a property name';
const BLOCKED = 'a value in the way that is no record or array is never replaced; es-toolkit replaces it';
const NO_HOLE = 'no write creates a hole; es-toolkit leaves holes before an index past the end';
// Whether `path` passes through a property that a value only inherits, a primitive's included.
function inherited(value: unknown, path: Path): boolean {
  let current = value;
  for (const segment of path) {
    if (current === null || current === undefined) {
      return false;
    }
    if (typeof current !== 'object' || !Object.hasOwn(current, segment as PropertyKey)) {
      return (segment as PropertyKey) in Object(current);
    }
    current = (current as Record<PropertyKey, unknown>)[segment as PropertyKey];
  }
  return false;
}

const INHERITED =
  'only own enumerable fields of records and arrays are read; es-toolkit also reads what a value inherits, ' +
  "a primitive's included";
const EMPTY = 'an empty path designates the value itself; es-toolkit reads or writes nothing there';
const UNDEFINED_REMOVED = 'a field that holds `undefined` is removed; es-toolkit leaves it';
const empty = ([, path]: readonly [unknown, Path]): boolean => path.length === 0;
const refused = (): unknown => 'refused';
const CREATE = { createMissing: 'array-if-numeric' } as const;

judge.compare('get', {
  input: valueAndPath,
  ours: ([value, path]) => {
    const read = get(value, path);
    return read.ok ? read.value : undefined;
  },
  theirs: ([value, path]) => theirGet(value, path as PropertyKey[]),
  differences: [
    { text: EMPTY, applies: empty, expected: (_, [value]) => value },
    { text: STRICT, applies: ([value, path]) => mismatched(value, path), expected: () => undefined },
    { text: INHERITED, applies: ([value, path]) => inherited(value, path), expected: () => undefined },
  ],
});

judge.compare('has', {
  input: valueAndPath,
  ours: ([value, path]) => has(value, path),
  theirs: ([value, path]) => theirHas(value, path as PropertyKey[]),
  differences: [
    { text: EMPTY, applies: empty, expected: () => true },
    { text: STRICT, applies: ([value, path]) => mismatched(value, path), expected: () => false },
  ],
});

judge.compare('set', {
  input: writeInput,
  ours: ([[value, path], next]) => {
    const written = set(value, path, next, CREATE);
    return written.ok ? written.value : 'refused';
  },
  theirs: ([[value, path], next]) => theirSet(cloneDeep(value) as object, path as PropertyKey[], next),
  differences: [
    { text: EMPTY, applies: ([input]) => empty(input), expected: (_, [, next]) => next },
    { text: STRICT, applies: ([[value, path]]) => mismatched(value, path), expected: refused },
    { text: BLOCKED, applies: ([[value, path]]) => blocked(value, path), expected: refused },
    { text: NO_HOLE, applies: ([[value, path]]) => holeAhead(value, path), expected: refused },
    { text: INDEX_LIKE, applies: ([[value, path]]) => indexLikeCreated(value, path) },
  ],
});

judge.compare('update', {
  input: writeInput,
  ours: ([[value, path], next]) => {
    const written = update(value, path, () => next, CREATE);
    return written.ok ? written.value : 'refused';
  },
  theirs: ([[value, path], next]) => theirUpdate(cloneDeep(value) as object, path as PropertyKey[], () => next),
  differences: [
    { text: EMPTY, applies: ([input]) => empty(input), expected: (_, [, next]) => next },
    { text: STRICT, applies: ([[value, path]]) => mismatched(value, path), expected: refused },
    { text: BLOCKED, applies: ([[value, path]]) => blocked(value, path), expected: refused },
    { text: NO_HOLE, applies: ([[value, path]]) => holeAhead(value, path), expected: refused },
    { text: INDEX_LIKE, applies: ([[value, path]]) => indexLikeCreated(value, path) },
  ],
});

judge.compare('remove', {
  input: valueAndPath,
  ours: ([value, path]) => {
    const removed = remove(value, path);
    return removed.ok ? removed.value : value;
  },
  theirs: ([value, path]) => {
    const copy = cloneDeep(value) as object;
    unset(copy, path as PropertyKey[]);
    return copy;
  },
  differences: [
    { text: STRICT, applies: ([value, path]) => mismatched(value, path), expected: (_, [value]) => value },
    {
      text: SPLICED,
      applies: ([value, path]) => path.length > 0 && Array.isArray(at(value, path.slice(0, -1))),
      // lodash's copy, with the hole it left spliced out.
      expected: (theirs, [value, path]) => {
        if (at(value, path) !== MISSING) {
          (at(theirs, path.slice(0, -1)) as unknown[]).splice(path[path.length - 1] as number, 1);
        }
        return theirs;
      },
    },
    {
      text: UNDEFINED_REMOVED,
      applies: ([value, path]) => path.length > 0 && at(value, path) === undefined,
      // lodash's copy, without the field it left.
      expected: (theirs, [, path]) => {
        delete (at(theirs, path.slice(0, -1)) as Record<PropertyKey, unknown>)[path[path.length - 1] as PropertyKey];
        return theirs;
      },
    },
  ],
});
