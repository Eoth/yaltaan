// The reactive node of ARCHITECTURE.md §5.5 and ADR 0041: sources, and derived nodes whose dependencies are given when
// they are built, in a lazy push-pull graph that a `createGraph` instance holds. No state lives in the module: the
// batch, the queue of notifications and the counter of writes belong to a graph, so two graphs never wait for each
// other, and nothing runs but a call of the caller (no timer, no microtask, no global scheduler).
//
// Invariants, which the laws of the tests check against a naive evaluation of the whole graph:
//   - A graph counts the writes that changed a value (its epoch). A derived node validated in the current epoch is
//     current, so that reading it again, or reaching it twice through a diamond, costs O(1).
//   - A node is watched when it has listeners or a watched dependent. Its dependencies then hold it among their
//     observers, and a write marks it stale (epoch STALE): a watched node not marked is current, whatever the epoch.
//     An unwatched node is held by no dependency, so a write costs it nothing and the garbage collector reclaims it
//     with its last reference.
//   - A stale node's watched dependents are all stale, so marking stops at a node already marked.
//   - Validating a node refreshes its dependencies first (a topological order, depth first), then compares their
//     values with the arguments of its last computation by `Object.is`: compute runs only when an argument changed,
//     and always on values of the same state of the sources, which is what keeps it free of glitches.
//   - An error thrown by compute is held as the node's value, rethrown by `get`, and passed on to its dependents
//     without calling their compute.
//   - After the writes (the write itself, or the end of the outermost batch), the watched nodes with listeners that a
//     write reached are refreshed in the order of their ids, given at construction, which is a topological order since
//     a node's dependencies exist before it; each listener whose last seen value differs is called, once, in the order
//     of subscription. What a listener writes is notified in a next pass of the same loop.
//
// Differences from @preact/signals-core 1.14.4, each found on its inputs by the judge, our side judged by the laws:
//   - createGraph: values compare by `Object.is`, so a source set to `NaN` again keeps it and notifies nobody, and `-0`
//     replaces `0`; preact compares with `!==`
//   - createGraph: a listener is called only when what `get` gives, a value or a thrown error, differs from what it
//     gave last; preact runs the effect again when a node throws again, or was read in a batch and set back before
//     its end

/**
 * A value that can be read and watched: exactly the contract of React's `useSyncExternalStore` (`subscribe`, then
 * `get` as the snapshot), which converts as directly to an Angular signal or a Vue `customRef`. `get` and `subscribe`
 * are methods: pass `(listener) => node.subscribe(listener)` and `() => node.get()` where a function is expected.
 * @since 0.3
 * @experimental
 */
export interface ReadableNode<T> {
  /**
   * The current value. A derived node computes it on its first read, then again only once a dependency's value has
   * changed; an error its compute or its `equals` threw, or that a dependency holds, is thrown again, until a
   * dependency changes.
   * @pure
   * @sharing none
   * @complexity O(1) for a source, for a watched node when nothing it depends on was written since, and for any node
   *   when nothing in the graph was; otherwise O(n) (n = nodes and edges it depends on), plus one compute per node
   *   whose arguments changed
   * @throws what the compute or the `equals` of this node, or of a node it depends on, threw (the same value)
   * @throws RangeError when the nodes it depends on are nested deeper than the call stack allows (about 4,800 levels
   *   on a first read with Node's default stack)
   */
  get(): T;
  /**
   * Calls `listener`, without arguments, once a write, or the batch that holds it, has changed what `get` gives
   * (a value or a thrown error, by `Object.is`) from what this listener saw last; never during a batch, and never
   * after the returned function has been called. Subscribing computes a derived node: the listener has seen that.
   * @mutates this
   * @sharing none
   * @complexity O(n) for the first listener (n = nodes and edges it depends on, which it watches from then on), O(1)
   *   for another
   * @throws RangeError when the nodes it depends on are nested deeper than the call stack allows; nothing is then
   *   subscribed
   */
  subscribe(listener: () => void): () => void;
}

/**
 * A node whose value is written by the caller.
 * @since 0.3
 * @experimental
 */
export interface SourceNode<T> extends ReadableNode<T> {
  /**
   * Replaces the value, unless `equals` finds it the same. Outside a batch, notifies the listeners of every node whose
   * value changed before returning; inside one, at its end.
   * @mutates this
   * @sharing none
   * @complexity O(w) (w = watched nodes the write reaches), plus their computes and listeners
   * @throws what `equals` throws, the value unchanged
   * @throws what a listener throws, once every listener has run: the error itself, or an `AggregateError` of all
   */
  set(value: T): void;
}

/**
 * Options of a source or a derived node.
 * @since 0.3
 * @experimental
 */
export interface NodeOptions<T> {
  /**
   * Called with the current value and a new one, when a source is set or a derived node has computed a value after
   * another; true keeps the current value and notifies nobody. `Object.is` by default; must be pure. On a derived
   * node, what it throws is held as the node's error.
   * @supplied
   */
  readonly equals?: (current: T, next: T) => boolean;
}

