# ADR 0042 — Guards of the reactive graph: no read or write inside a computation, bounded passes

- Date: 2026-11-08
- Status: accepted (design choices delegated by the owner, reported for review; `@experimental` until the contracts are frozen after the pilot)

## Context

ADR 0041 gave every derived node its dependencies at construction, so that a cycle of dependencies cannot be built, and left three ways to loop or to read past the graph's back, with the 22 B left under the budget of 1,000 B brotli (scenario `yaltaan/core-reactive`, ADR 0010) to guard them:

- a compute that calls `get` on another node of its graph: the read is not followed, so the node keeps a value computed from a state that has since changed, silently;
- a compute that calls `get` on its own node, the one cycle the API lets a caller write: it read the value being replaced, or `undefined` on the first computation, silently; `subscribe` inside a compute reads the same way;
- a compute that writes a source: the write changed the sources under the computation, and could notify listeners from inside a read;
- listeners that write in every pass, two that set each other's source for example: the write that started them never returned.

The guards change the public contract (`@throws` of `get`, `subscribe`, `set` and `batch`), hence this record; ADR 0041 is not rewritten.

## Options

1. **Native, or do nothing.** The platform has no reactive graph; doing nothing keeps the silent wrong values and the endless loop, which a form, where a listener often writes back a normalized value, meets in its first week.
2. **Document only.** "Must be pure" is already written; nothing tells the developer who reads another node, and the loop freezes the page.
3. **Guards on the graph instance (kept).** A counter of computations running, on the graph: `get`, `subscribe` and `set` of a node of that graph throw while it is not zero. A counter of passes bounds the notification loop.
4. **Guards in the module.** One counter for every graph would also see a node of another graph read inside a computation; it is state in the module, which ADR 0041 refused (two copies of the package side by side would not share it, and a computation that builds a scratch graph of its own and reads it would be refused).
5. **Track the reads, as signals do, and refuse only cycles.** It needs the module-level current computation that ADR 0041 refused, and its bytes.

Within option 3:

- **Which error.** `TypeError` for a read or a write inside a computation: the call is not allowed in that state, as `next()` on a running generator or a promise resolved with itself throw `TypeError` in the platform. `RangeError` when the passes run out, as the platform throws it when a stack runs out; the module already throws it for a chain deeper than the stack.
- **What the refusal does.** It is thrown inside the compute, so the node holds it as the error of that computation, rethrown by `get` until a dependency changes, like any error its compute throws: the developer sees it where they read the node. A compute that catches it keeps what it returns: no read happened.
- **What counts as a computation.** The compute of a derived node and its `equals`, which runs inside the same guard. The `equals` of a source, called by `set` before anything changes, is not guarded: it must be pure, and guarding it would cost bytes for no state it could break.
- **The bound.** 100 passes, the number preact and Vue's scheduler use: one pass notifies a write, the next what its listeners wrote; a chain of listeners deeper than 100 is not a form. Not configurable: an option would cost bytes and an API for a number nobody has asked to change.
- **After the bound.** The loop stops; the `RangeError` comes after the errors listeners threw, all in an `AggregateError`, the error of a batch's callback first, as ADR 0041 orders them. The queue of notifications is kept: the nodes in it are marked stale, and a stale node is not queued again by a later write, so clearing the queue would have left their listeners uninformed until something read them. The next write that changes a value, or batch, resumes it, and stops again if the listeners still write.

## Measurements

On 2026-11-08, Ubuntu 26.04 x64, Node 24.21.0, TypeScript 7.0.2:

