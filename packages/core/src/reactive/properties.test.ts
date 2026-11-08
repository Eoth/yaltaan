// The laws of the reactive graph, judged against a naive model: every node evaluated from the current values of the
// sources, in creation order, at each look. Random programs (programs.test.ts) write, read, subscribe, unsubscribe and
// batch, and their listeners may write, throw or unsubscribe; every compute, read and listener call is checked as it
// happens:
//   - consistency: `get` returns the model's value, or throws the model's error;
//   - no glitch: compute receives the model's values of its dependencies, never a mix of two states of the sources,
//     and a listener reads the state the writes before it left;
//   - laziness: a node computes only during a read of a node that depends on it, or a subscription to one, or the
//     notification of a write when a listener watches one; never twice on the same arguments unless one of its
//     dependencies held an error between the two;
//   - notification: after each write outside a batch, and at the end of each outermost batch, a listener is called
//     only when its node's value (or error) differs from the one it last saw, never after its unsubscription, never
//     during a batch, a read, a subscription, an unsubscription or another listener, nor more than 100 times by one
//     write (once per pass); once the write returns, every listener has seen its node's value; calls go by creation
//     order of their nodes, then by order of subscription, and start that order again only after a listener wrote a
//     change; when no listener writes a change, exactly the listeners whose node differs are called, save those
//     unsubscribed before their turn;
//   - errors: the write throws what its listeners threw, in the order they threw it, the error itself or an
//     `AggregateError` of all; a `RangeError` comes last only after listeners wrote at least 100 changes.
// Blind spots: values are small integers, `NaN` and `-0`, compared by `Object.is`, so `equals` is left to the
// examples of index.test.ts (with an `equals` of its own, a node's value depends on when it was last read, which no
// naive model gives); once a listener writes a change, which listeners a pass holds is left to the examples, as the
// model knows no passes: a listener skipped and unsubscribed later in the same notification goes unseen; the bound of
// 100 passes is checked here from below and through each listener's calls, and exactly by the examples; computations
// never read, write or batch the graph, so its guards are left to the examples too; and so is the cost of a step,
// which the scale tests of index.test.ts judge.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fc } from '@yaltaan/testing';

import { createGraph, type ReadableNode, type SourceNode } from './index.ts';
import { apply, ComputeError, programs, type Program, type Reaction, type Step } from './programs.test.ts';

type Outcome = { readonly failed: false; readonly value: number } | { readonly failed: true; readonly value: unknown };

const sameOutcome = (a: Outcome, b: Outcome): boolean => a.failed === b.failed && Object.is(a.value, b.value);

function outcomeOf(node: ReadableNode<number>): Outcome {
  try {
    return { failed: false, value: node.get() };
  } catch (error) {
    return { failed: true, value: error };
  }
}

/** What a `throw` listener throws: one object per subscription. */
class ListenerError extends Error {
  override readonly name = 'ListenerError';
}

interface Watch {
  readonly node: number;
  readonly reaction: Reaction | undefined;
  readonly error: ListenerError;
  unsubscribe: () => void;
  active: boolean;
  seen: Outcome;
}

/** The notification of one write or outermost batch, as the listeners it calls see it. */
interface Notification {
  /** Watches whose node differed when it started, by node then subscription; dropped once a listener writes. */
  expected: number[] | undefined;
  /** The node and the watch of the last call. */
  last: readonly [number, number] | undefined;
  /** A listener wrote a change since the order last started again. */
  wrote: boolean;
  changes: number;
  thrown: ListenerError[];
  /** Calls of each watch. */
  calls: Map<number, number>;
}

interface Totals {
  computes: number;
  calls: number;
  changes: number;
  thrown: number;
  stopped: number;
}

const before = (a: readonly [number, number], b: readonly [number, number]): boolean =>
  a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/** Runs `program`, checking every law at every step; adds what it saw to `totals`, for the diagnostics. */
