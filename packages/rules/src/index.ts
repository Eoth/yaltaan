// The rules of ARCHITECTURE.md §7.10: declarative rules across fields, pure and stateless, that give issues on the
// fields they target and reach any form engine through Standard Schema. Nothing runs on import, and a bundler drops
// every function nobody calls.
//
// A rule declares what it reads and where it marks. A built-in rule only meets the values of the paths it declares, and
// a callback is only handed a value that is not blank, but for a condition, for which absent is an answer: a row a user
// has just added cannot make a validator throw. A rule an application writes may read anything, and
// `assertDeclaredReads` is the test that says what it read. A value is read through own keys only: a name that
// `Object.prototype` holds is absent, not a function that looks filled.
//
// What an input can make a check hold is bounded, as in `@yaltaan/schema`: `MAX_ISSUES` issues or required paths, and a
// list over `MAX_ELEMENTS` gets one issue, none of its elements read. A list is walked once, its length read once. The
// rest of the work is linear in the elements of a value that shares no list, as JSON cannot, and the depth is that of
// the rules, without recursion on data.
import { toStandardIssue, type Issue, type IssueFormatter, type ToStandardIssueOptions } from '@yaltaan/core/issue';
import type { KeySegment, Path } from '@yaltaan/core/path';
import type { StandardResult, StandardSchema } from '@yaltaan/schema';

/**
 * In a path a rule declares, every element of the list before it: `['contacts', anyElement, 'email']`.
 * @since 0.2
 * @experimental
 */
export const anyElement: KeySegment = { key: undefined };

/**
 * An expected failure of a rule. The first seven name the rule; `rules.too_large` and `rules.too_many_issues` are the
 * limits of a check:
 * - `rules.required_if`: the condition holds, and this field is blank;
 * - `rules.all_or_none`: another field of the group is filled, and this one is blank;
 * - `rules.at_least`, `rules.exactly`: `count` of the fields or elements count, under `minimum` or not `expected`;
 * - `rules.mutually_exclusive`: another field of the group is filled, and so is this one;
 * - `rules.unique`: another element of the list has the same key;
 * - `rules.ordered`: this value comes before the value it must follow, or cannot be compared with it;
 * - `rules.too_large`: the list has more than `maximum` elements, none of them read;
 * - `rules.too_many_issues`: the check stopped at `maximum` errors, the last in the list, at the root.
 * @since 0.2
 * @experimental
 */
export type RuleIssue =
  | { readonly code: 'rules.required_if'; readonly path: Path }
  | { readonly code: 'rules.all_or_none'; readonly path: Path }
  | {
      readonly code: 'rules.at_least';
      readonly path: Path;
      readonly params: { readonly minimum: number; readonly count: number };
    }
  | {
      readonly code: 'rules.exactly';
      readonly path: Path;
      readonly params: { readonly expected: number; readonly count: number };
    }
  | { readonly code: 'rules.mutually_exclusive'; readonly path: Path }
  | { readonly code: 'rules.unique'; readonly path: Path }
  | { readonly code: 'rules.ordered'; readonly path: Path }
  | { readonly code: 'rules.too_large'; readonly path: Path; readonly params: { readonly maximum: number } }
  | { readonly code: 'rules.too_many_issues'; readonly path: Path; readonly params: { readonly maximum: number } };

/**
 * A rule across values: what it reads, where it can mark, and what it says of given values. It holds no state, and an
 * application can write its own: `assertDeclaredReads` then says whether `reads` tells the truth.
 * @since 0.2
 * @experimental
 */
export interface Rule {
  /** What the rule reads. A path covers what is under it; `anyElement` stands for every element of a list. */
  readonly reads: readonly Path[];
  /** Where the rule can place an issue, `rules.too_many_issues` aside; `anyElement` as in `reads`. */
  readonly targets: readonly Path[];
  /** The issues of these values, every one on a target; none when the rule holds. */
  readonly check: (values: unknown) => readonly Issue[];
  /** The fields these values require: a blank one among them gets an issue. A rule without it requires none. */
  readonly required?: (values: unknown) => readonly Path[];
}

