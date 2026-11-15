// The bridge between Yaltaan and Angular Signal Forms (ARCHITECTURE.md §7.12, ADR 0048): a node of the reactive graph
// as an Angular signal, each state of a node of @yaltaan/form as one, and the rules of @yaltaan/rules as validators of
// Signal Forms. It holds no state of its own: a signal follows its node, and Angular holds what a validator computes.
// Nothing runs on import.
//
// The source of @yaltaan/angular, kept beside the interoperability scripts until Angular is a development dependency of
// the workspace (ADR 0048): tests/interop/run.sh compiles it against the declarations of Angular
// 22.2.4, runs it there, and measures it.
//
// A rule runs as one tree validator of Signal Forms, which reads, through the fields of the form, only the paths the
// rule declares, each down to its first index or `anyElement`, the list then read whole: Angular checks it again only
// once one of those values changes, as it checks a validator an application writes. What the rule requires is a
// metadata of the field the rules stand on, computed once for every field it may name, which each such field compares
// with its own path.
import { computed, DestroyRef, inject, Injector, signal, untracked, type Signal } from '@angular/core';
import {
  applyEach,
  createMetadataKey,
  metadata,
  type MetadataKey,
  REQUIRED,
  validateTree,
  type PathKind,
  type ReadonlyFieldTree,
  type RootFieldContext,
  type SchemaPath,
  type SchemaPathRules,
  type ValidationError,
} from '@angular/forms/signals';
import type { Issue, IssueFormatter } from '@yaltaan/core/issue';
import type { KeySegment, Path } from '@yaltaan/core/path';
import type { ReadableNode } from '@yaltaan/core/reactive';
import type { FormNode } from '@yaltaan/form';
import { checkRules, type Rule } from '@yaltaan/rules';

/**
 * The options of `fromNode` and `signalsOf`.
 * @since 0.3
 * @experimental
 */
export interface FromNodeOptions {
  /** The injector whose destruction ends the subscriptions; that of the current injection context by default. */
  readonly injector?: Injector;
}

/**
 * A signal that follows `node`: its value, computed when the signal is read, and what it throws. Subscribed to the node
 * until the injector is destroyed, that of the current injection context or `injector`; the signal then keeps the last
 * value it read.
 * @mutates node (one subscription, until the injector is destroyed)
 * @sharing structural
 * @complexity O(1); a read costs that of `node.get()`
 * @throws Error (NG0203) when called outside an injection context without `injector`
 * @throws Error (NG0205, NG0911) when the injector, or the component, is already destroyed; nothing subscribed
 * @since 0.3
 * @experimental
 * @example const total = fromNode(graph.derived([price], (value) => value * 2)); // in a component's field
 */
export function fromNode<T>(node: ReadableNode<T>, options: FromNodeOptions = {}): Signal<T> {
  const version = signal(0);
  // The end first: a destroyed injector refuses it, before anything is subscribed that nothing would end.
  let stop = (): void => {};
  (options.injector ?? inject(Injector)).get(DestroyRef).onDestroy(() => stop());
  stop = node.subscribe(() => version.update((count) => count + 1));
  return computed(() => {
    version();
    return node.get();
  });
}

/** The states of a node of the form that `signalsOf` turns into signals, the items of an array among them. */
const STATES = [
  'raw',
  'parsed',
  'issues',
  'required',
  'dirty',
  'touched',
  'pending',
  'submitted',
  'disabled',
  'hidden',
  'readonly',
  'items',
] as const;

type State = (typeof STATES)[number];

/**
 * Each state of a node of @yaltaan/form as a signal, `items` of an array included; `children` of a group, the same for
 * each child.
 * @since 0.3
 * @experimental
 */
export type NodeSignals<N> = {
  readonly [K in Extract<keyof N, State>]: N[K] extends ReadableNode<infer T> ? Signal<T> : never;
} & (N extends { readonly children: infer C }
  ? { readonly children: { readonly [K in keyof C]: NodeSignals<C[K]> } }
  : unknown);