function checkLaws(program: Program, totals: Totals): void {
  const graph = createGraph();
  const sourceCount = program.sources.length;
  const deps: (readonly number[])[] = program.sources.map(() => []);
  const errors = program.derived.map((_, index) => new ComputeError(`node ${sourceCount + index}`));
  const values = [...program.sources];

  const model = (): Outcome[] => {
    const outcomes: Outcome[] = values.map((value) => ({ failed: false, value }));
    program.derived.forEach((spec, index) => {
      const failure = spec.deps.map((dep) => outcomes[dep]!).find((outcome) => outcome.failed);
      if (failure !== undefined) {
        outcomes.push(failure);
        return;
      }
      try {
        const args = spec.deps.map((dep) => outcomes[dep]!.value as number);
        outcomes.push({ failed: false, value: apply(spec.kind, args, errors[index]!) });
      } catch (error) {
        outcomes.push({ failed: true, value: error });
      }
    });
    return outcomes;
  };

  const upstream = (id: number, into: Set<number>): Set<number> => {
    if (!into.has(id)) {
      into.add(id);
      deps[id]!.forEach((dep) => upstream(dep, into));
    }
    return into;
  };

  // Nodes being read or subscribed to, innermost last; and whether a write's notification may refresh watched nodes.
  const reading: number[] = [];
  let notifying = false;
  const watches: Watch[] = [];
  const mayCompute = (id: number): boolean => {
    const into = new Set<number>();
    reading.forEach((node) => upstream(node, into));
    if (notifying) {
      watches.filter((watch) => watch.active).forEach((watch) => upstream(watch.node, into));
    }
    return into.has(id);
  };

  // What compute and listeners throw is held or gathered by the graph: a broken law is written down and checked after
  // each step, never thrown from there.
  const violations: string[] = [];
  const lastArgs = new Map<number, readonly number[]>();
  // Derived nodes one of whose dependencies held an error, at a state of the sources, since their last compute.
  const failedSince = new Set<number>();
  const noteFailures = (): void => {
    const outcomes = model();
    deps.forEach((ids, id) => {
      if (ids.some((dep) => outcomes[dep]!.failed)) {
        failedSince.add(id);
      }
    });
  };

  const nodes: ReadableNode<number>[] = [];
  const sources: SourceNode<number>[] = [];
  for (const value of program.sources) {
    const source = graph.source(value);
    nodes.push(source);
    sources.push(source);
  }
  program.derived.forEach((spec, index) => {
    const id = sourceCount + index;
    deps.push(spec.deps);
    const compute = (...args: number[]): number => {
      totals.computes += 1;
      if (!mayCompute(id)) {
        violations.push(`node ${id} computed, though nothing being read or watched depends on it`);
      }
      const outcomes = model();
      const expected = spec.deps.map((dep) => outcomes[dep]!);
      if (expected.some((outcome, position) => outcome.failed || !Object.is(outcome.value, args[position]))) {
        violations.push(`node ${id} computed on ${String(args)}, values of another state of the sources`);
      }
      const previous = lastArgs.get(id);
      if (
        previous !== undefined &&
        previous.every((value, position) => Object.is(value, args[position])) &&
        !failedSince.has(id)
      ) {
        violations.push(`node ${id} computed again on the same arguments`);
      }
      lastArgs.set(id, args);
      failedSince.delete(id);
      return apply(spec.kind, args, errors[index]!);
    };
    nodes.push(
      graph.derived(
        spec.deps.map((dep) => nodes[dep]!),
        compute,
      ),
    );
  });
  noteFailures();

  let inBatch = false;
  let inListener = false;
  let notification: Notification | undefined;
  // A notification stopped by the bound left listeners that have not seen their node's value.
  let pending = false;

  const read = (id: number): Outcome => {
    reading.push(id);
    const outcome = outcomeOf(nodes[id]!);
    reading.pop();
    if (!sameOutcome(outcome, model()[id]!)) {
      violations.push(`get of node ${id} disagrees with the model`);
    }
    return outcome;
  };

  const write = (source: number, value: number): void => {
    values[source] = value;
    sources[source]!.set(value);
    noteFailures();
  };

  const unsubscribe = (pick: number): void => {
    const watch = watches[pick % Math.max(1, watches.length)];
    if (watch !== undefined) {
      watch.unsubscribe();
      watch.active = false;
    }
  };

  const react = (watch: Watch, outcome: Outcome, now: Notification): void => {
    const { reaction } = watch;
    switch (reaction?.kind) {
      case undefined:
        break;
      case 'write':
      case 'follow': {
        if (reaction.kind === 'follow' && outcome.failed) {
          break;
        }
        const value = reaction.kind === 'write' ? reaction.value : (outcome.value as number) + reaction.offset;
        if (!Object.is(values[reaction.node], value)) {
          now.wrote = true;
          now.changes += 1;
          now.expected = undefined;
        }
        write(reaction.node, value);
        break;
      }
      case 'throw':
        now.thrown.push(watch.error);
        throw watch.error;
      case 'unsubscribe':
        unsubscribe(reaction.pick);
        break;
      default: {
        const never: never = reaction;
        throw new Error(`unknown reaction ${String(never)}`);
      }
    }
  };

  const listen = (index: number): void => {
    const watch = watches[index]!;
    const key = [watch.node, index] as const;
    totals.calls += 1;
    const now = notification;
    if (now === undefined || !notifying || inBatch || inListener) {
      violations.push(`listener ${index} called outside the notification of a write, or inside another listener`);
      return;
    }
    if (!watch.active) {
      violations.push(`listener ${index} called after its unsubscription`);
    }
    const calls = (now.calls.get(index) ?? 0) + 1;
    now.calls.set(index, calls);
    if (calls > 100) {
      // Without its reaction, a listener that writes without end lets the write return, and the law fail.
      violations.push(`listener ${index} called more than 100 times by one write`);
      return;
    }
    const expected = model()[watch.node]!;
    if (sameOutcome(expected, watch.seen)) {
      violations.push(`listener ${index} called, though node ${watch.node} holds what it saw last`);
    }
    watch.seen = expected;
    if (now.last !== undefined && !before(now.last, key)) {
      if (!now.wrote) {
        violations.push(`listener ${index} called out of order, with no change written since the order started`);
      }
      now.wrote = false;
    }
    now.last = key;
    if (now.expected !== undefined) {
      while (now.expected.length > 0 && before([watches[now.expected[0]!]!.node, now.expected[0]!], key)) {
        const skipped = now.expected.shift()!;
        if (watches[skipped]!.active) {
          violations.push(`listener ${skipped} skipped, though node ${watches[skipped]!.node} changed`);
        }
      }
      if (now.expected[0] === index) {
        now.expected.shift();
      } else {
        violations.push(`listener ${index} called, though no listener wrote and its node had not changed`);
      }
    }
    inListener = true;
    try {
      react(watch, read(watch.node), now);
    } finally {
      inListener = false;
    }
  };

  // Called as the notification starts: at a write outside a batch, or at the end of the run of the outermost batch.
  const notify = (): void => {
    const outcomes = model();
    const expected = watches
      .map((watch, index) => ({ watch, index }))
      .filter(({ watch }) => watch.active && !sameOutcome(watch.seen, outcomes[watch.node]!))
      .sort((a, b) => a.watch.node - b.watch.node || a.index - b.index)
      .map(({ index }) => index);
    notification = { expected, last: undefined, wrote: false, changes: 0, thrown: [], calls: new Map() };
    notifying = true;
  };

  const settle = (thrown: unknown, threw: boolean): void => {
    const now = notification!;
    notification = undefined;
    notifying = false;
    totals.changes += now.changes;
    totals.thrown += now.thrown.length;
    const all = thrown instanceof AggregateError ? thrown.errors : threw ? [thrown] : [];
    const stopped = all.at(-1) instanceof RangeError;
    const gathered = stopped ? all.slice(0, -1) : all;
    if (stopped) {
      totals.stopped += 1;
      assert.ok(now.changes >= 100, `stopped after ${now.changes} changes written by listeners, fewer than 100`);
    }
    assert.equal(gathered.length, now.thrown.length, 'errors thrown by the write');
    gathered.forEach((error, position) => assert.equal(error, now.thrown[position], 'errors thrown by the write'));
    assert.equal(threw, all.length > 0, 'a write throws when, and only when, a listener threw or the loop stopped');
    if (all.length === 1) {
      assert.ok(!(thrown instanceof AggregateError), 'a single error is thrown as it is');
    }
    pending = stopped;
    if (!stopped) {
      const outcomes = model();
      watches.forEach((watch, index) => {
        if (watch.active && !sameOutcome(watch.seen, outcomes[watch.node]!)) {
          violations.push(`listener ${index} not called, though node ${watch.node} changed`);
        }
      });
      for (const left of now.expected ?? []) {
        if (watches[left]!.active) {
          violations.push(`listener ${left} not called, though node ${watches[left]!.node} changed`);
        }
      }
    }
  };

  const run = (step: Step): void => {
    switch (step.op) {
      case 'set': {
        const changes = !Object.is(values[step.node], step.value);
        if (inBatch || !changes) {
          write(step.node, step.value);
          break;
        }
        values[step.node] = step.value;
        noteFailures();
        notify();
        let thrown: unknown;
        let threw = false;
        try {
          sources[step.node]!.set(step.value);
        } catch (error) {
          thrown = error;
          threw = true;
        }
        settle(thrown, threw);
        break;
      }
      case 'get':
        read(step.node);
        break;
      case 'subscribe': {
        const index = watches.length;
        const watch: Watch = {
          node: step.node,
          reaction: step.reaction,
          error: new ListenerError(`listener ${index}`),
          unsubscribe: () => {},
          active: true,
          seen: model()[step.node]!,
        };
        watches.push(watch);
        reading.push(step.node);
        watch.unsubscribe = nodes[step.node]!.subscribe(() => listen(index));
        reading.pop();
        break;
      }
      case 'unsubscribe':
        unsubscribe(step.pick);
        break;
      case 'batch': {
        const outer = !inBatch;
        let thrown: unknown;
        let threw = false;
        try {
          graph.batch(() => {
            inBatch = true;
            step.steps.forEach(run);
            inBatch = !outer;
            if (outer) {
              notify();
            }
          });
        } catch (error) {
          thrown = error;
          threw = true;
        }
        if (outer) {
          settle(thrown, threw);
        } else if (threw) {
          throw thrown;
        }
        break;
      }
      default: {
        const never: never = step;
        throw new Error(`unknown step ${String(never)}`);
      }
    }
  };

  for (const step of program.steps) {
    run(step);
    assert.deepEqual(violations, [], 'laws broken inside compute or a listener');
    if (!pending) {
      const outcomes = model();
      watches.forEach((watch, index) => {
        assert.ok(!watch.active || sameOutcome(watch.seen, outcomes[watch.node]!), `listener ${index} is behind`);
      });
    }
  }
  reading.push(...nodes.keys());
  nodes.forEach((_, id) => read(id));
  assert.deepEqual(violations, [], 'laws broken inside compute');
}

