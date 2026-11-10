// The nodes of a form (index.ts tells what each state means): the specs and the nodes of fields and groups, how a node
// is built and wired on the graph, how a write is planned and made. What only arrays do is in array.ts, reached through
// the spec `array` builds, so that a form without an array ships none of it.
import { equal } from '@yaltaan/core/equal';
import { fromStandardIssue, type Issue } from '@yaltaan/core/issue';
import type { Path } from '@yaltaan/core/path';
import { createGraph, type Graph, type ReadableNode, type SourceNode } from '@yaltaan/core/reactive';
import { err, ok, type Result } from '@yaltaan/core/result';
import type { Condition } from '@yaltaan/rules';
import { parse, type Schema, type StandardResult, type StandardSchema } from '@yaltaan/schema';

import type { ArrayInternal, List } from './array.ts';

/**
 * What `createForm` builds a field from: its initial raw value and its options.
 * @since 0.3
 * @experimental
 */
export interface FieldSpec<Raw = unknown, Output = Raw> {
  readonly kind: 'field';
  readonly initial: Raw;
  readonly options: FieldOptions<Raw, Output>;
}

/**
 * What `createForm` builds a group from: its children by key, and its options.
 * @since 0.3
 * @experimental
 */
export interface GroupSpec<C extends Children = Children, Output = OutputOf<C>> {
  readonly kind: 'group';
  readonly children: C;
  readonly options: GroupOptions<Output>;
}

/**
 * What `createForm` builds an array from: the spec of each item, and its options.
 * @since 0.3
 * @experimental
 */
export interface ArraySpec<E extends Spec = Spec, Output = OutputOf<E>[]> {
  readonly kind: 'array';
  readonly element: E;
  readonly options: ArrayOptions<unknown, Output>;
}

/**
 * A field, a group or an array, as `field`, `group` and `array` describe it.
 * @since 0.3
 * @experimental
 */
export type Spec = FieldSpec<unknown, unknown> | GroupSpec<Children, unknown> | ArraySpec<Spec, unknown>;

/**
 * The children of a group, by key.
 * @since 0.3
 * @experimental
 */
export type Children = Readonly<Record<string, Spec>>;

/**
 * The raw value of a spec: a field's own, an object of its children's for a group, a list of its items' for an array.
 * @since 0.3
 * @experimental
 */
export type RawOf<S> =
  S extends FieldSpec<infer R, unknown>
    ? R
    : S extends GroupSpec<infer C, unknown>
      ? { -readonly [K in keyof C]: RawOf<C[K]> }
      : S extends ArraySpec<infer E, unknown>
        ? RawOf<E>[]
        : S extends Children
          ? { -readonly [K in keyof S]: RawOf<S[K]> }
          : never;

/**
 * The parsed value of a spec, or of the children of a group: what its schema gives, or with none, a field's raw value,
 * an object of its children's parsed values and a list of its items'.
 * @since 0.3
 * @experimental
 */
export type OutputOf<S> =
  S extends FieldSpec<unknown, infer O>
    ? O
    : S extends GroupSpec<Children, infer O>
      ? O
      : S extends ArraySpec<Spec, infer O>
        ? O
        : S extends Children
          ? { -readonly [K in keyof S]: OutputOf<S[K]> }
          : never;

/**
 * The node `createForm` builds from a spec.
 * @since 0.3
 * @experimental
 */
export type NodeOf<S> =
  S extends FieldSpec<infer R, infer O>
    ? FieldNode<R, O>
    : S extends GroupSpec<infer C, infer O>
      ? GroupNode<C, O>
      : S extends ArraySpec<infer E, infer O>
        ? ArrayNode<E, O>
        : never;

/**
 * An item of an array: the node of its element, and the key it holds for as long as it lives.
 * @since 0.3
 * @experimental
 */
export type ItemOf<E> = NodeOf<E> & {
  /** The key the form gave it, at the end of its path: the next integer from 0 in the order the form builds items. */
  readonly key: number;
};

/**
 * The options a field, a group and an array share.
 * @since 0.3
 * @experimental
 */
export interface NodeSpecOptions<Output> {
  /**
   * Reads the node's raw value: any Standard Schema, which may answer with a promise; its output is the node's parsed
   * value, and each of its issues goes to the node its path names below this one. A rejected promise, or a failure
   * without an issue, places `form.validation_failed` on the node. What listeners throw when an answer settles after
   * its read rejects a promise that nothing awaits: the platform reports it as an unhandled rejection.
   */
  readonly schema?: StandardSchema<unknown, Output>;
  /**
   * Disables the node, and every node below it, while `when` holds on the raw values of `reads`: paths from the root
   * of the form, each naming one of its nodes; through an array that holds the node, a `{ key }` segment without a key
   * (`anyElement` of `@yaltaan/rules`) names the item that holds it.
   */
  readonly disabled?: Condition;
}

