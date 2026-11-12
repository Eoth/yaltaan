// The arrays of a form (index.ts tells what each state means): `array`, and the node of an array, which builds its
// items, writes and plans its lists, names an item in a raw value, and rewires the states that follow its items each
// time they change (ADR 0044). Only the spec `array` builds reaches this module, so that a form without an array ships
// none of it.
import { equal } from '@yaltaan/core/equal';
import type { Path } from '@yaltaan/core/path';
import { rewire, type ReadableNode, type SourceNode } from '@yaltaan/core/reactive';

import {
  build,
  check,
  checkOptions,
  doubtsOf,
  initialOf,
  isObject,
  isSpec,
  NONE,
  Node,
  own,
  plan,
  some,
  under,
  wire,
  writesOf,
  type Mode,
  type Writes,
} from './node.ts';
import type { ArrayOptions, ArraySpec, FieldOptions, OutputOf, RawOf, Spec } from './types.ts';

const MAX_LENGTH = 1000;
// V8 hashes a longer string by its length alone: keys are compared on this many code units, as @yaltaan/rules does.
const KEY_LENGTH = 16_000;
const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

// A key as two keys are compared, by SameValueZero on their first `KEY_LENGTH` code units.
const bounded = (key: unknown): unknown => (typeof key === 'string' ? key.slice(0, KEY_LENGTH) : key);

const sameKey = (a: unknown, b: unknown): boolean => new Set([bounded(a)]).has(bounded(b));

/**
 * An array of items, each built from `element`: its raw value is the list of theirs. Each item holds a key for as long
 * as it lives, its business key at `identity` or one the form gives it, so that its states and its issues follow it
 * when it moves; `initial` items are read and checked when a form is built.
 * @pure
 * @sharing structural
 * @complexity O(1)
 * @throws TypeError when `element` is not a spec, or an option is not of its kind: `schema` a Standard Schema,
 *   `disabled` a condition, `validate` a function, `initial` an array, `identity` a path, `maxLength` a whole number
 *   from 0
 * @since 0.3
 * @experimental
 * @example array(group({ sku: field(''), qty: field(1) }), { identity: ['sku'], initial: [{ sku: 'A', qty: 2 }] })
 */
export function array<const E extends Spec, Output = OutputOf<E>[]>(
  element: E,
  options: ArrayOptions<RawOf<NoInfer<E>>, Output> = {},
): ArraySpec<E, NoInfer<Output>> {
  check(isSpec(element), 'element is a spec of field, group or array');
  checkOptions(options);
  const { initial, identity, maxLength } = options as { readonly [K in keyof ArrayOptions<unknown>]?: unknown };
  check(initial === undefined || Array.isArray(initial), 'initial is a list of items');
  check(identity === undefined || Array.isArray(identity), 'identity is a path');
  check(maxLength === undefined || (Number.isInteger(maxLength) && (maxLength as number) >= 0), 'maxLength is whole');
  return { kind: 'array', element, options, type: List } as ArraySpec<E, NoInfer<Output>>;
}

// The key at `identity` in an item's raw value, through own properties.
const keyAt = (value: unknown, identity: Path): unknown =>
  identity.reduce<unknown>((at, key) => own(at, key as PropertyKey), value);

// What an array spec holds beside what its type shows.
export interface ArrayInternal extends ArraySpec {
  readonly type: typeof List;
}

// An array node, and all that only arrays do, reached only through the spec `array` builds.
export class List extends Node {
  declare readonly items: SourceNode<readonly Node[]>;

  override get dirty(): ReadableNode<boolean> {
    return (this.dirtyNode ??= this.graph.derived(
      [this.start, this.raw],
      (initial, raw) => !same(this.spec, initial, raw),
    ));
  }

  // Builds its items from `value`, a list as the form holds it, and the states that follow them.
  fill(value: unknown[]): void {
    const { graph, rows } = this.shared;
    const items = value.map((inner) => item(this, inner));
    Object.assign(this, { items: graph.source<readonly Node[]>(items), first: items, start: graph.source(value) });
    Object.assign(this, {
      raw: graph.derived([this.items, ...items.map((inner) => inner.raw)], (list, ...values) => {
        rows.set(values, list);
        return values;
      }),
      touched: graph.derived(
        items.map((inner) => inner.touched),
        some,
      ),
    });
  }

  insert(index: number, raw?: unknown): Node {
    const items = this.items!.get();
    const { element, options } = this.spec as ArraySpec;
    checkIndex(index, items.length);
    if (items.length >= (options.maxLength ?? MAX_LENGTH)) {
      throw new RangeError('an array holds no more items than its maxLength');
    }
    const writes = writesOf(this.shared);
    const value = raw === undefined ? initialOf(element, writes) : plan(element, undefined, raw, 'set', writes);
    const { identity } = options;
    if (identity) {
      const key = keyAt(value, identity);
      check(
        !isBlank(key) && !items.some((item) => sameKey(keyAt(item.raw.get(), identity), key)),
        "an item's key is blank or taken",
      );
    }
    return this.graph.batch(() => {
      const node = item(this, value);
      wire(node, this.shared);
      relist(this, items.toSpliced(index, 0, node));
      return node;
    });
  }

  remove(node: Node): boolean {
    const items = this.items!.get();
    const index = items.indexOf(node);
    if (index >= 0) {
      this.graph.batch(() => relist(this, items.toSpliced(index, 1)));
    }
    return index >= 0;
  }

