// The laws of the form, judged against a naive model: plain values for each field (raw, initial, touched), for each
// array (its items, those of its last reset, its initial list) and for the form (submitted), every state computed again
// from them at each look, by the rules the module's documentation states, with no graph. Random programs build a tree
// of fields, groups and arrays up to three levels deep, arrays holding fields, groups or arrays, some kept by the key
// their first field holds, some nodes with a schema answering at once, with a promise, or either depending on the
// value, whose output differs from what it reads, some with a validator of the application answering at once, with a
// promise, with one that rejects as soon as its signal aborts, with a thenable that calls back twice, or either
// depending on the value, some with a disabled condition reading any node it can name, an item through
// `{ key: undefined }`, and some with rules of the application that read nodes at or below theirs, every item of an
// array, the item of an index, a place in a field's list, and say issues, warnings among them, and what they require,
// by a hash of what they read; then they set, touch, reset, submit, batch, insert, remove and move items, set arrays to
// lists that reorder, keep, build and drop items, settle or reject the promises the schemas gave, in any order, the
// late ones included, and let `fc.scheduler()` release the answer of one run of a validator, the one it picks among
// those in flight, aborted ones included; at the end, it releases every one left, a look after each. After each step,
// for every node of the tree, in the order of the description:
//   - consistency: path, raw, dirty, touched, submitted, disabled, pending, issues, required and parsed are the
//     model's, the keys of every object in the order of the description; a rule reads the raw value of its node through
//     the paths it declares, its issues placed after those of its node's schema or validator, an item named by its
//     index in the list it read or by the key it read at `k0`; a warning blocks neither the parsed value nor a
//     validator; an item holds the key it took when it was built, its business key or one the form gave it, never
//     taken by another item of the form, so that an item moved keeps its states and its issues, the path of an issue
//     naming its item by `{ key }`; the answer of a run of a validator counts only while that run is its node's last
//     and the node is in the form, its first answer only when it calls back twice;
//   - one validation per change: each schema has been asked exactly once for each value its node took between two
//     looks, never twice for the same, and an answer settled for a value since replaced changes nothing; each rule of a
//     node in the tree, or out of it but still watched, is checked, and asked what it requires, once by a look when a
//     field at the end of one of its paths or the items of an array on its way are not those of its last call, and
//     never otherwise; a validator runs when no run of it counts, no schema or rule of its node, below it or above it
//     has placed an issue that is not a warning on the node or below, no schema has yet to answer, and its node is in
//     the form; the run that counts stays so, whatever schema has yet to
//     answer, until its raw value or the lives of the items that hold the node change, a schema places such an issue,
//     or a rule places such an issue, or the node leaves the form;
//   - abort: the signal of a run is aborted exactly when the run was still in flight as it stopped counting; never the
//     signal of a run that answered first, nor of the run that counts;
//   - notification, when every state of every node is watched from the start, and of every item from the look after it
//     was built: a listener is called once by a step that changes its state, never by a step that leaves it as it was.
//     A field's raw value changes by `Object.is`, a group's when one of its fields' does, an array's when its items or
//     one of their raw values do, its items even when a later write of the same batch gives the old ones back; a read
//     value when it turns ok or not, when its issues change by content, or when its value is another (a schema's
//     output is a new value each time it is asked); issues change by content;
//   - a write that throws (a group set to anything else than an object, an array to anything else than an array or to
//     more items than it may hold, two items with the same key or a blank one, an index out of range) writes nothing,
//     and a batch keeps the writes made before it.
// Values are small integers and, now and then, a list built anew at each write, which is never the same value as
// another and always equal by content. Blind spots: `equals`, `NaN` and `-0` are left to the examples of
// index.test.ts; schemas, validators and conditions never throw, left to the examples too, with schemas of
// @yaltaan/schema, whose issues keep their code (here every issue comes from the Standard Schema interface,
// `issue.external`, is the form's own, comes from a schema that names items by `{ key }`, or from a validator); a field
// inside an array has no schema, since its value would not tell which item asked (a validator is told by the path it is
// handed); the listeners of an item removed are no longer checked; a listener never reads another node during a write,
// so what one batch holds is left to the examples; every state is read at each look, so laziness is left to the
// examples, and with it a run aborted only once its node is read again (validate.test.ts), and a rule checked only once
// a state that needs it is read (rules.test.ts); so are a write into a removed item, an answer that throws when read,
// the turn on which a signal aborts, rules that throw, blank values other than `undefined`, the options a rule is
// checked against, and the cost of a step.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import type { Issue } from '@yaltaan/core/issue';
import type { Path } from '@yaltaan/core/path';
import type { ReadableNode } from '@yaltaan/core/reactive';
import type { Result } from '@yaltaan/core/result';
import type { Rule } from '@yaltaan/rules';
import type { StandardResult, StandardSchema } from '@yaltaan/schema';
import { fc } from '@yaltaan/testing';

import { array, createForm, field, group, type FormNode, type Spec, type Validation } from './index.ts';

type SchemaKind = 'sync' | 'async' | 'mixed' | 'keyed';
type ValidatorKind = 'sync' | 'async' | 'abortable' | 'thenable' | 'mixed';
type Kind = 'field' | 'group' | 'array';

interface Shape {
  readonly kind: Kind;
  readonly initial: number;
  /** A group's children; an array's element, alone. */
  readonly children: readonly Shape[];
  readonly schema: SchemaKind | null;
  readonly validator: ValidatorKind | null;
  readonly condition: { readonly reads: readonly number[]; readonly salt: number } | null;
  /** An array's: whether its items are kept by the key their first field holds, when its element allows it. */
  readonly identity: boolean;
  /** An array's: the seed of its initial items. */
  readonly start: readonly number[];
  /** Its rules: the nodes each reads, among those at or below it, and the salt of what it says. */
  readonly rules: readonly RuleShape[];
}

interface RuleShape {
  readonly reads: readonly number[];
  readonly salt: number;
  /** Whether it says which nodes it requires. */
  readonly required: boolean;
}

const ANY = { key: undefined };
type Segment = string | { readonly key: undefined };
/** A segment a rule declares: a child's key, every item (`ANY`), an item by its index, or a place in a field's list. */
type Declared = string | number | { readonly key: undefined };

/** A rule of a node, its paths resolved from it. */
interface LawRule {
  readonly declared: readonly (readonly Declared[])[];
  readonly salt: number;
  readonly required: boolean;
}

/** A node of the description: its shape, its place, and what its condition reads. */
interface Template {
  readonly id: number;
  readonly shape: Shape;
  /** Its key in its group; `undefined` for the root and for an array's element. */
  readonly key: string | undefined;
  readonly parent: Template | undefined;
  readonly children: readonly Template[];
  /** From the root, `{ key: undefined }` for an item. */
  readonly path: readonly Segment[];
  /** The arrays that hold it, outermost first. */
  readonly arrays: readonly Template[];
  readonly identity: boolean;
  reads: readonly Template[];
  /** An array's initial raw value, as the form holds it. */
  start: unknown[];
  rules: readonly LawRule[];
}

const UNSET = Symbol('unset');

/** A node of the tree, as the model holds it. */
interface Model {
  readonly id: number;
  readonly template: Template;
  readonly parent: Model | undefined;
  readonly children: readonly Model[];
  items: Model[];
  /** How many times its items changed, back to the same ones included. */
  revision: number;
  first: Model[];
  start: unknown;
  /** An item's key: its business key, or `UNSET` until the form's is read. */
  key: unknown;
  raw: unknown;
  initial: unknown;
  touched: boolean;
  /** An item's: how many times it left or entered its array, and whether it is out of it. */
  life: number;
  out: boolean;
  /** Its validator's run that counts, if any. */
  current: Run | undefined;
  /** What each of its rules read at its last check, and at its last `required`, by the rule's index. */
  checked: (Identity | undefined)[];
  needed: (Identity | undefined)[];
}

/** A value's identity, for the notification law: `Object.is` of each leaf, through groups and the items of arrays. */
type Identity =
  | { readonly leaf: unknown }
  | { readonly group: readonly Identity[] }
  | { readonly list: readonly (readonly [number, Identity])[]; readonly revision: number };

/** A question a schema was asked: its value and its identity, its answer, and how its promise, if any, settled. */
interface Request {
  readonly value: unknown;
  readonly identity: Identity;
  readonly answer: StandardResult<unknown> | Keyed;
  settled: 'resolved' | 'rejected' | undefined;
}

/** What a schema of @yaltaan/schema answers through `parse`: issues whose paths may hold `{ key }` segments. */
interface Keyed {
  readonly keyed: true;
  readonly issues: readonly Raised[];
  readonly value?: unknown;
}

/** What a validator answers for a value: issues, a failure and its cause, or nothing found. */
type Outcome =
  | { readonly kind: 'issues'; readonly issues: readonly Raised[] }
  | { readonly kind: 'failed'; readonly cause: string }
  | { readonly kind: 'clear' };

/** A run of a validator, as the model expects it: its value, its outcome, and whether it settled or was aborted. */
interface Run {
  readonly value: unknown;
  /** What it was asked for: its node's raw value, by identity, and the lives of the items that hold the node. */
  readonly identity: Identity;
  readonly life: string;
  readonly outcome: Outcome;
  settled: boolean;
  /** Whether the form must have aborted it: it was in flight when its node asked again or left the form. */
  aborted: boolean;
}

/** A run as the validator recorded it: its node's path, its value and its signal; whether the scheduler released it. */
interface Called {
  readonly template: number;
  readonly path: string;
  readonly value: unknown;
  readonly signal: AbortSignal;
  released: boolean;
}

/** A call of a rule's `check` or `required`, as the rule recorded it: its node of the description, and what it read. */
interface RuleCall {
  readonly template: number;
  readonly rule: number;
  readonly kind: 'check' | 'required';
  readonly seen: string;
}

/** A question as the schema recorded it, with the function that settles its promise. */
interface Asked {
  readonly template: number;
  readonly value: unknown;
  readonly settle: ((how: 'resolve' | 'reject') => void) | undefined;
  settled: boolean;
}

type Write =
  | { readonly kind: 'set'; readonly node: number; readonly seed: readonly number[] }
  | { readonly kind: 'touch'; readonly node: number }
  | { readonly kind: 'reset'; readonly node: number; readonly seed: readonly number[] | null }
  | { readonly kind: 'insert'; readonly node: number; readonly index: number; readonly seed: readonly number[] | null }
  | { readonly kind: 'remove'; readonly node: number; readonly item: number }
  | { readonly kind: 'move'; readonly node: number; readonly item: number; readonly to: number };

type Step =
  | Write
  | { readonly kind: 'submit' }
  | { readonly kind: 'settle'; readonly node: number; readonly which: number; readonly how: 'resolve' | 'reject' }
  | { readonly kind: 'release' }
  | { readonly kind: 'batch'; readonly steps: readonly Write[] };

