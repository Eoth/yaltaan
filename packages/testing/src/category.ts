import fc from 'fast-check';

/** The six categories of ARCHITECTURE.md §10.1, in the order the catalogue and its declarations list them. */
export const CATEGORY_NAMES = ['boundary', 'structures', 'hostile', 'unicode', 'callbacks', 'async'] as const;

export type CategoryName = (typeof CATEGORY_NAMES)[number];

/**
 * One adversarial case. `make` builds a fresh value on each call: a frozen object, a cycle, a Proxy or an aborted
 * signal handed to one test must never be the one another test receives, since the code under test may have changed
 * it.
 */
export interface NamedCase<T> {
  readonly label: string;
  readonly make: () => T;
}

/**
 * A value drawn by `Category.arbitrary`, in a box. fast-check asks every generated value whether it holds its clone
 * symbol, which a revoked or throwing Proxy answers by throwing: boxed, such a value travels through fast-check, and
 * a counterexample prints as its label.
 */
export interface Drawn<T> {
  /** The label of the named case, or `random`. */
  readonly label: string;
  readonly value: T;
}

/** A category of the catalogue: its named cases, and random values of the same kind beyond them. */
export interface Category<T> {
  readonly name: CategoryName;
  readonly cases: readonly NamedCase<T>[];
  /** Random values only, none of which throws when fast-check inspects it; a declaration runs them after the cases. */
  readonly random: fc.Arbitrary<T>;
  /** A named case, built fresh, or a random value, boxed: for the property tests of a domain. */
  readonly arbitrary: fc.Arbitrary<Drawn<T>>;
}

function box<T>(category: CategoryName, label: string, value: T, show: () => string): Drawn<T> {
  const drawn = { label, value, [fc.toStringMethod]: () => `${category}: ${show()}` };
  return drawn;
}

/** Builds a category; `cases` holds at least one case and no label twice. */
export function defineCategory<T>(
  name: CategoryName,
  cases: readonly NamedCase<T>[],
  random: fc.Arbitrary<T>,
): Category<T> {
  const [first, ...rest] = cases;
  if (first === undefined) {
    throw new Error(`adversarial.${name} has no named case`);
  }
  const labels = new Set<string>();
  for (const { label } of cases) {
    if (labels.has(label)) {
      throw new Error(`adversarial.${name} names "${label}" twice`);
    }
    labels.add(label);
  }
  // `map` runs on every generated value, so each named case drawn by fast-check is built anew.
  const drawn = fc
    .constantFrom(first, ...rest)
    .map((namedCase) => box(name, namedCase.label, namedCase.make(), () => namedCase.label));
  const drawnRandom = random.map((value) => box(name, 'random', value, () => `random ${fc.stringify(value)}`));
  return { name, cases, random, arbitrary: fc.oneof(drawn, drawnRandom) };
}

/** A named case: `make` returns a primitive, or builds a new object on each call. */
export function named<T>(label: string, make: () => T): NamedCase<T> {
  return { label, make };
}
