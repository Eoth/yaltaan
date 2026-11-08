// The laws of the reactive graph, judged against a naive model: every node evaluated from the current values of the
// sources, in creation order, at each look. Random programs (programs.test.ts) write, read, subscribe, unsubscribe and
// batch; every compute, read and listener call is checked as it happens:
//   - consistency: `get` returns the model's value, or throws the model's error;
//   - no glitch: compute receives the model's values of its dependencies, never a mix of two states of the sources,
//     and a listener reads the final state of its batch;
//   - laziness: a node computes only during a read of a node that depends on it, or a subscription to one, or the
//     notification of a write when a listener watches one; never twice on the same arguments unless one of its
//     dependencies held an error between the two;
//   - notification: after each write outside a batch, and at the end of each outermost batch, exactly the listeners
//     whose node's value (or error) differs from the one they last saw are called, once, by creation order of their
//     nodes, then by order of subscription; never during a batch, a read, a subscription or an unsubscription.
// Blind spots: values are small integers, `NaN` and `-0`, compared by `Object.is`, so `equals` is left to the
// examples of index.test.ts (with an `equals` of its own, a node's value depends on when it was last read, which no
// naive model gives); listeners only read, so a listener that writes, throws or unsubscribes is left to the examples
// too; and so is the cost of a step, which the scale tests of index.test.ts judge.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fc } from '@yaltaan/testing';

import { createGraph, type ReadableNode, type SourceNode } from './index.ts';
import { apply, ComputeError, programs, type Program, type Step } from './programs.test.ts';

type Outcome = { readonly failed: false; readonly value: number } | { readonly failed: true; readonly value: unknown };

const sameOutcome = (a: Outcome, b: Outcome): boolean => a.failed === b.failed && Object.is(a.value, b.value);

function outcomeOf(node: ReadableNode<number>): Outcome {
  try {
    return { failed: false, value: node.get() };
  } catch (error) {
    return { failed: true, value: error };
  }
}

interface Watch {
  readonly node: number;
  readonly unsubscribe: () => void;
  active: boolean;
  seen: Outcome;
}

/** Runs `program`, checking every law at every step; returns the number of compute calls, for the diagnostics. */
function checkLaws(program: Program): number {
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

  let allowed = new Set<number>();
  let computes = 0;
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
    // What compute throws is held by the graph as the node's error: a broken law is written down and checked after
    // each step, never thrown from here.
    const compute = (...args: number[]): number => {
      computes += 1;
      if (!allowed.has(id)) {
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

  const watches: Watch[] = [];
  let called: [node: number, watch: number][] = [];
  let inBatch = false;

  const watchedClosure = (): Set<number> => {
    const into = new Set<number>();
    watches.filter((watch) => watch.active).forEach((watch) => upstream(watch.node, into));
    return into;
  };

  const expectNotifications = (): void => {
    const outcomes = model();
    const expected: [number, number][] = [];
    for (let id = 0; id < nodes.length; id++) {
      watches.forEach((watch, index) => {
        if (watch.node === id && watch.active && !sameOutcome(watch.seen, outcomes[id]!)) {
          watch.seen = outcomes[id]!;
          expected.push([id, index]);
        }
      });
    }
    assert.deepEqual(called, expected, 'listeners called');
    called = [];
  };

  const read = (id: number): void => {
    assert.deepEqual(outcomeOf(nodes[id]!), model()[id], `get of node ${id}`);
  };

  const run = (step: Step): void => {
    switch (step.op) {
      case 'set':
        values[step.node] = step.value;
        sources[step.node]!.set(step.value);
        noteFailures();
        break;
      case 'get':
        read(step.node);
        break;
      case 'subscribe': {
        const index = watches.length;
        const node = nodes[step.node]!;
        const unsubscribe = node.subscribe(() => {
          assert.ok(!inBatch, 'a listener called during a batch');
          called.push([step.node, index]);
          read(step.node);
        });
        watches.push({ node: step.node, unsubscribe, active: true, seen: model()[step.node]! });
        break;
      }
      case 'unsubscribe': {
        const watch = watches[step.pick % Math.max(1, watches.length)];
        if (watch !== undefined) {
          watch.unsubscribe();
          watch.active = false;
        }
        break;
      }
      case 'batch': {
        const outer = inBatch;
        graph.batch(() => {
          inBatch = true;
          step.steps.forEach(run);
          inBatch = outer;
        });
        break;
      }
      default: {
        const never: never = step;
        throw new Error(`unknown step ${String(never)}`);
      }
    }
  };

  for (const step of program.steps) {
    if (step.op === 'set' || step.op === 'batch') {
      allowed = watchedClosure();
      const reads = (steps: readonly Step[]): void =>
        steps.forEach((inner) => {
          if (inner.op === 'get') {
            upstream(inner.node, allowed);
          } else if (inner.op === 'batch') {
            reads(inner.steps);
          }
        });
      reads([step]);
    } else if (step.op === 'get' || step.op === 'subscribe') {
      allowed = upstream(step.node, new Set());
    } else {
      allowed = new Set();
    }
    run(step);
    assert.deepEqual(violations, [], 'laws broken inside compute');
    expectNotifications();
  }
  allowed = new Set(nodes.keys());
  nodes.forEach((_, id) => read(id));
  assert.deepEqual(violations, [], 'laws broken inside compute');
  return computes;
}

// `NaN` and `-0` now and then: the graph and the model both compare by `Object.is`, a `===` anywhere in the graph
// shows as a computation or a notification the model does not make.
const VALUES = fc.oneof(
  { arbitrary: fc.integer({ min: -2, max: 2 }), weight: 20 },
  { arbitrary: fc.constantFrom(Number.NaN, -0), weight: 1 },
);

test('the graph agrees with a naive evaluation: no glitch, nothing computed for nothing, exact notifications', () => {
  fc.assert(
    fc.property(programs(VALUES), (program) => {
      checkLaws(program);
    }),
    { numRuns: 1000 },
  );
});
