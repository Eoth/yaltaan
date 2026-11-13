// The types of a form, which index.ts exports: the specs `field`, `group` and `array` build, their options, the nodes
// `createForm` builds and what each holds. Nothing here runs: node.ts and array.ts build what these describe.
import type { Issue } from '@yaltaan/core/issue';
import type { Path } from '@yaltaan/core/path';
import type { Graph, ReadableNode } from '@yaltaan/core/reactive';
import type { Result } from '@yaltaan/core/result';
import type { Condition, Rule } from '@yaltaan/rules';
import type { StandardSchema } from '@yaltaan/schema';

declare global {
  // The signal of the platform, which browsers and Node both give, named empty so that the declarations of the form
  // compile in an application that reads neither the DOM's library nor Node's; either library merges in whole.
  interface AbortSignal {}
}

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
 * What a validator of the application is handed beside the raw value it checks.
 * @since 0.3
 * @experimental
 */
export interface Validation {
  /**
   * Aborted when this run stops counting before the form has received its answer: when its node is next read after its
   * raw value changed, when a schema or a rule places an issue on the node or below, or when the node leaves the form,
   * an item removed. Aborted on the next microtask, out of any computation of the graph: what listens to it may read
   * the form.
   */
  readonly signal: AbortSignal;
  /** The path of the node, from the root of the form. */
  readonly path: Path;
}

/**
 * The options a field, a group and an array share.
 * @since 0.3
 * @experimental
 */
export interface NodeSpecOptions<Output, Raw = unknown> {
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
  /**
   * Checks the node's raw value, as the application alone can, a server's answer for instance: returns the issues
   * found, their paths from this node, placed as a schema's are, or a promise of them; an empty list when there is
   * none. Called with a signal of its own when a state that needs its answer is read and no run counts, once no schema
   * or rule of this node, of a node below or of an ancestor has placed an issue that is not a warning on it or below,
   * nor a schema has yet to answer. A run counts until the raw value, or the lives of the items that hold the node,
   * change, a schema or a rule places such an issue, or the node leaves the form; a schema that has yet to answer
   * neither starts nor drops one, so that a write elsewhere asks nothing again, and an item given back by `reset()`
   * asks again. A promise that rejects places
   * `form.validation_failed` on the node, the reason as `cause`, and so does an answer that is not a list of issues, or
   * that throws when read, that answer or the error as `cause`; what it throws at once is thrown by every state that
   * depends on it. Called from a computation of the graph: must not read or write the form's graph.
   * @supplied
   */
  validate?(raw: Raw, validation: Validation): readonly Issue[] | PromiseLike<readonly Issue[]>;
  /**
   * Rules across the fields of the node, as `@yaltaan/rules` writes them, their paths from this node, each checked
   * against the description when the form is built: a group's segment names a child, any segment of an array stands
   * for every item, and a path into a field reads the field. Each rule is a node of the graph that reads the raw values
   * of the paths it declares and nothing else, as `checkRules` would read the raw value of the node, so that a sub-form
   * left empty is an object, not a blank; it is checked again only once one of them changes, or the items of an array
   * on its way do, and only when a state that needs it is read. Its issues keep
   * their code, placed as a schema's are, after the schema's of the same node; what `required` gives makes those nodes
   * required. What a rule throws is thrown by every state that depends on it.
   */
  readonly rules?: readonly Rule[];
}

/**
 * The options of a field.
 * @since 0.3
 * @experimental
 */
export interface FieldOptions<Raw, Output = Raw> extends NodeSpecOptions<Output, Raw> {
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
export type GroupOptions<Output, Raw = unknown> = NodeSpecOptions<Output, Raw>;

/**
 * The options of an array.
 * @since 0.3
 * @experimental
 */
export interface ArrayOptions<Item, Output = Item[]> extends NodeSpecOptions<Output, Item[]> {
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
   * The read value: the issues of this node and of its descendants while one of them is not a warning or the node is
   * pending (with the issues known so far), the parsed value otherwise.
   */
  readonly parsed: ReadableNode<Result<Output, readonly Issue[]>>;
  /**
   * The issues placed on this node by the schemas, validators and rules of the node and of its ancestors, the
   * outermost first, a node's schema or validator before its rules.
   */
  readonly issues: ReadableNode<readonly Issue[]>;
  /** Whether a rule of the node or of an ancestor requires this node, by its `required` on the values it reads. */
  readonly required: ReadableNode<boolean>;
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
