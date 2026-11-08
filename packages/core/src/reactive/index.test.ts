import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { assertType, CallbackError, declareAdversarial, type Callback, type Equal } from '@yaltaan/testing';

import { createGraph, type Graph, type NodeValues, type ReadableNode, type SourceNode } from './index.ts';

const SUBPATH = '@yaltaan/core/reactive';

/** A compute that records the arguments of each call. */
function recorder<A extends unknown[], R>(compute: (...args: A) => R): { calls: A[]; compute: (...args: A) => R } {
  const calls: A[] = [];
  return {
    calls,
    compute: (...args) => {
      calls.push(args);
      return compute(...args);
    },
  };
}

function seenOrThrown(node: ReadableNode<unknown>): unknown {
  try {
    return node.get();
  } catch (error) {
    return error;
  }
}

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return assert.fail('expected a throw');
}

test('a derived node computes nothing until it is read, then only once its arguments change', () => {
  const graph = createGraph();
  const price = graph.source(10);
  const unrelated = graph.source('a');
  const double = recorder((value: number) => value * 2);
  const doubled = graph.derived([price], double.compute);
  assert.deepEqual(double.calls, []);
  assert.equal(doubled.get(), 20);
  assert.equal(doubled.get(), 20);
  unrelated.set('b');
  assert.equal(doubled.get(), 20);
  assert.deepEqual(double.calls, [[10]]);
  // Nothing watches it: writes cost it nothing, and the next read computes once, on the last value.
  price.set(11);
  price.set(12);
  assert.deepEqual(double.calls, [[10]]);
  assert.equal(doubled.get(), 24);
  assert.deepEqual(double.calls, [[10], [12]]);
  // A dependency that comes back to the arguments of the last computation recomputes nothing.
  price.set(13);
  price.set(12);
  assert.equal(doubled.get(), 24);
  assert.deepEqual(double.calls, [[10], [12]]);
});

test('a diamond computes its bottom once per write, on the values of one state of the sources', () => {
  const graph = createGraph();
  const a = graph.source(1);
  const b = graph.derived([a], (value) => value + 1);
  const c = graph.derived([a], (value) => value * 10);
  const bottom = recorder((left: number, right: number) => [left, right]);
  const d = graph.derived([b, c], bottom.compute);
  const seen: number[][] = [];
  d.subscribe(() => {
    seen.push([a.get(), b.get(), c.get(), ...d.get()]);
  });
  a.set(2);
  a.set(3);
  assert.deepEqual(bottom.calls, [
    [2, 10],
    [3, 20],
    [4, 30],
  ]);
  assert.deepEqual(seen, [
    [2, 3, 20, 3, 20],
    [3, 4, 30, 4, 30],
  ]);
});

test('a write that no listener watches computes nothing, and an unsubscribed node is no longer watched', () => {
  const graph = createGraph();
  const a = graph.source(1);
  const plusOne = recorder((value: number) => value + 1);
  const b = graph.derived([a], plusOne.compute);
  const stop = b.subscribe(() => {});
  assert.deepEqual(plusOne.calls, [[1]], 'subscribing computes the node');
  a.set(2);
  assert.deepEqual(plusOne.calls, [[1], [2]]);
  stop();
  a.set(3);
  a.set(4);
  assert.deepEqual(plusOne.calls, [[1], [2]]);
  assert.equal(b.get(), 5);
});

test('a batch notifies each listener once, at its end, on the final values; reads inside see its writes', () => {
  const graph = createGraph();
  const first = graph.source('Ada');
  const last = graph.source('Byron');
  const full = graph.derived([first, last], (a, b) => `${a} ${b}`);
  const seen: string[] = [];
  full.subscribe(() => seen.push(full.get()));
  const returned = graph.batch(() => {
    first.set('Augusta');
    assert.equal(full.get(), 'Augusta Byron');
    graph.batch(() => last.set('King'));
    assert.deepEqual(seen, [], 'a nested batch notifies at the end of the outermost one');
    last.set('Lovelace');
    first.set('Ada');
    return 42;
  });
  assert.equal(returned, 42);
  assert.deepEqual(seen, ['Ada Lovelace']);
});

