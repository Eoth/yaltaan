# Reactive values: derived without glitches

`import { createGraph, type ReadableNode, type SourceNode } from '@yaltaan/core/reactive';`

## The problem

A form is full of values that depend on others: a total from its lines, a field required once a box is ticked, a button enabled when everything is valid. Recomputing them by hand after each change forgets a case. An event per field shows a half-updated screen, the total changed and not yet its tax. A framework's signals tie that logic to the framework, and a test of it to a component.

## What you write

A graph holds sources, values you set, and derived values, each computed from the nodes it names. A derived value computes nothing until it is read, then again only when one of its dependencies has changed.

```ts
import { createGraph } from '@yaltaan/core/reactive';

const graph = createGraph();
const quantity = graph.source(2);
const unitPrice = graph.source(15);
const total = graph.derived([quantity, unitPrice], (count, price) => count * price);

total.get(); // → 30
quantity.set(3);
total.get(); // → 45
```

## Watching a value

`subscribe` calls its listener, without arguments, after a write that changed the value; the listener reads it with `get`. It returns the function that stops it. Through a diamond, here the total that depends on the price directly and through the tax, a listener sees only the final state: never the new price with the old tax.

```ts
import { createGraph } from '@yaltaan/core/reactive';

const graph = createGraph();
const price = graph.source(100);
const rate = graph.source(0.25);
const tax = graph.derived([price, rate], (amount, share) => amount * share);
const total = graph.derived([price, tax], (amount, due) => amount + due);

const seen: number[] = [];
const stop = total.subscribe(() => seen.push(total.get()));
price.set(200);
seen; // → [250]
stop();
price.set(300);
seen; // → [250]
```

## Changing several values at once

`batch` holds the notifications of the writes its function makes until it returns: each listener is then called once, on the final values, and again only for what a listener writes. Reads inside the batch already see its writes.

```ts
import { createGraph } from '@yaltaan/core/reactive';

const graph = createGraph();
const first = graph.source('Ada');
const last = graph.source('Byron');
const full = graph.derived([first, last], (given, family) => `${given} ${family}`);

const seen: string[] = [];
full.subscribe(() => seen.push(full.get()));
graph.batch(() => {
  first.set('Augusta Ada');
  last.set('King');
});
seen; // → ['Augusta Ada King']
```

## A computation that can fail

A computation that fails in an expected way returns a [`Result`](result.md), like any function of Yaltaan. One that throws has a bug: the node keeps that error, `get` throws it again, and nodes depending on it throw it too, until a dependency changes.

```ts
import { createGraph } from '@yaltaan/core/reactive';
import { err, ok } from '@yaltaan/core/result';

const graph = createGraph();
const text = graph.source('12');
const quantity = graph.derived([text], (typed) => (/^[0-9]+$/.test(typed) ? ok(Number(typed)) : err('not_a_number')));

quantity.get(); // → { ok: true, value: 12 }
text.set('twelve');
quantity.get(); // → { ok: false, error: 'not_a_number' }
```

## Deciding what counts as a change

A value is the same as the one before by `Object.is` unless an `equals` option says otherwise: the node then keeps its current value, and nobody is notified.

```ts
import { createGraph } from '@yaltaan/core/reactive';

const graph = createGraph();
const amount = graph.source(1.2, { equals: (current, next) => Math.round(current) === Math.round(next) });

amount.set(1.4);
amount.get(); // → 1.2
amount.set(1.6);
amount.get(); // → 1.6
```

## Naming every dependency

A computation receives the values of the nodes it names, and nothing else: another node read inside it, or its own, would go unseen when it changes. The graph refuses it: `get`, `subscribe` or `set` on a node of the same graph while a computation runs throws a `TypeError`, which the node keeps as its error. Name that node as a dependency instead.