/**
 * Each state of `node`, a node of @yaltaan/form, as a signal that `fromNode` makes on its first read, shown as the form
 * gives it: `dirty` on a read-only node too, where Angular hides it, and nothing hidden on a node left out of the
 * submission. A group's `children` are reached the same way, each made on the first read of `children`; an array's
 * `items` is a signal of its item nodes, whose states `signalsOf` reads in turn. Every subscription ends with the
 * injector of the call, which is captured then, so that a template may read a state for the first time. Each call
 * subscribes anew, until that injector is destroyed: call it once per node, in a constructor or a field initializer,
 * an item's in the component of its row, so that a row removed takes its subscriptions with it; views made in a
 * `computed` over `items` would pile up the subscriptions of every item ever shown.
 * @mutates node (one subscription per state read, until the injector is destroyed)
 * @sharing structural
 * @complexity O(1), and O(c) on the first read of `children` (c = children of the group)
 * @throws Error (NG0203) when called outside an injection context without `injector`
 * @since 0.3
 * @experimental
 * @example const email = signalsOf(form.children.email); // email.issues(), email.dirty() in the template
 */
export function signalsOf<N extends FormNode<unknown, unknown>>(
  node: N,
  options: FromNodeOptions = {},
): NodeSignals<N> {
  const injector = options.injector ?? inject(Injector);
  const view = {};
  const lazy = (name: string, make: () => unknown): void => {
    Object.defineProperty(view, name, {
      configurable: true,
      enumerable: true,
      get: () => {
        const value = make();
        Object.defineProperty(view, name, { value, enumerable: true });
        return value;
      },
    });
  };
  const states = node as unknown as Readonly<Record<string, ReadableNode<unknown>>>;
  for (const name of STATES) {
    if (name in node) {
      lazy(name, () => fromNode(states[name]!, { injector }));
    }
  }
  if ('children' in node) {
    const children = node.children as Readonly<Record<string, FormNode<unknown, unknown>>>;
    lazy('children', () =>
      Object.fromEntries(Object.entries(children).map(([key, child]) => [key, signalsOf(child, { injector })])),
    );
  }
  return view as NodeSignals<N>;
}

/**
 * The options of `validateRules`.
 * @since 0.3
 * @experimental
 */
export interface ValidateRulesOptions {
  /**
   * Builds the message of the error of an issue; the issue's code by default, as `refine` of @yaltaan/rules does.
   * Called once per issue, when Angular computes the errors.
   * @supplied
   */
  readonly format?: IssueFormatter;
  /**
   * The current index of the element a `{ key }` names, in the list at `parent`, from the values the rule read: without
   * it, an error stops at the list that holds the element, and a field so named is not marked as required. Called for
   * each `{ key }` of each issue and required path, up to some thousands of times a check on a list a user fills: a
   * search through the list makes the check quadratic, where a map of the keys built once per list does not.
   * @supplied
   */
  readonly resolveKey?: (segment: KeySegment, parent: Path, values: unknown) => number | undefined;
}

// A field of the form, read by key; a path of the schema being defined, of any kind; an issue on its way to a field.
interface Tree {
  (): { value: () => unknown };
  readonly [key: PropertyKey]: unknown;
}
type AnyPath = SchemaPath<unknown, SchemaPathRules.Supported, PathKind>;
type Error = ValidationError.WithOptionalFieldTree;
type Key<T> = MetadataKey<Signal<T | undefined>, T, T | undefined>;
interface Found {
  readonly kind: string;
  readonly message: string;
  readonly keys: readonly PropertyKey[];
}
const childPath = (path: AnyPath, key: string): AnyPath => (path as unknown as Readonly<Record<string, AnyPath>>)[key]!;

// The deepest field on the way of `keys`, and how many keys it took: a field is a function, which `length` of a list
// is not. Angular builds no field for a key whose value is `undefined`, nor under a value that is no object; once it
// becomes one, it builds them only where logic stands below, or a field there is asked for.
function walk(tree: Tree, keys: readonly PropertyKey[]): readonly [Tree, number] {
  let field = tree;
  let taken = 0;
  for (; taken < keys.length; taken += 1) {
    const next = field[keys[taken]!];
    if (typeof next !== 'function') {
      break;
    }
    field = next as Tree;
  }
  return [field, taken];
}