test('a value set back before the end of a batch notifies nobody, even read in between', () => {
  const graph = createGraph();
  const a = graph.source(1);
  const b = graph.derived([a], (value) => value * 2);
  let calls = 0;
  a.subscribe(() => (calls += 1));
  b.subscribe(() => (calls += 1));
  graph.batch(() => {
    a.set(5);
    assert.equal(b.get(), 10);
    a.set(1);
  });
  assert.equal(calls, 0);
});

test('equals keeps the current value and notifies nobody; what it throws stops a write, or is held as an error', () => {
  const graph = createGraph();
  const byFloor = (current: number, next: number): boolean => Math.floor(current) === Math.floor(next);
  const amount = graph.source(1, { equals: byFloor });
  let calls = 0;
  amount.subscribe(() => (calls += 1));
  amount.set(1.5);
  assert.equal(amount.get(), 1);
  assert.equal(calls, 0);
  amount.set(2.5);
  assert.equal(amount.get(), 2.5);
  assert.equal(calls, 1);

  const point = graph.derived([amount], (value) => ({ x: Math.round(value) }), {
    equals: (current, next) => current.x === next.x,
  });
  const before = point.get();
  amount.set(3.4);
  assert.equal(amount.get(), 3.4);
  assert.equal(point.get(), before, 'an equal value keeps the identity of the current one');

  const refused = new Error('refused');
  const strict = graph.source(0, {
    equals: () => {
      throw refused;
    },
  });
  assert.equal(
    caught(() => strict.set(1)),
    refused,
  );
  assert.equal(strict.get(), 0);
  const picky = graph.derived([amount], (value) => value, {
    equals: () => {
      throw refused;
    },
  });
  assert.equal(picky.get(), 3.4, 'the first computation compares with nothing');
  amount.set(4);
  assert.equal(
    caught(() => picky.get()),
    refused,
  );
});

test('an error thrown by compute is held, passed on without computing dependents, and replaced on a change', () => {
  const graph = createGraph();
  const input = graph.source(-1);
  const failure = new RangeError('negative');
  const root = recorder((value: number) => {
    if (value < 0) {
      throw failure;
    }
    return Math.sqrt(value);
  });
  const sqrt = graph.derived([input], root.compute);
  const label = recorder((value: number) => `√ = ${value}`);
  const text = graph.derived([sqrt], label.compute);
  const seen: unknown[] = [];
  text.subscribe(() => seen.push(seenOrThrown(text)));
  assert.equal(
    caught(() => text.get()),
    failure,
  );
  assert.equal(
    caught(() => sqrt.get()),
    failure,
  );
  assert.deepEqual(root.calls, [[-1]]);
  assert.deepEqual(label.calls, []);
  input.set(-2);
  assert.deepEqual(root.calls, [[-1], [-2]]);
  assert.deepEqual(seen, [], 'the same error again notifies nobody');
  input.set(4);
  assert.equal(text.get(), '√ = 2');
  assert.deepEqual(label.calls, [[2]]);
  assert.equal(seen.length, 1);
});

test('a listener that throws does not stop the others; one error is thrown as it is, several together', () => {
  const graph = createGraph();
  const a = graph.source(0);
  const first = new Error('first');
  const second = new Error('second');
  const order: string[] = [];
  a.subscribe(() => {
    order.push('one');
    throw first;
  });
  a.subscribe(() => order.push('two'));
  assert.equal(
    caught(() => a.set(1)),
    first,
  );
  assert.deepEqual(order, ['one', 'two']);
  a.subscribe(() => {
    throw second;
  });
  const both = caught(() => a.set(2));
  assert.ok(both instanceof AggregateError);
  assert.deepEqual(both.errors, [first, second]);
  assert.equal(a.get(), 2);

  const failure = new Error('run');
  const thrown = caught(() =>
    graph.batch(() => {
      a.set(3);
      throw failure;
    }),
  );
  assert.ok(thrown instanceof AggregateError, 'the error of run comes first, then those of the listeners');
  assert.deepEqual(thrown.errors, [failure, first, second]);
  assert.equal(a.get(), 3);
});

test('a batch whose run throws notifies its writes, then throws that error as it is', () => {
  const graph = createGraph();
  const a = graph.source(0);
  const seen: number[] = [];
  a.subscribe(() => seen.push(a.get()));
  const failure = new Error('run');
  assert.equal(
    caught(() =>
      graph.batch(() => {
        a.set(1);
        graph.batch(() => {
          a.set(2);
          throw failure;
        });
      }),
    ),
    failure,
  );
  assert.deepEqual(seen, [2]);
});

