// The Path contract of ARCHITECTURE.md §5.3: an array of segments inside the library, a text form at its boundaries
// only (a field name, a server error, a message), and the refusal of the keys that reach a prototype on writes.
//
// Text grammar, read by parsePath and written by formatPath:
//   path    = "" | first *rest
//   first   = name | bracket
//   rest    = "." name | bracket
//   name    = [A-Za-z_$] *[A-Za-z0-9_$], an ASCII identifier: a string segment
//   bracket = "[" index "]" | "[" quoted "]"
//   index   = "0" | [1-9] *[0-9], at most Number.MAX_SAFE_INTEGER: a number segment
//   quoted  = a JSON string literal (RFC 8259 §7): a string segment, any key, the empty one included
// One text form per path: formatPath writes a name wherever the key is an identifier and a quoted key elsewhere, so a
// key that looks like an index ("3") stays a string (`["3"]`) and `items.3` is a syntax error, never a guess. Names are
// ASCII so that every runtime reads and writes the same text: which characters are Unicode identifiers changes with
// the Unicode version of each engine.
//
// Each regular expression is anchored where the scanner stands (`y`) and is a sequence of alternatives that no code
// unit can start twice (a name, an index, a quoted key), so none can backtrack more than once per code unit: reading a
// text takes a time linear in its length, which parsePath bounds before it starts.
import { err, ok, type Result } from '../result/index.ts';

/**
 * A segment that designates an array element by a stable identity (an id) rather than by its index, so that what is
 * attached to it follows the element when it moves.
 * @since 0.1
 * @experimental
 */
export interface KeySegment {
  readonly key: unknown;
}

/**
 * One step of a `Path`: a property name, an array index, a symbol, or a key segment.
 * @since 0.1
 * @experimental
 */
export type PathSegment = string | number | symbol | KeySegment;

/**
 * Where a value sits in a structure, from its root; the empty path is the root itself.
 * @since 0.1
 * @experimental
 */
export type Path = readonly PathSegment[];

/**
 * Why a path could not be read, written as text, or used for a write. `path` is the path concerned, empty for a text
 * that could not be read; `params` holds the data a message is built from.
 * - `path.syntax`: the text breaks the grammar at code unit `index`, where a bracket or a name that cannot be read
 *   starts, or where a code unit stands that no segment can start with.
 * - `path.too_long`: the text is `length` code units long, over `maximum`.
 * - `path.too_deep`: the text holds more than `maximum` segments.
 * - `path.not_textual`: the segment at `index` has no text form (a symbol, a key segment, a number that is no index).
 * - `path.forbidden_segment`: the segment at `index` is `__proto__`, `constructor` or `prototype`.
 * @since 0.1
 * @experimental
 */
export type PathIssue =
  | { readonly code: 'path.syntax'; readonly path: Path; readonly params: { readonly index: number } }
  | {
      readonly code: 'path.too_long';
      readonly path: Path;
      readonly params: { readonly length: number; readonly maximum: number };
    }
  | { readonly code: 'path.too_deep'; readonly path: Path; readonly params: { readonly maximum: number } }
  | { readonly code: 'path.not_textual'; readonly path: Path; readonly params: { readonly index: number } }
  | {
      readonly code: 'path.forbidden_segment';
      readonly path: Path;
      readonly params: { readonly index: number; readonly segment: string };
    };

/**
 * Limits of `parsePath`. The text is refused before it is read when it is longer than `maxLength`.
 * @since 0.1
 * @experimental
 */
export interface ParsePathOptions {
  /** Most code units of the text; 4,096 by default. */
  readonly maxLength?: number;
  /** Most segments; 64 by default, the depth limit of the schema parsers. */
  readonly maxDepth?: number;
}

const DEFAULT_MAX_LENGTH = 4096;
const DEFAULT_MAX_DEPTH = 64;

const NAME = /[A-Za-z_$][\w$]*/y;
const WHOLE_NAME = /^[A-Za-z_$][\w$]*$/;
// A bracket, from its `[` to its `]`: an index, or a JSON string literal that JSON.parse then decodes.
const BRACKET = /\[(?:(0|[1-9][0-9]*)|("(?:[^"\\\u0000-\u001F]|\\["\\/bfnrt]|\\u[0-9A-Fa-f]{4})*"))\]/y;

function limit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (!(Number.isInteger(value) && value >= 0) && value !== Number.POSITIVE_INFINITY) {
    throw new RangeError(`${name} must be a non-negative integer or Infinity, not ${String(value)}`);
  }
  return value;
}