// `NaN` and `-0` now and then: the graph and the model both compare by `Object.is`, a `===` anywhere in the graph
// shows as a computation or a notification the model does not make.
const VALUES = fc.oneof(
  { arbitrary: fc.integer({ min: -2, max: 2 }), weight: 20 },
  { arbitrary: fc.constantFrom(Number.NaN, -0), weight: 1 },
);

const describe = (totals: Totals): string =>
  `${totals.computes} computes, ${totals.calls} listener calls, ${totals.changes} changes written by listeners, ` +
  `${totals.thrown} errors thrown by listeners, ${totals.stopped} notifications stopped by the bound`;

test('the graph agrees with a naive evaluation: no glitch, nothing computed for nothing, exact notifications', (t) => {
  const totals: Totals = { computes: 0, calls: 0, changes: 0, thrown: 0, stopped: 0 };
  fc.assert(
    fc.property(programs(VALUES), (program) => checkLaws(program, totals)),
    { numRuns: 1000 },
  );
  t.diagnostic(describe(totals));
});

test('listeners that write, throw and unsubscribe: no glitch, no call missed or made for nothing, bounded', (t) => {
  const totals: Totals = { computes: 0, calls: 0, changes: 0, thrown: 0, stopped: 0 };
  fc.assert(
    fc.property(programs(VALUES, true), (program) => checkLaws(program, totals)),
    { numRuns: 1000 },
  );
  t.diagnostic(describe(totals));
});
