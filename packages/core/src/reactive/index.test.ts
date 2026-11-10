import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import {
  assertType,
  CallbackError,
  declareAdversarial,
  HostileError,
  type Callback,
  type Equal,
} from '@yaltaan/testing';

import { createGraph, rewire, type Graph, type NodeValues, type ReadableNode, type SourceNode } from './index.ts';

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

test('a computation that reads, subscribes to or writes a node of its graph, its own too, holds a TypeError', () => {
  const graph = createGraph();
  const a = graph.source(1);
  const other = graph.source(10);
  const untracked = graph.derived([a], (value) => value + other.get());
  const refused = seenOrThrown(untracked);
  assert.ok(refused instanceof TypeError);
  assert.equal(refused.message, 'a computation reads or writes a node of this graph');
  assert.equal(seenOrThrown(untracked), refused, 'held until a dependency changes');

  const self: { node?: ReadableNode<number> } = {};
  self.node = graph.derived([a], (value) => value + self.node!.get());
  assert.ok(seenOrThrown(self.node) instanceof TypeError);

  let called = 0;
  const subscribing = graph.derived([a], (value) => {
    other.subscribe(() => (called += 1));
    return value;
  });
  assert.ok(seenOrThrown(subscribing) instanceof TypeError);
  const writing = graph.derived([a], (value) => {
    other.set(value);
    return value;
  });
  assert.ok(seenOrThrown(writing) instanceof TypeError);
  assert.equal(other.get(), 10, 'the write is refused before it is made');
  other.set(11);
  assert.equal(called, 0, 'nothing was subscribed');

  const comparing = graph.derived([a], (value) => value, { equals: () => other.get() > 0 });
  assert.equal(comparing.get(), 1);
  a.set(2);
  assert.ok(seenOrThrown(comparing) instanceof TypeError, 'equals of a derived node is a computation too');

  const catching = graph.derived([a], (value) => {
    try {
      return other.get();
    } catch {
      return -value;
    }
  });
  assert.equal(catching.get(), -2, 'a compute that catches the refusal keeps what it returns');

  const watched = graph.derived([a], (value) => value + other.get());
  const seen: unknown[] = [];
  watched.subscribe(() => seen.push(seenOrThrown(watched)));
  a.set(3);
  assert.equal(seen.length, 1, 'each computation refused throws a new error, which its listeners are told of');
  assert.ok(seen[0] instanceof TypeError);

  assert.equal(graph.derived([a, other], (x, y) => x + y).get(), 14, 'the graph computes on after a refusal');
  assert.equal(
    graph.derived([a], (value) => value + createGraph().source(5).get()).get(),
    8,
    'a node of another graph read in a computation is neither followed nor refused',
  );
});

test('a computation is refused on watched nodes, in a batch and in a pass, and a write of the same value too', () => {
  const graph = createGraph();
  const a = graph.source(1);
  const watchedSource = graph.source(10);
  const heard: number[] = [];
  watchedSource.subscribe(() => heard.push(watchedSource.get()));
  const reading = graph.derived([a], (value) => value + watchedSource.get());
  assert.ok(seenOrThrown(reading) instanceof TypeError, 'a read of a watched node');
  const writing = graph.derived([a], (value) => {
    watchedSource.set(value);
    return value;
  });
  assert.ok(seenOrThrown(writing) instanceof TypeError, 'a write of a watched source');
  const same = graph.derived([a], (value) => {
    watchedSource.set(10);
    return value;
  });
  assert.ok(seenOrThrown(same) instanceof TypeError, 'a write of the value it holds');
  assert.equal(watchedSource.get(), 10);
  assert.deepEqual(heard, []);

  let inBatch: unknown;
  graph.batch(() => {
    watchedSource.set(11);
    inBatch = seenOrThrown(graph.derived([a], (value) => value + watchedSource.get()));
  });
  assert.ok(inBatch instanceof TypeError, 'in a batch whose notifications wait');
  assert.deepEqual(heard, [11]);

  const b = graph.source(0);
  const viaListener = graph.derived([b], (value) => value + watchedSource.get());
  const inPass: unknown[] = [];
  b.subscribe(() => inPass.push(seenOrThrown(viaListener)));
  b.set(1);
  assert.equal(inPass.length, 1);
  assert.ok(inPass[0] instanceof TypeError, 'in a pass of notifications');
});

