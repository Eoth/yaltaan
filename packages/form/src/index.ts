// The form of ARCHITECTURE.md §7.11 and ADR 0043: a tree of fields and groups described by `field` and `group`, built
// by `createForm` on one reactive graph (ADR 0041), every state a node of that graph. A field holds its raw value,
// what its input shows, and its initial value; whether it was touched; the form, whether it was submitted. Everything
// else is derived, computed when read and again only once what it reads has changed:
//   - a group's raw value is the object of its children's raw values, by key, in the order of the description: a new
//     object each time one of them is another value (`Object.is`), never an older one kept for being equal;
//   - dirty: a field whose raw value differs from its initial value, by `equal` of @yaltaan/core/equal unless its
//     `equals` says otherwise; a group with a dirty child. Touched: a field touched since its last reset; a group with
//     a touched child. Submitted: the form's, on every node;
//   - disabled: a node whose `disabled` condition holds on the raw values it reads, or whose parent is disabled;
//   - a node with a schema reads its raw value through it, any Standard Schema; a schema of @yaltaan/schema through
//     `parse`, so that its issues keep their code and their data. Each issue is placed on the deepest node its path
//     names below the schema's node, through the children's own keys: `issues` of a node are those placed on it, from
//     the outermost schema to its own. A schema whose promise rejects, or that fails without an issue, places
//     `form.validation_failed` on its node: the form has nothing else to show;
//   - pending: a node that a schema may still place issues on, its own, an ancestor's or a descendant's, because it
//     has not yet answered for the raw value it reads. An answer is the promise that one read gave: settled, it counts
//     only while that read is the node's last one, so that the answer for a value since replaced is never delivered;
//   - parsed, the read value: an error with the issues of the node and of its descendants, in that order, while there
//     is one or the node is pending; otherwise the value its schema gave, or with none, its raw value for a field and
//     the object of its children's parsed values for a group.
// A computation never reads the graph (ADR 0042): every state names what it reads when it is built, the nodes a
// condition reads included, whatever branch its `when` takes. An answer that settles after its read is delivered from
// the promise's callback, where nothing awaits what the listeners throw.
import { equal } from '@yaltaan/core/equal';
import { fromStandardIssue, type Issue } from '@yaltaan/core/issue';
import type { Path } from '@yaltaan/core/path';
import { createGraph, type Graph, type ReadableNode, type SourceNode } from '@yaltaan/core/reactive';
import { err, ok, type Result } from '@yaltaan/core/result';
import type { Condition } from '@yaltaan/rules';
import { parse, type Schema, type StandardResult, type StandardSchema } from '@yaltaan/schema';

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
 * A field or a group, as `field` and `group` describe it.
 * @since 0.3
 * @experimental
 */
export type Spec = FieldSpec<unknown, unknown> | GroupSpec<Children, unknown>;

/**
 * The children of a group, by key.
 * @since 0.3
 * @experimental
 */
export type Children = Readonly<Record<string, Spec>>;

/**
 * The raw value of a spec: a field's own, an object of its children's for a group.
 * @since 0.3
 * @experimental
 */
export type RawOf<S> =
  S extends FieldSpec<infer R, unknown>
    ? R
    : S extends GroupSpec<infer C, unknown>
      ? { -readonly [K in keyof C]: RawOf<C[K]> }
      : S extends Children
        ? { -readonly [K in keyof S]: RawOf<S[K]> }
        : never;

/**
 * The parsed value of a spec, or of the children of a group: what its schema gives, or with none, a field's raw value
 * and an object of its children's parsed values.
 * @since 0.3
 * @experimental
 */
export type OutputOf<S> =
  S extends FieldSpec<unknown, infer O>
    ? O
    : S extends GroupSpec<Children, infer O>
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
      : never;

/**
 * The options a field and a group share.
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
   * of the form, each naming one of its nodes.
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
 * What every node of a form holds: its path, its values and its states, each a node of the form's graph.
 * @since 0.3
 * @experimental
 */