// Enough for any form a person fills in, as in `@yaltaan/schema`; a body built to fail costs a few hundred kilobytes.
const MAX_ISSUES = 1000;
const MAX_ELEMENTS = 1_000_000;
// V8 hashes a longer string by its length alone: same-length keys would all collide in a Map, and 34 MB of JSON would
// take seconds. Two keys that share this many code units are the same key.
const MAX_KEY_LENGTH = 16_000;

// A bad argument is a bug in the calling code, seen when the rule is built, never when a user fills in the form.
function refuse(what: string): never {
  throw new TypeError(`not ${what}`);
}

function checkFunction(value: unknown): void {
  if (typeof value !== 'function') {
    refuse('a function');
  }
}

// A path of names and indexes, kept whole: a later write to the array given changes nothing, and an issue can share it.
function checkPath(path: Path): Path {
  if (
    !Array.isArray(path) ||
    path.some((segment) => typeof segment !== 'string' && typeof segment !== 'number' && typeof segment !== 'symbol')
  ) {
    refuse('a path of names and indexes: each() walks a list');
  }
  return Object.freeze([...path]);
}

function checkPaths(paths: readonly Path[], fewest: number): readonly Path[] {
  if (!Array.isArray(paths) || paths.length < fewest) {
    refuse(`${fewest} path(s) or more`);
  }
  return Object.freeze(paths.map(checkPath));
}

function checkRuleList(rules: readonly Rule[]): readonly Rule[] {
  if (!Array.isArray(rules)) {
    refuse('an array of rules');
  }
  for (const rule of rules) {
    const { check, required } = (rule ?? {}) as Partial<Rule>;
    checkFunction(check);
    if (required !== undefined) {
      checkFunction(required);
    }
  }
  return [...rules];
}

function readPath(values: unknown, path: Path): unknown {
  let current = values;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index] as PropertyKey;
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

// What a check holds so far. Errors have a limit, which ends the walk; a warning blocks nothing, so it neither counts
// toward it nor ends a walk, which would hide an error behind it: the first `MAX_ISSUES` are kept, the rest dropped.
interface Found {
  readonly issues: Issue[];
  errors: number;
}

// False once the errors are full, the last issue saying so. The caller stops there.
function add(found: Found, issue: Issue): boolean {
  const { issues, errors } = found;
  if (issue.severity === 'warning') {
    if (issues.length - errors < MAX_ISSUES) {
      issues.push(issue);
    }
    return true;
  }
  if (errors < MAX_ISSUES) {
    found.errors += 1;
    issues.push(issue);
    return true;
  }
  issues.push({ code: 'rules.too_many_issues', path: [], params: { maximum: MAX_ISSUES } } satisfies RuleIssue);
  return false;
}

// The elements of a list: none when the path holds no array.
function elementsAt(values: unknown, path: Path): readonly unknown[] {
  const list = readPath(values, path);
  return Array.isArray(list) ? list : [];
}

function tooLarge(path: Path): readonly RuleIssue[] {
  return [{ code: 'rules.too_large', path, params: { maximum: MAX_ELEMENTS } }];
}

// The segment of an element in a path: its stable key when it has one, so that an issue follows it when the list is
// reordered, and otherwise its index.
function segmentOf(element: unknown, index: number, identity: Path | undefined): Path[number] {
  const key = identity === undefined ? undefined : readPath(element, identity);
  return isBlank(key) ? index : { key };
}

// A rule over a group of fields: `marked` says which get an issue, and `required` which the values require.
function overFields(
  paths: readonly Path[],
  issueAt: (path: Path, count: number) => RuleIssue,
  marked: (filled: readonly Path[], blank: readonly Path[]) => readonly Path[],
  required: (filled: readonly Path[], blank: readonly Path[]) => readonly Path[],
): Rule {
  const split = (values: unknown): readonly [Path[], Path[]] => {
    const filled: Path[] = [];
    const blank: Path[] = [];
    for (const path of paths) {
      (isBlank(readPath(values, path)) ? blank : filled).push(path);
    }
    return [filled, blank];
  };
  return {
    reads: paths,
    targets: paths,
    check: (values) => {
      const [filled, blank] = split(values);
      return marked(filled, blank).map((path) => issueAt(path, filled.length));
    },
    required: (values) => {
      const [filled, blank] = split(values);
      return required(filled, blank);
    },
  };
}