- **Size**: the guards and their messages first cost 87 B (978 → 1,065 B with Rollup, 960 → 1,050 B with esbuild). Brought back under the budget without changing what the module does, each step measured with Rollup: the guard placed in `refresh`, which `get` and `subscribe` call first and `set` calls for it, instead of a function of its own (−10 B); the `watched` tests moved into `observe` and `unobserve` (−10 B); the flush called without an explicit `undefined`, the depth tested as a truth value (−10 B); `batch` written with `try`/`catch`/`finally` (−9 B); the depth of a graph counting the passes during a flush instead of a counter of its own, the bound written as a number (−12 B); other tests of `undefined` written as truth values, `watched` returning a count (−8 B); the field `failed` left `undefined` on a source instead of `false` (−2 B); the epoch of a stale node 0, falsy, the epochs of a graph counting from 1 (−3 B); the messages shortened so that they share their words (−14 B). That made 979 B with esbuild and 987 B with Rollup; the contradictor's fix below brought it to 981 and 992 B, budget 1,000 B.
- **Laws** (`properties.test.ts`): the programs of ADR 0041 again, and 1,000 more whose listeners write a constant or their node's value plus 0 or 1 to a source, throw, or unsubscribe a listener, perhaps themselves: in one run, 51,084 computations, 52,549 listener calls, 27,823 changes written by listeners, 2,983 errors thrown by them and 215 notifications stopped by the bound, in about 0.6 s. Checked as they happen against the naive model: no glitch, no listener called when its node holds what it saw, after its unsubscription, inside another listener or more than 100 times by one write; once the write returns, every listener has seen its node's value; the order of calls starts again only after a listener wrote a change; while no listener writes, exactly the listeners whose node changed are called; the errors are those the listeners threw, in order, and a `RangeError` only after at least 100 changes written.
- **Examples** (`index.test.ts`): each refusal (another node, its own node, a subscription, a write, a read in `equals`), on watched nodes too, in a batch whose notifications wait and in a pass, a write of the value a source already holds, a compute that catches the refusal, a batch opened by a compute after a stop, a node of another graph read inside a compute (neither followed nor refused), the graph computing on after a refusal; 100 passes allowed, a write in the hundredth stopped, the notifications left delivered by the next batch, two listeners writing each other stopped after the error of the batch and of a listener.
- **Mutations by hand**, each restored by copy: 28 on the guards, the bound and every line the size work changed, 28 caught, four of them added after the contradictor. The bound removed was first caught only by a time-out of the laws (programs whose listeners loop); the law that a listener is called at most 100 times by one write now fails it fast.
- **Recipes** (`docs/guide/*/reactive.md`): a node turned into an Angular signal (`computed` over a counter the listener increments, the subscription ended by `DestroyRef`) and into a Vue `customRef` (ended by `onScopeDispose`), run against Angular 22.2.4 and Vue 3.5.44 by `tests/interop/run.sh`, which extracts them from both guides; a recipe that forgets to unsubscribe fails it.
- **Contradictor**: a fresh reviewer, given only this question and the code (145,786 tokens), ran its own programs and 32 mutations of its own; verdict: accept with fixes, applied before this record was committed, or sent to T1.8 with their measured cost:
  - a batch opened and closed by a computation after a stop ran the notification loop, which emptied the queue the stop had kept, then threw the guard's error from a refresh: the nodes left stale were never notified again. The loop now does not run while a computation runs (+5 B), and an example holds it;
  - four mutations of its own survived: the guard on unwatched nodes only, the guard skipped while notifications wait, the guard of `set` after its `equals`, the reset of the depth outside its `finally`. The first three are now caught by an example; the last needs a stack that overflows inside a pass, which also loses that pass's notifications since T1.6 a: T1.8;
  - an unsubscription called by a computation while a pass refreshes that node lets its listener run once more, a behaviour of T1.6 a. Refusing it or skipping the call cost 1,001 to 1,003 B: the documentation of `subscribe` now says so, and T1.8 takes it;
  - the `RangeError` also comes when the hundredth pass wrote a change that reaches a watched node without changing what any listener sees: the documentation now says when, rather than "still write";
  - two claims of the comments were too strong ("the node holds that error", "nothing else of the graph"), now corrected.

## Decision

Option 3.

- While the compute or the `equals` of a derived node runs, `get`, `subscribe` and `set` of a node of the same graph throw `TypeError('a computation reads or writes a node of this graph')`; the node computing holds it as its error, a write is refused before it is made, a subscription before anything is held.
- A notification runs at most 100 passes; past them, the write or the batch throws `RangeError('listeners of this graph still write after 100 passes')` after the other errors, and the notifications left wait for the next write that changes a value, or batch.
- A batch opened inside a computation notifies nothing: the queue waits for the next write or batch.
- A node of another graph read inside a computation is neither followed nor refused, and an unsubscription called there is not refused; the documentation says so.

## Consequences

- A compute that reads around its arguments now fails at once, where it gave a stale value: the guide shows the fix, naming that node as a dependency.
- Listeners that write each other without end get an error instead of a frozen page; a legitimate chain of more than 100 listeners would be refused, and would need this record reopened.
- Each refused computation throws a new error, so its listeners are told of it again on each write that reaches it.
- 8 B are left under the budget with Rollup.

## Review condition

A real form needing more than 100 passes; a need to read a node of another graph inside a computation; the guards costing more than the budget after a change of T2.4; the pilot showing that a refused read should be followed instead (dependencies that change at run time, ADR 0041's own review condition).