/**
 * The options of a field.
 * @since 0.3
 * @experimental
 */
export interface FieldOptions<Raw, Output = Raw> extends NodeSpecOptions<Output> {
  /**
   * Called with the initial raw value and the raw value, each time either changes while `dirty` is read or watched;
   * true when they are the same, and the field is then not dirty. `equal` of `@yaltaan/core/equal` by default; must be
   * pure, and what it throws is thrown by `dirty`.
   * @supplied
   */
  equals?(initial: Raw, raw: Raw): boolean;
}

/**
 * The options of a group.
 * @since 0.3
 * @experimental
 */
export type GroupOptions<Output> = NodeSpecOptions<Output>;

/**
 * The options of an array.
 * @since 0.3
 * @experimental
 */
export interface ArrayOptions<Item, Output = Item[]> extends NodeSpecOptions<Output> {
  /** The items the array starts with, and gives back on `reset()`, each read as `set` reads one; none by default. */
  readonly initial?: readonly Item[];
  /**
   * The path, in an item's raw value, of its business key, as `each` of `@yaltaan/rules` names it, never blank
   * (`undefined`, `null`, `''` or an empty list) nor the same as another item's: `set` and `reset` keep the item whose
   * value holds the key of each value given, `insert` refuses a key an item holds, and a `{ key }` segment of an issue
   * names the item whose value holds that key, all compared on what the values hold at that time, so that an item
   * whose key field was edited is found by its new key. Keys compare by SameValueZero on their first 16,000 code
   * units, as `@yaltaan/rules` compares them. The key at the end of an item's path stays the form's. Without
   * `identity`, `set` and `reset` keep the items by position, and a `{ key }` segment names an item by the form's key.
   */
  readonly identity?: Path;
  /** The most items the array may hold, 1,000 by default: a write that would hold more throws a `RangeError`. */
  readonly maxLength?: number;
}

/**
 * What every node of a form holds: its path, its values and its states, each a node of the form's graph.
 * @since 0.3
 * @experimental
 */
export interface FormNode<Raw, Output> {
  /** The keys from the root of the form to this node, `{ key }` for an item; empty for the root. */
  readonly path: Path;
  /**
   * What the inputs hold: a field's own value, the object of its children's raw values for a group, the list of its
   * items' for an array.
   */
  readonly raw: ReadableNode<Raw>;
  /**
   * The read value: the issues of this node and of its descendants while there is one or the node is pending (with
   * the issues known so far), the parsed value otherwise.
   */
  readonly parsed: ReadableNode<Result<Output, readonly Issue[]>>;
  /** The issues placed on this node by the schemas of the node and of its ancestors, the outermost first. */
  readonly issues: ReadableNode<readonly Issue[]>;
  /**
   * Whether a field's raw value differs from its initial value; whether a group holds a dirty child; whether an
   * array's raw value differs from its initial list, by its length or an item.
   */
  readonly dirty: ReadableNode<boolean>;
  /** Whether a field was touched since its last reset; whether a group or an array holds a touched field. */
  readonly touched: ReadableNode<boolean>;
  /**
   * Whether a schema that places issues on this node or below, its own, an ancestor's or a descendant's, has not yet
   * answered for the raw value it reads.
   */
  readonly pending: ReadableNode<boolean>;
  /** Whether the form was submitted since its last reset: one node, shared by every node of the form. */
  readonly submitted: ReadableNode<boolean>;
  /** Whether the `disabled` condition of this node or of an ancestor holds. */
  readonly disabled: ReadableNode<boolean>;
  /**
   * Writes `raw`: a field's raw value; for a group, the own property of `raw` of each child's key, `undefined` when
   * absent; for an array, the elements of `raw`, each to the item that holds its key with `identity`, or by position
   * without, an item built for each other one and the items left removed. Every value is read once, and checked,
   * before any is written, all in one batch.
   * @mutates this
   * @sharing structural
   * @complexity O(n) (n = nodes at or below this node, and the items a value builds), plus the notifications of the
   *   graph, in which each ancestor read or watched composes its raw value again, O(c) each (c = its children)
   * @throws TypeError when a group, this node or one below, is given anything else than an object, or an array
   *   anything else than an array, or with `identity`, two values the same key or a blank one; nothing written
   * @throws RangeError when an array is given more values than its `maxLength`; nothing written
   * @throws what a getter of `raw` throws, nothing written
   * @throws what the graph's `set` throws: the errors of listeners, or a `TypeError` when called by a computation of
   *   the form's graph
   */
  set(raw: Raw): void;
  /**
   * Marks every field at or below this node as touched, in one batch.
   * @mutates this
   * @sharing none
   * @complexity O(n) (n = nodes at or below this node), plus the notifications of the graph
   * @throws what the graph's `set` throws: the errors of listeners, or a `TypeError` when called by a computation of
   *   the form's graph
   */
  touch(): void;
  /**
   * Gives every field at or below this node its initial raw value back and marks it untouched, and every array the
   * items of its last reset, in their order, each given back its own initial value likewise, their raw values then
   * the array's initial list, in one batch; with `raw` other than `undefined`, makes `raw` the initial value first,
   * read as `set` reads it, and the items it leaves the items to give back. On the root, also clears `submitted`.
   * @mutates this
   * @sharing structural
   * @complexity O(n) (n = nodes at or below this node, and the items a value builds), plus the notifications of the
   *   graph
   * @throws TypeError when a group, this node or one below, is given anything else than an object, or an array
   *   anything else than an array, or with `identity`, two values the same key or a blank one; nothing written
   * @throws RangeError when an array is given more values than its `maxLength`; nothing written
   * @throws what a getter of `raw` throws, nothing written
   * @throws what the graph's `set` throws: the errors of listeners, or a `TypeError` when called by a computation of
   *   the form's graph
   */
  reset(raw?: Raw): void;
}