// What a rule reads, from the field it stands on: each declared path down to its first index or `anyElement`, a path
// under another one left to it, so that the values hold only what the rule declares and no value read is written into.
function pointsOf(reads: readonly Path[]): readonly (readonly string[])[] {
  const points = reads.map((declared) => {
    const end = declared.findIndex((segment) => typeof segment !== 'string');
    return (end === -1 ? declared : declared.slice(0, end)) as readonly string[];
  });
  return points.filter(
    (keys, index) =>
      !points.some(
        (other, at) =>
          (other.length < keys.length || (other.length === keys.length && at < index)) &&
          other.every((key, position) => key === keys[position]),
      ),
  );
}

// The values a rule reads at these points: each from the deepest field on its way. Past it, under an object, the value
// is absent, and a field that appears is seen through the children Angular holds, which it builds once one is asked
// for, so that nothing depends on the whole object; under a list, `null` or a primitive, which hold no field Angular
// builds as they change, the value is read, and then its own keys, such as the length of a list.
function reader(points: readonly (readonly string[])[]): (tree: Tree) => unknown {
  return (tree) => {
    const values: Record<string, unknown> = Object.create(null);
    for (const keys of points) {
      const [field, taken] = walk(tree, keys);
      const above = taken < keys.length && untracked(field().value);
      let value = typeof above === 'object' && above !== null && !Array.isArray(above) ? undefined : field().value();
      for (let index = taken; index < keys.length && value !== undefined; index += 1) {
        value =
          typeof value === 'object' && value !== null && Object.hasOwn(value, keys[index]!)
            ? (value as Record<string, unknown>)[keys[index]!]
            : undefined;
      }
      if (keys.length === 0) {
        return value;
      }
      let parent = values;
      for (let index = 0; index < keys.length - 1; index += 1) {
        parent = (parent[keys[index]!] ??= Object.create(null)) as Record<string, unknown>;
      }
      parent[keys[keys.length - 1]!] = value;
    }
    return values;
  };
}

// The keys of `path` in the form, each `{ key }` replaced by the index `resolveKey` gives: stops before one it does not
// resolve.
function keysOf(path: Path, values: unknown, resolveKey: ValidateRulesOptions['resolveKey']): PropertyKey[] {
  const keys: PropertyKey[] = [];
  for (const segment of path) {
    const key = typeof segment === 'object' ? resolveKey?.(segment, path.slice(0, keys.length), values) : segment;
    if (key === undefined || key === -1) {
      break;
    }
    if (typeof segment === 'object' && !(Number.isSafeInteger(key) && (key as number) >= 0)) {
      throw new TypeError(`resolveKey returned ${String(key)}, not an index, -1 or undefined`);
    }
    keys.push(key);
  }
  return keys;
}

// Marks as required, where `when` holds, the fields `target` names under `path`: an index or `anyElement` stands for
// every item of the list, each item comparing its own path.
function mark(path: AnyPath, target: Path, from: number, when: (context: RootFieldContext<unknown>) => boolean): void {
  for (let index = from; index < target.length; index += 1) {
    const segment = target[index];
    if (typeof segment !== 'string') {
      applyEach(path as SchemaPath<readonly unknown[]>, (item) => mark(item, target, index + 1, when));
      return;
    }
    path = childPath(path, segment);
  }
  metadata(path, REQUIRED, when);
}