/**
 * What a rule's condition reads, and what it says of those values.
 * @since 0.2
 * @experimental
 */
export interface Condition {
  /** The paths whose values `when` is given. */
  readonly reads: readonly Path[];
  /** Given the value of each path of `reads`, in order, and `undefined` for an absent one. */
  readonly when: (...values: readonly unknown[]) => boolean;
}

/**
 * `paths` are required while the condition holds: a blank one gets `rules.required_if`. Blank is `undefined`, `null`,
 * an empty string or an empty array; `0` and `false` are values.
 * @pure
 * @sharing structural
 * @complexity O(k) (k = number of paths and reads, each of its own length), plus the cost of `when`
 * @throws TypeError when `paths` is empty, a path is not an array of names and indexes, or `when` is not a function
 * @throws what `when` or a getter of the values throws, unchanged, when checking
 * @since 0.2
 * @experimental
 * @example
 * const rule = requiredIf({ reads: [['country']], when: (country) => country === 'FR' }, [['siren']]);
 * rule.check({ country: 'FR' }) // [{ code: 'rules.required_if', path: ['siren'] }]
 */
export function requiredIf(condition: Condition, paths: readonly Path[]): Rule {
  const from = checkPaths(condition.reads, 1);
  const targets = checkPaths(paths, 1);
  checkFunction(condition.when);
  const required = (values: unknown): readonly Path[] =>
    condition.when(...from.map((path) => readPath(values, path))) ? targets : [];
  return {
    reads: [...from, ...targets],
    targets,
    check: (values) =>
      required(values)
        .filter((path) => isBlank(readPath(values, path)))
        .map((path) => ({ code: 'rules.required_if', path }) satisfies RuleIssue),
    required,
  };
}

/**
 * Fields given together or not at all: when some are filled, each blank one gets `rules.all_or_none`, and is required.
 * @pure
 * @sharing structural
 * @complexity O(k) (k = number of paths, each of its own length)
 * @throws TypeError when there are fewer than two paths, or a path is not an array of names and indexes
 * @throws what a getter of the values throws, unchanged, when checking
 * @since 0.2
 * @experimental
 * @example allOrNone([['number'], ['signedOn']]).check({ number: 'C-1' }) // an issue at ['signedOn']
 */
export function allOrNone(paths: readonly Path[]): Rule {
  const needed = (filled: readonly Path[], blank: readonly Path[]): readonly Path[] => (filled.length > 0 ? blank : []);
  return overFields(checkPaths(paths, 2), (path) => ({ code: 'rules.all_or_none', path }), needed, needed);
}

/**
 * At most one field of a group is filled: when two or more are, each filled one gets `rules.mutually_exclusive`.
 * @pure
 * @sharing structural
 * @complexity O(k) (k = number of paths, each of its own length)
 * @throws TypeError when there are fewer than two paths, or a path is not an array of names and indexes
 * @throws what a getter of the values throws, unchanged, when checking
 * @since 0.2
 * @experimental
 * @example mutuallyExclusive([['a'], ['b']]).check({ a: 1, b: 2 }) // an issue at ['a'] and one at ['b']
 */
export function mutuallyExclusive(paths: readonly Path[]): Rule {
  return overFields(
    checkPaths(paths, 2),
    (path) => ({ code: 'rules.mutually_exclusive', path }),
    (filled) => (filled.length > 1 ? filled : []),
    () => [],
  );
}

/**
 * The elements of a list that count: those whose value at `at`, the element itself without it, is not blank and passes
 * `where`. A callback never meets a blank value, and the rule declares what it reads.
 * @since 0.2
 * @experimental
 */
export interface ListSource {
  readonly list: Path;
  readonly at?: Path;
  /** Whether this value counts; every value that is not blank without it. */
  readonly where?: (value: unknown) => boolean;
}

