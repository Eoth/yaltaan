// The differential judge: a function of ours and its equivalent in a reference library run on the same generated
// inputs, their outcomes (the value returned, or the name of the error thrown) compared by Node's
// `util.isDeepStrictEqual`, which is neither our `equal` nor the reference's own comparison. Where the two disagree on
// purpose, the module says so in its header comment, in a block that starts with the line `HEADING` followed by the
// reference's installed name and version, one line per difference:
//
//   //   - pick, mapValues: a dictionary without prototype stays one, where es-toolkit
//   //     returns an `Object` instance
//
// A line indented two more spaces continues the one above.
// The judge ties that text to the code both ways: a difference of a comparison must be a line of the block naming its
// function, and when the test file ends, every line of the block must have been claimed by a comparison of the file.
// An input a difference applies to is left out of the comparison, and each difference must apply to at least one
// generated input and change the outcome of at least one, so that no line of the block outlives its behaviour. At
// least a quarter of the inputs must be compared, so that differences drawn too often cannot leave nothing judged.
//
// Blind spots: only what the generators draw is compared; an input both libraries mishandle alike passes; and a
// difference without `expected` holds wherever its predicate says, so a predicate drawn too wide hides
// disagreements inside it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import fc from 'fast-check';

import { seedOf } from './declare.ts';

export const HEADING = 'Differences from';

/** A difference the module documents: `text` is its line of the block, verbatim after the function names. */
export interface Difference<I> {
  readonly text: string;
  /** Whether `input` reaches the difference: such an input is not compared as it is. */
  readonly applies: (input: I) => boolean;
  /**
   * What ours must return, built from what the reference returned for the same `input`: when given, the difference
   * is checked to be exactly that, on every input it applies to.
   */
  readonly expected?: (theirs: unknown, input: I) => unknown;
}

/** One function of ours against its equivalent. Each side gets the input as drawn; ours runs first. */
export interface Comparison<I> {
  readonly input: fc.Arbitrary<I>;
  readonly ours: (input: I) => unknown;
  readonly theirs: (input: I) => unknown;
  readonly differences?: readonly Difference<I>[];
  /** Inputs drawn; 1 000 by default. */
  readonly numRuns?: number;
}

export interface Judge {
  /** Registers a test that runs `comparison` for the function `name` of the module. */
  compare<I>(name: string, comparison: Comparison<I>): void;
}

const DEFAULT_RUNS = 1000;

type Outcome = { readonly returned: unknown } | { readonly threw: string };

function outcomeOf(run: () => unknown): Outcome {
  try {
    return { returned: run() };
  } catch (error) {
    return { threw: error instanceof Error ? error.name : typeof error };
  }
}

/** The lines of the block, as `function: text` pairs; throws when the module has no block for `reference`. */
export function documentedDifferences(source: string, reference: string): ReadonlySet<string> {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`// ${HEADING} ${reference}`));
  if (start === -1) {
    throw new Error(`no line "// ${HEADING} ${reference}" in the module`);
  }
  const items: [names: string, text: string][] = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\/\/ {3}- ([\w, ]+): (.+)$/.exec(line);
    const continued = /^\/\/ {5}(\S.*)$/.exec(line);
    if (item !== null) {
      items.push([item[1]!, item[2]!]);
    } else if (continued !== null && items.length > 0) {
      items[items.length - 1]![1] += ` ${continued[1]!}`;
    } else {
      break;
    }
  }
  const pairs = new Set<string>();
  for (const [names, text] of items) {
    for (const name of names.split(', ')) {
      pairs.add(`${name}: ${text}`);
    }
  }
  return pairs;
}

function installedVersion(reference: string, from: URL): string {
  const manifest = createRequire(from).resolve(`${reference}/package.json`);
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}

/**
 * Runs one comparison, `title` seeding its inputs; throws on the first input outside every difference where the two
 * outcomes differ, on a difference that no input reached or changed, and when less than a quarter of the inputs were
 * compared. Returns what was compared, for the test's diagnostics.
 */
export function runComparison<I>(title: string, comparison: Comparison<I>): string {
  const differences = comparison.differences ?? [];
  let compared = 0;
  const reached = differences.map(() => 0);
  const changed = differences.map(() => 0);
  const property = fc.property(comparison.input, (input) => {
    const ours = outcomeOf(() => comparison.ours(input));
    const theirs = outcomeOf(() => comparison.theirs(input));
    const index = differences.findIndex((difference) => difference.applies(input));
    if (index === -1) {
      assert.deepStrictEqual(ours, theirs);
      compared += 1;
      return;
    }
    reached[index]! += 1;
    changed[index]! += isDeepStrictEqual(ours, theirs) ? 0 : 1;
    const { expected } = differences[index]!;
    if (expected !== undefined && 'returned' in theirs) {
      assert.deepStrictEqual(ours, { returned: expected(theirs.returned, input) });
    }
  });
  const numRuns = comparison.numRuns ?? DEFAULT_RUNS;
  fc.assert(property, { seed: seedOf(title), numRuns });
  if (compared * 4 < numRuns) {
    throw new Error(`${title}: only ${compared} of ${numRuns} inputs compared`);
  }
  differences.forEach(({ text }, index) => {
    if (reached[index] === 0 || changed[index] === 0) {
      throw new Error(`${title}: "${text}" reached by ${reached[index]} inputs, changed ${changed[index]}`);
    }
  });
  return `${compared} of ${numRuns} inputs compared, ${reached.join(' + ')} left to a difference`;
}

/** Throws unless every documented `function: text` pair was claimed by a comparison. */
export function checkClaimed(documented: ReadonlySet<string>, claimed: ReadonlySet<string>): void {
  const unclaimed = [...documented].filter((pair) => !claimed.has(pair));
  if (unclaimed.length > 0) {
    throw new Error(`documented, but checked by no comparison: ${unclaimed.join(' | ')}`);
  }
}

/**
 * A judge of the module at `module` against `reference`, a package installed at the root of the workspace. Its block
 * must name the installed version: an update of the reference shows up in the module before it is believed.
 */
export function createJudge(module: URL, reference: string): Judge {
  const documented = documentedDifferences(
    readFileSync(fileURLToPath(module), 'utf8'),
    `${reference} ${installedVersion(reference, module)}`,
  );
  const claimed = new Set<string>();
  after(() => checkClaimed(documented, claimed));
  return {
    compare<I>(name: string, comparison: Comparison<I>): void {
      for (const { text } of comparison.differences ?? []) {
        const pair = `${name}: ${text}`;
        if (!documented.has(pair)) {
          throw new Error(`not documented in the module: ${pair}`);
        }
        claimed.add(pair);
      }
      const title = `${name} agrees with ${reference}`;
      test(title, (context) => {
        context.diagnostic(runComparison(title, comparison));
      });
    },
  };
}