/** A write with its node, the place of that node in the tree before it, and the value it gives, built once. */
type Resolved = Write & { readonly target: number; readonly value?: unknown };

const ABSENT = Symbol('absent');
const MAX_LENGTH = 3;

const conditions = fc.option(
  fc.record({ reads: fc.array(fc.nat(40), { minLength: 1, maxLength: 2 }), salt: fc.nat(3) }),
  {
    freq: 3,
  },
);
const seeds = fc.array(fc.nat(5), { minLength: 1, maxLength: 8 });
const ruleShapes = fc.oneof(
  { arbitrary: fc.constant([]), weight: 3 },
  {
    arbitrary: fc.array(
      fc.record({
        reads: fc.array(fc.nat(60), { minLength: 1, maxLength: 3 }),
        salt: fc.nat(23),
        required: fc.boolean(),
      }),
      { minLength: 1, maxLength: 2 },
    ),
    weight: 1,
  },
);
const validators = fc.constantFrom<ValidatorKind | null>(
  null,
  null,
  null,
  'sync',
  'async',
  'abortable',
  'thenable',
  'mixed',
);

const shapes = (depth: number, inArray: boolean): fc.Arbitrary<Shape> => {
  const leaf = fc.record({
    kind: fc.constant('field' as const),
    initial: fc.nat(3),
    children: fc.constant([]),
    schema: inArray ? fc.constant(null) : fc.constantFrom<SchemaKind | null>(null, null, 'sync', 'async', 'mixed'),
    validator: validators,
    condition: conditions,
    identity: fc.constant(false),
    start: fc.constant([]),
    rules: ruleShapes,
  });
  if (depth === 0) {
    return leaf;
  }
  const node = fc.record({
    kind: fc.constant('group' as const),
    initial: fc.constant(0),
    children: fc.array(shapes(depth - 1, inArray), { minLength: 1, maxLength: 3 }),
    schema: fc.constantFrom<SchemaKind | null>(null, null, 'sync', 'async', 'mixed'),
    validator: validators,
    condition: conditions,
    identity: fc.constant(false),
    start: fc.constant([]),
    rules: ruleShapes,
  });
  return fc.oneof(
    { arbitrary: leaf, weight: 2 },
    { arbitrary: node, weight: 2 },
    { arbitrary: lists(depth), weight: 2 },
  );
};

const lists = (depth: number): fc.Arbitrary<Shape> =>
  fc.record({
    kind: fc.constant('array' as const),
    initial: fc.constant(0),
    children: shapes(depth - 1, true).map((element) => [element]),
    schema: fc.constantFrom<SchemaKind | null>(null, null, 'sync', 'async', 'mixed', 'keyed'),
    validator: validators,
    condition: conditions,
    identity: fc.boolean(),
    start: seeds,
    rules: ruleShapes,
  });

const writes: fc.Arbitrary<Write> = fc.oneof(
  { arbitrary: fc.record({ kind: fc.constant('set' as const), node: fc.nat(40), seed: seeds }), weight: 3 },
  { arbitrary: fc.record({ kind: fc.constant('touch' as const), node: fc.nat(40) }), weight: 1 },
  {
    arbitrary: fc.record({ kind: fc.constant('reset' as const), node: fc.nat(40), seed: fc.option(seeds) }),
    weight: 2,
  },
  // A reset without a value, which gives each array the items of its last reset back, removed ones included.
  {
    arbitrary: fc.record({ kind: fc.constant('reset' as const), node: fc.nat(40), seed: fc.constant(null) }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('insert' as const),
      node: fc.nat(40),
      index: fc.nat(3),
      seed: fc.option(seeds),
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({ kind: fc.constant('remove' as const), node: fc.nat(40), item: fc.nat(3) }),
    weight: 2,
  },
  {
    arbitrary: fc.record({ kind: fc.constant('move' as const), node: fc.nat(40), item: fc.nat(3), to: fc.nat(2) }),
    weight: 4,
  },
);

const steps: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: writes, weight: 6 },
  { arbitrary: fc.record({ kind: fc.constant('submit' as const) }), weight: 1 },
  {
    arbitrary: fc.record({
      kind: fc.constant('settle' as const),
      node: fc.nat(40),
      which: fc.nat(3),
      how: fc.constantFrom<'resolve' | 'reject'>('resolve', 'resolve', 'resolve', 'reject'),
    }),
    weight: 4,
  },
  { arbitrary: fc.record({ kind: fc.constant('release' as const) }), weight: 4 },
  {
    arbitrary: fc.record({ kind: fc.constant('batch' as const), steps: fc.array(writes, { maxLength: 4 }) }),
    weight: 1,
  },
);

interface Program {
  readonly root: Shape;
  readonly steps: readonly Step[];
  readonly watched: boolean;
}

const programs: fc.Arbitrary<Program> = fc.record({
  root: fc.oneof(
    { arbitrary: shapes(3, false), weight: 1 },
    {
      arbitrary: fc.record({
        kind: fc.constant('group' as const),
        initial: fc.constant(0),
        children: fc.array(shapes(2, false), { minLength: 1, maxLength: 3 }),
        schema: fc.constantFrom<SchemaKind | null>(null, 'sync', 'async', 'mixed'),
        validator: validators,
        condition: fc.constant(null),
        identity: fc.constant(false),
        start: fc.constant([]),
        rules: ruleShapes,
      }),
      weight: 3,
    },
    {
      // An array first, so that every program of this kind moves items.
      arbitrary: fc.record({
        kind: fc.constant('group' as const),
        initial: fc.constant(0),
        children: fc
          .tuple(lists(2), fc.array(shapes(2, false), { maxLength: 2 }))
          .map(([first, rest]) => [first, ...rest]),
        schema: fc.constantFrom<SchemaKind | null>(null, 'sync', 'async', 'mixed'),
        validator: validators,
        condition: fc.constant(null),
        identity: fc.constant(false),
        start: fc.constant([]),
        rules: ruleShapes,
      }),
      weight: 4,
    },
  ),
  steps: fc.array(steps, { minLength: 4, maxLength: 30 }),
  watched: fc.boolean(),
});

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const own = (value: unknown, key: PropertyKey): unknown =>
  isObject(value) && Object.hasOwn(value, key) ? value[key as string] : undefined;

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

/**
 * The value a seed gives to a node: small integers, a list built anew, a key left out now and then, a group or an
 * array that is not one, and lists of every length up to one more than an array may hold.
 */
function valueOf(template: Template, seed: readonly number[], cursor = { at: 0 }): unknown {
  const next = seed[cursor.at++ % seed.length]!;
  if (next === 4) {
    return ABSENT;
  }
  const { kind } = template.shape;
  if (kind === 'field') {
    return next === 5 ? [1] : next;
  }
  const value: Record<string, unknown> | unknown[] = kind === 'group' ? {} : [];
  const length = kind === 'group' ? template.children.length : next === 5 ? MAX_LENGTH + 1 : next;
  for (let index = 0; index < length; index++) {
    const child = template.children[kind === 'group' ? index : 0]!;
    const inner = valueOf(child, seed, cursor);
    if (kind === 'array') {
      (value as unknown[]).push(given(inner));
    } else if (inner !== ABSENT) {
      (value as Record<string, unknown>)[child.key!] = inner;
    }
  }
  return value;
}

const given = (value: unknown): unknown => (value === ABSENT ? undefined : value);

/** What a condition says of the raw values it reads: a hash of all of them, so that every value and its place count. */
function holds(values: readonly unknown[], salt: number): boolean {
  let hash = salt;
  for (const character of String(JSON.stringify(values))) {
    hash = (hash * 31 + character.charCodeAt(0)) % 1009;
  }
  return hash % 3 === 0;
}

interface Raised {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[];
}

/** A field's schema: an integer that is even, 2 a failure without an issue; its output, ten times the integer. */
function fieldAnswer(value: unknown): StandardResult<unknown> {
  if (typeof value !== 'number') {
    return { issues: [{ message: 'not a number' }] };
  }
  if (value === 2) {
    return { issues: [] };
  }
  return value % 2 === 1 ? { issues: [{ message: 'odd' }] } : { value: value * 10 };
}

function leaves(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.values(value).reduce<number>((sum, inner) => sum + leaves(inner), 0)
    : 0;
}

/**
 * A group's schema: a 3 on a child, a 2 on a grandchild, a `{ key }` segment for a 1, a sum that is a multiple of
 * four on the group itself, and now and then a path that names no child, which stays on the group; its output, a new
 * object holding the value and its sum.
 */
function groupAnswer(value: unknown): StandardResult<unknown> {
  const issues: Raised[] = [];
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (child === 3) {
      issues.push({ message: 'three', path: [key] });
    } else if (child === 1) {
      issues.push({ message: 'one', path: [{ key }] });
    } else if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
      for (const [inner, grandchild] of Object.entries(child)) {
        if (grandchild === 2) {
          issues.push({ message: 'two', path: [key, inner] });
        }
      }
    }
  }
  const sum = leaves(value);
  if (sum % 4 === 0) {
    issues.push({ message: 'sum' });
  }
  if (sum % 5 === 1) {
    issues.push({ message: 'ghost', path: ['zz', 'k0'] });
  }
  return issues.length ? { issues } : { value: { ...record, sum } };
}

/**
 * An array's schema: a 3 on an item, a 1 on its first field, a 2 under its first field, which names no node of a field
 * and stays there, a length that is a multiple of three on the array, and an index past the end, which stays on the
 * array; its output, a new object holding the list and its length.
 */
function arrayAnswer(value: unknown): StandardResult<unknown> {
  const list = value as unknown[];
  const issues: Raised[] = [];
  list.forEach((item, index) => {
    const first = own(item, 'k0');
    if (item === 3) {
      issues.push({ message: 'three', path: [index] });
    } else if (first === 1) {
      issues.push({ message: 'one', path: [{ key: index }, 'k0'] });
    } else if (first === 2) {
      issues.push({ message: 'two', path: [index, 'k0', 'zz'] });
    }
  });
  if (list.length % 3 === 0) {
    issues.push({ message: 'length' });
  }
  if (list.length === 2) {
    issues.push({ message: 'past', path: [2] });
  }
  return issues.length ? { issues } : { value: { list, length: list.length } };
}

/**
 * The answer of a schema of @yaltaan/schema on an array: a `{ key }` segment holding an item's first field, or its
 * index, which may name another item, or none; always at once, through `parse`.
 */
function keyedAnswer(value: unknown): Keyed {
  const list = value as unknown[];
  const issues: Raised[] = [];
  list.forEach((item, index) => {
    const first = isObject(item) ? own(item, 'k0') : item;
    if (first === 1 || first === 3) {
      issues.push({ message: 'keyed', path: [{ key: first === 1 ? index : first }] });
    }
  });
  return issues.length ? { keyed: true, issues } : { keyed: true, issues, value: { keyed: list } };
}