// What a count rule says at a path: `minimum` or `expected`, and what it counted.
function counted(
  n: number,
  source: readonly Path[] | ListSource,
  code: 'rules.at_least' | 'rules.exactly',
  param: 'minimum' | 'expected',
  holds: (count: number) => boolean,
): Rule {
  if (!Number.isSafeInteger(n) || n < 0) {
    refuse('a count');
  }
  const issueAt = (path: Path, count: number): RuleIssue =>
    ({ code, path, params: { [param]: n, count } }) as RuleIssue;
  if (Array.isArray(source)) {
    const paths = checkPaths(source as readonly Path[], 1);
    if (n > paths.length) {
      refuse('a count these fields can reach');
    }
    return overFields(
      paths,
      issueAt,
      (filled, blank) => (holds(filled.length) ? [] : filled.length < n ? blank : filled),
      // A field is required only when the rule cannot hold without it: every blank one is needed.
      (filled, blank) => (n - filled.length === blank.length ? blank : []),
    );
  }
  const { list, at = [], where } = source as ListSource;
  const path = checkPath(list);
  const field = checkPath(at);
  if (where !== undefined) {
    checkFunction(where);
  }
  return {
    reads: [[...path, anyElement, ...field]],
    targets: [path],
    check: (values) => {
      const elements = elementsAt(values, path);
      const { length } = elements;
      if (length > MAX_ELEMENTS) {
        return tooLarge(path);
      }
      let count = 0;
      for (let index = 0; index < length; index += 1) {
        const value = readPath(elements[index], field);
        if (!isBlank(value) && (where === undefined || where(value))) {
          count += 1;
        }
      }
      return holds(count) ? [] : [issueAt(path, count)];
    },
  };
}

/**
 * At least `n` of these fields are filled, each blank one getting `rules.at_least`; or at least `n` elements of a list
 * count, the list getting the issue. Monotonic: filling one more field, or adding an element that counts, never creates
 * an issue, but for a list that passes the limit of 1,000,000 elements.
 * @pure
 * @sharing structural
 * @complexity O(k) (k = number of paths), or O(e) (e = number of elements) times the cost of `where`
 * @throws TypeError when `n` is not a whole number from 0, is over the number of paths, a path is not an array of names
 *   and indexes, or `where` is not a function
 * @throws what `where` or a getter of the values throws, unchanged, when checking
 * @since 0.2
 * @experimental
 * @example atLeast(1, [['phone'], ['email']]).check({}) // an issue at ['phone'] and one at ['email']
 */
export function atLeast(n: number, source: readonly Path[] | ListSource): Rule {
  return counted(n, source, 'rules.at_least', 'minimum', (count) => count >= n);
}

/**
 * Exactly `n` of these fields are filled: under it, each blank one gets `rules.exactly`, over it, each filled one; or
 * exactly `n` elements of a list count, the list getting the issue.
 * @pure
 * @sharing structural
 * @complexity O(k) (k = number of paths), or O(e) (e = number of elements) times the cost of `where`
 * @throws TypeError when `n` is not a whole number from 0, is over the number of paths, a path is not an array of names
 *   and indexes, or `where` is not a function
 * @throws what `where` or a getter of the values throws, unchanged, when checking
 * @since 0.2
 * @experimental
 * @example exactly(1, { list: ['contacts'], at: ['primary'], where: (primary) => primary === true })
 */
export function exactly(n: number, source: readonly Path[] | ListSource): Rule {
  return counted(n, source, 'rules.exactly', 'expected', (count) => count === n);
}

/**
 * The options of `unique` and `each`: the field of an element that holds its stable key, so that a path names the
 * element by `{ key }` and an issue follows it when the list is reordered; without it, or where it is blank, by index.
 * @since 0.2
 * @experimental
 */
export interface EachOptions {
  readonly identity?: Path;
}

/**
 * The options of `unique`.
 * @since 0.2
 * @experimental
 */
export interface UniqueOptions extends EachOptions {
  /**
   * What is compared, from the value at `at`, which is not blank: `(email) => (typeof email === 'string' ?
   * email.toLowerCase() : email)`. A blank answer is not compared either.
   */
  readonly by?: (value: unknown) => unknown;
}