test('each subscription is its own: removed once by its own function, never called after, nor during its pass', () => {
  const graph = createGraph();
  const a = graph.source(0);
  let calls = 0;
  const listener = (): void => {
    calls += 1;
  };
  const stopFirst = a.subscribe(listener);
  const stopSecond = a.subscribe(listener);
  a.set(1);
  assert.equal(calls, 2);
  stopFirst();
  stopFirst();
  a.set(2);
  assert.equal(calls, 3);
  stopSecond();
  a.set(3);
  assert.equal(calls, 3);

  const order: string[] = [];
  let stopLate = (): void => {};
  a.subscribe(() => {
    order.push('early');
    stopLate();
    a.subscribe(() => order.push('added during the pass'));
  });
  stopLate = a.subscribe(() => order.push('late'));
  a.set(4);
  assert.deepEqual(order, ['early']);
});

test('a listener is called without this nor arguments', () => {
  const graph = createGraph();
  const a = graph.source(0);
  let received: unknown[] = [];
  let self: unknown = 'unset';
  a.subscribe(function (this: unknown, ...args: unknown[]) {
    self = this;
    received = args;
  });
  a.set(1);
  assert.equal(self, undefined);
  assert.deepEqual(received, []);
});

test('what a listener writes is notified in a next pass, each listener seeing the latest value', () => {
  const graph = createGraph();
  const celsius = graph.source(0);
  const fahrenheit = graph.source(32);
  const seen: string[] = [];
  celsius.subscribe(() => fahrenheit.set((celsius.get() * 9) / 5 + 32));
  fahrenheit.subscribe(() => seen.push(`${celsius.get()} °C = ${fahrenheit.get()} °F`));
  celsius.set(100);
  assert.deepEqual(seen, ['100 °C = 212 °F']);
});

test('listeners run by creation order of their nodes, then by order of subscription', () => {
  const graph = createGraph();
  const a = graph.source(0);
  const b = graph.derived([a], (value) => value + 1);
  const c = graph.derived([b], (value) => value + 1);
  const order: string[] = [];
  c.subscribe(() => order.push('c1'));
  b.subscribe(() => order.push('b1'));
  a.subscribe(() => order.push('a1'));
  c.subscribe(() => order.push('c2'));
  a.set(1);
  assert.deepEqual(order, ['a1', 'b1', 'c1', 'c2']);
});

test('graphs are independent: a batch of one never holds back the notifications of another', () => {
  const one = createGraph();
  const other = createGraph();
  const a = one.source(0);
  const b = other.source(0);
  const seen: string[] = [];
  b.subscribe(() => seen.push('other'));
  one.batch(() => {
    a.set(1);
    b.set(1);
    assert.deepEqual(seen, ['other']);
  });
});

test('a dependency must be a node of the same graph; the list is copied', () => {
  const one = createGraph();
  const other = createGraph();
  const foreign: ReadableNode<number> = { get: () => 1, subscribe: () => () => {} };
  assert.throws(() => one.derived([other.source(1)], (value) => value), TypeError);
  assert.throws(() => one.derived([foreign], (value) => value), TypeError);
  const a = one.source(1);
  const b = one.source(2);
  const deps: ReadableNode<number>[] = [a];
  const first = one.derived(deps, (value) => value);
  deps[0] = b;
  assert.equal(first.get(), 1);
  assert.equal(one.derived([], () => 'constant').get(), 'constant');
});

test('values compare by Object.is: NaN stays NaN without a notification, -0 replaces 0', () => {
  const graph = createGraph();
  const input = graph.source(Number.NaN);
  const offset = graph.source(0);
  const sum = recorder((value: number, shift: number) => value + shift);
  const total = graph.derived([input, offset], sum.compute);
  let calls = 0;
  input.subscribe(() => (calls += 1));
  total.subscribe(() => (calls += 1));
  input.set(Number.NaN);
  assert.deepEqual(sum.calls, [[Number.NaN, 0]], 'the same arguments, NaN included, compute nothing');
  offset.set(1);
  assert.equal(calls, 0, 'a node that stays NaN notifies nobody');
  assert.equal(sum.calls.length, 2);
  offset.set(-0);
  offset.set(0);
  assert.ok(Object.is(offset.get(), 0));
  input.set(1);
  offset.set(-0);
  assert.ok(Object.is(offset.get(), -0), '-0 is not 0');
  assert.equal(total.get(), 1);
});