/** The values at `path` in what a rule read, each with its path: every item for `ANY`, the item of an index. */
function leavesAt(values: unknown, path: readonly Declared[]): (readonly [Path, unknown])[] {
  let found: (readonly [Path, unknown])[] = [[[], values]];
  for (const segment of path) {
    found = found.flatMap(([at, value]): (readonly [Path, unknown])[] => {
      if (typeof segment === 'string') {
        return [[[...at, segment], own(value, segment)]];
      }
      if (!Array.isArray(value)) {
        return [];
      }
      return typeof segment === 'number'
        ? segment < value.length
          ? [[[...at, segment], value[segment]]]
          : []
        : value.map((item: unknown, index) => [[...at, index], item] as const);
    });
  }
  return found;
}

/** What a rule read, at the paths it declares: what tells two calls apart. */
const seenOf = (values: unknown, declared: readonly (readonly Declared[])[]): string =>
  JSON.stringify(declared.map((path) => leavesAt(values, path)));

function digest(text: string): number {
  let hash = 7;
  for (const character of text) {
    hash = (hash * 31 + character.charCodeAt(0)) % 10_007;
  }
  return hash;
}

/** Whether a declared path reads `target` whole: it stands at it or above it, every item for any index. */
const covers = (declared: readonly (readonly Declared[])[], target: readonly unknown[]): boolean =>
  declared.some(
    (path) =>
      path.length <= target.length &&
      path.every((segment, index) =>
        typeof segment === 'string' ? segment === target[index] : typeof target[index] === 'number',
      ),
  );

/**
 * `at`, a path in what a rule read, with an item named now and then by a `{ key }`: the key its value holds at `k0`,
 * when the rule declares it reads that field, or a number, which names an item by the form's key, another one or none.
 */
function named(values: unknown, at: Path, { declared, salt }: LawRule): Path {
  let value = values;
  return at.map((segment, index) => {
    const list = value;
    value = typeof segment === 'number' && Array.isArray(list) ? list[segment] : own(list, segment as PropertyKey);
    if (typeof segment !== 'number' || !Array.isArray(list)) {
      return segment;
    }
    const key = covers(declared, [...at.slice(0, index + 1), 'k0']) ? own(value, 'k0') : undefined;
    return salt % 3 === 1 && key !== undefined ? { key } : salt % 3 === 2 ? { key: segment } : segment;
  });
}

/**
 * What a rule says of what it read, by a hash of each value at each place, of its salt and of all it read: issues on
 * values, some of them warnings, now and then one on its node and one on a path that names no node.
 */
function ruleSays(values: unknown, rule: LawRule): Issue[] {
  const { declared, salt } = rule;
  const issues: Issue[] = [];
  declared.forEach((path, index) => {
    for (const [at, value] of leavesAt(values, path)) {
      const hash = digest(`${salt} ${index} ${JSON.stringify(at)} ${JSON.stringify(value) ?? '-'}`);
      if (hash % 3 === 0) {
        const warning = hash % 4 === 0;
        issues.push({
          code: warning ? 'law.warning' : 'law.rule',
          path: named(values, at, rule),
          params: { message: `r${salt}.${index}` },
          ...(warning ? { severity: 'warning' as const } : {}),
        });
      }
    }
  });
  const whole = digest(`${salt} ${seenOf(values, declared)}`);
  if (whole % 5 === 0) {
    issues.push({ code: 'law.rule', path: [], params: { message: 'whole' } });
  }
  if (whole % 7 === 1) {
    issues.push({ code: 'law.rule', path: ['zz', 'k0'], params: { message: 'ghost' } });
  }
  return issues;
}

/** What a rule requires of what it read: some of the places it read, and now and then its node. */
function ruleNeeds(values: unknown, rule: LawRule): Path[] {
  const { declared, salt } = rule;
  const paths: Path[] = [];
  declared.forEach((path, index) => {
    for (const [at, value] of leavesAt(values, path)) {
      if (digest(`need ${salt} ${index} ${JSON.stringify(at)} ${JSON.stringify(value) ?? '-'}`) % 4 === 1) {
        paths.push(named(values, at, rule));
      }
    }
  });
  if (digest(`need ${salt} ${seenOf(values, declared)}`) % 3 === 0) {
    paths.push([]);
  }
  return paths;
}

const CLEAR: Outcome = { kind: 'clear' };
const NOT_A_LIST = 'not a list';

/**
 * A validator's outcome for a value: on a field, an issue for a 1 and a failure for a 3; on a group, by the sum of its
 * leaves, a failure, an issue on its first child or under it, or one on itself; on an array, a failure for two items,
 * else an issue on each item whose first leaf is 1, by its index, and a `{ key }` segment for a 3, which may name
 * another item, or none; nothing found otherwise.
 */
function outcomeOf(template: Template, value: unknown): Outcome {
  const { kind } = template.shape;
  const failed: Outcome = { kind: 'failed', cause: 'vno' };
  if (kind === 'field') {
    return value === 1 ? { kind: 'issues', issues: [{ message: 'v-one', path: [] }] } : value === 3 ? failed : CLEAR;
  }
  if (kind === 'group') {
    const sum = leaves(value);
    if (sum % 7 === 6) {
      return failed;
    }
    const path = sum % 3 === 1 ? (sum % 2 ? ['k0'] : ['k0', 'zz']) : sum % 3 === 2 ? [] : undefined;
    return path ? { kind: 'issues', issues: [{ message: 'v-group', path }] } : CLEAR;
  }
  const list = value as unknown[];
  if (list.length === 2) {
    return failed;
  }
  const issues: Raised[] = [];
  list.forEach((item, index) => {
    const first = isObject(item) ? own(item, 'k0') : item;
    if (first === 1) {
      issues.push({ message: 'v-item', path: [index] });
    } else if (first === 3) {
      issues.push({ message: 'v-key', path: [{ key: index }] });
    }
  });
  return issues.length ? { kind: 'issues', issues } : CLEAR;
}

/** Whether a validator answers `value` with a promise; a validator answering at once fails by giving no list. */
const later = (kind: ValidatorKind, value: unknown): boolean =>
  kind !== 'sync' && (kind !== 'mixed' || String(JSON.stringify(value)).length % 2 === 0);

function answerOf(template: Template, value: unknown): StandardResult<unknown> | Keyed {
  const { kind, schema } = template.shape;
  if (schema === 'keyed') {
    return keyedAnswer(value);
  }
  return kind === 'field' ? fieldAnswer(value) : kind === 'group' ? groupAnswer(value) : arrayAnswer(value);
}

const isAsync = (kind: SchemaKind, value: unknown): boolean =>
  kind === 'async' || (kind === 'mixed' && String(JSON.stringify(value)).length % 2 === 1);

function buildTemplates(
  shape: Shape,
  key: string | undefined,
  parent: Template | undefined,
  all: Template[],
): Template {
  const keyed = shape.kind === 'array' && shape.children[0]!.kind === 'group';
  const template: Template = {
    id: all.length,
    shape,
    key,
    parent,
    children: [],
    path: parent ? [...parent.path, key ?? ANY] : [],
    arrays: parent ? (parent.shape.kind === 'array' ? [...parent.arrays, parent] : parent.arrays) : [],
    identity: shape.identity && keyed && shape.children[0]!.children[0]!.kind === 'field',
    reads: [],
    start: [],
    rules: [],
  };
  all.push(template);
  (template as unknown as { children: Template[] }).children = shape.children.map((child, index) =>
    buildTemplates(child, shape.kind === 'group' ? `k${index}` : undefined, template, all),
  );
  return template;
}

/** The key of an item's raw value: its first field. */
const keyOf = (value: unknown): unknown => own(value, 'k0');

/**
 * `value` as the form holds it, read as `set` reads a value: or the error that reading it throws, in the order the
 * form reads.
 */
function normalize(template: Template, value: unknown): unknown {
  const { kind } = template.shape;
  if (kind === 'field') {
    return value;
  }
  if (kind === 'group') {
    if (!isObject(value)) {
      throw new TypeError('a group is set to an object');
    }
    return Object.fromEntries(template.children.map((child) => [child.key!, normalize(child, own(value, child.key!))]));
  }
  if (!Array.isArray(value)) {
    throw new TypeError('an array is set to an array');
  }
  if (value.length > MAX_LENGTH) {
    throw new RangeError('too many items');
  }
  const seen = new Set<unknown>();
  return value.map((_, index) => {
    const item = own(value, index);
    if (template.identity) {
      const key = keyOf(item);
      if (isBlank(key) || seen.has(key)) {
        throw new TypeError('a key blank or taken');
      }
      seen.add(key);
    }
    return normalize(template.children[0]!, item);
  });
}

/** The initial raw value of a node of the description. */
function initialOf(template: Template): unknown {
  const { kind } = template.shape;
  if (kind === 'field') {
    return template.shape.initial;
  }
  return kind === 'group'
    ? Object.fromEntries(template.children.map((child) => [child.key!, initialOf(child)]))
    : template.start;
}

/**
 * The description of a node, with the schema that records every question it is asked, and the validator that records
 * every run, its answer later ones released by `scheduler`: a promise, one that rejects as soon as its signal aborts,
 * or a thenable that calls back twice, the second time with another answer.
 */