function syntax(index: number): Result<never, PathIssue> {
  return err({ code: 'path.syntax', path: [], params: { index } });
}

/**
 * Reads the text form of a path (`items[3].name`, `["a.b"][0]`), by the grammar written in this module. The text is
 * untrusted: its length and its number of segments are bounded, and any departure from the grammar is an issue that
 * names where it is, never a guess.
 * @pure
 * @sharing none
 * @complexity O(n) (n = length of the text)
 * @throws TypeError when `text` is not a string
 * @throws RangeError when `maxLength` or `maxDepth` is neither a non-negative integer nor Infinity
 * @since 0.1
 * @experimental
 * @example parsePath('items[3].name') // { ok: true, value: ['items', 3, 'name'] }
 */
export function parsePath(text: string, options: ParsePathOptions = {}): Result<Path, PathIssue> {
  if (typeof text !== 'string') {
    throw new TypeError(`parsePath reads a string, not ${typeof text}`);
  }
  const maxLength = limit(options.maxLength, DEFAULT_MAX_LENGTH, 'maxLength');
  const maxDepth = limit(options.maxDepth, DEFAULT_MAX_DEPTH, 'maxDepth');
  if (text.length > maxLength) {
    return err({ code: 'path.too_long', path: [], params: { length: text.length, maximum: maxLength } });
  }
  const segments: (string | number)[] = [];
  let index = 0;
  while (index < text.length) {
    if (segments.length === maxDepth) {
      return err({ code: 'path.too_deep', path: [], params: { maximum: maxDepth } });
    }
    const unit = text.charCodeAt(index);
    if (unit === 0x5b) {
      BRACKET.lastIndex = index;
      const bracket = BRACKET.exec(text);
      const segment = bracket === null ? undefined : bracket[1] === undefined ? bracket[2] : Number(bracket[1]);
      if (segment === undefined || (typeof segment === 'number' && !Number.isSafeInteger(segment))) {
        return syntax(index);
      }
      // The literal matched the JSON string grammar: JSON.parse cannot throw on it.
      segments.push(typeof segment === 'number' ? segment : (JSON.parse(segment) as string));
      index = BRACKET.lastIndex;
      continue;
    }
    const start = index === 0 ? 0 : index + 1;
    if (index > 0 && unit !== 0x2e) {
      return syntax(index);
    }
    NAME.lastIndex = start;
    if (!NAME.test(text)) {
      return syntax(start);
    }
    segments.push(text.slice(start, NAME.lastIndex));
    index = NAME.lastIndex;
  }
  return ok(segments);
}

/**
 * Writes the text form of a path, which `parsePath` reads back to the same segments: a string segment as a name where
 * it is an ASCII identifier and as a quoted key elsewhere, an index in brackets. A symbol, a key segment or a number
 * that is no index (negative, fractional, unsafe, NaN) has no text form; `-0` is written as the index 0.
 * @pure
 * @sharing none
 * @complexity O(n) (n = total length of the segments)
 * @throws never
 * @since 0.1
 * @experimental
 * @example formatPath(['items', 3, 'first name']) // { ok: true, value: 'items[3]["first name"]' }
 */
export function formatPath(path: Path): Result<string, PathIssue> {
  let text = '';
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    if (typeof segment === 'string') {
      if (WHOLE_NAME.test(segment)) {
        text += index === 0 ? segment : `.${segment}`;
      } else {
        text += `[${JSON.stringify(segment)}]`;
      }
    } else if (typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0) {
      text += `[${String(segment)}]`;
    } else {
      return err({ code: 'path.not_textual', path, params: { index } });
    }
  }
  return ok(text);
}

/**
 * Checks that a path can be used for a write: none of its string segments is `__proto__`, `constructor` or
 * `prototype`, the keys through which a write reaches a prototype shared by every object. Returns the path itself
 * when it can.
 * @pure
 * @sharing identity-preserving
 * @complexity O(d) (d = number of segments)
 * @throws never
 * @since 0.1
 * @experimental
 * @example checkWritablePath(['user', '__proto__', 'isAdmin']) // an error, code 'path.forbidden_segment', index 1
 */
export function checkWritablePath(path: Path): Result<Path, PathIssue> {
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    if (segment === '__proto__' || segment === 'constructor' || segment === 'prototype') {
      return err({ code: 'path.forbidden_segment', path, params: { index, segment } });
    }
  }
  return ok(path);
}