test('a batch that a computation opens notifies nothing, and keeps the notifications a stop left', () => {
  const graph = createGraph();
  const source = graph.source(0);
  const double = graph.derived([source], (value) => value * 2);
  let writes = true;
  const heard: number[] = [];
  double.subscribe(() => {
    heard.push(double.get());
    if (writes) {
      source.set(source.get() + 1);
    }
  });
  assert.ok(caught(() => source.set(1)) instanceof RangeError);
  writes = false;
  heard.length = 0;
  const other = graph.source(0);
  const opening = graph.derived([other], (value) => graph.batch(() => value + 1));
  assert.equal(opening.get(), 1, 'what run returns');
  assert.deepEqual(heard, []);
  source.set(1000);
  assert.deepEqual(heard, [2000], 'the next write notifies what the stop left');
});

test('a listener that writes in every pass is stopped after 100 passes, the notifications left kept', () => {
  const graph = createGraph();
  const a = graph.source(0);
  let calls = 0;
  let writes = true;
  a.subscribe(() => {
    calls += 1;
    // Stops by itself after 1,000 calls: without the bound, this test fails instead of running forever.
    if (writes && calls < 1000) {
      a.set(a.get() + 1);
    }
  });
  const stopped = caught(() => a.set(1));
  assert.ok(stopped instanceof RangeError);
  assert.equal(stopped.message, 'listeners of this graph still write after 100 passes');
  assert.equal(calls, 100);
  assert.equal(a.get(), 101);
  writes = false;
  graph.batch(() => {});
  assert.equal(calls, 101, 'the next batch notifies what the last pass wrote');

  const b = graph.source(0);
  let rounds = 0;
  let limit = 100;
  b.subscribe(() => {
    rounds += 1;
    if (rounds < limit) {
      b.set(rounds + 1000);
    }
  });
  b.set(1);
  assert.equal(rounds, 100, '100 passes, the last writing nothing: no error');
  rounds = 0;
  limit = 101;
  assert.ok(caught(() => b.set(2)) instanceof RangeError, 'a write in the hundredth pass');
  assert.equal(rounds, 100);
});