function specOf(
  template: Template,
  asked: Asked[],
  calls: Called[],
  scheduler: fc.Scheduler,
  ruleCalls: RuleCall[],
): Spec {
  const { shape } = template;
  const options: {
    rules?: Rule[];
    schema?: StandardSchema;
    disabled?: { reads: Segment[][]; when: (...values: unknown[]) => boolean };
    validate?: (value: unknown, validation: Validation) => readonly Issue[] | PromiseLike<readonly Issue[]>;
  } = {};
  if (shape.validator) {
    const kind = shape.validator;
    options.validate = ((value: unknown, { signal, path }: Validation): unknown => {
      const call: Called = { template: template.id, path: JSON.stringify(path), value, signal, released: false };
      calls.push(call);
      const outcome = outcomeOf(template, value);
      const list =
        outcome.kind === 'issues'
          ? outcome.issues.map((issue) => ({
              code: 'law.validator',
              path: issue.path,
              params: { message: issue.message },
            }))
          : [];
      if (!later(kind, value)) {
        call.released = true;
        return outcome.kind === 'failed' ? NOT_A_LIST : list;
      }
      const released = scheduler.schedule(Promise.resolve(), call.path).then(() => {
        call.released = true;
      });
      const failure = (): Error => new Error('vno');
      if (kind === 'thenable') {
        return {
          then(resolve: (value: unknown) => void, reject: (reason: unknown) => void): void {
            void released.then(() => {
              if (outcome.kind === 'failed') {
                reject(failure());
                resolve(list);
              } else {
                resolve(list);
                resolve([{ code: 'law.twice', path: [] }]);
                reject(new Error('twice'));
              }
            });
          },
        };
      }
      if (kind === 'abortable') {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          void released.then(() => (outcome.kind === 'failed' ? reject(failure()) : resolve(list)));
        });
      }
      return released.then(() => {
        if (outcome.kind === 'failed') {
          throw failure();
        }
        return list;
      });
    }) as never;
  }
  if (shape.schema === 'keyed') {
    options.schema = {
      '~standard': { version: 1, vendor: 'yaltaan', validate: () => ({ issues: [{ message: 'unused' }] }) },
      '~run': (value: unknown, reading: { issues: Issue[] }) => {
        asked.push({ template: template.id, value, settle: undefined, settled: true });
        const answer = keyedAnswer(value);
        for (const issue of answer.issues) {
          reading.issues.push({ code: 'law.keyed', path: issue.path as Issue['path'], params: { message: 'keyed' } });
        }
        return answer.value;
      },
    } as unknown as StandardSchema;
  } else if (shape.schema) {
    const kind = shape.schema;
    options.schema = {
      '~standard': {
        version: 1,
        vendor: 'law',
        validate: (value: unknown) => {
          if (!isAsync(kind, value)) {
            asked.push({ template: template.id, value, settle: undefined, settled: true });
            return answerOf(template, value) as StandardResult<unknown>;
          }
          return new Promise((resolve, reject) => {
            const settle = (how: 'resolve' | 'reject'): void =>
              how === 'resolve'
                ? resolve(answerOf(template, value) as StandardResult<unknown>)
                : reject(new Error('no'));
            asked.push({ template: template.id, value, settle, settled: false });
          });
        },
      },
    };
  }
  if (shape.condition) {
    const { salt } = shape.condition;
    options.disabled = {
      reads: template.reads.map((read) => [...read.path]),
      when: (...values) => holds(values, salt),
    };
  }
  if (template.rules.length) {
    const record = (rule: number, kind: RuleCall['kind'], values: unknown): void => {
      ruleCalls.push({ template: template.id, rule, kind, seen: seenOf(values, template.rules[rule]!.declared) });
    };
    options.rules = template.rules.map((rule, index): Rule => ({
      reads: rule.declared as Path[],
      targets: [],
      check: (values) => {
        record(index, 'check', values);
        return ruleSays(values, rule);
      },
      ...(rule.required
        ? {
            required: (values: unknown) => {
              record(index, 'required', values);
              return ruleNeeds(values, rule);
            },
          }
        : {}),
    }));
  }
  if (shape.kind === 'field') {
    return field(shape.initial, options);
  }
  if (shape.kind === 'group') {
    return group(
      Object.fromEntries(
        template.children.map((child) => [child.key!, specOf(child, asked, calls, scheduler, ruleCalls)]),
      ),
      options,
    );
  }
  return array(specOf(template.children[0]!, asked, calls, scheduler, ruleCalls), {
    ...options,
    initial: template.start,
    maxLength: MAX_LENGTH,
    ...(template.identity ? { identity: ['k0'] } : {}),
  } as never);
}

interface Plain {
  readonly code: string;
  readonly path: readonly unknown[];
  readonly message: unknown;
  /** The schema's own issue, with the index it gave; the message of a rejection. */
  readonly cause: unknown;
}

type PlainResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: Plain[] };

function sameIdentity(a: Identity, b: Identity): boolean {
  if ('leaf' in a) {
    return 'leaf' in b && Object.is(a.leaf, b.leaf);
  }
  if ('group' in a) {
    return 'group' in b && a.group.length === b.group.length && a.group.every((x, i) => sameIdentity(x, b.group[i]!));
  }
  return (
    'list' in b &&
    a.revision === b.revision &&
    a.list.length === b.list.length &&
    a.list.every(([id, x], i) => id === b.list[i]![0] && sameIdentity(x, b.list[i]![1]))
  );
}

/** The naive model: every state from the plain values, at each look. */
class Naive {
  readonly requests = new Map<number, Request[]>();
  /** The runs of each validator, by the node of the model. */
  readonly runs = new Map<number, Run[]>();
  /** How many items holding a validator came back into the form after they left it. */
  restored = 0;
  /** How many looks found a run kept while a schema had not answered. */
  kept = 0;
  /** How many looks found a validator held back by the issues of rules alone. */
  heldByRules = 0;
  /** Every node ever built, by id. */
  readonly built: Model[] = [];
  readonly root: Model;
  submitted = false;

  constructor(template: Template) {
    this.root = this.instantiate(template, initialOf(template), undefined);
  }

  /** A node built from `value`, its raw value as the form holds it. */
  instantiate(template: Template, value: unknown, parent: Model | undefined): Model {
    const model: Model = {
      id: this.built.length,
      template,
      parent,
      children: [],
      items: [],
      revision: 0,
      first: [],
      start: undefined,
      key: parent?.template.shape.kind === 'array' ? UNSET : undefined,
      raw: value,
      initial: value,
      touched: false,
      life: 0,
      out: false,
      current: undefined,
      checked: [],
      needed: [],
    };
    this.built.push(model);
    const { kind } = template.shape;
    if (kind === 'group') {
      (model as unknown as { children: Model[] }).children = template.children.map((child) =>
        this.instantiate(child, own(value, child.key!), model),
      );
    } else if (kind === 'array') {
      model.items = (value as unknown[]).map((item) => this.instantiate(template.children[0]!, item, model));
      model.first = model.items;
      model.start = value;
    }
    return model;
  }

  /** Every node of the tree: the root, then depth first, children and items in order. */
  nodes(model = this.root, into: Model[] = []): Model[] {
    into.push(model);
    for (const child of model.template.shape.kind === 'array' ? model.items : model.children) {
      this.nodes(child, into);
    }
    return into;
  }

  /**
   * Gives an array other items: a new raw value, even when a later write of the batch gives the old ones back; an item
   * that leaves, or comes back, starts another life.
   */
  relist(model: Model, items: Model[]): void {
    if (items.length !== model.items.length || items.some((item, index) => item !== model.items[index])) {
      for (const item of model.items) {
        if (!items.includes(item)) {
          item.life++;
          item.out = true;
        }
      }
      for (const item of items) {
        if (item.out) {
          item.life++;
          item.out = false;
          this.restored += this.nodes(item).some((node) => node.template.shape.validator) ? 1 : 0;
        }
      }
      model.items = items;
      model.revision++;
    }
  }

  /** The lives of the items on the way to `model`, as its validator reads them. */
  lifeOf(model: Model): string {
    const lives: string[] = [];
    for (let at = model; at.parent; at = at.parent) {
      if (at.parent.template.shape.kind === 'array') {
        lives.push(`${at.life}${at.out ? ' out' : ''}`);
      }
    }
    return lives.join(',');
  }

  schemaPending(model: Model): boolean {
    return model.template.shape.schema !== null && this.answer(model) === undefined;
  }

  /**
   * What a validator of `model` may do: 2 while a schema or a rule has placed an issue that is not a warning on the
   * node or below (it stops), 1 while a schema of the node, of a node below or of an ancestor has not answered (it
   * waits), 0 otherwise (it runs).
   */
  gate(model: Model): 0 | 1 | 2 {
    const below = this.nodes(model);
    if (below.some((node) => this.issues(node, 'gate').length > 0)) {
      this.heldByRules += below.every((node) => this.answered(node, node, 'gate').length === 0) ? 1 : 0;
      return 2;
    }
    let pending = below.some((node) => this.schemaPending(node));
    for (let at = model.parent; at; at = at.parent) {
      pending ||= this.schemaPending(at);
    }
    return pending ? 1 : 0;
  }

  /**
   * Applies the rules of a validator at each look, for the tree and for the nodes that left it since the last look: the
   * run that counts is dropped when a schema places an issue, when its node is out of the form, or when its raw value
   * or the lives of its items are no longer those it was asked for, and must then be aborted if still in flight; a new
   * run starts when none counts, no schema may still place an issue and the node is in the form. A schema that has not
   * answered keeps the run that counts as it is.
   */
  check(departed: readonly Model[]): void {
    for (const model of [...this.nodes(), ...departed]) {
      const { validator } = model.template.shape;
      if (!validator) {
        continue;
      }
      const gate = this.gate(model);
      const attached = this.attached(model);
      const identity = this.identity(model);
      const life = this.lifeOf(model);
      const run = model.current;
      if (run && (gate === 2 || !attached || !sameIdentity(run.identity, identity) || run.life !== life)) {
        run.aborted = !run.settled;
        model.current = undefined;
      }
      if (run && model.current && gate === 1) {
        this.kept++;
      }
      const runs = this.runs.get(model.id) ?? [];
      this.runs.set(model.id, runs);
      if (!model.current && gate === 0 && attached) {
        const value = this.raw(model);
        model.current = {
          value,
          identity,
          life,
          outcome: outcomeOf(model.template, value),
          settled: !later(validator, value),
          aborted: false,
        };
        runs.push(model.current);
      }
    }
  }

  /** Whether `model` is still in the tree: every item on its way is among the items of its array. */
  attached(model: Model): boolean {
    for (let at = model; at.parent; at = at.parent) {
      if (at.parent.template.shape.kind === 'array' && !at.parent.items.includes(at)) {
        return false;
      }
    }
    return true;
  }

  pathOf(model: Model): readonly unknown[] {
    if (!model.parent) {
      return [];
    }
    return [...this.pathOf(model.parent), model.template.key ?? { key: model.key }];
  }

  raw(model: Model): unknown {
    const { kind } = model.template.shape;
    if (kind === 'field') {
      return model.raw;
    }
    return kind === 'group'
      ? Object.fromEntries(model.children.map((child) => [child.template.key!, this.raw(child)]))
      : model.items.map((item) => this.raw(item));
  }

  identity(model: Model): Identity {
    const { kind } = model.template.shape;
    if (kind === 'field') {
      return { leaf: model.raw };
    }
    return kind === 'group'
      ? { group: model.children.map((child) => this.identity(child)) }
      : { list: model.items.map((item) => [item.id, this.identity(item)] as const), revision: model.revision };
  }

  dirty(model: Model): boolean {
    const { kind } = model.template.shape;
    if (kind === 'field') {
      return !isDeepStrictEqual(model.raw, model.initial);
    }
    return kind === 'group'
      ? model.children.some((child) => this.dirty(child))
      : !isDeepStrictEqual(model.start, this.raw(model));
  }

  touched(model: Model): boolean {
    const { kind } = model.template.shape;
    if (kind === 'field') {
      return model.touched;
    }
    return (kind === 'group' ? model.children : model.items).some((child) => this.touched(child));
  }