/**
 * The values of a list of nodes, in its order: what the compute of a derived node receives.
 * @since 0.3
 * @experimental
 */
export type NodeValues<D extends readonly ReadableNode<unknown>[]> = {
  -readonly [K in keyof D]: D[K] extends ReadableNode<infer V> ? V : never;
};

/**
 * Builds and batches the nodes of one graph. Nodes of different graphs never depend on each other.
 * @since 0.3
 * @experimental
 */
export interface Graph {
  /**
   * A node holding `initial` until it is set.
   * @pure
   * @sharing structural
   * @complexity O(1)
   * @throws never
   * @example createGraph().source(1).get() // 1
   */
  source<T>(initial: T, options?: NodeOptions<NoInfer<T>>): SourceNode<T>;
  /**
   * A node whose value is `compute` applied to the values of `deps`, in their order. Computes nothing until it is
   * read or subscribed to; `compute` must be pure, and read other nodes through its arguments only.
   * @pure
   * @sharing structural
   * @complexity O(d) (d = number of dependencies)
   * @throws TypeError when a dependency is not a node of this graph
   * @example
   * const graph = createGraph();
   * const price = graph.source(10);
   * graph.derived([price], (value) => value * 2).get() // 20
   */
  derived<const D extends readonly ReadableNode<unknown>[], T>(
    deps: D,
    compute: (...values: NodeValues<D>) => T,
    options?: NodeOptions<NoInfer<T>>,
  ): ReadableNode<T>;
  /**
   * Calls `run` and returns what it returns, holding the notifications of what it writes until it ends, nested
   * batches included: each listener then runs once, on the values `run` left, and again only for what a listener
   * writes. Reads inside see the writes already made.
   * @pure
   * @sharing none
   * @complexity O(1), plus `run`, plus one notification pass over the watched nodes its writes reached
   * @throws what `run` throws, once its writes are notified; with errors of listeners, all in an `AggregateError`
   * @throws what a listener throws, once every listener has run: the error itself, or an `AggregateError` of all
   */
  batch<R>(run: () => R): R;
}

type Listener = () => void;
type Compute = (...values: unknown[]) => unknown;

// One per call of `subscribe`, with the value and the failure its listener last saw: the same listener subscribed twice
// is two subscriptions, each removed by its own function, and one subscribed in the middle of a batch is told only of
// what changes after.
interface Subscription {
  readonly listener: Listener;
  value: unknown;
  failed: boolean | undefined;
}

// The epoch of a watched node that a write may have changed, and of a node never validated.
const STALE = -1;

// What a node without dependencies or observers walks, allocated once.
const NONE: readonly never[] = [];

class ReactiveGraph implements Graph {
  epoch = 0;
  depth = 0;
  ids = 0;
  queue = new Set<GraphNode<unknown>>();

  source<T>(initial: T, options?: NodeOptions<NoInfer<T>>): SourceNode<T> {
    return new Source(this, initial, false, options);
  }

  derived<const D extends readonly ReadableNode<unknown>[], T>(
    deps: D,
    compute: (...values: NodeValues<D>) => T,
    options?: NodeOptions<NoInfer<T>>,
  ): ReadableNode<T> {
    for (const dep of deps) {
      if (!(dep instanceof GraphNode) || dep.graph !== this) {
        throw new TypeError('a dependency is not a node of this graph');
      }
    }
    return new GraphNode<T>(this, undefined, undefined, options, [...deps] as GraphNode<unknown>[], compute as Compute);
  }

  batch<R>(run: () => R): R {
    let errors: unknown[] | undefined;
    let result: R | undefined;
    this.depth++;
    try {
      result = run();
    } catch (error) {
      errors = [error];
    }
    if (--this.depth > 0) {
      if (errors !== undefined) {
        throw errors[0];
      }
    } else {
      flush(this, errors);
    }
    return result as R;
  }
}

// Every field exists from the constructor on, in one order, so that every node has the same shape: the fields set by
// the constructor are only declared, the others defined as `undefined` by their declaration.
class GraphNode<T> implements ReadableNode<T> {
  declare readonly graph: ReactiveGraph;
  declare readonly id: number;
  declare readonly equals: (current: unknown, next: unknown) => boolean;
  declare readonly deps: readonly GraphNode<unknown>[] | undefined;
  declare readonly compute: Compute | undefined;
  /** The value, or the error held when `failed`. */
  declare value: unknown;
  /** `undefined` until a derived node has computed. */
  declare failed: boolean | undefined;
  /** The arguments of the last computation; `undefined` when there is none to compare with. */
  args: unknown[] | undefined;
  epoch = STALE;
  observers: Set<GraphNode<unknown>> | undefined;
  listeners: Set<Subscription> | undefined;

  constructor(
    graph: ReactiveGraph,
    value: unknown,
    failed: boolean | undefined,
    options: NodeOptions<T> | undefined,
    deps?: readonly GraphNode<unknown>[],
    compute?: Compute,
  ) {
    this.graph = graph;
    this.id = graph.ids++;
    this.equals = (options?.equals ?? Object.is) as (current: unknown, next: unknown) => boolean;
    this.deps = deps;
    this.compute = compute;
    this.value = value;
    this.failed = failed;
  }