test('a derived node that recovers from an error takes its new value without asking equals', () => {
  const graph = createGraph();
  const input = graph.source(-1);
  const compared: unknown[] = [];
  const half = graph.derived(
    [input],
    (value) => {
      if (value < 0) {
        throw new RangeError('negative');
      }
      return { half: value / 2 };
    },
    {
      equals: (current, next) => {
        compared.push(current, next);
        return current.half === next.half;
      },
    },
  );
  assert.ok(seenOrThrown(half) instanceof RangeError);
  input.set(4);
  assert.deepEqual(half.get(), { half: 2 });
  assert.deepEqual(compared, [], 'a held error is never handed to equals');
  input.set(5);
  assert.deepEqual(compared, []);
  assert.deepEqual(half.get(), { half: 2.5 });
  assert.deepEqual(compared, [{ half: 2 }, { half: 2.5 }]);
});

test('a node no longer watched is held by none of its dependencies, and is reclaimed', async () => {
  setFlagsFromString('--expose-gc');
  const collect = runInNewContext('gc') as () => void;
  const graph = createGraph();
  const source = graph.source(0);
  const refs = ((): WeakRef<object>[] => {
    let node: ReadableNode<number> = source;
    const made: WeakRef<object>[] = [];
    for (let level = 0; level < 4; level++) {
      node = graph.derived([node, node], (left, right) => left + right);
      made.push(new WeakRef(node));
    }
    const stop = node.subscribe(() => {});
    source.set(1);
    stop();
    return made;
  })();
  // A WeakRef keeps its target until the end of the job that read it.
  await new Promise((resolve) => setImmediate(resolve));
  collect();
  assert.deepEqual(
    refs.map((ref) => ref.deref()),
    [undefined, undefined, undefined, undefined],
  );
  source.set(2);
});

/** The fastest of five runs, in nanoseconds: the least disturbed by the rest of the machine. */
function fastest(run: () => void): number {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 5; attempt++) {
    const started = process.hrtime.bigint();
    run();
    best = Math.min(best, Number(process.hrtime.bigint() - started));
  }
  return best;
}

/** Throws when `large` takes more than `limit` times as long as `small`: the same work at another size. */
function assertScales(what: string, small: () => void, large: () => void, limit: number): void {
  fastest(small);
  const ratio = fastest(large) / fastest(small);
  assert.ok(ratio < limit, `${what}: ${ratio.toFixed(1)} times as long, more than ${limit}`);
}

/** A ladder of `rungs` diamonds over one source, each rung reading both nodes of the rung below. */
function ladder(rungs: number): { source: SourceNode<number>; top: ReadableNode<number> } {
  const graph = createGraph();
  const source = graph.source(0);
  let left: ReadableNode<number> = source;
  let right: ReadableNode<number> = source;
  for (let rung = 0; rung < rungs; rung++) {
    const nextLeft = graph.derived([left, right], (l, r) => (l + r) % 7);
    right = graph.derived([left, right], (l, r) => (l * r) % 7);
    left = nextLeft;
  }
  return { source, top: graph.derived([left, right], (l, r) => l + r) };
}

/** A chain of `length` derived nodes over `source`, each naming the one below `width` times. */
function chain(graph: Graph, source: ReadableNode<number>, length: number, width = 1): ReadableNode<number> {
  let node = source;
  for (let level = 0; level < length; level++) {
    node = graph.derived(
      Array.from({ length: width }, () => node),
      (...values: number[]) => values[0]! + 1,
    );
  }
  return node;
}

// Each test runs the same steps at two sizes: a cost that is not proportional to the size, as an exponential walk
// through diamonds, or a read that walks what it should not, shows as a ratio far over the size ratio.
test('scale: a ladder of diamonds reads, and writes when watched, in time linear in its rungs', () => {
  const steps = (rungs: number, watched: boolean): (() => void) => {
    const { source, top } = ladder(rungs);
    if (watched) {
      top.subscribe(() => {});
    }
    let value = 0;
    return () => {
      for (let write = 0; write < 200; write++) {
        source.set((value += 1));
        top.get();
      }
    };
  };
  // Small enough that an exponential walk fails in about a second instead of never ending: 2^16 paths a read.
  assertScales('unwatched ladder, 8 then 16 rungs', steps(8, false), steps(16, false), 8);
  assertScales('watched ladder, 8 then 16 rungs', steps(8, true), steps(16, true), 8);
});