/**
 * A field of a form.
 * @since 0.3
 * @experimental
 */
export interface FieldNode<Raw, Output = Raw> extends FormNode<Raw, Output> {
  readonly kind: 'field';
}

/**
 * A group of a form, and its children by key.
 * @since 0.3
 * @experimental
 */
export interface GroupNode<C extends Children, Output = OutputOf<C>> extends FormNode<RawOf<C>, Output> {
  readonly kind: 'group';
  readonly children: { readonly [K in keyof C]: NodeOf<C[K]> };
}

/**
 * An array of a form, and its items.
 * @since 0.3
 * @experimental
 */
export interface ArrayNode<E extends Spec, Output = OutputOf<E>[]> extends FormNode<RawOf<E>[], Output> {
  readonly kind: 'array';
  /** The items, in order: a new list each time one is inserted, removed or moved, or a write changes them. */
  readonly items: ReadableNode<readonly ItemOf<E>[]>;
  /**
   * Builds an item from `raw`, read as `set` reads it, or, when `raw` is `undefined`, from the initial value of the
   * element, and inserts it at `index`, in one batch: its initial value is that value, so that it is not dirty until it
   * changes.
   * @mutates this
   * @sharing structural
   * @complexity O(n + m) (n = nodes the item holds, m = items), plus the notifications of the graph
   * @throws RangeError when `index` is not a whole number from 0 to the number of items, or the array already holds
   *   `maxLength` items; nothing written
   * @throws TypeError when `raw` does not fit the element, as for `set`, or with `identity`, its key is blank or
   *   another item's; nothing written
   * @throws what a getter of `raw` throws, nothing written
   * @throws what the graph's `set` throws: the errors of listeners, or a `TypeError` when called by a computation of
   *   the form's graph
   */
  insert(index: number, raw?: RawOf<E>): ItemOf<E>;
  /**
   * Removes `item` from the items, in one batch, and returns whether it was one of them; nothing happens otherwise. The
   * node removed keeps its own states, but no state of the form reads it any longer.
   * @mutates this
   * @sharing structural
   * @complexity O(m) (m = items), plus the notifications of the graph
   * @throws what the graph's `set` throws: the errors of listeners, or a `TypeError` when called by a computation of
   *   the form's graph
   */
  remove(item: ItemOf<E>): boolean;
  /**
   * Moves `item` to `index` among the items, in one batch, and returns whether it was one of them; nothing happens
   * otherwise. Its states, and the issues placed on it, follow it.
   * @mutates this
   * @sharing structural
   * @complexity O(m) (m = items), plus the notifications of the graph
   * @throws RangeError when `index` is not a whole number from 0 to the number of items minus one; nothing written
   * @throws what the graph's `set` throws: the errors of listeners, or a `TypeError` when called by a computation of
   *   the form's graph
   */
  move(item: ItemOf<E>, index: number): boolean;
}

/**
 * The root of a form, its graph, and its submission.
 * @since 0.3
 * @experimental
 */
