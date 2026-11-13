// The nodes of a form (index.ts tells what each state means, types.ts what each holds): the specs of fields and groups,
// how a node is built and wired on the graph, how a write is planned and made. What only arrays do is in array.ts,
// reached through the spec `array` builds, so that a form without an array ships none of it.
import { equal } from '@yaltaan/core/equal';
import { fromStandardIssue, type Issue } from '@yaltaan/core/issue';
import type { Path } from '@yaltaan/core/path';
import { createGraph, type Graph, type ReadableNode, type SourceNode } from '@yaltaan/core/reactive';
import { err, ok, type Result } from '@yaltaan/core/result';
import type { Condition, Rule } from '@yaltaan/rules';
import { parse, type Schema, type StandardResult, type StandardSchema } from '@yaltaan/schema';

import type { ArrayInternal, List } from './array.ts';
import type {
  Children,
  FieldOptions,
  FieldSpec,
  Form,
  FormIssue,
  FormOptions,
  GroupOptions,
  GroupSpec,
  NodeSpecOptions,
  OutputOf,
  RawOf,
  Spec,
} from './types.ts';
// What a schema or a validator answered: its value, or its issues, their paths from the root of the form, and the raw
// value it read, through which an index names an item.
interface Answer {
  readonly value?: unknown;
  readonly issues: readonly Issue[];
  readonly read?: unknown;
}

// What a promise of a schema or a validator settled to, by promise.
type Settled = WeakMap<object, Answer>;

export const NONE: readonly never[] = [];
const PENDING: Answer = { issues: NONE };
// What a validator that found nothing, or was not asked, answers.
const CLEAR: Answer = { issues: NONE };
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
  const { schema, disabled, equals, validate, rules } = options as {
    readonly schema?: Partial<StandardSchema> | null;
    readonly disabled?: Partial<Condition> | null;
    readonly equals?: unknown;
    readonly validate?: unknown;
    readonly rules?: readonly Partial<Rule>[];
  };
  check(schema === undefined || typeof schema?.['~standard']?.validate === 'function', 'schema is a Standard Schema');
  check(
    disabled === undefined || (Array.isArray(disabled?.reads) && typeof disabled.when === 'function'),
    'disabled is a condition: reads and when',
  );
  check(equals === undefined || typeof equals === 'function', 'equals is a function');
  check(validate === undefined || typeof validate === 'function', 'validate is a function');
  check(
    rules === undefined ||
      (Array.isArray(rules) &&
        rules.every(
          (rule) =>
            Array.isArray(rule?.reads) &&
            typeof rule.check === 'function' &&
            (rule.required === undefined || typeof rule.required === 'function'),
        )),
    'rules are rules: reads, check and required',
  );
}