test('scale: reading a watched node after an unrelated write costs the same, whatever its depth', () => {
  const steps = (length: number): (() => void) => {
    const graph = createGraph();
    const unrelated = graph.source(0);
    const end = chain(graph, graph.source(0), length);
    end.subscribe(() => {});
    let value = 0;
    return () => {
      for (let write = 0; write < 200; write++) {
        unrelated.set((value += 1));
        end.get();
      }
    };
  };
  assertScales('watched chain end, 100 then 1,600 levels', steps(100), steps(1600), 4);
});

test('scale: subscribing and unsubscribing a chain whose nodes name their dependency twice is linear', () => {
  const steps = (length: number): (() => void) => {
    const graph = createGraph();
    const end = chain(graph, graph.source(0), length, 2);
    return () => {
      for (let round = 0; round < 20; round++) {
        end.subscribe(() => {})();
      }
    };
  };
  assertScales('doubled chain, 8 then 16 levels', steps(8), steps(16), 8);
});

test('a chain of 1,000 nodes reads and recomputes', () => {
  const graph = createGraph();
  const source = graph.source(0);
  const end = chain(graph, source, 1000);
  assert.equal(end.get(), 1000);
  source.set(1);
  assert.equal(end.get(), 1001);
});

test('types: values inferred from the dependencies, set only on a source', () => {
  const graph: Graph = createGraph();
  const count = graph.source(1);
  const name = graph.source('Ada');
  const both = graph.derived([count, name], (n, s) => {
    assertType<Equal<typeof n, number>>();
    assertType<Equal<typeof s, string>>();
    return { n, s };
  });
  assertType<Equal<typeof count, SourceNode<number>>>();
  assertType<Equal<typeof both, ReadableNode<{ n: number; s: string }>>>();
  assertType<Equal<NodeValues<[SourceNode<number>, ReadableNode<string>]>, [number, string]>>();
  const readable: ReadableNode<unknown> = count;
  void readable;
  const amount = graph.source(1, { equals: (current, next) => Math.floor(current) === Math.floor(next) });
  assertType<Equal<typeof amount, SourceNode<number>>>();
  // Compiled, never run.
  const refused = (): void => {
    // @ts-expect-error A derived node has no set.
    both.set({ n: 2, s: 'Bob' });
    // @ts-expect-error A source takes values of its type only.
    count.set('two');
    // @ts-expect-error A dependency is a node.
    graph.derived([1], (value) => value);
  };
  void refused;
});

// What every category checks: a value is held as it is, by identity, never read; a callback is a compute, an equals
// or a listener, whose throw is held or passed on, the graph still usable after it.
const holdsAsIs = (value: unknown): void => {
  const graph = createGraph();
  const held = graph.source<unknown>(undefined);
  const copy = graph.derived([held], (inner) => inner);
  let calls = 0;
  copy.subscribe(() => (calls += 1));
  held.set(value);
  assert.ok(Object.is(held.get(), value) && Object.is(copy.get(), value));
  assert.equal(calls, Object.is(value, undefined) ? 0 : 1);
};

function survives(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof CallbackError || error === 'callback failure', String(error));
  }
}

declareAdversarial(SUBPATH, 'createGraph', {
  boundary: holdsAsIs,
  structures: holdsAsIs,
  hostile: holdsAsIs,
  unicode: holdsAsIs,
  callbacks: (callback: Callback) => {
    const graph = createGraph();
    const input = graph.source(1);
    const computed = graph.derived([input], (value) => callback(value, 0, [value]));
    survives(() => computed.get());
    const compared = graph.source<unknown>(1, { equals: (current, next) => callback(current, 0, [next]) === true });
    survives(() => compared.set(2));
    let after = 0;
    input.subscribe(() => callback(input.get(), 0, []));
    input.subscribe(() => (after += 1));
    survives(() => input.set(2));
    survives(() => input.set(3));
    assert.equal(after, 2, 'a listener that throws stops no other');
    assert.equal(input.get(), 3);
    survives(() => computed.get());
  },
  async: { na: 'the graph is synchronous: it runs nothing but on a call of the caller, and takes no signal' },
});