  /** The node a condition of `from` reads: `template`, through the items that hold `from`. */
  resolve(template: Template, from: Model): Model {
    let model = this.root;
    for (const segment of template.path) {
      if (typeof segment === 'string') {
        model = model.children[Number(segment.slice(1))]!;
      } else {
        let at: Model = from;
        while (at.parent !== model) {
          at = at.parent!;
        }
        model = at;
      }
    }
    return model;
  }

  disabled(model: Model): boolean {
    const { condition } = model.template.shape;
    const values = model.template.reads.map((read) => this.raw(this.resolve(read, model)));
    return (condition !== null && holds(values, condition.salt)) || (!!model.parent && this.disabled(model.parent));
  }

  /**
   * Records the question a schema is asked when its node's value changed since the last one: called at each look, for
   * the tree and for the nodes `gone` from it since the last look, whose listeners read them until then.
   */
  ask(gone: readonly Model[]): void {
    for (const model of [...this.nodes(), ...gone]) {
      const { schema } = model.template.shape;
      if (schema) {
        const value = this.raw(model);
        const identity = this.identity(model);
        const requests = this.requests.get(model.id) ?? [];
        this.requests.set(model.id, requests);
        const last = requests.at(-1);
        if (last === undefined || !sameIdentity(last.identity, identity)) {
          const settled = schema !== 'keyed' && isAsync(schema, value) ? undefined : 'resolved';
          requests.push({ value, identity, answer: answerOf(model.template, value), settled });
        }
      }
    }
  }

  /** The issues and the output of a node's schema now, as the form reads them; `undefined` while pending. */
  answer(
    model: Model,
  ):
    { readonly issues: readonly Raised[] | 'failed'; readonly output?: unknown; readonly cause?: unknown } | undefined {
    const request = this.requests.get(model.id)!.at(-1)!;
    if (request.settled === undefined) {
      return undefined;
    }
    const { answer } = request;
    if ('keyed' in answer) {
      return answer.issues.length ? { issues: answer.issues } : { issues: [], output: answer.value };
    }
    if (request.settled === 'rejected' || answer.issues?.length === 0) {
      return { issues: 'failed', cause: request.settled === 'rejected' ? 'no' : undefined };
    }
    return answer.issues ? { issues: answer.issues as Raised[] } : { issues: [], output: answer.value };
  }

  /**
   * What places issues on a node and holds it pending: its schema's answer while it has not answered or found issues,
   * then its validator's run that counts, if any; `undefined` while pending.
   */
  combined(model: Model):
    | {
        readonly issues: readonly Raised[] | 'failed';
        readonly cause?: unknown;
        readonly validator?: true;
      }
    | undefined {
    const { schema, validator } = model.template.shape;
    const first = schema ? this.answer(model) : { issues: [] };
    if (first === undefined || first.issues === 'failed' || first.issues.length || !validator || !model.current) {
      return first;
    }
    const { settled, outcome } = model.current;
    if (!settled) {
      return undefined;
    }
    return outcome.kind === 'issues'
      ? { issues: outcome.issues, validator: true }
      : outcome.kind === 'failed'
        ? {
            issues: 'failed',
            cause: later(validator, model.current.value) ? outcome.cause : NOT_A_LIST,
            validator: true,
          }
        : first;
  }

  ownPending(model: Model): boolean {
    const { schema, validator } = model.template.shape;
    return (schema !== null || validator !== null) && this.combined(model) === undefined;
  }

  under(model: Model): readonly Model[] {
    return model.template.shape.kind === 'array' ? model.items : model.children;
  }

  pending(model: Model): boolean {
    const below = (node: Model): boolean => this.ownPending(node) || this.under(node).some(below);
    let above = false;
    for (let at = model.parent; at; at = at.parent) {
      above ||= this.ownPending(at);
    }
    return above || below(model);
  }

  /**
   * The issues placed on `model`, as plain data, the outermost node first, its schema or validator before its rules:
   * all of them, or only what holds a validator back, the schemas' issues and the rules' that are not warnings.
   */
  issues(model: Model, by: 'shown' | 'gate' = 'shown'): Plain[] {
    const ancestors: Model[] = [];
    for (let at: Model | undefined = model; at; at = at.parent) {
      ancestors.unshift(at);
    }
    const placed: Plain[] = [];
    for (const owner of ancestors) {
      placed.push(...this.answered(owner, model, by));
      for (const rule of owner.template.rules) {
        const read = this.view(owner);
        for (const issue of ruleSays(read, rule)) {
          const [target, path] = this.place(owner, read, issue.path, rule);
          if (target === model && (by === 'shown' || issue.code !== 'law.warning')) {
            placed.push({ code: issue.code, path, message: issue.params?.['message'], cause: undefined });
          }
        }
      }
    }
    return placed;
  }

  /** The issues the schema or the validator of `owner` places on `model`. */
  answered(owner: Model, model: Model, by: 'shown' | 'gate'): Plain[] {
    const { schema, validator } = owner.template.shape;
    const answer =
      by === 'gate'
        ? schema
          ? this.answer(owner)
          : undefined
        : schema || validator
          ? this.combined(owner)
          : undefined;
    const placed: Plain[] = [];
    if (answer?.issues === 'failed') {
      if (owner === model) {
        placed.push({
          code: 'form.validation_failed',
          path: this.pathOf(owner),
          message: undefined,
          cause: answer.cause,
        });
      }
      return placed;
    }
    const own = answer !== undefined && 'validator' in answer;
    const keyed = own || owner.template.shape.schema === 'keyed';
    for (const issue of answer?.issues ?? []) {
      // The Standard Schema interface reads a `{ key }` segment as the key it holds.
      const relative: unknown[] = (issue.path ?? []).map((segment) =>
        !keyed && typeof segment === 'object' ? (segment as { key: PropertyKey }).key : segment,
      );
      let target = owner;
      for (const [at, segment] of relative.entries()) {
        let next: Model | undefined;
        if (target.template.shape.kind === 'array') {
          next =
            typeof segment === 'number'
              ? target.items[segment]
              : isObject(segment)
                ? target.items.find((item) =>
                    new Set([target.template.identity ? keyOf(this.raw(item)) : item.key]).has(segment['key']),
                  )
                : undefined;
          if (next) {
            relative[at] = { key: next.key };
          }
        } else if (target.template.shape.kind === 'group') {
          next = target.children.find((child) => child.template.key === segment);
        }
        if (next === undefined) {
          break;
        }
        target = next;
      }
      if (target === model) {
        placed.push({
          code: own ? 'law.validator' : keyed ? 'law.keyed' : 'issue.external',
          path: [...this.pathOf(owner), ...relative],
          message: issue.message,
          cause: keyed ? undefined : issue,
        });
      }
    }
    return placed;
  }

  /** What a rule of `model` reads: the raw value of its node, through the paths it declares only. */
  view(model: Model): unknown {
    return this.raw(model);
  }

  /** What a path of a rule reaches, by identity: each field at its end, and the items of every array on its way. */
  reached(model: Model, path: readonly Declared[], at = 0): Identity {
    const { kind } = model.template.shape;
    if (at === path.length || kind === 'field') {
      return this.identity(model);
    }
    if (kind === 'group') {
      return this.reached(
        model.children.find((child) => child.template.key === path[at])!,
        path,
        at + 1,
      );
    }
    return {
      list: model.items.map((item) => [item.id, this.reached(item, path, at + 1)] as const),
      revision: model.revision,
    };
  }

  /**
   * The node a path a rule of `owner` gives names, from what the rule read, and the path from the root with each item
   * by its key: a child by its key, an item by its index or `{ key }` in the list the rule read, the key its value
   * holds at `k0` as the rule read it, or without `identity`, the form's key.
   */
  place(owner: Model, read: unknown, path: Path, rule: LawRule): [Model, unknown[]] {
    const relative: unknown[] = [...path];
    // The places walked, an item by its index in what the rule read.
    const walked: unknown[] = [];
    let target = owner;
    let value = read;
    for (const [at, segment] of relative.entries()) {
      let next: Model | undefined;
      const { kind } = target.template.shape;
      if (kind === 'array' && Array.isArray(value)) {
        const list: unknown[] = value;
        const index =
          typeof segment === 'number'
            ? segment
            : isObject(segment)
              ? target.template.identity
                ? list.findIndex(
                    (item, place) =>
                      covers(rule.declared, [...walked, place, 'k0']) && new Set([own(item, 'k0')]).has(segment['key']),
                  )
                : target.items.findIndex((item) => new Set([item.key]).has(segment['key']))
              : -1;
        next = target.items[index];
        if (next) {
          relative[at] = { key: next.key };
          value = list[index];
          walked.push(index);
        }
      } else if (kind === 'group' && typeof segment === 'string') {
        next = target.children.find((child) => child.template.key === segment);
        value = own(value, segment);
        walked.push(segment);
      }
      if (next === undefined) {
        break;
      }
      target = next;
    }
    return [target, [...this.pathOf(owner), ...relative]];
  }