export type Form<S extends Spec> = NodeOf<S> & {
  /** The graph of every node of the form: batch writes to it, or build nodes beside them. */
  readonly graph: Graph;
  /**
   * Marks every field as touched and the form as submitted, in one batch, then returns what `parsed` of its root
   * gives: while a schema has not answered, an error with the issues known so far, until `pending` turns false.
   * @mutates this
   * @sharing structural
   * @complexity O(n) (n = nodes), plus what reading `parsed` computes and the notifications of the graph
   * @throws what `parsed` of the root throws
   * @throws what the graph's `set` throws: the errors of listeners, or a `TypeError` when called by a computation of
   *   the form's graph
   */
  submit(): Result<OutputOf<S>, readonly Issue[]>;
};

/**
 * The options of `createForm`.
 * @since 0.3
 * @experimental
 */
export interface FormOptions {
  /** The graph to build the nodes in, so that a batch holds writes to them and to other nodes; a new one by default. */
  readonly graph?: Graph;
  /**
   * The most items one write may read in its value, those of every array counted, nested ones included: 10,000 by
   * default. Past it the write throws a `RangeError`, nothing written, so that a value from outside, a draft or a
   * server answer, cannot build more items than this, whatever the `maxLength` of each array.
   */
  readonly maxItems?: number;
}

/**
 * An issue of the form itself:
 * - `form.validation_failed`: a schema gave nothing to show for the raw value of this node: its promise rejected, the
 *   reason as `cause`, or it failed without an issue.
 * @since 0.3
 * @experimental
 */
export interface FormIssue extends Issue {
  readonly code: 'form.validation_failed';
}

// What a schema answered: its value, or its issues, their paths from the root of the form, and the raw value it read,
// through which an index names an item.
interface Answer {
  readonly value?: unknown;
  readonly issues: readonly Issue[];
  readonly read?: unknown;
}

// What a promise of a schema settled to, by promise.
type Settled = WeakMap<object, Answer>;

export const NONE: readonly never[] = [];
const PENDING: Answer = { issues: NONE };
const DANGEROUS = ['__proto__', 'constructor', 'prototype'];
const KINDS = ['field', 'group', 'array'];
const MAX_ITEMS = 10_000;

