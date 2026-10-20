// The pure part of the instruction count: turning a TypeScript module into the JavaScript the counted process loads,
// reading Callgrind's total, turning two process counts into the work of one
// call, judging A against B, and printing the table a commit message carries. The process side lives in
// scripts/perf-count.ts.
import { stripTypeScriptTypes } from 'node:module';

/** The datasets a scenario measures, in the order the table prints them. */
export const perfDatasets: readonly string[] = ['micro', 'realistic', 'pathological'];

/**
 * A TypeScript module as the JavaScript the counted process loads: types erased by Node's own stripping, relative
 * imports of `.ts` files pointed at their `.js` twins. Node strips types with a WebAssembly build of a compiler whose
 * optimizing tier-up is a delayed task: in a process that strips types itself, it lands or not depending on the clock,
 * and moves the count by some 28 million instructions; a process that loads JavaScript only never compiles it.
 */
export function toJavaScript(source: string): string {
  return stripTypeScriptTypes(source, { mode: 'strip' }).replace(
    /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]*)\.ts\2/g,
    '$1$2$3.js$2',
  );
}

/** A variant name, `<side>/<dataset>`, split; `undefined` for a name that does not follow the rule. */
export function parseVariant(name: string): { readonly side: string; readonly dataset: string } | undefined {
  const match = /^([a-z][a-z0-9-]*)\/([a-z]+)$/.exec(name);
  if (match === null || !perfDatasets.includes(match[2] ?? '')) {
    return undefined;
  }
  return { side: match[1] ?? '', dataset: match[2] ?? '' };
}

/** The instructions a Callgrind profile counted for the whole process: its `summary:` line, else its `totals:`. */
export function callgrindTotal(profile: string): number {
  const match = /^summary:\s+(\d+)/m.exec(profile) ?? /^totals:\s+(\d+)/m.exec(profile);
  if (match === null) {
    throw new Error('the Callgrind profile has neither a summary nor a totals line');
  }
  return Number(match[1]);
}

/**
 * The instructions of one call, from a process that made `calls` calls (the base) and one that made twice as many
 * (the measured one): what both share, Node's start, the loading of the scenario and the building of its input, and
 * the first `calls` calls, which warm the code up, cancels out.
 */
export function workPerCall(base: number, measured: number, calls: number): number {
  if (!Number.isInteger(calls) || calls <= 0) {
    throw new Error(`calls must be a positive integer, got ${calls}`);
  }
  return (measured - base) / calls;
}

/** The change from `a` to `b`, in percent of `a`. */
export function changePercent(a: number, b: number): number {
  return ((b - a) / a) * 100;
}

/** The spread of repeated counts of the same work: (max − min) / min, in percent; 0 for fewer than two counts. */
export function spreadPercent(counts: readonly number[]): number {
  if (counts.length < 2) {
    return 0;
  }
  const min = Math.min(...counts);
  return ((Math.max(...counts) - min) / min) * 100;
}

export type Verdict = 'same work' | 'MORE work' | 'less work' | 'only in A' | 'only in B';

export interface CountRow {
  /** `<scenario> <side>/<dataset>`. */
  readonly name: string;
  readonly a: number | undefined;
  readonly b: number | undefined;
  readonly change: number | undefined;
  readonly verdict: Verdict;
}

/**
 * Judges each variant counted at A and at B: more or less work when the instructions per call move by more than
 * `threshold` percent. A variant counted on one side only is reported, never judged.
 */
export function judge(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
  threshold: number,
): readonly CountRow[] {
  const names = [...new Set([...a.keys(), ...b.keys()])].sort(compareNames);
  return names.map((name): CountRow => {
    const countA = a.get(name);
    const countB = b.get(name);
    if (countA === undefined || countB === undefined) {
      return {
        name,
        a: countA,
        b: countB,
        change: undefined,
        verdict: countA === undefined ? 'only in B' : 'only in A',
      };
    }
    const change = changePercent(countA, countB);
    const verdict: Verdict = change > threshold ? 'MORE work' : change < -threshold ? 'less work' : 'same work';
    return { name, a: countA, b: countB, change, verdict };
  });
}

/** Scenario, then dataset in the order of `perfDatasets`, then side. */
function compareNames(left: string, right: string): number {
  const [scenarioLeft = '', variantLeft = ''] = left.split(' ');
  const [scenarioRight = '', variantRight = ''] = right.split(' ');
  const parsedLeft = parseVariant(variantLeft);
  const parsedRight = parseVariant(variantRight);
  return (
    scenarioLeft.localeCompare(scenarioRight, 'en') ||
    perfDatasets.indexOf(parsedLeft?.dataset ?? '') - perfDatasets.indexOf(parsedRight?.dataset ?? '') ||
    (parsedLeft?.side ?? variantLeft).localeCompare(parsedRight?.side ?? variantRight, 'en')
  );
}

function formatCount(count: number | undefined): string {
  return count === undefined
    ? '-'
    : count.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatChange(change: number | undefined): string {
  if (change === undefined) {
    return '-';
  }
  const text = change.toFixed(3);
  return change > 0 ? `+${text} %` : `${text === '-0.000' ? '0.000' : text} %`;
}

/** The rows as a Markdown table, instructions per call of A and B, ready for a commit message. */
export function formatTable(rows: readonly CountRow[]): string {
  const lines = [
    '| Scenario | Variant | A, instructions per call | B, instructions per call | Change | Verdict |',
    '|---|---|---:|---:|---:|---|',
  ];
  for (const row of rows) {
    const [scenario = '', variant = ''] = row.name.split(' ');
    const cells = [scenario, variant, formatCount(row.a), formatCount(row.b), formatChange(row.change), row.verdict];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

/** The same rows as tab-separated values, raw numbers, for a script to read. */
export function formatTsv(rows: readonly CountRow[]): string {
  const lines = ['scenario\tvariant\ta\tb\tchange_percent\tverdict'];
  for (const row of rows) {
    const [scenario = '', variant = ''] = row.name.split(' ');
    lines.push(
      [
        scenario,
        variant,
        row.a ?? '',
        row.b ?? '',
        row.change === undefined ? '' : row.change.toFixed(6),
        row.verdict,
      ].join('\t'),
    );
  }
  return `${lines.join('\n')}\n`;
}