/**
 * No two elements of a list have the same value at `at`, the element itself when it is empty, compared by SameValueZero
 * and, for a string, on its first 16,000 code units: every element sharing one gets `rules.unique` at `at`. A blank is
 * not compared, before or after `by`: a field still empty is another rule's.
 * @pure
 * @sharing structural
 * @complexity O(e) (e = number of elements), times the cost of `by`
 * @throws TypeError when `by` is not a function, or a path is not an array of names and indexes
 * @throws what `by` or a getter of the values throws, unchanged, when checking
 * @since 0.2
 * @experimental
 * @example unique(['tags'], []).check({ tags: ['a', 'a'] }) // an issue at ['tags', 0] and one at ['tags', 1]
 */
export function unique(list: Path, at: Path, options: UniqueOptions = {}): Rule {
  const path = checkPath(list);
  const field = checkPath(at);
  const { by, identity: given } = options;
  const identity = given === undefined ? undefined : checkPath(given);
  if (by !== undefined) {
    checkFunction(by);
  }
  const element = [...path, anyElement];
  return {
    reads: [[...element, ...field], ...(identity === undefined ? [] : [[...element, ...identity]])],
    targets: [path, [...element, ...field]],
    check: (values) => {
      const elements = elementsAt(values, path);
      const { length } = elements;
      if (length > MAX_ELEMENTS) {
        return tooLarge(path);
      }
      const found: Found = { issues: [], errors: 0 };
      const mark = (index: number): boolean =>
        add(found, {
          code: 'rules.unique',
          path: [...path, segmentOf(elements[index], index, identity), ...field],
        } satisfies RuleIssue);
      // The first element of each key, until a second one marks it: -1 from then on.
      const first = new Map<unknown, number>();
      for (let index = 0; index < length; index += 1) {
        const value = readPath(elements[index], field);
        if (isBlank(value)) {
          continue;
        }
        const read = by === undefined ? value : by(value);
        if (isBlank(read)) {
          continue;
        }
        const key = typeof read === 'string' ? read.slice(0, MAX_KEY_LENGTH) : read;
        const seen = first.get(key);
        if (seen === undefined) {
          first.set(key, index);
          continue;
        }
        if ((seen >= 0 && !mark(seen)) || !mark(index)) {
          break;
        }
        first.set(key, -1);
      }
      return found.issues;
    },
  };
}

/**
 * The options of `ordered`.
 * @since 0.2
 * @experimental
 */
export interface OrderedOptions {
  /** Refuses equal values too. */
  readonly strict?: boolean;
  /** Negative when `start` comes first, as for `Array.prototype.sort`; for what `<` cannot order, such as Temporal. */
  readonly compare?: (start: unknown, end: unknown) => number;
}

function naturalOrder(start: unknown, end: unknown): number {
  const [first, second] =
    start instanceof Date && end instanceof Date ? [start.getTime(), end.getTime()] : [start, end];
  const kind = typeof first;
  if (kind !== typeof second || (kind !== 'number' && kind !== 'string' && kind !== 'bigint')) {
    return Number.NaN;
  }
  return (first as number) < (second as number)
    ? -1
    : first === second
      ? 0
      : (first as number) > (second as number)
        ? 1
        : Number.NaN;
}

/**
 * `start` does not come after `end`: `end` gets `rules.ordered`, and so it does when the two cannot be compared, since
 * a rule that cannot tell must not pass. Numbers and bigints compare by value, dates by time, strings by code unit, the
 * order of ISO 8601 dates; `compare` is for what else there is, such as Temporal. A blank value is another rule's.
 * @pure
 * @sharing structural
 * @complexity O(1) (the two paths, each of its own length), plus the cost of `compare`
 * @throws TypeError when a path is not an array of names and indexes, or `compare` is not a function
 * @throws what `compare` or a getter of the values throws, unchanged, when checking
 * @since 0.2
 * @experimental
 * @example ordered(['from'], ['to']).check({ from: 2, to: 1 }) // [{ code: 'rules.ordered', path: ['to'] }]
 */
