// The record of one adversarial category test, as the reporter writes it for the verification gate and the gate
// reads it back. The test name carries the identity of the declaration, so that a record needs nothing but the
// event of the test that ran. It names no file: the runner reports where `test()` was called, which is the
// declaration helper for every record.
import { CATEGORY_NAMES, type CategoryName } from './category.ts';

/** Each record is one line of the test output that starts with this prefix, followed by the record in JSON. */
export const RECORD_PREFIX = 'adversarial-record ';

/** The reporter writes records only when this variable is `1`, as the verification gate sets it. */
export const RECORDS_VARIABLE = 'YALTAAN_ADVERSARIAL_RECORDS';

/** The skip and todo messages that mark a category "N/A" or deferred. */
export const NOT_APPLICABLE_PREFIX = 'n/a: ';
export const DEFERRED_PREFIX = 'deferred: ';

/**
 * `tested`: every named case and the random runs passed; `failed`: one did not; `n/a`: the category does not concern
 * the export; `deferred`: it does, and its tests wait for the promotion to stable; `skipped`: the runner skipped the
 * test for another reason (`only`), so nothing was tested. A test that a name filter leaves out leaves no record.
 */
export type Outcome = 'tested' | 'failed' | 'n/a' | 'deferred' | 'skipped';

export interface AdversarialRecord {
  /** The package subpath that exports it: `@yaltaan/core/object`. */
  readonly specifier: string;
  readonly exportName: string;
  readonly category: CategoryName;
  readonly outcome: Outcome;
}

const SPECIFIER = /^@yaltaan\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;
const EXPORT_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const TEST_NAME = /^adversarial (\S+) (\S+): ([a-z]+)$/;
const OUTCOMES: ReadonlySet<string> = new Set<Outcome>(['tested', 'failed', 'n/a', 'deferred', 'skipped']);

export function isSpecifier(value: string): boolean {
  return SPECIFIER.test(value);
}

export function isExportName(value: string): boolean {
  return EXPORT_NAME.test(value);
}

function isCategoryName(value: string): value is CategoryName {
  return (CATEGORY_NAMES as readonly string[]).includes(value);
}

/** The name of the test that covers `category` of an export. */
export function testName(specifier: string, exportName: string, category: CategoryName): string {
  return `adversarial ${specifier} ${exportName}: ${category}`;
}

/** The identity a test name carries, or `undefined` for any other test. */
export function parseTestName(
  name: string,
): Pick<AdversarialRecord, 'specifier' | 'exportName' | 'category'> | undefined {
  const match = TEST_NAME.exec(name);
  if (match === null) {
    return undefined;
  }
  const [, specifier = '', exportName = '', category = ''] = match;
  if (!isSpecifier(specifier) || !isExportName(exportName) || !isCategoryName(category)) {
    return undefined;
  }
  return { specifier, exportName, category };
}

/** Reads one line of records; `undefined` if the line is not a well-formed record. */
export function parseRecord(line: string): AdversarialRecord | undefined {
  if (!line.startsWith(RECORD_PREFIX)) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(line.slice(RECORD_PREFIX.length));
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const fields = value as Record<string, unknown>;
  const { specifier, exportName, category, outcome } = fields;
  if (
    typeof specifier !== 'string' ||
    typeof exportName !== 'string' ||
    typeof category !== 'string' ||
    typeof outcome !== 'string' ||
    !isSpecifier(specifier) ||
    !isExportName(exportName) ||
    !isCategoryName(category) ||
    !OUTCOMES.has(outcome)
  ) {
    return undefined;
  }
  return { specifier, exportName, category, outcome: outcome as Outcome };
}