export interface FormNode<Raw, Output> {
  /** The keys from the root of the form to this node; empty for the root. */
  readonly path: Path;
  /** What the inputs hold: a field's own value, the object of its children's raw values for a group. */
  readonly raw: ReadableNode<Raw>;
  /**
   * The read value: the issues of this node and of its descendants while there is one or the node is pending (with
   * the issues known so far), the parsed value otherwise.
   */
  readonly parsed: ReadableNode<Result<Output, readonly Issue[]>>;
  /** The issues placed on this node by the schemas of the node and of its ancestors, the outermost first. */
  readonly issues: ReadableNode<readonly Issue[]>;
  /** Whether a field's raw value differs from its initial value; whether a group holds a dirty field. */
  readonly dirty: ReadableNode<boolean>;
  /** Whether a field was touched since its last reset; whether a group holds a touched field. */
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
   * Writes `raw`: a field's raw value, or for a group, the own property of `raw` of each child's key, `undefined`
   * when absent, each read once and every one before any is written, all in one batch.
   * @mutates this
   * @sharing structural
   * @complexity O(n) (n = nodes at or below this node), plus the notifications of the graph, in which each ancestor
   *   read or watched composes its raw value again, O(c) each (c = its children)
   * @throws TypeError when a group, this node or one below, is given anything else than an object, nothing written
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
   * Gives every field at or below this node its initial raw value back and marks it untouched, in one batch; with
   * `raw` other than `undefined`, makes `raw` the initial value first, read as `set` reads it. On the root, also
   * clears `submitted`.
   * @mutates this
   * @sharing structural
   * @complexity O(n) (n = nodes at or below this node), plus the notifications of the graph
   * @throws TypeError when a group, this node or one below, is given anything else than an object, nothing written
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

// What a schema answered: its value, or its issues, their paths from the root of the form.
interface Answer {
  readonly value?: unknown;
  readonly issues: readonly Issue[];
}

// What a promise of a schema settled to, by promise.
type Settled = WeakMap<object, Answer>;

const NONE: readonly never[] = [];
const PENDING: Answer = { issues: NONE };
const DANGEROUS = ['__proto__', 'constructor', 'prototype'];

function check(holds: unknown, message: string): asserts holds {
  if (!holds) {
    throw new TypeError(message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return isObject(value) && typeof value['then'] === 'function';
}

function checkOptions(options: unknown): void {
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
    const kind = (children[key] as Partial<Spec> | null)?.kind;
    check(kind === 'field' || kind === 'group', `${key} is not a spec of field or group`);
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
  const read = (result: StandardResult<unknown>): Answer =>
    !result.issues
      ? { value: result.value, issues: NONE }
      : result.issues.length
        ? { issues: result.issues.map((issue) => place(fromStandardIssue(issue))) }
        : failed(path);
  const props = schema['~standard'];
  if (props.vendor === 'yaltaan' && typeof (schema as Partial<Schema>)['~run'] === 'function') {
    const result = parse(schema as Schema, value);
    return result.ok ? { value: result.value, issues: NONE } : { issues: result.error.map(place) };
  }
  const result = props.validate(value);
  return isThenable(result)
    ? Promise.resolve(result)
        .then(read)
        .catch((reason: unknown) => failed(path, reason))
    : read(result);
}

const compose = (keys: readonly string[], values: readonly unknown[]): unknown =>
  Object.fromEntries(keys.map((key, index) => [key, values[index]]));

const some = (...values: unknown[]): boolean => values.some((value) => value === true || value === PENDING);

// The same read value: issues are kept by `equal` upstream, so an error compares by identity, as a value does.
const sameParsed = (a: Result<unknown, readonly Issue[]>, b: Result<unknown, readonly Issue[]>): boolean =>
  a.ok ? b.ok && Object.is(a.value, b.value) : !b.ok && a.error === b.error;

// Each field at or below `node`, with its value in `raw` when `read`: the value of each group read once, through its
// own properties, and refused when it is not an object.
function fieldsOf(node: Node, raw?: unknown, read?: boolean, into: [Field, unknown][] = []): [Field, unknown][] {
  if (!node.children) {
    into.push([node as Field, raw]);
    return into;
  }
  if (read) {
    check(isObject(raw), 'a group is set to an object');
  }
  for (const key of Object.keys(node.children)) {
    const value = read && Object.hasOwn(raw as object, key) ? (raw as Record<string, unknown>)[key] : undefined;
    fieldsOf(node.children[key]!, value, read, into);
  }
  return into;
}

class Node {
  declare readonly kind: 'field' | 'group';
  declare readonly path: Path;
  declare readonly spec: Spec;
  declare readonly parent: Node | undefined;
  declare readonly graph: Graph;
  declare readonly submitted: SourceNode<boolean>;
  declare readonly children: Readonly<Record<string, Node>> | undefined;
  declare readonly raw: ReadableNode<unknown>;
  declare readonly dirty: ReadableNode<boolean>;
  declare readonly touched: ReadableNode<boolean>;
  declare disabled: ReadableNode<boolean>;
  declare issues: ReadableNode<readonly Issue[]>;
  declare pending: ReadableNode<boolean>;
  declare parsed: ReadableNode<Result<unknown, readonly Issue[]>>;
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

  set(raw: unknown): void {
    const fields = fieldsOf(this, raw, true);
    this.graph.batch(() => fields.forEach(([field, value]) => field.value.set(value)));
  }

  touch(): void {
    this.graph.batch(() => fieldsOf(this).forEach(([field]) => field.marked.set(true)));
  }

  reset(raw?: unknown): void {
    const given = raw !== undefined;
    const fields = fieldsOf(this, raw, given);
    this.graph.batch(() => {
      for (const [field, value] of fields) {
        if (given) {
          field.start.set(value);
        }
        field.value.set(field.start.get());
        field.marked.set(false);
      }
      if (!this.parent) {
        this.submitted.set(false);
      }
    });
  }
}

class Field extends Node {
  declare readonly value: SourceNode<unknown>;
  declare readonly start: SourceNode<unknown>;
  declare readonly marked: SourceNode<boolean>;
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

// Builds the sources of a node and the states that only follow its children; the others need the whole tree.
function build(spec: Spec, path: Path, parent: Node | undefined, graph: Graph, submitted: SourceNode<boolean>): Node {
  const node = new (spec.kind === 'field' ? Field : Node)() as Writable<Field>;
  Object.assign(node, { kind: spec.kind, path, spec, parent, graph, submitted });
  if (spec.kind === 'field') {
    const equals = (spec.options as FieldOptions<unknown>).equals ?? equal;
    node.value = node.raw = graph.source(spec.initial);
    node.start = graph.source(spec.initial);
    node.marked = node.touched = graph.source(false);
    node.dirty = graph.derived([node.start, node.value], (initial, raw) => !equals(initial, raw));
  } else {
    const keys = Object.keys(spec.children);
    const children = keys.map((key) => build(spec.children[key] as Spec, [...path, key], node, graph, submitted));
    node.children = compose(keys, children) as Record<string, Node>;
    node.raw = graph.derived(
      children.map((child) => child.raw),
      (...values) => compose(keys, values),
    );
    node.dirty = graph.derived(
      children.map((child) => child.dirty),
      some,
    );
    node.touched = graph.derived(
      children.map((child) => child.touched),
      some,
    );
  }
  return node;
}

// The node `path` names from `root`, through group keys.
function find(root: Node, path: Path): Node {
  check(Array.isArray(path), 'a condition reads paths');
  let node: Node | undefined = root;
  for (const key of path) {
    node =
      typeof key === 'string' && node?.children && Object.hasOwn(node.children, key) ? node.children[key] : undefined;
  }
  check(node, 'a condition reads a path that names no node of this form');
  return node;
}

interface Shared {
  readonly root: Node;
  readonly settled: Settled;
  readonly no: ReadableNode<boolean>;
  readonly none: ReadableNode<readonly Issue[]>;
}

// Builds the states that read other nodes than its children, from the root down, then those that follow its
// children, from the leaves up: a node's dependencies always exist before it.
function wire(node: Node, shared: Shared): void {
  const { graph, spec, parent, path } = node;
  const { schema, disabled } = spec.options;
  const own =
    disabled &&
    graph.derived(
      disabled.reads.map((read) => find(shared.root, read).raw),
      (...values) => !!disabled.when(...values),
    );
  node.disabled = own ? (parent ? graph.derived([parent.disabled, own], some) : own) : (parent?.disabled ?? shared.no);
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
    node.placed = graph.derived([node.answer], ({ issues }) => {
      const placed = new Map<Node, Issue[]>();
      for (const issue of issues) {
        let target = node;
        for (const key of issue.path.slice(path.length)) {
          const next: Node | undefined =
            typeof key === 'string' && target.children && Object.hasOwn(target.children, key)
              ? target.children[key]
              : undefined;
          if (!next) {
            break;
          }
          target = next;
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
  const children = Object.values(node.children ?? {});
  for (const child of children) {
    wire(child, shared);
  }
  const below = [...(node.answer ? [node.answer] : []), ...children.map((child) => child.below)];
  node.below = below.length ? graph.derived(below, some) : shared.no;
  node.pending =
    node.above === shared.no
      ? node.below
      : node.below === shared.no
        ? node.above
        : graph.derived([node.above, node.below], some);
  node.all = children.length
    ? graph.derived([node.issues, ...children.map((child) => child.all)], (...lists) => lists.flat(), { equals: equal })
    : node.issues;
  node.output = node.answer
    ? graph.derived([node.answer], (answer) => answer.value)
    : node.children
      ? graph.derived(
          children.map((child) => child.output),
          (...values) => compose(Object.keys(node.children!), values),
        )
      : node.raw;
  node.parsed = graph.derived(
    [node.all, node.pending, node.output],
    (all, pending, output) => (all.length || pending ? err(all) : ok(output)),
    { equals: sameParsed },
  );
}

/**
 * The form `spec` describes: a node for each field and group, on one graph, every value and state a node of it that
 * computes when read, and again only once what it reads has changed.
 * @pure
 * @sharing structural
 * @complexity O(n × d) (n = fields, groups and the paths their conditions read, d = depth of the tree), each node
 *   holding its path
 * @throws TypeError when `spec` is not a spec of `field` or `group`, or a condition reads a path that names no node
 *   of the form
 * @throws TypeError when `graph` is not a graph
 * @throws RangeError when groups are nested deeper than the call stack allows
 * @since 0.3
 * @experimental
 * @example
 * const form = createForm(group({ email: field('', { schema: string({ minLength: 3 }) }) }));
 * form.children.email.set('ada@example.org');
 * form.submit() // { ok: true, value: { email: 'ada@example.org' } }
 */
export function createForm<S extends Spec>(spec: S, options: FormOptions = {}): Form<S> {
  check(spec?.kind === 'field' || spec?.kind === 'group', 'spec is a spec of field or group');
  const graph = options.graph ?? createGraph();
  const submitted = graph.source(false);
  const root = build(spec, [], undefined, graph, submitted);
  wire(root, { root, settled: new WeakMap(), no: graph.source(false), none: graph.source(NONE) });
  return Object.assign(root, {
    submit: (): Result<unknown, readonly Issue[]> => {
      graph.batch(() => {
        root.touch();
        submitted.set(true);
      });
      return root.parsed.get();
    },
  }) as unknown as Form<S>;
}