  move(node: Node, index: number): boolean {
    const items = this.items!.get();
    checkIndex(index, items.length - 1);
    const from = items.indexOf(node);
    if (from >= 0 && from !== index) {
      this.graph.batch(() => relist(this, items.toSpliced(from, 1).toSpliced(index, 0, node)));
    }
    return from >= 0;
  }

  // Writes what `plan` noted for this array, in the batch of the caller: its items, kept or built, and its initial
  // list on a reset.
  commit(entries: readonly (Node | { readonly value: unknown })[], values: unknown[], how: Mode): void {
    const items = entries.map((entry) => {
      if (entry instanceof Node) {
        return entry;
      }
      const built = item(this, entry.value);
      wire(built, this.shared);
      return built;
    });
    const current = this.items.get();
    if (items.length !== current.length || items.some((node, index) => node !== current[index])) {
      relist(this, items);
    }
    if (how !== 'set') {
      this.first = items;
      this.start.set(values);
    }
  }

  // The item `segment` names in `value`, a raw value of this array as a schema read it, by its index or its
  // `{ key }`: the key that value holds at `identity`, or the key the form gave the item; and its raw value there.
  named(segment: unknown, value: unknown): [Node, unknown] | undefined {
    const items = (isObject(value) && this.shared.rows.get(value)) || NONE;
    const { identity } = (this.spec as ArraySpec).options;
    const index =
      typeof segment === 'number'
        ? segment
        : isObject(segment)
          ? identity
            ? (value as unknown[]).findIndex((inner) => sameKey(keyAt(inner, identity), segment['key']))
            : items.findIndex((node) => sameKey(node.key, segment['key']))
          : -1;
    const found = items[index];
    return found && [found, (value as unknown[])[index]];
  }

  // The array part of `plan`.
  static plan(
    spec: ArraySpec<Spec, unknown>,
    node: List | undefined,
    raw: unknown,
    mode: Mode,
    writes: Writes,
  ): unknown {
    const restore = mode === 'restore';
    const { element, options } = spec;
    const { identity, maxLength = MAX_LENGTH } = options;
    if (restore) {
      const values = node!.first.map((item) => plan(element, item, undefined, mode, writes));
      writes.arrays.push([node!, [...node!.first], values, mode]);
      return values;
    }
    check(Array.isArray(raw), 'an array is set to an array');
    const { length } = raw;
    if (length > maxLength) {
      throw new RangeError('an array holds no more items than its maxLength');
    }
    if ((writes.left -= length) < 0) {
      throw new RangeError("a write reads no more items than its form's maxItems");
    }
    const current = node?.items!.get() ?? NONE;
    const kept = new Map(identity ? current.map((item) => [bounded(keyAt(item.raw.get(), identity)), item]) : NONE);
    const seen = new Set<unknown>();
    const values: unknown[] = [];
    const items = Array.from({ length }, (_, index) => {
      const value = own(raw, index);
      let found = current[index];
      if (identity) {
        const key = bounded(keyAt(value, identity));
        check(!isBlank(key) && !seen.has(key), "an item's key is blank or taken");
        seen.add(key);
        found = kept.get(key);
      }
      values.push(plan(element, found, value, mode, writes));
      return found ?? { value: values[index] };
    });
    if (node) {
      writes.arrays.push([node, items, values, mode]);
    }
    return values;
  }
}

// Whether two raw values of `spec`, as the form holds them, are the same by the comparisons of its fields.
function same(spec: Spec, initial: unknown, raw: unknown): boolean {
  if (spec.kind === 'field') {
    return ((spec.options as FieldOptions<unknown>).equals ?? equal)(initial, raw);
  }
  if (spec.kind === 'group') {
    return Object.keys(spec.children).every((key) => same(spec.children[key]!, own(initial, key), own(raw, key)));
  }
  const [a, b] = [initial as unknown[], raw as unknown[]];
  return a.length === b.length && a.every((item, index) => same(spec.element, item, b[index]));
}

function checkIndex(index: number, last: number): void {
  if (!Number.isInteger(index) || index < 0 || index > last) {
    throw new RangeError(`an index is a whole number from 0 to ${last}`);
  }
}

// An item of `array` built from `value`, a raw value as the form holds it, with the next key of the form.
function item(array: Node, value: unknown): Node {
  const key = array.shared.keys++;
  return build((array.spec as ArraySpec).element, [...array.path, { key }], array, array.shared, value, key);
}

// Aborts the runs in flight of the validators at or below `node`.
function stopAll(node: Node): void {
  node.stop?.();
  under(node).forEach(stopAll);
}

// Gives an array its items, and rewires to them the states that follow them, in the batch of the caller; the validators
// of an item that leaves are aborted and stay idle until it comes back, by `reset()`, when they may ask again.
function relist(array: Node, items: readonly Node[]): void {
  const { answer } = array;
  const before = array.items!.get();
  array.items!.set(items);
  rewire(array.raw, [array.items!, ...items.map((item) => item.raw)]);
  rewire(
    array.touched,
    items.map((item) => item.touched),
  );
  rewire(array.below, [...(answer ? [answer] : []), ...items.map((item) => item.below)]);
  rewire(array.all, [array.issues, ...items.map((item) => item.all)]);
  if (!array.own) {
    rewire(
      array.output,
      items.map((item) => item.output),
    );
  }
  if (array.doubt) {
    rewire(array.doubt, doubtsOf(array));
  }
  const kept = new Set(items);
  for (const item of before) {
    if (item.life && !kept.has(item)) {
      item.life.set(null);
      stopAll(item);
    }
  }
  for (const item of items) {
    if (item.life?.get() === null) {
      item.life.set({});
    }
  }
}