export function ordered(start: Path, end: Path, options: OrderedOptions = {}): Rule {
  const from = checkPath(start);
  const to = checkPath(end);
  const { strict = false, compare = naturalOrder } = options;
  checkFunction(compare);
  return {
    reads: [from, to],
    targets: [to],
    check: (values) => {
      const first = readPath(values, from);
      const second = readPath(values, to);
      if (isBlank(first) || isBlank(second)) {
        return [];
      }
      const order = compare(first, second);
      return order < 0 || (!strict && order === 0) ? [] : [{ code: 'rules.ordered', path: to } satisfies RuleIssue];
    },
  };
}

/**
 * Applies `rules` to every element of a list, as if each element were the values: their paths are relative to it, and
 * an issue or a required path comes back with the path of the element in front. A path that holds no array has no
 * element. Lists nest.
 * @pure
 * @sharing structural
 * @complexity O(e × r) (e = number of elements, r = cost of the rules on one)
 * @throws TypeError when `rules` is not an array of rules, or a path is not an array of names and indexes
 * @throws what a rule or a getter of the values throws, unchanged, when checking
 * @since 0.2
 * @experimental
 * @example
 * const taxed = requiredIf({ reads: [['taxable']], when: (taxable) => taxable === true }, [['rate']]);
 * each(['products'], [taxed]).check({ products: [{ taxable: true }] }) // an issue at ['products', 0, 'rate']
 */
export function each(list: Path, rules: readonly Rule[], options: EachOptions = {}): Rule {
  const path = checkPath(list);
  const inner = checkRuleList(rules);
  const identity = options.identity === undefined ? undefined : checkPath(options.identity);
  const element = [...path, anyElement];
  const under = (paths: readonly Path[]): Path[] => paths.map((relative) => [...element, ...relative]);
  // Walks the elements of one read of the list, until `visit` says the list it fills is full.
  const walk = (
    elements: readonly unknown[],
    length: number,
    visit: (item: unknown, prefix: Path) => boolean,
  ): void => {
    for (let index = 0; index < length; index += 1) {
      const item = elements[index];
      if (!visit(item, [...path, segmentOf(item, index, identity)])) {
        return;
      }
    }
  };
  const reads = under(inner.flatMap((rule) => rule.reads));
  if (identity !== undefined) {
    reads.unshift([...element, ...identity]);
  }
  return {
    // Walking the list reads its elements, even for rules that declare nothing.
    reads: reads.length === 0 ? [element] : reads,
    targets: [path, ...under(inner.flatMap((rule) => rule.targets))],
    check: (values) => {
      const elements = elementsAt(values, path);
      const { length } = elements;
      if (length > MAX_ELEMENTS) {
        return tooLarge(path);
      }
      const found: Found = { issues: [], errors: 0 };
      walk(elements, length, (item, prefix) =>
        inner.every((rule) =>
          rule.check(item).every((issue) => add(found, { ...issue, path: [...prefix, ...issue.path] })),
        ),
      );
      return found.issues;
    },
    required: (values) => {
      const elements = elementsAt(values, path);
      const { length } = elements;
      const required: Path[] = [];
      if (length <= MAX_ELEMENTS) {
        walk(elements, length, (item, prefix) =>
          inner.every((rule) =>
            (rule.required?.(item) ?? []).every((relative) => {
              required.push([...prefix, ...relative]);
              return required.length < MAX_ISSUES;
            }),
          ),
        );
      }
      return required;
    },
  };
}

/**
 * The issues of these values, in the order of the rules: up to 1,000 errors and then `rules.too_many_issues`, which
 * ends the check, and the first 1,000 warnings; none when every rule holds. A rule reads the values, and never writes
 * them.
 * @pure
 * @sharing structural
 * @complexity O(r) (r = cost of the rules); memory bounded by 2,001 issues
 * @throws what a rule or a getter of the values throws, unchanged
 * @since 0.2
 * @experimental
 * @example checkRules([atLeast(1, [['a']])], { a: 1 }) // []
 */
export function checkRules(rules: readonly Rule[], values: unknown): readonly Issue[] {
  const found: Found = { issues: [], errors: 0 };
  for (const rule of rules) {
    if (!rule.check(values).every((issue) => add(found, issue))) {
      break;
    }
  }
  return found.issues;
}