/**
 * The rules, in the schema function of Signal Forms' `form`, on the value at `path`: their issues but warnings, each an
 * error of kind its code, placed on the field its path names or the deepest one that exists on the way, as tree errors
 * at `path`; the fields that `required` of a rule names marked as required, which adds no error of Angular's (the
 * rule's issue says what is missing), where a target of the rule names them, `anyElement` or an index standing for
 * each item: Angular marks only a field named when the schema is defined, so that a field a rule requires under a
 * target, not at one, is not marked. A rule reads, and is checked again for, only the values its `reads` declare, each
 * down to its first index or `anyElement`, the list then read whole; a field built or removed on the way of one of its
 * issues places it again, without checking. It reads what Angular holds, hidden and disabled fields included, whose
 * errors Angular does not show. Up to 1,000 errors per rule, then `rules.too_many_issues`, as `checkRules` gives.
 * @mutates path (validators and metadata of the schema being defined)
 * @sharing none
 * @complexity O(r × d) to define (r = rules, d = paths they declare); a check costs that of the rule, O(d) reads and
 *   a call of `resolveKey` per `{ key }` of each issue and required path; Angular then filters the tree errors of
 *   `path` for each field below it
 * @throws TypeError when `rules` is not an array of rules
 * @throws Error when called outside a schema function of Signal Forms
 * @throws what a rule, `format` or `resolveKey` throws, unchanged, when Angular computes the errors or the required
 *   fields; TypeError when `resolveKey` returns something else than an index, -1 or undefined
 * @since 0.3
 * @experimental
 * @example form(model, (path) => validateRules(path, [allOrNone([['number'], ['signedOn']])]), { injector })
 */
export function validateRules<TValue, TPathKind extends PathKind = PathKind.Root>(
  path: SchemaPath<TValue, SchemaPathRules.Supported, TPathKind>,
  rules: readonly Rule[],
  options: ValidateRulesOptions = {},
): void {
  if (!Array.isArray(rules) || !rules.every((rule: Partial<Rule> | null) => typeof rule?.check === 'function')) {
    throw new TypeError('not an array of rules');
  }
  const { format = (issue: Issue) => issue.code, resolveKey } = options;
  const root = path as unknown as AnyPath;
  const gathered: Key<readonly Error[]>[] = [];
  for (const rule of rules) {
    const read = reader(pointsOf(rule.reads));
    const alone = [rule];
    // The check in a computation of its own, its errors placed in another: a field built or removed on the way of an
    // issue places it again, and checks nothing.
    const issuesOf = createMetadataKey<readonly Found[]>();
    metadata(root, issuesOf, ({ fieldTree }) => {
      const values = read(fieldTree as unknown as Tree);
      return checkRules(alone, values)
        .filter((issue) => issue.severity !== 'warning')
        .map((issue) => ({ kind: issue.code, message: format(issue), keys: keysOf(issue.path, values, resolveKey) }));
    });
    const errorsOf = createMetadataKey<readonly Error[]>();
    gathered.push(errorsOf);
    metadata(root, errorsOf, ({ fieldTree, state }) =>
      (state.metadata(issuesOf)?.() ?? []).map(({ kind, message, keys }) => {
        const [field, taken] = walk(fieldTree as unknown as Tree, keys);
        // No logic need stand below the field it stops at: its value, read, places the issue again once it changes.
        if (taken < keys.length) {
          field().value();
        }
        return { kind, message, fieldTree: field as unknown as ReadonlyFieldTree<unknown> };
      }),
    );
    const { required } = rule;
    if (required !== undefined) {
      const named = createMetadataKey<ReadonlySet<string>>();
      metadata(root, named, ({ fieldTree }) => {
        const values = read(fieldTree as unknown as Tree);
        const found = new Set<string>();
        for (const where of required(values)) {
          const keys = keysOf(where, values, resolveKey);
          if (keys.length === where.length) {
            found.add(JSON.stringify(keys.map(String)));
          }
        }
        return found;
      });
      for (const target of rule.targets) {
        mark(root, target, 0, ({ pathKeys, stateOf }) => {
          const keys = pathKeys();
          const own = JSON.stringify(keys.slice(keys.length - target.length));
          return stateOf(root).metadata(named)?.()?.has(own) ?? false;
        });
      }
    }
  }
  validateTree(root, ({ state }) => gathered.flatMap((errorsOf) => state.metadata(errorsOf)?.() ?? []));
}