test('listeners that write each other without end are stopped, after the other errors; the graph goes on', () => {
  const graph = createGraph();
  const a = graph.source(0);
  const b = graph.source(0);
  const failure = new Error('listener');
  const run = new Error('run');
  let thrown = 0;
  const stopA = a.subscribe(() => b.set(a.get() + 1));
  const stopB = b.subscribe(() => a.set(b.get() + 1));
  const stopThrowing = a.subscribe(() => {
    if (thrown++ === 0) {
      throw failure;
    }
  });
  const stopped = caught(() =>
    graph.batch(() => {
      a.set(1);
      throw run;
    }),
  );
  assert.ok(stopped instanceof AggregateError);
  assert.equal(stopped.errors.length, 3);
  assert.equal(stopped.errors[0], run);
  assert.equal(stopped.errors[1], failure);
  assert.ok(stopped.errors[2] instanceof RangeError);
  stopA();
  stopB();
  stopThrowing();
  const seen: number[] = [];
  a.subscribe(() => seen.push(a.get()));
  a.set(-1);
  assert.deepEqual(seen, [-1]);
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

test('rewire: the node computes again from its new dependencies, even on the same values, as a write', () => {
  const graph = createGraph();
  const [a, b, c] = [graph.source(1), graph.source(1), graph.source(5)];
  // What the compute closes over changes with the list, as the rows of a form do: the values alone would not tell.
  let label = 'a';
  const { calls, compute } = recorder((...values: number[]) => `${label}:${values.join(',')}`);
  const node = graph.derived([a], compute);
  const after = graph.derived([node], (value) => value.toUpperCase());
  assert.equal(after.get(), 'A:1');
  label = 'b';
  rewire(node, [b]);
  assert.equal(after.get(), 'B:1');
  assert.deepEqual(calls, [[1], [1]]);
  a.set(2);
  assert.equal(after.get(), 'B:1', 'an old dependency no longer feeds it');
  assert.equal(calls.length, 2);
  rewire(node, [b, c, b]);
  assert.equal(node.get(), 'b:1,5,1');
  rewire(node, []);
  assert.equal(node.get(), 'b:');
});

test('rewire: watched, its listeners and those of its dependents are told after the writes, once a batch', () => {
  const graph = createGraph();
  const [a, b] = [graph.source(1), graph.source(2)];
  const node = graph.derived([a], (...values: number[]) => values.reduce((sum, value) => sum + value, 0));
  const doubled = graph.derived([node], (value) => value * 2);
  const seen: string[] = [];
  node.subscribe(() => seen.push(`node ${node.get()}`));
  doubled.subscribe(() => seen.push(`doubled ${doubled.get()}`));
  rewire(node, [a, b]);
  assert.deepEqual(seen, ['node 3', 'doubled 6']);
  b.set(3);
  assert.deepEqual(seen.splice(0), ['node 3', 'doubled 6', 'node 4', 'doubled 8'], 'a new dependency feeds it');
  a.set(0);
  assert.deepEqual(seen.splice(0), ['node 3', 'doubled 6']);
  graph.batch(() => {
    rewire(node, [b]);
    assert.deepEqual(seen, [], 'nothing during the batch');
    assert.equal(doubled.get(), 6, 'reads inside see the rewire');
    rewire(node, [a, b]);
  });
  assert.deepEqual(seen, [], 'rewired and back within a batch: nothing changed');
  rewire(node, [a, b]);
  assert.deepEqual(seen, [], 'a rewire that gives the same value notifies nobody');
});

test('rewire: a cycle, a source, a foreign node, a node of another graph and a computation are refused', () => {
  const graph = createGraph();
  const a = graph.source(1);
  const node = graph.derived([a], (...values: number[]) => values.length);
  const above = graph.derived([node], (value) => value + 1);
  const top = graph.derived([above, a], (x, y) => x + y);
  let calls = 0;
  top.subscribe(() => (calls += 1));
  const refused: [string, () => void][] = [
    ['itself', () => rewire(node, [node])],
    ['a dependent', () => rewire(node, [a, above])],
    ['a dependent two levels up', () => rewire(node, [top])],
    ['a source, watched', () => rewire(a, [])],
    ['a source no listener watches', () => rewire(graph.source(0), [a])],
    ['a foreign node', () => rewire({ get: () => 1, subscribe: () => () => {} }, [])],
    ['a foreign dependency', () => rewire(node, [{ get: () => 1, subscribe: () => () => {} }])],
    ['a node of another graph', () => rewire(node, [createGraph().source(1)])],
  ];
  for (const [what, run] of refused) {
    assert.throws(run, TypeError, what);
  }
  const inside = graph.derived([a], () => caught(() => rewire(node, [])));
  assert.ok(inside.get() instanceof TypeError, 'a computation cannot rewire');
  a.set(2);
  assert.deepEqual([node.get(), top.get(), calls], [1, 4, 1], 'nothing changed by what was refused');
});

test('rewire: a watched node lets go of its old dependencies, then reclaimed, and holds its new ones', async () => {
  setFlagsFromString('--expose-gc');
  const collect = runInNewContext('gc') as () => void;
  const graph = createGraph();
  const source = graph.source(0);
  const node = graph.derived([source], (value) => value);
  node.subscribe(() => {});
  const ref = ((): WeakRef<object> => {
    const old = graph.derived([source], (value) => value * 2);
    rewire(node, [old]);
    source.set(1);
    assert.equal(node.get(), 2);
    rewire(node, [source]);
    return new WeakRef(old);
  })();
  await new Promise((resolve) => setImmediate(resolve));
  collect();
  assert.equal(ref.deref(), undefined);
  let calls = 0;
  const fresh = graph.source(10);
  rewire(node, [fresh]);
  node.subscribe(() => (calls += 1));
  fresh.set(11);
  assert.deepEqual([node.get(), calls], [11, 1]);
});

test('rewire: a node given dependencies created after it keeps its values, its listeners by creation order', () => {
  const graph = createGraph();
  const early = graph.derived([], (...values: number[]) => values[0] ?? 0);
  const source = graph.source(1);
  const late = graph.derived([source], (value) => value * 10);
  rewire(early, [late]);
  const order: string[] = [];
  late.subscribe(() => order.push(`late ${late.get()}`));
  early.subscribe(() => order.push(`early ${early.get()}`));
  source.set(2);
  assert.deepEqual(order, ['early 20', 'late 20']);
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
  return { source, top: diamonds(graph, source, rungs) };
}

/** The top of a ladder of `rungs` diamonds over `base`, in `graph`. */
function diamonds(graph: Graph, base: ReadableNode<number>, rungs: number): ReadableNode<number> {
  let left = base;
  let right = base;
  for (let rung = 0; rung < rungs; rung++) {
    const nextLeft = graph.derived([left, right], (l, r) => (l + r) % 7);
    right = graph.derived([left, right], (l, r) => (l * r) % 7);
    left = nextLeft;
  }
  return graph.derived([left, right], (l, r) => l + r);
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

test('scale: a rewire walks the new dependencies in time linear in their nodes, and refuses a cycle as fast', () => {
  const steps = (rungs: number): (() => void) => {
    const graph = createGraph();
    const base = graph.source(0);
    const bottom = graph.derived([base], (value) => value);
    const top = diamonds(graph, bottom, rungs);
    const node = graph.derived([base], (value) => value);
    return () => {
      for (let round = 0; round < 50; round++) {
        rewire(node, [top]);
        rewire(node, [base]);
        assert.throws(() => rewire(bottom, [top]), TypeError);
      }
    };
  };
  // Without the nodes already walked, 2^16 paths a rewire.
  assertScales('a ladder walked by rewire, 8 then 16 rungs', steps(8), steps(16), 8);
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

// Rewired to a source holding the value, the node gives it as it is; the value as a node or as the list is refused,
// unless it is a list of nodes of the graph, with a `TypeError` or what a hostile value throws when looked at.
const rewiredAsIs = (value: unknown): void => {
  const graph = createGraph();
  const held = graph.source<unknown>(value);
  const node = graph.derived([], (...values: unknown[]) => values[0]);
  rewire(node, [held]);
  assert.ok(Object.is(node.get(), value));
  for (const run of [() => rewire(value as never, []), () => rewire(node, value as never)]) {
    try {
      run();
    } catch (error) {
      assert.ok(error instanceof TypeError || error instanceof HostileError, String(error));
    }
  }
  assert.ok(Object.is(node.get(), value) || node.get() === undefined);
};

declareAdversarial(SUBPATH, 'rewire', {
  boundary: rewiredAsIs,
  structures: rewiredAsIs,
  hostile: rewiredAsIs,
  unicode: rewiredAsIs,
  callbacks: (callback: Callback) => {
    const graph = createGraph();
    const input = graph.source(1);
    const node = graph.derived([], (...values: number[]) => callback(values[0], 0, values));
    const seen = graph.derived([node], (value) => value);
    seen.subscribe(() => callback(input.get(), 0, []));
    survives(() => rewire(node, [input]));
    survives(() => seen.get());
    survives(() => rewire(node, []));
    assert.equal(input.get(), 1);
  },
  async: { na: 'rewire is synchronous: it runs nothing but on a call of the caller, and takes no signal' },
});
