# `@yaltaan/angular`

Written by `node scripts/check-contract-tags.ts --update` from the contract tags of the published declarations ([ADR 0012](../adr/0012-contract-tag-checker.md)); never edited by hand: the verification gate fails when this folder differs from what the tags give.

## `@yaltaan/angular`

### `FromNodeOptions`

A type.

The options of `fromNode` and `signalsOf`.

```ts
export interface FromNodeOptions {
    /** The injector whose destruction ends the subscriptions; that of the current injection context by default. */
    readonly injector?: Injector;
}
```

| Contract | Value |
|---|---|
| `@since` | 0.3 |
| `@experimental` | yes |

### `NodeSignals`

A type.

Each state of a node of `@yaltaan/form` as a signal, `items` of an array included; `children` of a group, the same for each child.

```ts
export type NodeSignals<N> = {
    readonly [K in Extract<keyof N, State>]: N[K] extends ReadableNode<infer T> ? Signal<T> : never;
} & (N extends {
    readonly children: infer C;
} ? {
    readonly children: {
        readonly [K in keyof C]: NodeSignals<C[K]>;
    };
} : unknown);
```

| Contract | Value |
|---|---|
| `@since` | 0.3 |
| `@experimental` | yes |

### `ValidateRulesOptions`

A type.

The options of `validateRules`.

```ts
export interface ValidateRulesOptions {
    /**
     * Builds the message of the error of an issue; the issue's code by default, as `refine` of `@yaltaan/rules` does.
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
```

| Contract | Value |
|---|---|
| `@since` | 0.3 |
| `@experimental` | yes |

#### `ValidateRulesOptions.format`

A supplied member.

Builds the message of the error of an issue; the issue's code by default, as `refine` of `@yaltaan/rules` does. Called once per issue, when Angular computes the errors.

```ts
readonly format?: IssueFormatter;
```

| Contract | Value |
|---|---|
| `@supplied` | yes |

#### `ValidateRulesOptions.resolveKey`

A supplied member.

The current index of the element a `{ key }` names, in the list at `parent`, from the values the rule read: without it, an error stops at the list that holds the element, and a field so named is not marked as required. Called for each `{ key }` of each issue and required path, up to some thousands of times a check on a list a user fills: a search through the list makes the check quadratic, where a map of the keys built once per list does not.

```ts
readonly resolveKey?: (segment: KeySegment, parent: Path, values: unknown) => number | undefined;
```

| Contract | Value |
|---|---|
| `@supplied` | yes |

### `fromNode`

A function.

A signal that follows `node`: its value, computed when the signal is read, and what it throws. Subscribed to the node until the injector is destroyed, that of the current injection context or `injector`; the signal then keeps the last value it read.

```ts
export declare function fromNode<T>(node: ReadableNode<T>, options?: FromNodeOptions): Signal<T>;
```

| Contract | Value |
|---|---|
| `@mutates` | node |
| `@sharing` | structural |
| `@complexity` | O(1); a read costs that of `node.get()` |
| `@throws` | Error (NG0203) when called outside an injection context without `injector` |
| `@throws` | Error (NG0205, NG0911) when the injector, or the component, is already destroyed; nothing subscribed |
| `@since` | 0.3 |
| `@experimental` | yes |

**Example**

```ts
const total = fromNode(graph.derived([price], (value) => value * 2)); // in a component's field
```

### `signalsOf`

A function.

Each state of `node`, a node of `@yaltaan/form`, as a signal that `fromNode` makes on its first read, shown as the form gives it: `dirty` on a read-only node too, where Angular hides it, and nothing hidden on a node left out of the submission. A group's `children` are reached the same way, each made on the first read of `children`; an array's `items` is a signal of its item nodes, whose states `signalsOf` reads in turn. Every subscription ends with the injector of the call, which is captured then, so that a template may read a state for the first time. Each call subscribes anew, until that injector is destroyed: call it once per node, in a constructor or a field initializer, an item's in the component of its row, so that a row removed takes its subscriptions with it; views made in a `computed` over `items` would pile up the subscriptions of every item ever shown.

```ts
export declare function signalsOf<N extends FormNode<unknown, unknown>>(node: N, options?: FromNodeOptions): NodeSignals<N>;
```

| Contract | Value |
|---|---|
| `@mutates` | node |
| `@sharing` | structural |
| `@complexity` | O(1), and O(c) on the first read of `children` (c = children of the group) |
| `@throws` | Error (NG0203) when called outside an injection context without `injector` |
| `@since` | 0.3 |
| `@experimental` | yes |

**Example**

```ts
const email = signalsOf(form.children.email); // email.issues(), email.dirty() in the template
```

### `validateRules`

A function.

The rules, in the schema function of Signal Forms' `form`, on the value at `path`: their issues but warnings, each an error of kind its code, placed on the field its path names or the deepest one that exists on the way, as tree errors at `path`; the fields that `required` of a rule names marked as required, which adds no error of Angular's (the rule's issue says what is missing), where a target of the rule names them, `anyElement` or an index standing for each item: Angular marks only a field named when the schema is defined, so that a field a rule requires under a target, not at one, is not marked. A rule reads, and is checked again for, only the values its `reads` declare, each down to its first index or `anyElement`, the list then read whole; a field built or removed on the way of one of its issues places it again, without checking. It reads what Angular holds, hidden and disabled fields included, whose errors Angular does not show. Up to 1,000 errors per rule, then `rules.too_many_issues`, as `checkRules` gives.

```ts
export declare function validateRules<TValue, TPathKind extends PathKind = PathKind.Root>(path: SchemaPath<TValue, SchemaPathRules.Supported, TPathKind>, rules: readonly Rule[], options?: ValidateRulesOptions): void;
```

| Contract | Value |
|---|---|
| `@mutates` | path |
| `@sharing` | none |
| `@complexity` | O(r × d) to define (r = rules, d = paths they declare); a check costs that of the rule, O(d) reads and a call of `resolveKey` per `{ key }` of each issue and required path; Angular then filters the tree errors of `path` for each field below it |
| `@throws` | TypeError when `rules` is not an array of rules |
| `@throws` | Error when called outside a schema function of Signal Forms |
| `@throws` | what a rule, `format` or `resolveKey` throws, unchanged, when Angular computes the errors or the required fields; TypeError when `resolveKey` returns something else than an index, -1 or undefined |
| `@since` | 0.3 |
| `@experimental` | yes |

**Example**

```ts
form(model, (path) => validateRules(path, [allOrNone([['number'], ['signedOn']])]), { injector })
```