  /** Whether a rule of the node or of an ancestor requires `model`, by what it requires of what it read. */
  required(model: Model): boolean {
    for (let owner: Model | undefined = model; owner; owner = owner.parent) {
      for (const rule of owner.template.rules) {
        if (rule.required) {
          const read = this.view(owner);
          if (ruleNeeds(read, rule).some((path) => this.place(owner!, read, path, rule)[0] === model)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * The calls of the rules a look must have made, each as its node of the description, its rule, `check` or
   * `required`, and what it read: one for each rule of a node in the tree whose fields at the end of its paths, or
   * the items of an array on its way, are not those of its last call, every state being read at each look; the same
   * for the nodes `gone` from the tree since the last look, whose listeners kept them up to date until then.
   */
  calls(gone: readonly Model[]): string[] {
    const due: string[] = [];
    for (const model of [...this.nodes(), ...gone]) {
      model.template.rules.forEach((rule, index) => {
        const print: Identity = { group: rule.declared.map((path) => this.reached(model, path)) };
        for (const [kind, last] of [
          ['check', model.checked],
          ...(rule.required ? [['required', model.needed] as const] : []),
        ] as const) {
          if (last[index] === undefined || !sameIdentity(last[index], print)) {
            last[index] = print;
            due.push(`${model.template.id}:${index}:${kind} ${seenOf(this.view(model), rule.declared)}`);
          }
        }
      });
    }
    return due;
  }

  allIssues(model: Model): Plain[] {
    return [...this.issues(model), ...this.under(model).flatMap((child) => this.allIssues(child))];
  }

  output(model: Model): unknown {
    const { kind, schema } = model.template.shape;
    if (schema) {
      return this.answer(model)?.output;
    }
    if (kind === 'field') {
      return model.raw;
    }
    return kind === 'group'
      ? Object.fromEntries(model.children.map((child) => [child.template.key!, this.output(child)]))
      : model.items.map((item) => this.output(item));
  }

  /** The identity of the read value: a schema's output is the one recorded with its question. */
  outputIdentity(model: Model): Identity {
    const { kind, schema } = model.template.shape;
    if (schema) {
      return { leaf: this.answer(model)?.output };
    }
    if (kind === 'field') {
      return { leaf: model.raw };
    }
    return kind === 'group'
      ? { group: model.children.map((child) => this.outputIdentity(child)) }
      : {
          list: model.items.map((item) => [item.id, this.outputIdentity(item)] as const),
          revision: model.revision,
        };
  }

  parsed(model: Model): PlainResult {
    const errors = this.allIssues(model);
    return errors.some((issue) => issue.code !== 'law.warning') || this.pending(model)
      ? { ok: false, error: errors }
      : { ok: true, value: this.output(model) };
  }

  fields(model: Model): Model[] {
    return model.template.shape.kind === 'field' ? [model] : this.under(model).flatMap((child) => this.fields(child));
  }

  /**
   * Notes in `ops` what writing `value` at `model` does, mode by mode as the form documents them, and returns the value
   * as the form holds it; throws what the form throws, before anything is noted as done.
   */
  plan(model: Model, value: unknown, mode: 'set' | 'reset' | 'restore', ops: (() => void)[]): unknown {
    const { template } = model;
    const { kind } = template.shape;
    const restore = mode === 'restore';
    if (kind === 'field') {
      ops.push(() => {
        if (mode === 'reset') {
          model.initial = value;
        }
        model.raw = mode === 'set' ? value : model.initial;
        model.touched &&= mode === 'set';
      });
      return restore ? model.initial : value;
    }
    if (kind === 'group') {
      if (!restore && !isObject(value)) {
        throw new TypeError('a group is set to an object');
      }
      return Object.fromEntries(
        model.children.map((child) => [
          child.template.key!,
          this.plan(child, own(value, child.template.key!), mode, ops),
        ]),
      );
    }
    if (restore) {
      const values = model.first.map((item) => this.plan(item, undefined, mode, ops));
      ops.push(() => {
        this.relist(model, [...model.first]);
        model.start = values;
      });
      return values;
    }
    if (!Array.isArray(value)) {
      throw new TypeError('an array is set to an array');
    }
    if (value.length > MAX_LENGTH) {
      throw new RangeError('too many items');
    }
    const seen = new Set<unknown>();
    const values: unknown[] = [];
    const entries = value.map((_, index): Model | { readonly value: unknown } => {
      const item = own(value, index);
      let found = model.items[index];
      if (template.identity) {
        const key = keyOf(item);
        if (isBlank(key) || seen.has(key)) {
          throw new TypeError('a key blank or taken');
        }
        seen.add(key);
        // The key each item's value holds now, the last item winning, as a map built from the items keeps it.
        found = model.items.findLast((candidate) => new Set([keyOf(this.raw(candidate))]).has(key));
      }
      values.push(found ? this.plan(found, item, mode, ops) : normalize(template.children[0]!, item));
      return found ?? { value: values[index] };
    });
    ops.push(() => {
      this.relist(
        model,
        entries.map((entry) =>
          'id' in entry ? (entry as Model) : this.instantiate(template.children[0]!, entry.value, model),
        ),
      );
      if (mode === 'reset') {
        model.first = model.items;
        model.start = values;
      }
    });
    return values;
  }

  /** Applies a write to the node it was resolved to, or returns the error it throws, nothing written. */
  apply(write: Resolved, nodes: readonly Model[]): Error | undefined {
    const model = nodes[write.target]!;
    try {
      switch (write.kind) {
        case 'touch':
          this.fields(model).forEach((target) => (target.touched = true));
          return undefined;
        case 'set':
        case 'reset': {
          const ops: (() => void)[] = [];
          const mode = write.kind === 'set' ? 'set' : write.value === undefined ? 'restore' : 'reset';
          this.plan(model, write.value, mode, ops);
          ops.forEach((op) => op());
          if (write.kind === 'reset' && model === this.root) {
            this.submitted = false;
          }
          return undefined;
        }
        case 'insert': {
          const { items } = model;
          if (write.index > items.length || items.length >= MAX_LENGTH) {
            throw new RangeError('an index out of range, or too many items');
          }
          const element = model.template.children[0]!;
          const value = write.value === undefined ? initialOf(element) : normalize(element, write.value);
          if (model.template.identity) {
            const key = keyOf(value);
            if (isBlank(key) || items.some((item) => new Set([keyOf(this.raw(item))]).has(key))) {
              throw new TypeError('a key blank or taken');
            }
          }
          this.relist(model, items.toSpliced(write.index, 0, this.instantiate(element, value, model)));
          return undefined;
        }
        case 'remove': {
          const item = model.items[write.item % Math.max(1, model.items.length)];
          if (item) {
            this.relist(
              model,
              model.items.filter((other) => other !== item),
            );
          }
          return undefined;
        }
        case 'move': {
          const { items } = model;
          if (write.to > items.length - 1) {
            throw new RangeError('an index out of range');
          }
          const item = items[write.item % items.length]!;
          this.relist(model, items.filter((other) => other !== item).toSpliced(write.to, 0, item));
          return undefined;
        }
      }
    } catch (error) {
      return error as Error;
    }
  }

  submit(): void {
    for (const target of this.fields(this.root)) {
      target.touched = true;
    }
    this.submitted = true;
  }
}

const plain = (issue: Issue): Plain => ({
  code: issue.code,
  path: issue.path as unknown[],
  message: issue.params?.['message'],
  cause: issue.cause instanceof Error ? issue.cause.message : issue.cause,
});

function plainResult(result: Result<unknown, readonly Issue[]>): PlainResult {
  return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.map(plain) };
}

/** The keys of every object of `value`, in order, beside its leaves: what `deepStrictEqual` does not compare. */
function order(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Array.isArray(value) ? value.map(order) : Object.entries(value).map(([key, inner]) => [key, order(inner)]);
}

const STATES = ['raw', 'dirty', 'touched', 'submitted', 'disabled', 'pending', 'issues', 'required', 'parsed'] as const;
type State = (typeof STATES)[number];

type AnyNode = FormNode<unknown, unknown> & {
  readonly kind: Kind;
  readonly key?: unknown;
  readonly children?: Record<string, AnyNode>;
  readonly items?: ReadableNode<readonly AnyNode[]>;
  insert(index: number, raw?: unknown): AnyNode;
  remove(item: AnyNode): boolean;
  move(item: AnyNode, index: number): boolean;
};

/** Every node of the form: the root, then depth first, children and items in order. */
function nodesOf(node: AnyNode, into: AnyNode[] = []): AnyNode[] {
  into.push(node);
  for (const child of node.items?.get() ?? Object.values(node.children ?? {})) {
    nodesOf(child, into);
  }
  return into;
}

function expected(naive: Naive, model: Model, state: State): unknown {
  switch (state) {
    case 'raw':
      return naive.raw(model);
    case 'dirty':
      return naive.dirty(model);
    case 'touched':
      return naive.touched(model);
    case 'submitted':
      return naive.submitted;
    case 'disabled':
      return naive.disabled(model);
    case 'pending':
      return naive.pending(model);
    case 'issues':
      return naive.issues(model);
    case 'required':
      return naive.required(model);
    case 'parsed':
      return naive.parsed(model);
  }
}

/** What tells a change of `state` to its listener, in the model: see the header. */
function seenBy(naive: Naive, model: Model, state: State, value: unknown): unknown {
  if (state === 'raw') {
    return naive.identity(model);
  }
  if (state === 'parsed') {
    const parsed = value as PlainResult;
    return parsed.ok ? { ok: true, identity: naive.outputIdentity(model) } : parsed;
  }
  return value;
}

function changed(state: State, before: unknown, after: unknown): boolean {
  if (state === 'raw') {
    return !sameIdentity(before as Identity, after as Identity);
  }
  const [a, b] = [before as { ok?: boolean; identity?: Identity }, after as { ok?: boolean; identity?: Identity }];
  if (state === 'parsed' && a.ok && b.ok) {
    return !sameIdentity(a.identity!, b.identity!);
  }
  return !isDeepStrictEqual(before, after);
}

function actual(node: AnyNode, state: State): unknown {
  const value = (node[state] as ReadableNode<unknown>).get();
  if (state === 'issues') {
    return (value as readonly Issue[]).map(plain);
  }
  return state === 'parsed' ? plainResult(value as Result<unknown, readonly Issue[]>) : value;
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface Counts {
  validations: number;
  /** Runs of validators, those aborted, and those released after their abort. */
  runs: number;
  aborted: number;
  abortedOut: number;
  releasedAborted: number;
  validatorIssues: number;
  restored: number;
  kept: number;
  settledLate: number;
  rejected: number;
  notifications: number;
  thrown: number;
  pendingSeen: number;
  failedSeen: number;
  inserted: number;
  removed: number;
  moved: number;
  movedWithIssues: number;
  keyedIssues: number;
  mostItems: number;
  ruleCalls: number;
  ruleIssues: number;
  warnings: number;
  requiredSeen: number;
  heldByRules: number;
}

function resolveWrite(write: Write, nodes: readonly Model[]): Resolved {
  const arrays = nodes.flatMap((model, index) => (model.template.shape.kind === 'array' ? [index] : []));
  const target =
    write.kind === 'insert' || write.kind === 'remove' || write.kind === 'move'
      ? (arrays[write.node % Math.max(1, arrays.length)] ?? -1)
      : write.node % nodes.length;
  if (write.kind === 'touch' || write.kind === 'remove' || write.kind === 'move' || target < 0) {
    return { ...write, target };
  }
  const template = nodes[target]!.template;
  const shape = write.kind === 'insert' ? template.children[0]! : template;
  return { ...write, target, value: write.seed ? given(valueOf(shape, write.seed)) : undefined };
}

function applyTo(nodes: readonly AnyNode[], write: Resolved): void {
  const node = nodes[write.target]!;
  switch (write.kind) {
    case 'touch':
      node.touch();
      break;
    case 'set':
      node.set(write.value);
      break;
    case 'reset':
      node.reset(write.value);
      break;
    case 'insert':
      node.insert(write.index, write.value);
      break;
    case 'remove': {
      const items = node.items!.get();
      const item = items[write.item % Math.max(1, items.length)];
      if (item) {
        assert.equal(node.remove(item), true, 'remove of an item');
      }
      break;
    }
    case 'move': {
      const items = node.items!.get();
      const item = items[write.item % Math.max(1, items.length)] ?? node;
      node.move(item, write.to);
      break;
    }
  }
}

async function run(program: Program, scheduler: fc.Scheduler, counts: Counts): Promise<void> {
  const templates: Template[] = [];
  const top = buildTemplates(program.root, undefined, undefined, templates);
  for (const template of templates) {
    const candidates = templates.filter((other) => other.arrays.every((outer) => template.arrays.includes(outer)));
    template.reads = (template.shape.condition?.reads ?? []).map((read) => candidates[read % candidates.length]!);
    // A rule reads nodes at or below its own: every item of an array, or the item of an index, which the form reads
    // as every item; now and then a place in the list a field may hold.
    const below = templates.filter((other) => {
      for (let at: Template | undefined = other; at; at = at.parent) {
        if (at === template) {
          return true;
        }
      }
      return false;
    });
    template.rules = template.shape.rules.map(({ reads, salt, required }) => ({
      salt,
      required,
      declared: reads.map((read) => {
        const target = below[read % below.length]!;
        const relative = target.path
          .slice(template.path.length)
          .map((segment): Declared => (typeof segment === 'string' ? segment : read % 3 === 1 ? 0 : ANY));
        return target.shape.kind === 'field' && read % 5 === 4 ? [...relative, 0] : relative;
      }),
    }));
  }
  // Initial lists from the innermost arrays out, each read as the form reads it, or none when the seed gives none.
  for (const template of [...templates].reverse()) {
    if (template.shape.kind === 'array') {
      try {
        template.start = normalize(template, given(valueOf(template, template.shape.start))) as unknown[];
      } catch {
        template.start = [];
      }
    }
  }
  const asked: Asked[] = [];
  const made: Called[] = [];
  const ruled: RuleCall[] = [];
  let ruledHeard = 0;
  const form = createForm(specOf(top, asked, made, scheduler, ruled)) as unknown as AnyNode & {
    readonly graph: { batch(run: () => void): void };
    submit(): unknown;
  };
  const naive = new Naive(top);
  // What the form asked, by the node of the model that asked it.
  const askedBy = new Map<number, Asked[]>();
  let attributed = 0;
  // The runs of the validators, by the node of the model that made them.
  const calledBy = new Map<number, Called[]>();
  let heard = 0;
  const calls = new Map<AnyNode, Map<State, number>>();
  // The listeners of each node watched, until a look finds it out of the tree.
  const watched = new Map<AnyNode, (() => void)[]>();
  const watch = (node: AnyNode): void => {
    const counts = new Map<State, number>();
    calls.set(node, counts);
    watched.set(
      node,
      STATES.map((state) =>
        (node[state] as ReadableNode<unknown>).subscribe(() => counts.set(state, (counts.get(state) ?? 0) + 1)),
      ),
    );
  };
  const modelOf = new Map<AnyNode, Model>();
  const generated = new Set<unknown>();
  let previous = new Map<AnyNode, Map<State, unknown>>();
  let pairs: [AnyNode, Model][] = [];
  // The nodes of the last look, in the tree or just out of it.
  let looked: (readonly [AnyNode, Model])[] = [];
  // After a look and a turn of the event loop (a signal aborts on the next microtask, out of any computation): the
  // signal of each run is aborted exactly when the model says the form had to abort it.
  const signals = async (label: string): Promise<void> => {
    await tick();
    for (const [node, model] of looked) {
      const runs = naive.runs.get(model.id) ?? [];
      (calledBy.get(model.id) ?? []).forEach((call, index) => {
        assert.equal(
          call.signal.aborted,
          runs[index]!.aborted,
          `${label}: run ${index} of the validator of ${JSON.stringify(node.path)} ` +
            (runs[index]!.aborted ? 'aborted' : 'not aborted'),
        );
      });
    }
  };
  const look = (label: string): void => {
    const nodes = nodesOf(form);
    const models = naive.nodes();
    assert.equal(nodes.length, models.length, `${label}: number of nodes`);
    // The nodes that left the tree since the last look, watched or not: their validators must have been aborted.
    const departed = pairs.filter(([node]) => !nodes.includes(node));
    pairs = nodes.map((node, index) => [node, models[index]!]);
    const gone = [...watched.keys()]
      .filter((node) => !nodes.includes(node))
      .map((node) => [node, modelOf.get(node)!] as const);
    for (const [node, model] of pairs) {
      modelOf.set(node, model);
      assert.equal(node.kind, model.template.shape.kind, `${label}: kind of a node`);
      if (model.key === UNSET) {
        assert.ok(!generated.has(node.key), `${label}: key ${String(node.key)} given twice`);
        generated.add(node.key);
        model.key = node.key;
      }
      assert.ok(Object.is(node.key, model.key), `${label}: key of ${naive.pathOf(model).join('.')}`);
      assert.deepStrictEqual(node.path, naive.pathOf(model), `${label}: path`);
      if (model.template.shape.kind === 'array') {
        counts.mostItems = Math.max(counts.mostItems, model.items.length);
      }
    }
    if (program.watched) {
      for (const [node] of pairs) {
        if (!watched.has(node)) {
          watch(node);
        }
      }
    }
    naive.ask(gone.map(([, model]) => model));
    for (const [id, list] of calledBy) {
      list.forEach((call, index) => (naive.runs.get(id)![index]!.settled ||= call.released));
    }
    naive.check(departed.map(([, model]) => model));
    const seen = new Map<AnyNode, Map<State, unknown>>();
    for (const [node, model] of pairs) {
      const states = new Map<State, unknown>();
      seen.set(node, states);
      for (const state of STATES) {
        const want = expected(naive, model, state);
        const got = actual(node, state);
        const at = `${label}: ${state} of ${JSON.stringify(naive.pathOf(model))}`;
        assert.deepStrictEqual(got, want, at);
        assert.deepStrictEqual(order(got), order(want), `${at}, keys in order`);
        states.set(state, seenBy(naive, model, state, want));
        counts.pendingSeen += state === 'pending' && want === true ? 1 : 0;
        counts.requiredSeen += state === 'required' && want === true ? 1 : 0;
        if (state === 'issues') {
          const plainIssues = want as Plain[];
          counts.ruleIssues += plainIssues.filter((issue) => issue.code === 'law.rule').length;
          counts.warnings += plainIssues.filter((issue) => issue.code === 'law.warning').length;
          counts.failedSeen += plainIssues.some((issue) => issue.code === 'form.validation_failed') ? 1 : 0;
          counts.keyedIssues += plainIssues.filter((issue) => issue.code === 'law.keyed').length;
          counts.validatorIssues += plainIssues.filter((issue) => issue.code === 'law.validator').length;
        }
      }
    }
    // The calls of the rules: exactly those the model says are due, each with what it read, and no other.
    const due = naive.calls(gone.map(([, model]) => model));
    const heardRules = ruled.slice(ruledHeard).map((call) => `${call.template}:${call.rule}:${call.kind} ${call.seen}`);
    ruledHeard = ruled.length;
    assert.deepStrictEqual(heardRules.sort(), due.sort(), `${label}: calls of the rules`);
    counts.ruleCalls += due.length;
    // Who asked: the only node of a description outside arrays, or the node whose raw value is the value asked.
    const byRaw = new Map<unknown, Model>();
    for (const [node, model] of [...pairs, ...gone]) {
      if (model.template.shape.schema) {
        byRaw.set(model.template.arrays.length ? node.raw.get() : model.template.id, model);
      }
    }
    for (const request of asked.slice(attributed)) {
      const template = templates[request.template]!;
      const model = byRaw.get(template.arrays.length ? request.value : template.id);
      assert.ok(model?.template === template, `${label}: a question of the schema of node ${template.id} has its node`);
      askedBy.set(model.id, [...(askedBy.get(model.id) ?? []), request]);
    }
    attributed = asked.length;
    for (const [node, model] of [...pairs, ...gone]) {
      if (model.template.shape.schema) {
        const made = (askedBy.get(model.id) ?? []).map((request) => request.value);
        const want = naive.requests.get(model.id)!.map((request) => request.value);
        assert.deepStrictEqual(made, want, `${label}: questions asked of ${JSON.stringify(node.path)}`);
      }
    }
    // Who ran a validator: the node whose path it was handed, in the tree or just out of it.
    const byPath = new Map([...pairs, ...departed].map(([node, model]) => [JSON.stringify(node.path), model]));
    for (const call of made.slice(heard)) {
      const model = byPath.get(call.path);
      assert.ok(model?.template.id === call.template, `${label}: a run of the validator at ${call.path} has its node`);
      calledBy.set(model.id, [...(calledBy.get(model.id) ?? []), call]);
    }
    heard = made.length;
    for (const [node, model] of [...pairs, ...departed]) {
      if (model.template.shape.validator) {
        const list = calledBy.get(model.id) ?? [];
        const runs = naive.runs.get(model.id)!;
        assert.deepStrictEqual(
          list.map((call) => call.value),
          runs.map((expected) => expected.value),
          `${label}: runs of the validator of ${JSON.stringify(node.path)}`,
        );
      }
    }
    looked = [...pairs, ...departed];
    for (const [node] of gone) {
      watched.get(node)!.forEach((unsubscribe) => unsubscribe());
      watched.delete(node);
      calls.delete(node);
    }
    if (program.watched) {
      for (const [node, states] of seen) {
        const before = previous.get(node);
        if (!before) {
          continue;
        }
        for (const [state, value] of states) {
          const count = calls.get(node)!.get(state) ?? 0;
          const want: number = changed(state, before.get(state), value) ? 1 : 0;
          assert.equal(count, want, `${label}: calls of the listener of ${state} of ${node.path.join('.')}`);
          counts.notifications += count;
        }
      }
      for (const counted of calls.values()) {
        counted.clear();
      }
    }
    previous = seen;
  };
  look('built');
  await signals('built');
  for (const [index, step] of program.steps.entries()) {
    const label = `step ${index} ${JSON.stringify(step)}`;
    let thrown: unknown;
    let want: Error | undefined;
    if (step.kind === 'settle') {
      const owners = naive.built.filter((model) => (askedBy.get(model.id) ?? []).some((request) => !request.settled));
      const owner = owners[step.node % Math.max(owners.length, 1)];
      if (owner) {
        const requests = askedBy.get(owner.id)!;
        const open = requests.filter((request) => !request.settled);
        const request = open[step.which % open.length]!;
        request.settled = true;
        naive.requests.get(owner.id)![requests.indexOf(request)]!.settled =
          step.how === 'resolve' ? 'resolved' : 'rejected';
        counts.settledLate += request === requests.at(-1) ? 0 : 1;
        counts.rejected += step.how === 'reject' ? 1 : 0;
        request.settle!(step.how);
      }
    } else if (step.kind === 'submit') {
      form.submit();
      naive.submit();
    } else if (step.kind === 'release') {
      if (scheduler.count()) {
        await scheduler.waitNext(1);
      }
    } else {
      const models = pairs.map(([, model]) => model);
      const nodes = pairs.map(([node]) => node);
      const resolved = (step.kind === 'batch' ? step.steps : [step])
        .map((inner) => resolveWrite(inner, models))
        .filter((write) => write.target >= 0);
      // The model goes first, so that a write to an item an earlier write of the batch removed is left out of both.
      const applies: boolean[] = [];
      for (const write of resolved) {
        const model = models[write.target]!;
        applies.push(naive.attached(model));
        if (!applies.at(-1)) {
          continue;
        }
        // Counted outside a batch only, where every node of the item has been looked at.
        if (step.kind === 'move' && write.kind === 'move' && model.items.length && write.to < model.items.length) {
          counts.moved++;
          counts.movedWithIssues += naive.allIssues(model.items[write.item % model.items.length]!).length ? 1 : 0;
        }
        const before = model.items.length;
        want = naive.apply(write, models);
        if (want) {
          break;
        }
        counts.inserted += write.kind === 'insert' ? 1 : 0;
        counts.removed += write.kind === 'remove' && model.items.length < before ? 1 : 0;
      }
      try {
        form.graph.batch(() => resolved.forEach((write, at) => applies[at] && applyTo(nodes, write)));
      } catch (error) {
        thrown = error;
      }
    }
    await tick();
    if (want) {
      counts.thrown++;
      assert.ok(
        thrown instanceof want.constructor,
        `${label}: throws a ${want.constructor.name}, not ${String(thrown)}`,
      );
    } else {
      assert.equal(thrown, undefined, `${label}: throws nothing`);
    }
    look(label);
    await signals(label);
  }
  // Every run left in flight answers at last, one at a time, in an order of the scheduler's.
  while (scheduler.count()) {
    await scheduler.waitNext(1);
    await tick();
    look(`run released, ${scheduler.count()} left`);
    await signals(`run released, ${scheduler.count()} left`);
  }
  counts.validations += asked.length;
  counts.heldByRules += naive.heldByRules;
  counts.restored += naive.restored;
  counts.kept += naive.kept;
  const runs = [...naive.runs.values()].flat();
  counts.runs += runs.length;
  counts.aborted += runs.filter((expected) => expected.aborted).length;
  counts.releasedAborted += made.filter((call) => call.released && call.signal.aborted).length;
  counts.abortedOut += [...naive.runs.entries()].reduce(
    (sum, [id, list]) =>
      sum + (naive.attached(naive.built[id]!) ? 0 : list.filter((expected) => expected.aborted).length),
    0,
  );
}

const fresh = (): Counts => ({
  validations: 0,
  runs: 0,
  aborted: 0,
  abortedOut: 0,
  releasedAborted: 0,
  validatorIssues: 0,
  restored: 0,
  kept: 0,
  settledLate: 0,
  rejected: 0,
  notifications: 0,
  thrown: 0,
  pendingSeen: 0,
  failedSeen: 0,
  inserted: 0,
  removed: 0,
  moved: 0,
  movedWithIssues: 0,
  keyedIssues: 0,
  mostItems: 0,
  ruleCalls: 0,
  ruleIssues: 0,
  warnings: 0,
  requiredSeen: 0,
  heldByRules: 0,
});

test('every state of every node follows the naive model, through writes, moving items and late answers', async () => {
  const counts = fresh();
  await fc.assert(
    fc.asyncProperty(programs, fc.scheduler(), (program, scheduler) => run(program, scheduler, counts)),
    { numRuns: 400 },
  );
  console.log(counts);
  assert.ok(counts.runs > 400, `${counts.runs} runs of validators`);
  assert.ok(counts.aborted > 40, `${counts.aborted} runs aborted`);
  assert.ok(counts.kept > 100, `${counts.kept} looks at a run kept while a schema had not answered`);
  assert.ok(counts.releasedAborted > 30, `${counts.releasedAborted} answers released after their abort`);
  assert.ok(counts.validatorIssues > 200, `${counts.validatorIssues} issues of validators looked at`);
});

// An array of groups, its items with a schema and the array with one, under a group with a schema: long programs of
// structural writes, so that items move often while they hold issues of each schema.
const crowded: fc.Arbitrary<Program> = fc.record({
  root: fc.record({
    kind: fc.constant('group' as const),
    initial: fc.constant(0),
    children: fc
      .record({
        kind: fc.constant('array' as const),
        initial: fc.constant(0),
        children: shapes(1, true).map((element) => [
          {
            ...element,
            kind: 'group' as const,
            children: element.children.length ? element.children : [element],
            schema: 'mixed' as const,
          },
        ]),
        schema: fc.constantFrom<SchemaKind | null>('sync', 'async', 'keyed'),
        validator: validators,
        condition: conditions,
        identity: fc.boolean(),
        start: seeds,
        rules: ruleShapes,
      })
      .map((list) => [list]),
    schema: fc.constantFrom<SchemaKind | null>(null, 'sync', 'async'),
    validator: validators,
    condition: fc.constant(null),
    identity: fc.constant(false),
    start: fc.constant([]),
    rules: ruleShapes,
  }),
  steps: fc.array(
    fc.oneof(
      { arbitrary: steps, weight: 1 },
      {
        arbitrary: fc.record({ kind: fc.constant('move' as const), node: fc.nat(40), item: fc.nat(3), to: fc.nat(2) }),
        weight: 1,
      },
    ),
    { minLength: 10, maxLength: 40 },
  ),
  watched: fc.boolean(),
});

test('moving items keep their states and issues, under schemas of the item, the array and the form', async () => {
  const counts = fresh();
  await fc.assert(
    fc.asyncProperty(crowded, fc.scheduler(), (program, scheduler) => run(program, scheduler, counts)),
    { numRuns: 200 },
  );
  console.log(counts);
  assert.ok(counts.movedWithIssues > 200, `${counts.movedWithIssues} items moved while they held issues`);
});

// An array whose items each hold a validator, beside a field with one, with no schema to hold them back: programs of
// writes, removals, restores and releases, so that runs are often in flight when their item leaves, or comes back.
const validating: fc.Arbitrary<Program> = fc.record({
  root: fc.record({
    kind: fc.constant('group' as const),
    initial: fc.constant(0),
    children: fc
      .tuple(
        fc.record({
          kind: fc.constant('array' as const),
          initial: fc.constant(0),
          children: shapes(1, true).map((element) => [
            { ...element, schema: null, validator: element.validator ?? ('abortable' as const) },
          ]),
          schema: fc.constant(null),
          validator: validators,
          condition: fc.constant(null),
          identity: fc.boolean(),
          start: fc.array(fc.nat(3), { minLength: 2, maxLength: 8 }),
          rules: ruleShapes,
        }),
        fc.record({
          kind: fc.constant('field' as const),
          initial: fc.nat(3),
          children: fc.constant([]),
          schema: fc.constant(null),
          validator: fc.constantFrom<ValidatorKind>('async', 'abortable', 'thenable'),
          condition: fc.constant(null),
          identity: fc.constant(false),
          start: fc.constant([]),
          rules: fc.constant([]),
        }),
      )
      .map(([list, single]) => [list, single]),
    schema: fc.constant(null),
    validator: fc.constant(null),
    condition: fc.constant(null),
    identity: fc.constant(false),
    start: fc.constant([]),
    rules: ruleShapes,
  }),
  steps: fc.array(
    fc.oneof(
      { arbitrary: steps, weight: 2 },
      { arbitrary: fc.record({ kind: fc.constant('remove' as const), node: fc.nat(40), item: fc.nat(3) }), weight: 2 },
      {
        arbitrary: fc.record({ kind: fc.constant('reset' as const), node: fc.nat(1), seed: fc.constant(null) }),
        weight: 1,
      },
      { arbitrary: fc.record({ kind: fc.constant('release' as const) }), weight: 2 },
    ),
    { minLength: 10, maxLength: 30 },
  ),
  watched: fc.boolean(),
});

test('a run in flight is aborted when its item leaves, and an item given back asks again', async () => {
  const counts = fresh();
  await fc.assert(
    fc.asyncProperty(validating, fc.scheduler(), (program, scheduler) => run(program, scheduler, counts)),
    { numRuns: 200 },
  );
  console.log(counts);
  assert.ok(counts.abortedOut > 100, `${counts.abortedOut} runs aborted by a removal`);
  assert.ok(counts.restored > 100, `${counts.restored} items holding a validator given back`);
});

// Rules on every level: at the root, on an array kept or not by a key, on its items, beside a group of fields and a
// field whose validator a rule may hold back: programs of writes, moves and releases, so that rules read through items
// that move and say what they require.
const rules = fc.array(
  fc.record({ reads: fc.array(fc.nat(60), { minLength: 1, maxLength: 3 }), salt: fc.nat(23), required: fc.boolean() }),
  { minLength: 1, maxLength: 3 },
);
const ruling: fc.Arbitrary<Program> = fc.record({
  root: fc.record({
    kind: fc.constant('group' as const),
    initial: fc.constant(0),
    children: fc
      .tuple(
        fc.tuple(lists(2), rules, rules).map(([list, own, inner]) => ({
          ...list,
          rules: own,
          children: [{ ...list.children[0]!, rules: inner }],
        })),
        fc.record({
          kind: fc.constant('group' as const),
          initial: fc.constant(0),
          children: fc.array(shapes(1, false), { minLength: 1, maxLength: 2 }),
          schema: fc.constant(null),
          validator: fc.constant(null),
          condition: fc.constant(null),
          identity: fc.constant(false),
          start: fc.constant([]),
          rules,
        }),
        fc.record({
          kind: fc.constant('field' as const),
          initial: fc.nat(3),
          children: fc.constant([]),
          schema: fc.constant(null),
          validator: fc.constantFrom<ValidatorKind>('sync', 'async', 'abortable'),
          condition: fc.constant(null),
          identity: fc.constant(false),
          start: fc.constant([]),
          rules: fc.constant([]),
        }),
      )
      .map((children) => [...children]),
    schema: fc.constantFrom<SchemaKind | null>(null, null, 'sync'),
    validator: fc.constant(null),
    condition: fc.constant(null),
    identity: fc.constant(false),
    start: fc.constant([]),
    rules,
  }),
  steps: fc.array(steps, { minLength: 10, maxLength: 30 }),
  watched: fc.boolean(),
});

test('rules are checked again exactly when what they read changes, through moved items and empty groups', async () => {
  const counts = fresh();
  await fc.assert(
    fc.asyncProperty(ruling, fc.scheduler(), (program, scheduler) => run(program, scheduler, counts)),
    { numRuns: 150 },
  );
  console.log(counts);
  assert.ok(counts.ruleCalls > 3000, `${counts.ruleCalls} calls of rules`);
  assert.ok(counts.requiredSeen > 1000, `${counts.requiredSeen} nodes required`);
  assert.ok(counts.warnings > 300, `${counts.warnings} warnings looked at`);
  assert.ok(counts.heldByRules > 100, `${counts.heldByRules} looks at a validator held back by rules alone`);
  assert.ok(counts.moved > 40, `${counts.moved} moves`);
});