export function check(holds: unknown, message: string): asserts holds {
  if (!holds) {
    throw new TypeError(message);
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return isObject(value) && typeof value['then'] === 'function';
}

// An array's spec carries the class of its node, so that a form without an array ships no code of arrays.
export const isSpec = (spec: unknown): spec is Spec => {
  const kind = (spec as Partial<Spec> | null)?.kind;
  return KINDS.includes(kind!) && (kind !== 'array' || (spec as ArrayInternal).type?.prototype instanceof Node);
};

// The own property `key` of `value`, `undefined` when it has none.
export const own = (value: unknown, key: PropertyKey): unknown =>
  isObject(value) && Object.hasOwn(value, key) ? value[key as string] : undefined;

export function checkOptions(options: unknown): void {
  check(isObject(options), 'options are an object');
  const { schema, disabled, equals } = options as {
    readonly schema?: Partial<StandardSchema> | null;
    readonly disabled?: Partial<Condition> | null;
    readonly equals?: unknown;
  };
  check(schema === undefined || typeof schema?.['~standard']?.validate === 'function', 'schema is a Standard Schema');
  check(
    disabled === undefined || (Array.isArray(disabled?.reads) && typeof disabled.when === 'function'),
    'disabled is a condition: reads and when',
  );
  check(equals === undefined || typeof equals === 'function', 'equals is a function');
}

/**
 * A field holding `initial` until it is set.
 * @pure
 * @sharing structural
 * @complexity O(1)
 * @throws TypeError when an option is not of its kind: `schema` a Standard Schema, `disabled` a condition, `equals` a
 *   function
 * @since 0.3
 * @experimental
 * @example field('', { schema: string({ minLength: 1 }) })
 */
export function field<Raw, Output = Raw>(
  initial: Raw,
  options: FieldOptions<NoInfer<Raw>, Output> = {},
): FieldSpec<Raw, NoInfer<Output>> {
  checkOptions(options);
  return { kind: 'field', initial, options };
}

/**
 * A group of `children`, by key: its raw value is the object of theirs.
 * @pure
 * @sharing structural
 * @complexity O(c) (c = number of children)
 * @throws TypeError when `children` is not an object of specs, a key is `__proto__`, `constructor` or `prototype`, or
 *   an option is not of its kind
 * @since 0.3
 * @experimental
 * @example group({ email: field(''), password: field('') })
 */
export function group<const C extends Children, Output = OutputOf<C>>(
  children: C,
  options: GroupOptions<Output> = {},
): GroupSpec<C, NoInfer<Output>> {
  check(isObject(children), 'children are an object of specs');
  for (const key of Object.keys(children)) {
    check(isSpec(children[key]), `${key} is not a spec of field, group or array`);
    check(!DANGEROUS.includes(key), `${key} cannot name a child`);
  }
  checkOptions(options);
  return { kind: 'group', children, options };
}

// What a schema that gave nothing to show answers, on its node.
const failed = (path: Path, cause?: unknown): Answer => {
  const issue: FormIssue = { code: 'form.validation_failed', path };
  return { issues: [cause === undefined ? issue : { ...issue, cause }] };
};

// A schema's answer for `value`, read at `path` of the form: an answer, or a promise of one, always settled after the
// read that asked for it, whatever kind of promise the schema gave, and never rejected: a node never stays pending for
// an answer it cannot read. A schema of @yaltaan/schema is told by its vendor and its `~run`, which valibot's schemas
// also have, with another meaning.
function validate(schema: StandardSchema, value: unknown, path: Path): Answer | Promise<Answer> {
  const place = (issue: Issue): Issue => (path.length ? { ...issue, path: [...path, ...issue.path] } : issue);
  const answer = (result: StandardResult<unknown>): Answer =>
    !result.issues
      ? { value: result.value, issues: NONE }
      : result.issues.length
        ? { issues: result.issues.map((issue) => place(fromStandardIssue(issue))), read: value }
        : failed(path);
  const props = schema['~standard'];
  if (props.vendor === 'yaltaan' && typeof (schema as Partial<Schema>)['~run'] === 'function') {
    const result = parse(schema as Schema, value);
    return result.ok ? { value: result.value, issues: NONE } : { issues: result.error.map(place), read: value };
  }
  const result = props.validate(value);
  return isThenable(result)
    ? Promise.resolve(result)
        .then(answer)
        .catch((reason: unknown) => failed(path, reason))
    : answer(result);
}

export const compose = (keys: readonly string[], values: readonly unknown[]): unknown =>
  Object.fromEntries(keys.map((key, index) => [key, values[index]]));

export const some = (...values: unknown[]): boolean => values.some((value) => value === true || value === PENDING);

const list = (...values: unknown[]): unknown[] => values;

// The same read value: issues are kept by `equal` upstream, so an error compares by identity, as a value does.
const sameParsed = (a: Result<unknown, readonly Issue[]>, b: Result<unknown, readonly Issue[]>): boolean =>
  a.ok ? b.ok && Object.is(a.value, b.value) : !b.ok && a.error === b.error;

export class Node {
  declare readonly kind: 'field' | 'group' | 'array';
  declare readonly path: Path;
  declare readonly spec: Spec;
  declare readonly parent: Node | undefined;
  declare readonly shared: Shared;
  /** An item's key; `undefined` for any other node. */
  declare readonly key: unknown;
  declare readonly children: Readonly<Record<string, Node>> | undefined;
  /** An array's items. */
  declare readonly items: SourceNode<readonly Node[]> | undefined;
  /** The items of an array's last reset, which `reset()` gives back. */
  declare first: readonly Node[];
  /** A field's initial raw value; an array's, the list of its items' at its last reset. */
  declare readonly start: SourceNode<unknown>;
  declare readonly raw: ReadableNode<unknown>;
  declare readonly touched: ReadableNode<boolean>;
  declare disabled: ReadableNode<boolean>;
  declare issues: ReadableNode<readonly Issue[]>;
  declare pending: ReadableNode<boolean>;
  /** The issues placed on this node and below it, this node's first. */
  declare all: ReadableNode<readonly Issue[]>;
  declare output: ReadableNode<unknown>;
  /** Whether the schema of an ancestor has not answered. */
  declare above: ReadableNode<boolean>;
  /** Whether the schema of this node or of a node below has not answered. */
  declare below: ReadableNode<boolean>;
  /** What this node's schema answered for its raw value; `PENDING` while it has not. */
  declare answer: ReadableNode<Answer> | undefined;
  /** The issues of that answer, by the node each is placed on. */
  declare placed: ReadableNode<Map<Node, Issue[]>> | undefined;

  /** `dirty` and `parsed`, built on their first read: few views read them on every field. */
  declare dirtyNode: ReadableNode<boolean> | undefined;
  declare parsedNode: ReadableNode<Result<unknown, readonly Issue[]>> | undefined;

  get graph(): Graph {
    return this.shared.graph;
  }

  get dirty(): ReadableNode<boolean> {
    return (this.dirtyNode ??= dirtyOf(this));
  }

  get parsed(): ReadableNode<Result<unknown, readonly Issue[]>> {
    return (this.parsedNode ??= this.graph.derived(
      [this.all, this.pending, this.output],
      (all, pending, output) => (all.length || pending ? err(all) : ok(output)),
      { equals: sameParsed },
    ));
  }

  get submitted(): SourceNode<boolean> {
    return this.shared.submitted;
  }

  set(raw: unknown): void {
    write(this, raw, 'set');
  }

  touch(): void {
    this.graph.batch(() => fieldsOf(this).forEach((field) => field.marked.set(true)));
  }

  reset(raw?: unknown): void {
    write(this, raw, raw === undefined ? 'restore' : 'reset');
  }
}

class Field extends Node {
  declare readonly value: SourceNode<unknown>;
  declare readonly marked: SourceNode<boolean>;
}

export type Writable<T> = { -readonly [K in keyof T]: T[K] };

export interface Shared {
  readonly graph: Graph;
  readonly maxItems: number;
  readonly submitted: SourceNode<boolean>;
  readonly settled: Settled;
  /** The items of each raw value of an array, as its node composed it: an index of an issue names one of them. */
  readonly rows: WeakMap<object, readonly Node[]>;
  readonly no: ReadableNode<boolean>;
  readonly none: ReadableNode<readonly Issue[]>;
  root: Node;
  /** The next key the form gives an item. */
  keys: number;
}

// Each field at or below `node`, through the items of arrays.
function fieldsOf(node: Node, into: Field[] = []): Field[] {
  if (node.kind === 'field') {
    into.push(node as Field);
  }
  for (const child of node.items?.get() ?? Object.values(node.children ?? {})) {
    fieldsOf(child, into);
  }
  return into;
}

// `set` writes raw values; `reset`, initial values too; `restore`, a reset without a value, gives each field its own
// initial value back, and each array the items of its last reset, each restored, their raw values its initial list.
export type Mode = 'set' | 'reset' | 'restore';

// What a write gives each field, and each array: its new items, an item kept or the raw value of one to build, and the
// list of their raw values.
export interface Writes {
  readonly fields: [Field, unknown, Mode][];
  readonly arrays: [List, (Node | { readonly value: unknown })[], unknown[], Mode][];
  /** How many more items of arrays the write may read: the form's `maxItems` at its start. */
  left: number;
}

// What a write of the form starts from: nothing noted, its budget of items whole.
export const writesOf = (shared: Shared): Writes => ({ fields: [], arrays: [], left: shared.maxItems });

// Reads `raw` for `spec`, once, checking it, and returns it as the form holds it, groups and lists built anew; with
// `node`, notes in `writes` what writing it there does: an item is kept by its key with `identity`, otherwise by
// position. `restore` reads no value, and returns the initial raw value it gives back.
export function plan(spec: Spec, node: Node | undefined, raw: unknown, mode: Mode, writes: Writes): unknown {
  const restore = mode === 'restore';
  if (spec.kind === 'field') {
    if (node) {
      writes.fields.push([node as Field, raw, mode]);
    }
    return restore ? node!.start.get() : raw;
  }
  if (spec.kind === 'group') {
    check(restore || isObject(raw), 'a group is set to an object');
    const keys = Object.keys(spec.children);
    return compose(
      keys,
      keys.map((key) => plan(spec.children[key]!, node?.children![key], own(raw, key), mode, writes)),
    );
  }
  return (spec as ArrayInternal).type.plan(spec, node as List | undefined, raw, mode, writes);
}

// The initial raw value of `spec`, as the form holds it, its items counted in `writes`.
export function initialOf(spec: Spec, writes: Writes): unknown {
  if (spec.kind === 'field') {
    return spec.initial;
  }
  if (spec.kind === 'group') {
    const keys = Object.keys(spec.children);
    return compose(
      keys,
      keys.map((key) => initialOf(spec.children[key]!, writes)),
    );
  }
  return plan(spec, undefined, spec.options.initial ?? [], 'set', writes);
}

// Writes what `plan` noted, in one batch: the items of arrays first, then the fields.
function write(node: Node, raw: unknown, mode: Mode): void {
  const writes = writesOf(node.shared);
  plan(node.spec, node, raw, mode, writes);
  node.graph.batch(() => {
    for (const [array, entries, values, how] of writes.arrays) {
      array.commit(entries, values, how);
    }
    for (const [field, value, how] of writes.fields) {
      if (how === 'reset') {
        field.start.set(value);
      }
      field.value.set(how === 'restore' ? field.start.get() : value);
      if (how !== 'set') {
        field.marked.set(false);
      }
    }
    if (mode !== 'set' && !node.parent) {
      node.submitted.set(false);
    }
  });
}

// Builds the sources of a node from `value`, its raw value as the form holds it, and the states that only follow its
// children or items; the others need the whole tree.
export function build(
  spec: Spec,
  path: Path,
  parent: Node | undefined,
  shared: Shared,
  value: unknown,
  key?: unknown,
): Node {
  const node = new (spec.kind === 'field'
    ? Field
    : spec.kind === 'group'
      ? Node
      : (spec as ArrayInternal).type)() as Writable<Field & List>;
  const { graph } = shared;
  Object.assign(node, { kind: spec.kind, path, spec, parent, shared, key });
  if (spec.kind === 'field') {
    node.value = node.raw = graph.source(value);
    node.start = graph.source(value);
    node.marked = node.touched = graph.source(false);
  } else if (spec.kind === 'group') {
    const keys = Object.keys(spec.children);
    const children = keys.map((key) => build(spec.children[key]!, [...path, key], node, shared, own(value, key)));
    node.children = compose(keys, children) as Record<string, Node>;
    node.raw = graph.derived(
      children.map((child) => child.raw),
      (...values) => compose(keys, values),
    );
    node.touched = graph.derived(
      children.map((child) => child.touched),
      some,
    );
  } else {
    node.fill(value as unknown[]);
  }
  return node;
}

// Checks every condition of `spec` and below against the description, `root` the spec of the form and `arrays` those
// that hold `spec`: a path names a node through group keys and, for an array that holds the condition, a `{ key }`
// segment without a key, so that a condition of an item fails when the form is built, not when an item is.
function checkReads(spec: Spec, root: Spec, arrays: readonly Spec[]): void {
  for (const read of spec.options.disabled?.reads ?? NONE) {
    check(Array.isArray(read), 'a condition reads paths');
    let at: Spec | undefined = root;
    for (const key of read) {
      at =
        at?.kind === 'array'
          ? isObject(key) && key['key'] === undefined && arrays.includes(at)
            ? at.element
            : undefined
          : at?.kind === 'group' && typeof key === 'string' && Object.hasOwn(at.children, key)
            ? at.children[key]
            : undefined;
    }
    check(at, 'a condition reads a path that names no node of this form');
  }
  const inner = spec.kind === 'group' ? Object.values(spec.children) : spec.kind === 'array' ? [spec.element] : NONE;
  for (const child of inner) {
    checkReads(child, root, spec.kind === 'array' ? [...arrays, spec] : arrays);
  }
}

// The node `path` names from the root, as `checkReads` checked it: through group keys and, for an array, the item
// that holds `from`.
function find(root: Node, path: Path, from: Node): Node {
  let node = root;
  for (const key of path) {
    if (node.items) {
      let at = from;
      while (at.parent !== node) {
        at = at.parent!;
      }
      node = at;
    } else {
      node = node.children![key as string]!;
    }
  }
  return node;
}

// The node `segment` names below `target`, and what it holds of `value`, the raw value of `target` as a schema read
// it: a child by its own key, an item by its index or its `{ key }` in that value.
function step(target: Node, segment: unknown, value: unknown): [Node, unknown] | undefined {
  if (target.items) {
    return (target as List).named(segment, value);
  }
  return typeof segment === 'string' && target.children && Object.hasOwn(target.children, segment)
    ? [target.children[segment]!, own(value, segment)]
    : undefined;
}

// Builds the states that read other nodes than its children, from the root down, then those that follow its
// children or items, from the leaves up: a node's dependencies always exist before it.
export function wire(node: Node, shared: Shared): void {
  const { graph } = shared;
  const { spec, parent, path } = node;
  const { schema, disabled } = spec.options;
  const condition =
    disabled &&
    graph.derived(
      disabled.reads.map((read) => find(shared.root, read, node).raw),
      (...values) => !!disabled.when(...values),
    );
  node.disabled = condition
    ? parent
      ? graph.derived([parent.disabled, condition], some)
      : condition
    : (parent?.disabled ?? shared.no);
  if (schema) {
    const last = graph.source<unknown>(undefined);
    const asked = graph.derived([node.raw], (raw) => {
      const answer = validate(schema, raw, path);
      if (isThenable(answer)) {
        void answer.then((settled) => {
          shared.settled.set(answer, settled);
          last.set(answer);
        });
      }
      return answer;
    });
    node.answer = graph.derived([asked, last], (answer) =>
      isThenable(answer) ? (shared.settled.get(answer) ?? PENDING) : answer,
    );
    node.placed = graph.derived([node.answer], ({ issues, read }) => {
      const placed = new Map<Node, Issue[]>();
      for (let issue of issues) {
        let target = node;
        let value = read;
        for (let at = path.length; at < issue.path.length; at++) {
          const next = step(target, issue.path[at], value);
          if (!next) {
            break;
          }
          if (target.items) {
            issue = { ...issue, path: issue.path.with(at, next[0].path.at(-1)!) };
          }
          [target, value] = next;
        }
        const list = placed.get(target);
        if (list) {
          list.push(issue);
        } else {
          placed.set(target, [issue]);
        }
      }
      return placed;
    });
  }
  node.above = parent?.answer ? graph.derived([parent.above, parent.answer], some) : (parent?.above ?? shared.no);
  const sources: ReadableNode<Map<Node, Issue[]>>[] = [];
  for (let at: Node | undefined = node; at; at = at.parent) {
    if (at.placed) {
      sources.unshift(at.placed);
    }
  }
  node.issues = sources.length
    ? graph.derived(sources, (...placed) => placed.flatMap((issues): readonly Issue[] => issues.get(node) ?? NONE), {
        equals: equal,
      })
    : shared.none;
  const children = node.items?.get() ?? Object.values(node.children ?? {});
  for (const child of children) {
    wire(child, shared);
  }
  const below = [...(node.answer ? [node.answer] : []), ...children.map((child) => child.below)];
  node.below = below.length || node.items ? graph.derived(below, some) : shared.no;
  node.pending =
    node.above === shared.no
      ? node.below
      : node.below === shared.no
        ? node.above
        : graph.derived([node.above, node.below], some);
  node.all =
    children.length || node.items
      ? graph.derived([node.issues, ...children.map((child) => child.all)], (...lists) => lists.flat(), {
          equals: equal,
        })
      : node.issues;
  node.output = node.answer
    ? graph.derived([node.answer], (answer) => answer.value)
    : node.items
      ? graph.derived(
          children.map((child) => child.output),
          list,
        )
      : node.children
        ? graph.derived(
            children.map((child) => child.output),
            (...values) => compose(Object.keys(node.children!), values),
          )
        : node.raw;
}

// A node's `dirty`: a field's raw value against its initial one, a group's children; an array's is its own.
function dirtyOf(node: Node): ReadableNode<boolean> {
  const { spec, graph } = node;
  return spec.kind === 'field'
    ? graph.derived(
        [node.start, (node as Field).value],
        (initial, raw) => !((spec.options as FieldOptions<unknown>).equals ?? equal)(initial, raw),
      )
    : graph.derived(
        Object.values(node.children!).map((child) => child.dirty),
        some,
      );
}

/**
 * The form `spec` describes: a node for each field, group, array and item, on one graph, every value and state a node
 * of it that computes when read, and again only once what it reads has changed.
 * @pure
 * @sharing structural
 * @complexity O(n × d) (n = fields, groups, arrays, items and the paths their conditions read, d = depth of the tree),
 *   each node holding its path
 * @throws TypeError when `spec` is not a spec of `field`, `group` or `array`, an initial item does not fit its
 *   element, two initial items of an array with `identity` hold the same key or a blank one, or a condition reads a
 *   path that names no node of the form
 * @throws RangeError when an array starts with more items than its `maxLength`, or the form with more than `maxItems`
 * @throws TypeError when `graph` is not a graph, or `maxItems` not a whole number from 0
 * @throws RangeError when groups are nested deeper than the call stack allows
 * @since 0.3
 * @experimental
 * @example
 * const form = createForm(group({ email: field('', { schema: string({ minLength: 3 }) }) }));
 * form.children.email.set('ada@example.org');
 * form.submit() // { ok: true, value: { email: 'ada@example.org' } }
 */
export function createForm<S extends Spec>(spec: S, options: FormOptions = {}): Form<S> {
  check(isSpec(spec), 'spec is a spec of field, group or array');
  const { graph = createGraph(), maxItems = MAX_ITEMS } = options;
  check(Number.isInteger(maxItems) && maxItems >= 0, 'maxItems is a whole number');
  checkReads(spec, spec, NONE);
  const shared = {
    graph,
    maxItems,
    submitted: graph.source(false),
    settled: new WeakMap(),
    rows: new WeakMap(),
    no: graph.source(false),
    none: graph.source(NONE),
    keys: 0,
  } as unknown as Writable<Shared>;
  const root = (shared.root = build(spec, [], undefined, shared, initialOf(spec, writesOf(shared))));
  wire(root, shared);
  return Object.assign(root, {
    submit: (): Result<unknown, readonly Issue[]> => {
      graph.batch(() => {
        root.touch();
        shared.submitted.set(true);
      });
      return root.parsed.get();
    },
  }) as unknown as Form<S>;
}