/**
 * A field holding `initial` until it is set.
 * @pure
 * @sharing structural
 * @complexity O(1)
 * @throws TypeError when an option is not of its kind: `schema` a Standard Schema, `disabled` a condition, `equals`
 *   and `validate` functions, `rules` rules
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
  options: GroupOptions<Output, RawOf<C>> = {},
): GroupSpec<C, NoInfer<Output>> {
  check(isObject(children), 'children are an object of specs');
  for (const key of Object.keys(children)) {
    check(isSpec(children[key]), `${key} is not a spec of field, group or array`);
    check(!DANGEROUS.includes(key), `${key} cannot name a child`);
  }
  checkOptions(options);
  return { kind: 'group', children, options };
}

// Places an issue whose path starts at the node at `path`.
const placeAt =
  (path: Path) =>
  (issue: Issue): Issue =>
    path.length ? { ...issue, path: [...path, ...issue.path] } : issue;

// What a schema that gave nothing to show answers, on its node.
const failed = (path: Path, cause?: unknown): Answer => {
  const issue: FormIssue = { code: 'form.validation_failed', path };
  return { issues: [cause === undefined ? issue : { ...issue, cause }] };
};

// A schema's answer for `value`, read at `path` of the form: an answer, or a promise of one, always settled after the
// read that asked for it, whatever kind of promise the schema gave, and never rejected: a node never stays pending for
// an answer it cannot read. A schema of @yaltaan/schema is told by its vendor and its `~run`, which valibot's schemas
// also have, with another meaning.
function judge(schema: StandardSchema, value: unknown, path: Path): Answer | Promise<Answer> {
  const place = placeAt(path);
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

// What a validator's answer means, `value` the raw value it read at `path`: its issues placed from there, nothing found
// for an empty list, or when it is not a list of issues, a failure whose cause is that answer.
const heard = (list: unknown, value: unknown, path: Path): Answer =>
  Array.isArray(list) &&
  (list as Issue[]).every((issue) => typeof issue?.code === 'string' && Array.isArray(issue.path))
    ? list.length
      ? { issues: list.map(placeAt(path)), read: value }
      : CLEAR
    : failed(path, list);

export const compose = (keys: readonly string[], values: readonly unknown[]): unknown =>
  Object.fromEntries(keys.map((key, index) => [key, values[index]]));

export const some = (...values: unknown[]): boolean => values.some((value) => value === true || value === PENDING);

const list = (...values: unknown[]): unknown[] => values;

// Whether an issue blocks: any but a warning, which is shown and holds nothing back.
const blocks = (issue: Issue): boolean => issue.severity !== 'warning';

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
  declare own: ReadableNode<Answer> | undefined;
  /** The issues of that answer, by the node each is placed on. */
  declare ownPlaced: ReadableNode<Map<Node, Issue[]>> | undefined;
  /** What its schema answered, or once it found nothing, its validator: what places issues and holds pending. */
  declare answer: ReadableNode<Answer> | undefined;
  /** The issues of that answer, by the node each is placed on. */
  declare placed: ReadableNode<Map<Node, Issue[]>> | undefined;
  /** The issues of its rules, by the node each is placed on. */
  declare ruled: ReadableNode<Map<Node, Issue[]>> | undefined;
  /** The paths its rules require, by the node each names. */
  declare mandated: ReadableNode<Map<Node, Issue[]>> | undefined;
  /** Whether a validator sits at or above this node; absent otherwise. */
  declare checked: true | undefined;
  /**
   * For such a node: 2 when a schema placed an issue on it or below, 1 when one of the node, below it or above it has
   * not answered, 0 otherwise.
   */
  declare doubt: ReadableNode<number> | undefined;
  /** Aborts the run of this node's validator in flight. */
  declare stop: (() => void) | undefined;
  /** An item's life while a validator sits at or below it: a new object each time it enters the form, null out. */
  declare life: SourceNode<object | null> | undefined;

  /** `dirty`, `parsed` and `required`, built on their first read: few views read them on every field. */
  declare dirtyNode: ReadableNode<boolean> | undefined;
  declare requiredNode: ReadableNode<boolean> | undefined;
  declare parsedNode: ReadableNode<Result<unknown, readonly Issue[]>> | undefined;

  get graph(): Graph {
    return this.shared.graph;
  }

  get required(): ReadableNode<boolean> {
    return (this.requiredNode ??= requiredOf(this));
  }

  get dirty(): ReadableNode<boolean> {
    return (this.dirtyNode ??= dirtyOf(this));
  }

  get parsed(): ReadableNode<Result<unknown, readonly Issue[]>> {
    return (this.parsedNode ??= this.graph.derived(
      [this.all, this.pending, this.output],
      (all, pending, output) => (all.some(blocks) || pending ? err(all) : ok(output)),
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

// The children or the items of a node.
export const under = (node: Node): readonly Node[] => node.items?.get() ?? Object.values(node.children ?? {});

// Each field at or below `node`, through the items of arrays.
function fieldsOf(node: Node, into: Field[] = []): Field[] {
  if (node.kind === 'field') {
    into.push(node as Field);
  }
  for (const child of under(node)) {
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

// Checks every condition and rule of `spec` and below against the description, `root` the spec of the form and
// `arrays` those that hold `spec`: a path of a condition names a node through group keys and, for an array that holds
// the condition, a `{ key }` segment without a key; a rule's, as `readsOf` reads it; so that a condition or a rule of
// an item fails when the form is built, not when an item is.
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
  for (const rule of spec.options.rules ?? NONE) {
    readsOf(spec, rule.reads);
  }
  const inner = spec.kind === 'group' ? Object.values(spec.children) : spec.kind === 'array' ? [spec.element] : NONE;
  for (const child of inner) {
    checkReads(child, root, spec.kind === 'array' ? [...arrays, spec] : arrays);
  }
}

/**
 * What a rule reads below a node: all of it (`true`), or by the key of each child it reads below, an array by `0` for
 * every item.
 */
export type Reads = true | Map<unknown, Reads>;

// What `paths` read below a node of `spec`, checked against the description: a group's segment names a child, any
// segment of an array stands for every item, and a path that reaches a field reads it whole.
function readsOf(spec: Spec, paths: readonly Path[]): Reads {
  const top = new Map<unknown, Reads>();
  for (const path of paths) {
    check(Array.isArray(path), 'a rule reads paths');
    let at = spec;
    let map = top;
    let key: unknown = '';
    for (const segment of path) {
      let reads = map.get(key);
      if (reads === true || at.kind === 'field') {
        break;
      }
      map.set(key, (reads ??= new Map()));
      map = reads;
      if (at.kind === 'array') {
        key = 0;
        at = at.element;
      } else {
        check(
          typeof segment === 'string' && Object.hasOwn(at.children, segment),
          'a rule reads a path that names no node of this form',
        );
        at = at.children[(key = segment)]!;
      }
    }
    map.set(key, true);
  }
  return top.get('') ?? new Map();
}

/**
 * Notes in `deps` the nodes whose raw values `reads` names at and below `node`, and returns what builds, from their
 * values, the values a rule reads: what it does not read left out, through an array the list of what it reads of each
 * item, a node the array rewires with its items, and nothing for a rule that reads nothing.
 */
export function resolve(node: Node, reads: Reads, deps: ReadableNode<unknown>[]): (values: unknown[]) => unknown {
  if (reads !== true && !reads.size) {
    return () => undefined;
  }
  if (reads === true || !node.children) {
    const at = deps.push(node.items && reads !== true ? (node as List).view(reads.get(0)!) : node.raw) - 1;
    return (values) => values[at];
  }
  const keys = [...reads.keys()] as string[];
  const parts = keys.map((key) => resolve(node.children![key]!, reads.get(key)!, deps));
  return (values) =>
    compose(
      keys,
      parts.map((part) => part(values)),
    );
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

// What a schema or a validator answers for the values of `deps`: what `call` gives, or once the promise it gives has
// settled, what it settled to, as long as it is still the last one asked; a promise given again is followed once.
function answerOf(
  shared: Shared,
  deps: readonly ReadableNode<unknown>[],
  call: (...values: unknown[]) => Answer | Promise<Answer>,
): ReadableNode<Answer> {
  const { graph, settled } = shared;
  const last = graph.source<unknown>(undefined);
  let hooked: unknown;
  const asked = graph.derived(deps, (...values) => {
    const answer = call(...values);
    if (isThenable(answer) && answer !== hooked) {
      hooked = answer;
      void answer.then((settles) => {
        settled.set(answer, settles);
        last.set(answer);
      });
    }
    return answer;
  });
  return graph.derived([asked, last], (answer) => (isThenable(answer) ? (settled.get(answer) ?? PENDING) : answer));
}

// The issues of `answers`, by the node each is placed on: the deepest node its path names below `node`.
function placedOf(node: Node, answers: readonly ReadableNode<Answer>[]): ReadableNode<Map<Node, Issue[]>> {
  const { path } = node;
  return node.graph.derived(answers, (...list) => {
    const placed = new Map<Node, Issue[]>();
    for (const { issues, read } of list) {
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
        const here = placed.get(target);
        if (here) {
          here.push(issue);
        } else {
          placed.set(target, [issue]);
        }
      }
    }
    return placed;
  });
}

// What tells whether a schema may still place an issue on `node` or below, or a schema or a rule has: what the
// schemas of the node and of its ancestors answered and the issues they and their rules placed, and the same of each
// node below.
export const doubtsOf = (node: Node): ReadableNode<unknown>[] => {
  const deps: ReadableNode<unknown>[] = [];
  for (let at: Node | undefined = node; at; at = at.parent) {
    if (at.own) {
      deps.push(at.own, at.ownPlaced!);
    }
    if (at.ruled) {
      deps.push(at.ruled);
    }
  }
  return [...deps, ...under(node).map((child) => child.doubt!)];
};

// A node's whole state, its own and that of every node below: what schemas and validators answer (`ask`), then what
// follows from it (`connect`), so that a validator may wait for the schemas below it.
export function wire(node: Node, shared: Shared): void {
  ask(node, shared);
  connect(node, shared);
}

// Builds what the schema of a node answers, from the root down; then, from the leaves up, for a node at or below a
// validator, whether a schema places an issue on it or may still, and what its validator answers: a run starts once no
// schema may, and counts until its raw value or the lives of its items change, or a schema places an issue; a schema
// that has not answered yet neither starts nor aborts one.
function ask(node: Node, shared: Shared): void {
  const { graph } = shared;
  const { spec, parent, path } = node;
  const { schema, validate, rules } = spec.options as NodeSpecOptions<unknown>;
  if (schema) {
    node.own = node.answer = answerOf(shared, [node.raw], (raw) => judge(schema, raw, path));
    node.ownPlaced = node.placed = placedOf(node, [node.own]);
  }
  if (rules?.length) {
    // Each rule is a node that reads the values of its paths: what it says, and what it requires, are computed again
    // only once one of them changes, each when a state that needs it is read.
    const said: ReadableNode<Answer>[] = [];
    const needed: ReadableNode<Answer>[] = [];
    for (const { reads, check, required } of rules) {
      const deps: ReadableNode<unknown>[] = [];
      const make = resolve(node, readsOf(spec, reads), deps);
      said.push(
        graph.derived(deps, (...values) => {
          const read = make(values);
          return { issues: check(read).map(placeAt(path)), read };
        }),
      );
      if (required) {
        needed.push(
          graph.derived(deps, (...values) => {
            const read = make(values);
            return { issues: required(read).map((at) => ({ code: '', path: [...path, ...at] })), read };
          }),
        );
      }
    }
    node.ruled = placedOf(node, said);
    node.mandated = placedOf(node, needed);
  }
  if (validate || parent?.checked) {
    node.checked = true;
  }
  const children = under(node);
  for (const child of children) {
    ask(child, shared);
  }
  if (node.checked) {
    node.doubt = graph.derived(doubtsOf(node), (...values) =>
      Math.max(
        0,
        ...values.map((value) =>
          value instanceof Map ? (value.get(node)?.some(blocks) ? 2 : 0) : value === PENDING ? 1 : Number(value) || 0,
        ),
      ),
    );
  }
  if (validate) {
    const own = node.own;
    // The life of each item that holds the node, out of the form already when it is out of its array.
    const lives: SourceNode<object | null>[] = [];
    for (let at = node; at.parent; at = at.parent) {
      if (at.parent.items) {
        lives.push((at.life ??= graph.source(at.parent.items.get().includes(at) ? {} : null)));
      }
    }
    // The run that counts: the raw value and the lives it was asked for, and what it answered or will.
    let run: { readonly raw: unknown; readonly alive: readonly unknown[]; readonly answer: unknown } | undefined;
    let flight: AbortController | undefined;
    // Aborts the run in flight on the next microtask, out of any computation or write, so that what listens to the
    // signal may read the form.
    const stop = (node.stop = () => {
      const controller = flight;
      flight = undefined;
      if (controller) {
        void Promise.resolve().then(() => controller.abort());
      }
    });
    const verdict = answerOf(shared, [node.raw, node.doubt!, ...lives], (raw, shut, ...alive) => {
      if (run && (shut === 2 || !Object.is(run.raw, raw) || alive.some((life, index) => life !== run!.alive[index]))) {
        stop();
        run = undefined;
      }
      if (!run && shut === 0 && !alive.includes(null)) {
        const controller = new AbortController();
        const answer = validate(raw, { signal: controller.signal, path });
        if (isThenable(answer)) {
          flight = controller;
          const done = (answer: Answer): Answer => {
            if (flight === controller) {
              flight = undefined;
            }
            return answer;
          };
          run = {
            raw,
            alive,
            answer: Promise.resolve(answer)
              .then((list) => heard(list, raw, path))
              .catch((reason: unknown) => failed(path, reason))
              .then(done),
          };
        } else {
          run = { raw, alive, answer: heard(answer, raw, path) };
        }
      }
      return (run?.answer ?? CLEAR) as Answer | Promise<Answer>;
    });
    node.answer = own
      ? graph.derived([own, verdict], (first, then) => (then === PENDING || then.issues.length ? then : first))
      : verdict;
    node.placed = placedOf(node, [node.answer]);
  }
}

// Builds the states that read other nodes than its children, from the root down, then those that follow its
// children or items, from the leaves up: a node's dependencies always exist before it.
function connect(node: Node, shared: Shared): void {
  const { graph } = shared;
  const { spec, parent } = node;
  const { disabled } = spec.options;
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
  node.above = parent?.answer ? graph.derived([parent.above, parent.answer], some) : (parent?.above ?? shared.no);
  const sources: ReadableNode<Map<Node, Issue[]>>[] = [];
  for (let at: Node | undefined = node; at; at = at.parent) {
    if (at.ruled) {
      sources.unshift(at.ruled);
    }
    if (at.placed) {
      sources.unshift(at.placed);
    }
  }
  node.issues = sources.length
    ? graph.derived(sources, (...placed) => placed.flatMap((issues): readonly Issue[] => issues.get(node) ?? NONE), {
        equals: equal,
      })
    : shared.none;
  const children = under(node);
  for (const child of children) {
    connect(child, shared);
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
  node.output = node.own
    ? graph.derived([node.own], (answer) => answer.value)
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

// A node's `required`: whether what a rule of the node or of an ancestor requires names it.
function requiredOf(node: Node): ReadableNode<boolean> {
  const needs: ReadableNode<Map<Node, Issue[]>>[] = [];
  for (let at: Node | undefined = node; at; at = at.parent) {
    if (at.mandated) {
      needs.push(at.mandated);
    }
  }
  return needs.length ? node.graph.derived(needs, (...maps) => maps.some((map) => map.has(node))) : node.shared.no;
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
