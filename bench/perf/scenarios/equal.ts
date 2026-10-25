// Comparing two values deeply: the platform's JSON round trip against es-toolkit's isEqual, the reference of the size
// harness for the same primitive, and Yaltaan's equal. The data is JSON with the same key order on both sides, the one
// case where the round trip gives the right answer.
import { equal } from '@yaltaan/core/equal';
import { isEqual } from 'es-toolkit';
import { seededRandom, user, type PerfScenario, type PerfVariant, type UserRecord } from '../scenario.ts';

function nativeEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `count` users and a copy of them, built apart from the same seed. */
function pair(seed: number, count: number): readonly [UserRecord[], UserRecord[]] {
  const build = (): UserRecord[] => {
    const random = seededRandom(seed);
    return Array.from({ length: count }, (_, i) => user(random, i));
  };
  return [build(), build()];
}

const sides = {
  native: nativeEqual,
  'es-toolkit': isEqual,
  yaltaan: (a: unknown, b: unknown): boolean => equal(a, b),
} as const;

const datasets = {
  // One record of a form, equal to its saved copy.
  micro: () => pair(1, 1).map((users) => users[0]),
  // A page of 100 records, equal.
  realistic: () => pair(2, 100),
  // A table of 1 000 records, equal: every side reaches every value before it answers, whatever order it walks in.
  pathological: () => pair(3, 1000),
} as const;

const variants: Record<string, PerfVariant> = {};
for (const [side, compare] of Object.entries(sides)) {
  for (const [dataset, build] of Object.entries(datasets)) {
    variants[`${side}/${dataset}`] = () => {
      const [left, right] = build();
      return () => compare(left, right);
    };
  }
}

const scenario: PerfScenario = {
  calls: { micro: 50_000, realistic: 500, pathological: 50 },
  variants,
};

export default scenario;
