// What a performance scenario of this folder exports, and the seeded inputs every scenario builds from. The instruction
// count (scripts/perf-count.sh) and the timed harness read the same scenarios, so that a figure of one is about the
// same calls as a figure of the other.

/** One way to do the work on one dataset: builds its input (never measured), then returns the call that is measured. */
export type PerfVariant = () => () => unknown;

/** The three sizes of input every scenario measures. */
export type PerfDataset = 'micro' | 'realistic' | 'pathological';

/**
 * A scenario, the default export of each file of `bench/perf/scenarios/`. Variants are named `<side>/<dataset>`: the
 * side is `native` (what an application writes with the platform alone), a reference library, or `yaltaan`; the
 * dataset is `micro`, `realistic` or `pathological`. Every side of one dataset returns the same value, which a test
 * checks, so that no side is faster by doing less.
 */
export interface PerfScenario {
  /**
   * Calls counted per variant of each dataset: enough for the work to dwarf the noise of a count (a few thousand
   * instructions per process), few enough to count in seconds under Callgrind.
   */
  readonly calls: Readonly<Record<PerfDataset, number>>;
  readonly variants: Readonly<Record<string, PerfVariant>>;
}

/**
 * A seeded generator of numbers in [0, 1) (mulberry32): the same seed yields the same dataset on every runtime and
 * every run, which a count that compares two commits requires.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A lower-case ASCII word of `length` letters. */
export function word(random: () => number, length: number): string {
  let text = '';
  for (let i = 0; i < length; i++) {
    text += String.fromCharCode(97 + Math.floor(random() * 26));
  }
  return text;
}

/** A user record as an application receives it from an API: flat fields, a nested address, a list of roles. */
export interface UserRecord {
  readonly id: number;
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly token: string;
  readonly age: number;
  readonly roles: readonly string[];
  readonly address: { readonly street: string; readonly city: string; readonly zip: string };
  readonly createdAt: string;
}

/** The `index`-th user of the dataset seeded by `random`. */
export function user(random: () => number, index: number): UserRecord {
  const first = word(random, 3 + Math.floor(random() * 6));
  return {
    id: index,
    email: `${first}.${word(random, 5)}@example.com`,
    name: `${first} ${word(random, 7)}`,
    password: word(random, 12),
    token: word(random, 32),
    age: 18 + Math.floor(random() * 70),
    roles: random() < 0.2 ? ['admin', 'user'] : ['user'],
    address: { street: `${Math.floor(random() * 200)} ${word(random, 8)} street`, city: word(random, 6), zip: '75001' },
    createdAt: new Date(Date.UTC(2020, 0, 1) + Math.floor(random() * 2e11)).toISOString(),
  };
}
