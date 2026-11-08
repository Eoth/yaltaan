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

`batch` holds the notifications of the writes its function makes until it returns: each listener is then called once, on the final values. Reads inside the batch already see its writes.

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

## Good to know

- A computation names its dependencies, and receives their values in that order: a `get` of another node inside it is not followed. It must be pure.
- Nothing watched, nothing computed: a write costs nothing to a value no listener watches, and such a value is reclaimed by the garbage collector with its last reference.
- A listener is called only when the value differs from the one it last saw: a value changed and set back before the end of a batch notifies nobody. Listeners run after the writes, never in the middle of a batch, each at most once per write or batch, by creation order of their nodes, then by order of subscription.
- A listener that throws stops no other; the write then throws that error, or an `AggregateError` of all.
- `get` and `subscribe` are methods, the contract of React's `useSyncExternalStore`: pass it `(listener) => node.subscribe(listener)` and `() => node.get()`, built once per node.
- Every dependency belongs to the same graph, and two graphs never wait for each other's batches: build on one graph what must change together.
- The whole module weighs under 1,000 bytes minified and compressed with brotli.
