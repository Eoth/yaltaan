# ADR 0041 — The reactive node: dependencies given at construction, in a graph instance

- Date: 2026-11-08
- Status: accepted (design choices delegated by the owner, reported for review; `@experimental` until the contracts are frozen after the pilot)

## Context

ARCHITECTURE.md §5.5 fixes the interface every domain shares, `ReadableNode<T>` with `get()` and `subscribe(listener)`, the contract of React's `useSyncExternalStore`, and what the graph behind it must be: push-pull, lazy, free of glitches, batched explicitly by an instance or a call with no global scheduler, evaluated in topological order, with cycles found at construction, within 1,000 B minified and brotli-compressed (ADR 0010). It leaves open what the form (T2.4) will depend on:

- how a derived node names its dependencies, which decides whether a cycle can be found at construction at all;
- what holds a batch, if not a global scheduler;
- when a listener is called, and what "changed" means for it;
- what an error thrown by a computation does to the graph, and an error thrown by a listener to the write;
- whether a dependency may be a node of another graph, or any object with `get` and `subscribe`;
- whether `get` and `subscribe` are methods or functions bound to their node.

Facts on the references, from the size baseline and the libraries installed: `@preact/signals-core` 1.14.4 weighs 1,562 B (esbuild) and 1,559 B (Rollup) for `signal`, `computed`, `effect` and `batch`; alien-signals 3.2.1, 1,644 B (ADR 0010). Both track dependencies automatically, through a module-level "current computation", and batch through module-level state; preact's `subscribe` runs its callback at once with the value, which is not the contract of `useSyncExternalStore`. TC39 Signals have stood at Stage 1 since April 2024. The form builds its nodes from a schema and its rules: every dependency is known when the node is built.

## Options

1. **Native, or do nothing.** The platform has no reactive value: `EventTarget` notifies, but derives nothing, batches nothing and cannot keep a reader from seeing half a change. A framework's signals would make the core's timing depend on the framework, which §5.5 rejects. Rejected.
2. **Depend on `@preact/signals-core` or alien-signals.** A runtime dependency in `core`, which §11 forbids; over the budget (1,562 B); and their state lives in the module, so every graph of a page shares one batch, and two copies of the package installed side by side do not batch together. Rejected.
3. **Track dependencies automatically, written here.** Dependencies that follow the branches a computation takes, the ergonomics of signals; but it needs a module-level current computation, a cycle is then found only when it runs, and both libraries that do it are over the budget. Rejected.
4. **Dependencies given at construction, in a graph instance.** `graph.derived([a, b], (a, b) => …)`: a node can only name nodes that already exist, so a cycle of dependencies cannot be built, creation order is a topological order, and no global current computation is needed. `createGraph()` holds the batch, the queue of notifications and the count of writes: nothing lives in the module. Kept, with the choices below.

Within option 4:

- **What holds a batch.** The graph (kept). A module-level `batch(run)` would be state shared by the whole page; a writer handed to the batch callback (`batch((write) => …)`) would let a helper that calls `set` notify in the middle of a batch.
- **When a listener is called.** When what `get` gives, a value or a thrown error, differs by `Object.is` from what that subscription last saw (kept), after the writes: the write itself, or the end of the outermost batch. A baseline per node instead of per subscription was written first and refused by the judge: a listener subscribed during a batch was told of a change it had not missed. A version counter, as preact keeps, notifies a node changed and set back within a batch, and a node that throws the same error again.
- **Order.** Nodes by creation order, a topological order, then subscriptions by order of subscription: an order the caller can predict and that does not depend on the history of subscriptions.
- **Errors.** An error thrown by a computation is held as the node's value, thrown again by `get` until a dependency changes, and passed on to dependents without calling their computation, as preact and the TC39 proposal hold them. A listener that throws stops no other; the write then throws that error, or an `AggregateError` of all, the error of a batch's callback first.
- **Dependencies of another graph, or foreign objects.** Refused with a `TypeError` for now. Accepting them later breaks nobody, while refusing them after accepting would; a foreign node would need its own subscription and would defeat the count of writes that keeps reads in O(1).
- **Methods or bound functions.** Methods on a prototype (kept): bound functions would cost two closures per node. React needs `(listener) => node.subscribe(listener)` and `() => node.get()`, which the React adapter (T2.6) will hold once per node. The contradictor asked for this to be settled before any publication, since binding later would break callers: it is settled here, and `useSyncExternalStore(node.subscribe, node.get)` fails at once with a `TypeError`, never in silence.
- **Equality.** `Object.is` by default, the comparison of `useSyncExternalStore` and of the TC39 proposal (`NaN` equals `NaN`, `-0` differs from `0`), replaceable by an `equals` option; preact compares with `!==`.

## Measurements

On 2026-11-08, Ubuntu 26.04 x64, Node 24.21.0, TypeScript 7.0.2, `@preact/signals-core` 1.14.4 installed:

