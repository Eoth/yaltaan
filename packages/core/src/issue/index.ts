// The Issue contract of ARCHITECTURE.md §5.2: one shape for every expected failure, a stable code and data, never a
// message; the application formats it. At the Standard Schema boundary (interface version 1), an issue becomes a
// message and a path of property keys, and a foreign issue becomes `issue.external`.
//
// The two path forms disagree on `{ key }`: here it designates an array element by identity, there it only wraps a
// property name. An identity never crosses the boundary as a property name: it is resolved to the element's current
// index, or the path stops before it, so that the issue lands on the array rather than on a field that does not exist.
import type { KeySegment, Path } from '../path/index.ts';

/**
 * How much an issue blocks: an `error` makes the value invalid, a `warning` is shown without blocking.
 * @since 0.1
 * @experimental
 */
export type IssueSeverity = 'error' | 'warning';

/**
 * An expected failure: a stable namespaced code (`path.syntax`, `schema.too_small`), where it happened, and the data
 * a message is built from. The library writes no message; codes are listed in a registry per package.
 * @since 0.1
 * @experimental
 */
export interface Issue {
  /** Stable, namespaced, part of the SemVer contract of the package that produces it. */
  readonly code: string;
  /** Where the issue is, from the root of the value checked; empty for the value itself. */
  readonly path: Path;
  /** The data a message is built from. */
  readonly params?: Readonly<Record<string, unknown>>;
  /** `error` when absent. */
  readonly severity?: IssueSeverity;
  /** What caused the issue, for whoever needs more than the code (a foreign issue, a server answer). */
  readonly cause?: unknown;
}

/**
 * Builds the message of an issue, in the language and the words of the application.
 * @since 0.1
 * @experimental
 */
export type IssueFormatter = (issue: Issue) => string;

/**
 * A path segment of the Standard Schema issue: a property name wrapped in an object, never an identity.
 * @since 0.1
 * @experimental
 */
export interface StandardPathSegment {
  readonly key: PropertyKey;
}

/**
 * The issue of the Standard Schema interface, version 1: what its consumers (form engines, resolvers) read.
 * @since 0.1
 * @experimental
 */
export interface StandardIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | StandardPathSegment)[] | undefined;
}

/**
 * An issue read from another Standard Schema validator: its message is kept as data, the foreign issue as cause.
 * @since 0.1
 * @experimental
 */
export interface ExternalIssue extends Issue {
  readonly code: 'issue.external';
  readonly params: { readonly message: string };
  readonly cause: StandardIssue;
}

/**
 * How `toStandardIssue` builds the message and turns `{ key }` segments into indexes.
 * @since 0.1
 * @experimental
 */
export interface ToStandardIssueOptions {
  /** Builds the message; must return a string. */
  readonly format: IssueFormatter;
  /**
   * The current index of the element that `segment` designates in the array at `parent`, or -1 or `undefined` when it
   * is no longer there: `findIndex` answers as it is. Without it, the path stops before every `{ key }` segment.
   */
  readonly resolveKey?: (segment: KeySegment, parent: Path) => number | undefined;
}

const NOT_STANDARD = 'not a Standard Schema issue: a string message, a path of property keys or { key }';

function isKeySegment(segment: unknown): segment is KeySegment {
  return typeof segment === 'object' && segment !== null;
}

// The path as Standard Schema reads it: the same array when it holds no `{ key }` segment, nothing allocated.
function toStandardPath(path: Path, resolveKey: ToStandardIssueOptions['resolveKey']): readonly PropertyKey[] {
  let keys: PropertyKey[] | undefined;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    if (!isKeySegment(segment)) {
      keys?.push(segment as PropertyKey);
      continue;
    }
    keys ??= path.slice(0, index) as PropertyKey[];
    const resolved = resolveKey?.(segment, path.slice(0, index));
    if (resolved === undefined || resolved === -1) {
      break;
    }
    if (!(Number.isSafeInteger(resolved) && resolved >= 0)) {
      throw new TypeError(`resolveKey returned ${String(resolved)}, not an index, -1 or undefined`);
    }
    keys.push(resolved);
  }
  return keys ?? (path as readonly PropertyKey[]);
}

/**
 * The Standard Schema form of an issue: the message `format` builds, and the path in property keys, absent for an
 * issue on the value itself. A `{ key }` segment becomes the index `resolveKey` gives; when it gives none, the path
 * stops before that segment, on the array that holds the element.
 * @pure
 * @sharing structural
 * @complexity O(d) (d = number of segments), plus one call of `format` and one of `resolveKey` per `{ key }` segment
 * @throws TypeError when `format` is not a function or returns something else than a string
 * @throws TypeError when `resolveKey` returns something else than an index, -1 or undefined
 * @throws what `format` or `resolveKey` throws, unchanged
 * @since 0.1
 * @experimental
 * @example toStandardIssue({ code: 'a.b', path: ['x'] }, { format: (i) => i.code }) // { message: 'a.b', path: ['x'] }
 */
export function toStandardIssue(issue: Issue, options: ToStandardIssueOptions): StandardIssue {
  const message = options.format(issue);
  if (typeof message !== 'string') {
    throw new TypeError(`format returned a ${typeof message}, not a string`);
  }
  const path = toStandardPath(issue.path, options.resolveKey);
  return path.length === 0 ? { message } : { message, path };
}

/**
 * The issue form of a Standard Schema issue from another validator: code `issue.external`, the message in
 * `params.message`, the foreign issue as `cause`. A `{ key }` segment of its path is a property name and is unwrapped.
 * @pure
 * @sharing structural
 * @complexity O(d) (d = number of segments)
 * @throws TypeError when `message` is not a string, `path` is neither an array nor undefined, or a segment is neither
 *   a property key nor `{ key }` holding one
 * @since 0.1
 * @experimental
 * @example fromStandardIssue({ message: 'Too short', path: [{ key: 'name' }] }) // code 'issue.external', path ['name']
 */
export function fromStandardIssue(issue: StandardIssue): ExternalIssue {
  const { message, path: foreign } = issue;
  if (typeof message !== 'string' || (foreign !== undefined && !Array.isArray(foreign))) {
    throw new TypeError(NOT_STANDARD);
  }
  let path: PropertyKey[] | undefined;
  const segments = foreign ?? [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    let key: unknown = segment;
    if (isKeySegment(segment)) {
      key = segment.key;
      path ??= segments.slice(0, index) as PropertyKey[];
    }
    if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'symbol') {
      throw new TypeError(NOT_STANDARD);
    }
    path?.push(key);
  }
  return {
    code: 'issue.external',
    path: path ?? (segments as readonly PropertyKey[]),
    params: { message },
    cause: issue,
  };
}
