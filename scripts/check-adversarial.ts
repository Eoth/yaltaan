// Checks the adversarial declarations (ARCHITECTURE.md §10.1): every public export that runs declares each category
// of the catalogue in its test file, and the tests of that declaration ran. The declarations are read from the test
// run itself, as records that the reporter of the internal testing package writes (packages/testing/src/reporter.ts);
// the exports and their stability come from the contract tag reading, never from a second list.
//
// Refused: an export that runs without a declaration; a declaration that names no export, or an export that never
// runs; a category without its record (a test the runner left out) or with two (one export declared twice); a check
// that failed, or that the runner skipped; a `@stable` export that defers a category.
//
// Runs after the build and the tests: the verification gate keeps the records of its test run and passes them here.
//
// Usage: node scripts/check-adversarial.ts <records file>
import { readFileSync } from 'node:fs';

import { CATEGORY_NAMES } from '../packages/testing/src/category.ts';
import { parseRecord, RECORD_PREFIX, type AdversarialRecord } from '../packages/testing/src/record.ts';
import { checkContractTags, type SubpathSurface } from './check-contract-tags.ts';
import type { PublicExport } from './lib/contract-tags.ts';
import { describeError, repositoryRoot, report } from './lib/workspace.ts';

export interface AdversarialVerdict {
  readonly problems: readonly string[];
  /** Exports that run, each of which must declare. */
  readonly exports: number;
  readonly tested: number;
  readonly notApplicable: number;
  readonly deferred: number;
}

/** Whether an export runs, and can therefore be attacked: the exports that carry the whole contract tag set. */
export function runs(exported: PublicExport): boolean {
  return exported.kind === 'callable' || exported.kind === 'class';
}

/** Reads the records of a test run; every line that starts with the record prefix must be a well-formed record. */
export function parseRecords(text: string): { readonly records: AdversarialRecord[]; readonly problems: string[] } {
  const records: AdversarialRecord[] = [];
  const problems: string[] = [];
  text.split('\n').forEach((line, index) => {
    if (!line.startsWith(RECORD_PREFIX)) {
      return;
    }
    const record = parseRecord(line);
    if (record === undefined) {
      problems.push(`records line ${index + 1}: not a well-formed record: ${line.slice(0, 120)}`);
    } else {
      records.push(record);
    }
  });
  return { records, problems };
}

/** Judges the records of a test run against the public surface. */
export function judgeAdversarial(
  surface: readonly SubpathSurface[],
  records: readonly AdversarialRecord[],
): AdversarialVerdict {
  const problems: string[] = [];
  const byExport = new Map<string, AdversarialRecord[]>();
  for (const record of records) {
    const key = `${record.specifier} ${record.exportName}`;
    byExport.set(key, [...(byExport.get(key) ?? []), record]);
  }
  const published = new Map<string, PublicExport>();
  for (const subpath of surface) {
    for (const exported of subpath.exports) {
      published.set(`${subpath.specifier} ${exported.name}`, exported);
    }
  }
  let exports = 0;
  let tested = 0;
  let notApplicable = 0;
  let deferred = 0;
  for (const [key, exported] of published) {
    if (!runs(exported)) {
      continue;
    }
    exports += 1;
    const declared = byExport.get(key) ?? [];
    if (declared.length === 0) {
      problems.push(`${key}: no adversarial declaration: declare it in its test file with declareAdversarial()`);
      continue;
    }
    const stable = exported.tags.some((tag) => tag.name === 'stable');
    for (const category of CATEGORY_NAMES) {
      const found = declared.filter((record) => record.category === category);
      const [record] = found;
      if (record === undefined) {
        problems.push(`${key}: the ${category} test of its declaration did not run (left out by a filter?)`);
        continue;
      }
      if (found.length > 1) {
        problems.push(`${key}: ${category} is declared ${found.length} times: one declaration per export`);
        continue;
      }
      switch (record.outcome) {
        case 'tested':
          tested += 1;
          break;
        case 'n/a':
          notApplicable += 1;
          break;
        case 'deferred':
          deferred += 1;
          if (stable) {
            problems.push(`${key}: is @stable but defers ${category}: a stable export tests every category it meets`);
          }
          break;
        case 'failed':
          problems.push(`${key}: the ${category} check failed: see the test output`);
          break;
        case 'skipped':
          problems.push(`${key}: the ${category} check was skipped by the runner, so nothing was tested`);
          break;
        default: {
          const unknown: never = record.outcome;
          problems.push(`${key}: unknown outcome ${String(unknown)}`);
        }
      }
    }
  }
  for (const key of byExport.keys()) {
    const exported = published.get(key);
    if (exported === undefined) {
      problems.push(`${key}: declared, but no subpath publishes this export`);
    } else if (!runs(exported)) {
      problems.push(`${key}: declared, but the export never runs (${exported.kind}) and declares nothing`);
    }
  }
  return { problems, exports, tested, notApplicable, deferred };
}

/** Checks the repository at `root` against the records text of its test run. */
export async function checkAdversarial(root: string, recordsText: string): Promise<AdversarialVerdict> {
  const empty = { exports: 0, tested: 0, notApplicable: 0, deferred: 0 };
  const parsed = parseRecords(recordsText);
  const contract = await checkContractTags(root);
  // A surface read with problems may miss exports: judging it would pass on less than the packages publish.
  if (contract.problems.length > 0) {
    return {
      problems: [...parsed.problems, 'the public exports could not be read without problems: see the contract tags'],
      ...empty,
    };
  }
  const verdict = judgeAdversarial(contract.surface, parsed.records);
  return { ...verdict, problems: [...parsed.problems, ...verdict.problems] };
}

if (import.meta.main) {
  const file = process.argv[2];
  let text: string | undefined;
  try {
    text = file === undefined ? undefined : readFileSync(file, 'utf8');
  } catch (error) {
    report([`${file}: cannot be read (${describeError(error)})`], '');
  }
  if (file === undefined) {
    report(['usage: node scripts/check-adversarial.ts <records file>'], '');
  } else if (text !== undefined) {
    const verdict = await checkAdversarial(repositoryRoot, text);
    report(
      verdict.problems,
      `${verdict.exports} export(s) that run declare the adversarial catalogue: ${verdict.tested} category check(s) ` +
        `passed, ${verdict.notApplicable} N/A, ${verdict.deferred} deferred.`,
    );
  }
}
