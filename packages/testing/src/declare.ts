// The adversarial declaration of one public export: one test per category, named after the export, which either runs
// a check against every named case and against random values, or records why the category does not apply, or that
// its tests are deferred. The verification gate reads these tests back from the run (see reporter.ts).
import { test } from 'node:test';

import fc from 'fast-check';

import { adversarial, type CategoryValues } from './catalogue.ts';
import { CATEGORY_NAMES, type Category, type CategoryName } from './category.ts';
import { DEFERRED_PREFIX, isExportName, isSpecifier, NOT_APPLICABLE_PREFIX, testName } from './record.ts';

/** A check of one value of a category: it throws, or rejects, when the export mishandles the value. */
export type Check<T> = (value: T) => void | Promise<void>;

/**
 * What a declaration says of one category: a check, `{ na: reason }` when the category does not concern the export,
 * or `{ deferred: reason }` when it does and its tests wait for the export's promotion to stable.
 */
export type Coverage<T> = Check<T> | { readonly na: string } | { readonly deferred: string };

export type Declaration = { readonly [Name in CategoryName]: Coverage<CategoryValues[Name]> };

export interface DeclareOptions {
  /** Random values tried per category after the named cases; 100 by default. */
  readonly numRuns?: number;
}

const DEFAULT_RUNS = 100;

// FNV-1a over the test name: each declaration draws its own random values, the same on every run and machine, so a
// failure replays from the seed fast-check prints.
export function seedOf(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash = Math.imul(hash ^ name.charCodeAt(index), 0x01000193);
  }
  return hash | 0;
}

/** One category of a declaration, checked before any test is registered. */
type Plan<T> =
  | { readonly kind: 'check'; readonly category: Category<T>; readonly check: Check<T> }
  | { readonly kind: 'skip'; readonly message: string }
  | { readonly kind: 'todo'; readonly message: string };

function planOf<T>(name: string, category: Category<T>, coverage: Coverage<T>): Plan<T> {
  if (typeof coverage === 'function') {
    return { kind: 'check', category, check: coverage };
  }
  const isNotApplicable = 'na' in coverage;
  const reason: unknown = isNotApplicable ? coverage.na : (coverage as { readonly deferred?: unknown }).deferred;
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error(`${name}: { ${isNotApplicable ? 'na' : 'deferred'} } needs a reason`);
  }
  return isNotApplicable
    ? { kind: 'skip', message: `${NOT_APPLICABLE_PREFIX}${reason}` }
    : { kind: 'todo', message: `${DEFERRED_PREFIX}${reason}` };
}

function register<T>(name: string, plan: Plan<T>, numRuns: number): void {
  if (plan.kind === 'skip') {
    test(name, { skip: plan.message });
    return;
  }
  if (plan.kind === 'todo') {
    test(name, { todo: plan.message });
    return;
  }
  const { category, check } = plan;
  test(name, async (context) => {
    for (const { label, make } of category.cases) {
      await context.test(label, async () => {
        await check(make());
      });
    }
    await context.test('random', async () => {
      const property = fc.asyncProperty(category.random, async (value) => {
        await check(value);
      });
      await fc.assert(property, { seed: seedOf(name), numRuns });
    });
  });
}

/**
 * Declares how the export `exportName` of the package subpath `specifier` meets each adversarial category, from its
 * test file. Every category is listed: a check, "N/A" with its reason, or "deferred" while the export is
 * `@experimental`.
 */
export function declareAdversarial(
  specifier: string,
  exportName: string,
  declaration: Declaration,
  options: DeclareOptions = {},
): void {
  if (!isSpecifier(specifier)) {
    throw new Error(`"${specifier}" is not a package subpath of the workspace (@yaltaan/<package>[/<subpath>])`);
  }
  if (!isExportName(exportName)) {
    throw new Error(`"${exportName}" is not the name of an export`);
  }
  const numRuns = options.numRuns ?? DEFAULT_RUNS;
  if (!Number.isInteger(numRuns) || numRuns < 1) {
    throw new Error(`numRuns must be a positive integer, not ${numRuns}`);
  }
  // Every category is checked before the first test is registered: a declaration refused halfway would leave tests
  // of an export that the rest of the run never sees declared. Each pairs its catalogue entry with its own coverage;
  // the mapped types keep the two in step.
  const plans: (() => void)[] = [];
  const plan = <Name extends CategoryName>(category: Name): void => {
    const name = testName(specifier, exportName, category);
    const entry: Category<CategoryValues[Name]> = adversarial[category];
    const checked = planOf(name, entry, declaration[category]);
    plans.push(() => register(name, checked, numRuns));
  };
  for (const category of CATEGORY_NAMES) {
    plan(category);
  }
  for (const registerCategory of plans) {
    registerCategory();
  }
}
