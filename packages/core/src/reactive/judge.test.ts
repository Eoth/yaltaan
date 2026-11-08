// The reactive graph against @preact/signals-core, on the random programs of programs.test.ts (see the judge in
// @yaltaan/testing): a source is a `signal`, a derived node a `computed` that reads its dependencies in order, a
// subscription an `effect` that reads the node (its first run, at creation, is not a notification), a batch a `batch`.
// Each program gives, step by step, what every read returned (the value, or the message of the error thrown) and which
// listeners were called with what they read. Listeners are compared as a set per step: the order of preact's effects is
// its own, and ours (creation order of the nodes, then order of subscription) is judged by the laws.
// Blind spots: compute counts (preact computes on its own schedule: laziness is judged by the laws); listeners that
// write, throw or unsubscribe; `equals`, which preact does not have.
import { batch, computed, effect, signal, type ReadonlySignal, type Signal } from '@preact/signals-core';

import { createJudge, fc } from '@yaltaan/testing';

import { createGraph, type ReadableNode, type SourceNode } from './index.ts';
import { apply, ComputeError, programs, type Program, type Step } from './programs.test.ts';

const judge = createJudge(new URL('./index.ts', import.meta.url), '@preact/signals-core');

type Outcome = number | { readonly threw: string };
interface StepTrace {
  readonly reads: Outcome[];
  readonly notified: [node: number, subscription: number, read: Outcome][];
}

/** What a program needs of a reactive library. */
interface Engine<N> {
  source(value: number): N;
  derived(deps: readonly N[], compute: (values: readonly number[]) => number): N;
  read(node: N): number;
  write(node: N, value: number): void;
  subscribe(node: N, listener: () => void): () => void;
  batch(run: () => void): void;
}

function outcomeOf(read: () => number): Outcome {
  try {
    return read();
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}

function trace<N>(program: Program, engine: Engine<N>): StepTrace[] {
  const nodes: N[] = program.sources.map((value) => engine.source(value));
  for (const spec of program.derived) {
    const error = new ComputeError(`node ${nodes.length}`);
    nodes.push(
      engine.derived(
        spec.deps.map((dep) => nodes[dep]!),
        (values) => apply(spec.kind, values, error),
      ),
    );
  }
  const unsubscribes: (() => void)[] = [];
  const steps: StepTrace[] = [];
  let current: StepTrace = { reads: [], notified: [] };
  const run = (step: Step): void => {
    switch (step.op) {
      case 'set':
        engine.write(nodes[step.node]!, step.value);
        break;
      case 'get':
        current.reads.push(outcomeOf(() => engine.read(nodes[step.node]!)));
        break;
      case 'subscribe': {
        const index = unsubscribes.length;
        const node = nodes[step.node]!;
        unsubscribes.push(
          engine.subscribe(node, () => {
            current.notified.push([step.node, index, outcomeOf(() => engine.read(node))]);
          }),
        );
        break;
      }
      case 'unsubscribe':
        unsubscribes[step.pick % Math.max(1, unsubscribes.length)]?.();
        break;
      case 'batch':
        engine.batch(() => step.steps.forEach(run));
        break;
      default: {
        const never: never = step;
        throw new Error(`unknown step ${String(never)}`);
      }
    }
  };
  for (const step of program.steps) {
    current = { reads: [], notified: [] };
    run(step);
    current.notified.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    steps.push(current);
  }
  return steps;
}

function ours(program: Program): StepTrace[] {
  const graph = createGraph();
  return trace<ReadableNode<number>>(program, {
    source: (value) => graph.source(value),
    derived: (deps, compute) => graph.derived(deps, (...values) => compute(values)),
    read: (node) => node.get(),
    write: (node, value) => (node as SourceNode<number>).set(value),
    subscribe: (node, listener) => node.subscribe(listener),
    batch: (run) => graph.batch(run),
  });
}

// `repeats: false` leaves out an effect run that reads what the same effect read last, which preact allows itself
// and our listeners never see.
function theirs(program: Program, repeats: boolean): StepTrace[] {
  return trace<ReadonlySignal<number>>(program, {
    source: (value) => signal(value),
    derived: (deps, compute) => computed(() => compute(deps.map((dep) => dep.value))),
    read: (node) => node.value,
    write: (node, value) => {
      (node as Signal<number>).value = value;
    },
    subscribe: (node, listener) => {
      let started = false;
      let last: Outcome | undefined;
      const dispose = effect(() => {
        const read = outcomeOf(() => node.value);
        const repeated = started && sameOutcome(read, last!);
        last = read;
        if (started && (repeats || !repeated)) {
          listener();
        }
      });
      started = true;
      return dispose;
    },
    batch: (run) => batch(run),
  });
}

function sameOutcome(a: Outcome, b: Outcome): boolean {
  return typeof a === 'number' && typeof b === 'number' ? Object.is(a, b) : JSON.stringify(a) === JSON.stringify(b);
}

const special = (value: number): boolean => Number.isNaN(value) || Object.is(value, -0);
const writesSpecial = (program: Program): boolean => {
  const inSteps = (steps: readonly Step[]): boolean =>
    steps.some((step) => (step.op === 'set' ? special(step.value) : step.op === 'batch' ? inSteps(step.steps) : false));
  return program.sources.some(special) || inSteps(program.steps);
};

const values = fc.oneof(
  { arbitrary: fc.integer({ min: -2, max: 2 }), weight: 100 },
  { arbitrary: fc.constantFrom(Number.NaN, -0), weight: 1 },
);

judge.compare('createGraph', {
  input: programs(values),
  ours,
  theirs: (program) => theirs(program, true),
  differences: [
    {
      text:
        'values compare by `Object.is`, so a source set to `NaN` again keeps it and notifies nobody, and `-0` ' +
        'replaces `0`; preact compares with `!==`',
      applies: writesSpecial,
    },
    {
      text:
        'a listener is called only when what `get` gives, a value or a thrown error, differs from what it gave ' +
        'last; preact runs the effect again when a node throws again, or was read in a batch and set back before ' +
        'its end',
      applies: (program) => JSON.stringify(theirs(program, true)) !== JSON.stringify(theirs(program, false)),
      expected: (_, program) => theirs(program, false),
    },
  ],
});