/**
 * The fields these values require, derived from the rules and never written into them: what a form marks as required.
 * In the order of the rules, up to 1,000: a field two rules require comes twice. It shows, and `checkRules` decides.
 * @pure
 * @sharing structural
 * @complexity O(r) (r = cost of the rules); memory bounded by 1,000 paths
 * @throws what a rule or a getter of the values throws, unchanged
 * @since 0.2
 * @experimental
 * @example requiredPaths([allOrNone([['a'], ['b']])], { a: 1 }) // [['b']]
 */
export function requiredPaths(rules: readonly Rule[], values: unknown): readonly Path[] {
  const required: Path[] = [];
  for (const rule of rules) {
    for (const path of rule.required?.(values) ?? []) {
      required.push(path);
      if (required.length === MAX_ISSUES) {
        return required;
      }
    }
  }
  return required;
}

/**
 * The options of `refine`.
 * @since 0.2
 * @experimental
 */
export interface RefineOptions<O = unknown> {
  /** Builds the message of an issue; its code by default, as a schema of this library does. */
  readonly format?: IssueFormatter;
  /**
   * The current index of the element a `{ key }` names, from the value this read gave; without it, an issue stops at
   * the list that holds the element.
   */
  readonly resolveKey?: (segment: KeySegment, parent: Path, value: O) => number | undefined;
}

/**
 * `schema`, followed by `rules` on the value it gives: a Standard Schema that any engine reads, with no form of ours.
 * The rules only see a value the schema accepted; asynchronous when the schema is. `schema` is any Standard Schema. A
 * `warning` blocks nothing, and the interface has no other kind of issue: it stays out, for `checkRules` to show.
 * @pure
 * @sharing structural
 * @complexity O(1) to build; a read costs that of `schema` and of the rules
 * @throws TypeError when `schema` has no `~standard` interface, `rules` is not an array of rules, or `format` or
 *   `resolveKey` is not a function
 * @throws what a rule, `format` or `schema` throws, unchanged, when reading
 * @since 0.2
 * @experimental
 * @example refine(object({ a: optional(string()), b: optional(string()) }), [allOrNone([['a'], ['b']])])
 */
export function refine<I, O>(
  schema: StandardSchema<I, O>,
  rules: readonly Rule[],
  options: RefineOptions<O> = {},
): StandardSchema<I, O> {
  const base = (schema as Partial<StandardSchema<I, O>> | null | undefined)?.['~standard'];
  if (typeof base?.validate !== 'function') {
    refuse('a Standard Schema');
  }
  const inner = checkRuleList(rules);
  const { format = (issue) => issue.code, resolveKey } = options;
  checkFunction(format);
  if (resolveKey !== undefined) {
    checkFunction(resolveKey);
  }
  const finish = (result: StandardResult<O>): StandardResult<O> => {
    if (result.issues !== undefined) {
      return result;
    }
    const { value } = result;
    const blocking = checkRules(inner, value).filter((issue) => issue.severity !== 'warning');
    if (blocking.length === 0) {
      return result;
    }
    // From the value of this read, so that two reads under way at once cannot answer for each other.
    const conversion: ToStandardIssueOptions =
      resolveKey === undefined
        ? { format }
        : { format, resolveKey: (segment, parent) => resolveKey(segment, parent, value) };
    return { issues: blocking.map((issue) => toStandardIssue(issue, conversion)) };
  };
  return {
    '~standard': {
      version: 1,
      vendor: 'yaltaan',
      validate: (value, standardOptions) => {
        const result = base.validate(value, standardOptions);
        return 'then' in result ? Promise.resolve(result).then(finish) : finish(result);
      },
      types: base.types,
    },
  };
}