- **Size**: scenario `yaltaan/core-reactive` (`createGraph`, the whole module), 960 B brotli with esbuild and 978 B with Rollup (raw 2,257 and 2,295 B), budget 1,000 B; preact 1,562 and 1,559 B. Writing it took shrinks without a change of behaviour: fields declared instead of initialized to `undefined`, one shared empty list for nodes without dependencies, listeners iterated live instead of copied (1,018 and 1,031 B for the first version).
- **Heap**, 100,000 pairs, `--expose-gc`: a source and a derived node read once, 415 B per pair (preact's `signal` and `computed`, 414 B); with one subscription, 937 B (preact with an `effect`, 738 B): our observers and listeners are `Set`s.
- **Depth**: on Node's default stack, a chain of derived nodes read for the first time, in a fresh process, reads without a `RangeError` up to about 4,800 levels (preact about 1,850); once the code is optimized, about 5,900 (preact about 2,000). A subscription that throws so registers nothing.
- **Laws** (`properties.test.ts`): 1,000 random programs of 1 to 4 sources, 1 to 10 derived nodes and 4 to 40 steps (writes, reads, subscriptions, unsubscriptions, nested batches), values from -2 to 2 with `NaN` and `-0` now and then, checked against a naive evaluation of the whole graph at every step: 17,086 computations, 8,177 listener calls, 780 programs with notifications, in about 0.6 s on this machine. The first version of the programs was too thin (344 listener calls) and was widened before any verdict.
- **Mutations by hand**, each restored by copy, on the final code: 34 mutations, 34 caught: the marking, the queue and its order, the baselines of subscriptions, the epoch, batches, errors, `equals`, dependencies, subscriptions, and the eight the contradictor found surviving. Two of them make a walk through a ladder of diamonds exponential: the scale test first ran for minutes under them, and its sizes were cut to 8 and 16 rungs, where it fails in 6 and 10 s (ratios of 171 and 207, against 1.7 to 2.2 for the module). Each family of laws catches one alone: the glitch law an evaluation during marking, the laziness law a computation at construction. One mutation of a first version, iterating a copy of the listeners, changed nothing observable: the copy was removed.
- **Judge** (`judge.test.ts`, ADR 0022's harness): the same programs on preact, 1,000 inputs, 759 compared as they are, 142 left to the equality difference, 99 compared through the exact filter of the listener difference; alone, it catches 11 of the 15 mutations, and does not see what computations receive or how often they run, the order of listeners, nor listeners that unsubscribe, which the laws and the examples judge.
- **Found by the judges while writing**: the baseline per node (above); `source(1, { equals })` inferred as `SourceNode<1>`, fixed by `NoInfer` on the options; an assertion thrown inside a computation was held by the graph as the node's error and could vanish, so the laws now write a broken law down outside the graph.
- **Contradictor**: a fresh reviewer, given only this question and the code, ran its own model of listeners that write, batch, subscribe, unsubscribe and throw (20,000 programs, after checking it caught three mutations): no glitch, no missed or extra call. Verdict: accept with fixes, all applied before this record was committed: unsubscribing a chain whose nodes name a dependency twice took exponential time (22 levels, 175 ms; now linear, and a scale test); eight mutations passed the tests (a leak, the cost of a watched write and of a watched read, `===` for `Object.is` at three places, `equals` handed a held error), each now caught; claims of the documentation too strong (the cost of a read, "once" in a batch whose listener writes, a subscription that could throw after registering), corrected, and a subscription now computes before it registers. Its remarks on a `get` inside a computation and a listener that writes forever go to T1.6 b.

## Decision

Option 4.

- `createGraph(): Graph`; `graph.source(initial, { equals })` returns a `SourceNode<T>` (`get`, `subscribe`, `set`); `graph.derived(deps, compute, { equals })` returns a `ReadableNode<T>` whose `compute` receives the values of `deps` in their order (`NodeValues<D>`); `graph.batch(run)` returns what `run` returns.
- A derived node computes nothing until it is read or subscribed to; then again only when one of its arguments differs by `Object.is` from those of its last computation. A write costs nothing to a node that no listener watches; such a node is held by none of its dependencies and is reclaimed with its last reference.
- A computation always receives values of one state of the sources; a listener runs after the writes, never during a batch, sees the final values, and is called at most once per pass.
- `set` applies its value at once; reads inside a batch see it. Notifications wait for the end of the outermost batch of the same graph. What a listener writes is notified in a next pass.
- Subscribing computes a derived node: its value is what that subscription has seen.
- Every rule above is a law or an example of the module's tests, and the judge holds each documented difference from preact to an input it applies to.

## Consequences

- Every computation names its dependencies; a `get` of another node inside a computation is not tracked, and the documentation says so; T1.6 b refuses it, with the read of a node by its own computation, the one cycle the API lets a caller write. A dependency that changes with the branch taken (a node read only when a checkbox is ticked) recomputes on every change of either branch. A list that grows, the rows of a form array, is a source holding the list or a node built again with it: T2.4 b decides which.
- The interface would stay the same over TC39 Signals, but not the timing: a `Watcher` may not read a signal in its `notify`, where our listeners read at once, as React's do; moving to it would need a scheduler, so a record of its own.
- Two forms on two graphs never batch together; a page that wants them to builds them on one graph.
- T1.6 b keeps: the guard against a computation that reads a node or writes a source, and against a listener that writes forever (a cycle of dependencies itself cannot be built); properties under listeners that write, throw and unsubscribe; the Angular and Vue recipes. The budget leaves 22 B (Rollup) for those guards. A test already shows that a node no longer watched is reclaimed.
- A watched pair costs 937 B of heap instead of preact's 738 B.

## Review condition

The pilot (T2.4) needing dependencies that change at run time; an adapter needing a foreign node as a dependency; TC39 Signals reaching Stage 3; the guards of T1.6 b over the budget; the heap of watched nodes significant in the measurements of T2.6.