  get(): T {
    refresh(this);
    if (this.failed) {
      throw this.value;
    }
    return this.value as T;
  }

  subscribe(listener: Listener): () => void {
    // Computed before anything holds the node: a chain too deep for the stack throws here, and nothing is subscribed.
    refresh(this);
    if (!watched(this)) {
      observe(this);
    }
    const subscription: Subscription = { listener, value: this.value, failed: this.failed };
    (this.listeners ??= new Set()).add(subscription);
    return () => {
      if (this.listeners!.delete(subscription) && !watched(this)) {
        unobserve(this);
      }
    };
  }
}

class Source<T> extends GraphNode<T> implements SourceNode<T> {
  set(value: T): void {
    const { graph, equals } = this;
    if (equals(this.value, value)) {
      return;
    }
    this.value = value;
    graph.epoch++;
    if (this.listeners?.size) {
      graph.queue.add(this);
    }
    mark(this);
    if (graph.depth === 0) {
      flush(graph, undefined);
    }
  }
}

function watched(node: GraphNode<unknown>): boolean {
  return !!(node.listeners?.size || node.observers?.size);
}

// Called once the node has been refreshed: it and every node it starts watching are current, so marking finds them
// unmarked at the next write.
function observe(node: GraphNode<unknown>): void {
  for (const dep of node.deps ?? NONE) {
    if (!watched(dep)) {
      observe(dep);
    }
    (dep.observers ??= new Set()).add(node);
  }
}

function unobserve(node: GraphNode<unknown>): void {
  for (const dep of node.deps ?? NONE) {
    // Only on the first delete: a dependency named twice would otherwise be left twice, and a chain of them in
    // exponential time.
    if (dep.observers!.delete(node) && !watched(dep)) {
      unobserve(dep);
    }
  }
}

function mark(node: GraphNode<unknown>): void {
  for (const observer of node.observers ?? NONE) {
    if (observer.epoch !== STALE) {
      observer.epoch = STALE;
      if (observer.listeners?.size) {
        observer.graph.queue.add(observer);
      }
      mark(observer);
    }
  }
}

function refresh(node: GraphNode<unknown>): void {
  const { graph, deps, compute } = node;
  if (compute === undefined || node.epoch === graph.epoch || (node.epoch !== STALE && watched(node))) {
    return;
  }
  const previous = node.args;
  let same = previous !== undefined;
  let failure: GraphNode<unknown> | undefined;
  for (let index = 0; index < deps!.length; index++) {
    const dep = deps![index]!;
    refresh(dep);
    if (dep.failed) {
      failure ??= dep;
    }
    same &&= !dep.failed && Object.is(dep.value, previous![index]);
  }
  node.epoch = graph.epoch;
  if (same) {
    return;
  }
  if (failure === undefined) {
    // Built only to compute: a validation that finds the same arguments allocates nothing.
    const args = deps!.map((dep) => dep.value);
    node.args = args;
    try {
      settle(node, compute(...args), false);
    } catch (error) {
      settle(node, error, true);
    }
  } else {
    node.args = undefined;
    settle(node, failure.value, true);
  }
}

function settle(node: GraphNode<unknown>, value: unknown, failed: boolean): void {
  const { equals } = node;
  if (failed || node.failed !== false || !equals(node.value, value)) {
    node.value = value;
    node.failed = failed;
  }
}

function flush(graph: ReactiveGraph, errors: unknown[] | undefined): void {
  graph.depth++;
  try {
    while (graph.queue.size > 0) {
      const nodes = [...graph.queue].sort((a, b) => a.id - b.id);
      graph.queue.clear();
      for (const node of nodes) {
        // Iterated live: a subscription removed during the pass is skipped, one added has seen the current value, and
        // the node is refreshed for each, as a listener before may have written.
        for (const subscription of node.listeners!) {
          refresh(node);
          if (!Object.is(node.value, subscription.value) || node.failed !== subscription.failed) {
            subscription.value = node.value;
            subscription.failed = node.failed;
            const { listener } = subscription;
            try {
              listener();
            } catch (error) {
              (errors ??= []).push(error);
            }
          }
        }
      }
    }
  } finally {
    graph.depth--;
  }
  if (errors !== undefined) {
    throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'listeners of the reactive graph threw');
  }
}

/**
 * A new graph, empty, holding its own batches: a write in one never waits for a batch of another.
 * @pure
 * @sharing none
 * @complexity O(1)
 * @throws never
 * @since 0.3
 * @experimental
 * @example
 * const graph = createGraph();
 * const first = graph.source('Ada');
 * const last = graph.source('Lovelace');
 * const full = graph.derived([first, last], (a, b) => `${a} ${b}`);
 * full.get() // 'Ada Lovelace'
 */
export function createGraph(): Graph {
  return new ReactiveGraph();
}