// Whether a read of `path` is declared: it goes through a declared path on its way, or stands under one. A read of all
// the keys of an object must stand at or under one, since it sees the keys no declared path names.
function isDeclared(reads: readonly Path[], path: readonly PropertyKey[], wholeObject: boolean): boolean {
  return reads.some((declared) => {
    if (wholeObject && declared.length > path.length) {
      return false;
    }
    for (let index = 0; index < Math.min(declared.length, path.length); index += 1) {
      const expected = declared[index];
      const read = path[index];
      if (typeof expected !== 'object') {
        if (String(expected) !== String(read)) {
          return false;
        }
      } else if (
        !(typeof read === 'string' && /^[0-9]+$/.test(read)) &&
        !(read === 'length' && index === path.length - 1)
      ) {
        return false;
      }
    }
    return true;
  });
}

// A plain assignment reaches `defineProperty` too.
function refuseWrite(): never {
  throw new Error('a rule wrote to the values it reads');
}

// A view of `value` that notes every read: on a blank object, so that a frozen value can still hand out views of what
// it holds, which the invariants of a Proxy refuse on a frozen target. A read gives the same view twice, so that a rule
// comparing what it reads takes the branch it takes on the real values. A Date, a Map or a class instance is handed out
// as it is, its methods needing the real `this`: what it holds is not traced.
function traced(
  value: unknown,
  path: readonly PropertyKey[],
  note: (path: readonly PropertyKey[], whole: boolean) => void,
): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const isList = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!isList && prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  const real = value as Record<PropertyKey, unknown>;
  const views = new Map<PropertyKey, unknown>();
  const viewOf = (key: PropertyKey): unknown => {
    if (!views.has(key)) {
      views.set(key, traced(real[key], [...path, key], note));
    }
    return views.get(key);
  };
  return new Proxy(isList ? [] : {}, {
    get: (_, key) => {
      // A method of the array itself, or a symbol such as its iterator, is no data of the values.
      if (!Object.hasOwn(real, key) && (typeof key === 'symbol' || (isList && key in Array.prototype))) {
        return real[key];
      }
      note([...path, key], false);
      return viewOf(key);
    },
    has: (_, key) => {
      note([...path, key], false);
      return key in real;
    },
    getOwnPropertyDescriptor: (_, key) => {
      note([...path, key], false);
      const descriptor = Object.getOwnPropertyDescriptor(real, key);
      if (descriptor === undefined) {
        return undefined;
      }
      // What the invariants of a Proxy accept on the blank object, whose own `length` cannot be configured.
      return isList && key === 'length'
        ? { value: real[key], writable: true, enumerable: false, configurable: false }
        : { value: viewOf(key), writable: true, enumerable: descriptor.enumerable ?? false, configurable: true };
    },
    ownKeys: () => {
      note(path, true);
      return Reflect.ownKeys(real);
    },
    getPrototypeOf: () => prototype as object | null,
    defineProperty: refuseWrite,
    deleteProperty: refuseWrite,
    setPrototypeOf: refuseWrite,
    preventExtensions: refuseWrite,
  });
}

/**
 * The test of a rule: runs it on these values, notes each read, and throws if it read a value its `reads` does not
 * declare, or wrote to them. Built-in rules hold by construction; this is for the ones an application writes, on the
 * values of its tests. Not seen: a branch these values do not take, what a closure reads, the inside of a Date, a Map
 * or a class instance, and a decision on a value a declared path only goes through (`values.a === 5` where
 * `['a', 'b']` is declared). Two paths to one object are two views, so that they compare as different here.
 * @pure
 * @sharing none
 * @complexity O(r × d) (r = reads of the rule, d = declared paths)
 * @throws Error when the rule reads a value it does not declare, or writes to the values
 * @throws what the rule or a getter of the values throws, unchanged
 * @since 0.2
 * @experimental
 * @example assertDeclaredReads({ reads: [], targets: [], check: (values) => [values.b] && [] }, { b: 1 }) // throws
 */
export function assertDeclaredReads(rule: Rule, values: unknown): void {
  const undeclared = new Set<string>();
  const view = traced(values, [], (path, whole) => {
    if (!isDeclared(rule.reads, path, whole)) {
      undeclared.add(path.map(String).join('.'));
    }
  });
  rule.check(view);
  rule.required?.(view);
  if (undeclared.size > 0) {
    throw new Error(`the rule reads what it does not declare: ${[...undeclared].join(', ')}`);
  }
}
