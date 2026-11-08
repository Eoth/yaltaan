// Random programs over a reactive graph, shared by the laws (properties.test.ts) and the judge (judge.test.ts); this
// file holds no test. A program builds a few sources, then derived nodes over nodes built before them, so that its
// graph is acyclic in creation order as every graph is, and runs steps that write, read, subscribe, unsubscribe and
// batch, nested batches included; for the laws only, its listeners may also write, throw or unsubscribe. Values are
// small integers, so that sums meet, come back and divide by three; the judge adds `NaN` and `-0`.
import { fc } from '@yaltaan/testing';

/** What a derived node computes from the values of its dependencies. */
export type Kind = 'sum' | 'first' | 'parity' | 'constant' | 'throws';

export const KINDS: readonly Kind[] = ['sum', 'first', 'parity', 'constant', 'throws'];

export interface DerivedSpec {
  /** Ids of earlier nodes, duplicates allowed: sources are `0` to `sources.length - 1`, then derived nodes in order. */
  readonly deps: readonly number[];
  readonly kind: Kind;
}

/** What a listener does once it has read its node. */
export type Reaction =
  /** Sets source `node` to `value`. */
  | { readonly kind: 'write'; readonly node: number; readonly value: number }
  /** Sets source `node` to the value read plus `offset`, unless the read threw: chains, some of which never end. */
  | { readonly kind: 'follow'; readonly node: number; readonly offset: number }
  | { readonly kind: 'throw' }
  /** Calls the unsubscribe function of subscription `pick` modulo their number, perhaps its own. */
  | { readonly kind: 'unsubscribe'; readonly pick: number };

export type Step =
  | { readonly op: 'set'; readonly node: number; readonly value: number }
  | { readonly op: 'get'; readonly node: number }
  /** A listener that reads its node, then does `reaction`, if any. */
  | { readonly op: 'subscribe'; readonly node: number; readonly reaction?: Reaction | undefined }
  /** Calls the unsubscribe function of subscription `pick` modulo their number, perhaps a second time. */
  | { readonly op: 'unsubscribe'; readonly pick: number }
  | { readonly op: 'batch'; readonly steps: readonly Step[] };

export interface Program {
  readonly sources: readonly number[];
  readonly derived: readonly DerivedSpec[];
  readonly steps: readonly Step[];
}

/** What a `throws` node throws: one object per node, so that an error thrown again is the same value. */
export class ComputeError extends Error {
  override readonly name = 'ComputeError';
}

/** The value a node of `kind` computes from `values`, or `error` thrown. */
export function apply(kind: Kind, values: readonly number[], error: ComputeError): number {
  const sum = values.reduce((total, value) => total + value, 0);
  switch (kind) {
    case 'sum':
      return sum;
    case 'first':
      return values[0]!;
    case 'parity':
      return ((sum % 2) + 2) % 2;
    case 'constant':
      return 0;
    case 'throws':
      if (sum % 3 === 0) {
        throw error;
      }
      return sum;
    default: {
      const never: never = kind;
      throw new Error(`unknown kind ${String(never)}`);
    }
  }
}

/** Programs whose sources take `values`; with `reactions`, a listener may write, throw or unsubscribe. */
export function programs(values: fc.Arbitrary<number>, reactions = false): fc.Arbitrary<Program> {
  return fc.integer({ min: 1, max: 4 }).chain((sourceCount) =>
    fc.integer({ min: 1, max: 10 }).chain((derivedCount) => {
      const total = sourceCount + derivedCount;
      const derived = fc.tuple(
        ...Array.from({ length: derivedCount }, (_, index) =>
          fc.record({
            deps: fc.array(fc.nat({ max: sourceCount + index - 1 }), { minLength: 1, maxLength: 3 }),
            kind: fc.constantFrom(...KINDS),
          }),
        ),
      );
      const set = fc.record({ op: fc.constant('set' as const), node: fc.nat({ max: sourceCount - 1 }), value: values });
      const get = fc.record({ op: fc.constant('get' as const), node: fc.nat({ max: total - 1 }) });
      const source = fc.nat({ max: sourceCount - 1 });
      const reaction: fc.Arbitrary<Reaction> = fc.oneof(
        { arbitrary: fc.record({ kind: fc.constant('write' as const), node: source, value: values }), weight: 3 },
        {
          arbitrary: fc.record({
            kind: fc.constant('follow' as const),
            node: source,
            offset: fc.integer({ min: 0, max: 1 }),
          }),
          weight: 1,
        },
        { arbitrary: fc.record({ kind: fc.constant('throw' as const) }), weight: 1 },
        { arbitrary: fc.record({ kind: fc.constant('unsubscribe' as const), pick: fc.nat() }), weight: 1 },
      );
      const subscribe = reactions
        ? fc.record({
            op: fc.constant('subscribe' as const),
            node: fc.nat({ max: total - 1 }),
            reaction: fc.option(reaction, { nil: undefined, freq: 3 }),
          })
        : fc.record({ op: fc.constant('subscribe' as const), node: fc.nat({ max: total - 1 }) });
      const unsubscribe = fc.record({ op: fc.constant('unsubscribe' as const), pick: fc.nat() });
      const nested = fc.record({
        op: fc.constant('batch' as const),
        steps: fc.array(fc.oneof({ arbitrary: set, weight: 3 }, { arbitrary: get, weight: 1 }), { maxLength: 4 }),
      });
      const batch = fc.record({
        op: fc.constant('batch' as const),
        steps: fc.array(
          fc.oneof({ arbitrary: set, weight: 4 }, { arbitrary: get, weight: 2 }, { arbitrary: nested, weight: 1 }),
          { maxLength: 6 },
        ),
      });
      const step: fc.Arbitrary<Step> = fc.oneof(
        { arbitrary: set, weight: 4 },
        { arbitrary: get, weight: 3 },
        { arbitrary: subscribe, weight: 3 },
        { arbitrary: unsubscribe, weight: 1 },
        { arbitrary: batch, weight: 2 },
      );
      return fc.record({
        sources: fc.array(values, { minLength: sourceCount, maxLength: sourceCount }),
        derived,
        steps: fc.array(step, { minLength: 4, maxLength: 40, size: 'medium' }),
      });
    }),
  );
}