```ts
import { createGraph } from '@yaltaan/core/reactive';

const graph = createGraph();
const price = graph.source(10);
const rate = graph.source(0.2);
const unfollowed = graph.derived([price], (amount) => amount * rate.get());

let refused: unknown;
try {
  unfollowed.get();
} catch (error) {
  refused = error;
}
refused instanceof TypeError; // → true
const tax = graph.derived([price, rate], (amount, share) => amount * share);
tax.get(); // → 2
```

## A list that changes

When what a node reads changes at run time, the rows of a table for instance, `rewire(node, deps)` gives a derived node its new dependencies, as a write does: in a batch, its listeners and those of the nodes that read it are told at the end. Its compute receives the new values, so it must accept any number of them. A dependency that depends on the node throws a `TypeError`: the graph never holds a cycle. Listeners keep the order their nodes were created in, which is then not always the order of their dependencies.

```ts
import { createGraph, rewire } from '@yaltaan/core/reactive';

const graph = createGraph();
const prices = [graph.source(10), graph.source(5)];
const total = graph.derived(prices, (...values: number[]) => values.reduce((sum, value) => sum + value, 0));
total.get(); // → 15
rewire(total, [...prices, graph.source(20)]);
total.get(); // → 35
```

## In Angular and Vue

A node already has what a framework asks of an outside value: a way to read it, and a way to be told it changed. These two functions turn it into an Angular signal and into a Vue ref; copy them into your application. Both are checked against Angular 22.2.4 and Vue 3.5.44.

In Angular, call `fromNode` in an injection context, a constructor or a field initializer: the subscription ends with the component. The signal follows the node, and throws what the node throws.

```ts angular
import { computed, DestroyRef, inject, signal, type Signal } from '@angular/core';
import type { ReadableNode } from '@yaltaan/core/reactive';

export function fromNode<T>(node: ReadableNode<T>): Signal<T> {
  const version = signal(0);
  inject(DestroyRef).onDestroy(node.subscribe(() => version.update((count) => count + 1)));
  return computed(() => {
    version();
    return node.get();
  });
}
```

In Vue, call `nodeRef` in `setup()` or inside an `effectScope`: the subscription ends with the scope. The ref of a source writes through to it.

```ts vue
import { customRef, onScopeDispose, type Ref } from 'vue';
import type { ReadableNode, SourceNode } from '@yaltaan/core/reactive';

export function nodeRef<T>(node: SourceNode<T>): Ref<T>;
export function nodeRef<T>(node: ReadableNode<T>): Readonly<Ref<T>>;
export function nodeRef<T>(node: ReadableNode<T>): Ref<T> {
  return customRef<T>((track, trigger) => {
    onScopeDispose(node.subscribe(trigger));
    return {
      get: () => {
        track();
        return node.get();
      },
      set: (value) => (node as SourceNode<T>).set(value),
    };
  });
}
```

## Good to know

- A computation names its dependencies, and receives their values in that order; it must be pure. A node of another graph read inside it is neither followed nor refused.
- Nothing watched, nothing computed: a write costs nothing to a value no listener watches, and such a value is reclaimed by the garbage collector with its last reference.
- A listener is called only when the value differs from the one it last saw: a value changed and set back before the end of a batch notifies nobody. Listeners run after the writes, never in the middle of a batch, each at most once per pass, by creation order of their nodes, then by order of subscription: a write or a batch makes one pass, and what listeners write in a pass makes the next.
- A listener that throws stops no other; the write then throws that error, or an `AggregateError` of all.
- Listeners that keep writing are stopped after 100 passes: the write throws a `RangeError`, after the errors of listeners, and the notifications left wait for the next write or batch.
- `get` and `subscribe` are methods, the contract of React's `useSyncExternalStore`: pass it `(listener) => node.subscribe(listener)` and `() => node.get()`, built once per node.
- Every dependency belongs to the same graph, and two graphs never wait for each other's batches: build on one graph what must change together.
- The whole module weighs under 1,000 bytes minified and compressed with brotli.
