// The pure part of the timed harness's command: the publication, a header that says where and how the figures were
// taken, and one row per variant. The process side lives in scripts/perf-time.ts, the measured processes in
// bench/perf/time.ts and bench/perf/alloc.ts.
import type { AllocResult } from '../../bench/perf/alloc.ts';
import { quantile } from '../../bench/perf/statistics.ts';
import type { TimeResult } from '../../bench/perf/time.ts';

/** Where and how a run timed its variants: every field the publication of a figure needs beside it. */
export interface TimeEnvironment {
  readonly date: string;
  readonly cpu: string;
  readonly processors: number;
  /** The logical processor every measured process was pinned to, or `null`. */
  readonly pinned: number | null;
  readonly os: string;
  readonly power: string;
  readonly runtime: string;
  readonly command: string;
  readonly warmupMs: number;
  readonly budgetMs: number;
  readonly passes: number;
  readonly loadBefore: readonly number[];
  readonly loadAfter: readonly number[];
}

/**
 * One variant's figures in one pass: its time, and in the first pass only the bytes one call allocates (`heap`) and
 * their check through the collector's accounting (`check`).
 */
export interface TimeRow {
  readonly scenario: string;
  readonly variant: string;
  readonly pass: number;
  readonly time: TimeResult;
  readonly alloc: { readonly heap: AllocResult; readonly check: AllocResult } | null;
}

/** Nanoseconds as the table prints them: two decimals below 10, one below 1 000, none above. */
export function formatNs(ns: number): string {
  const size = Math.abs(ns);
  return size < 10 ? ns.toFixed(2) : size < 1000 ? ns.toFixed(1) : Math.round(ns).toString();
}

/** Bytes per call as the table prints them: the median, then, with `range`, the smallest and largest window. */
function formatBytes(alloc: AllocResult | undefined, range: boolean): string {
  if (alloc === undefined) {
    return '';
  }
  if (alloc.bytes === null || alloc.min === null || alloc.max === null) {
    return 'n/a (collected)';
  }
  return range
    ? `${alloc.bytes.toFixed(1)} [${alloc.min.toFixed(0)}, ${alloc.max.toFixed(0)}]`
    : alloc.bytes.toFixed(1);
}

/** The header lines of a publication. */
export function formatHeader(environment: TimeEnvironment): string[] {
  const load = (values: readonly number[]): string => values.map((value) => value.toFixed(2)).join(' ');
  return [
    `Date: ${environment.date}`,
    `CPU: ${environment.cpu}, ${environment.processors} logical processors; ` +
      (environment.pinned === null ? 'not pinned' : `every measured process pinned to processor ${environment.pinned}`),
    `OS: ${environment.os}`,
    `Power: ${environment.power}`,
    `Runtime: ${environment.runtime}`,
    `Command: ${environment.command}`,
    `Warmup: ${environment.warmupMs} ms per variant and pass; budget: ${environment.budgetMs} ms of samples per ` +
      `variant and pass, at least 30 samples; ${environment.passes} passes, each variant in a fresh process`,
    'Samples: batches of calls lasting at least 10 µs, divided by the batch; p50, p99, minimum and maximum are of ' +
      'batch means; the floor (median time of one iteration of the same loop around a function that returns its ' +
      'argument) is subtracted from every figure; margin: 95 % confidence interval of the mean (Student); a ' +
      'collection lands in a few samples, so p50 leaves its cost out and the mean spreads it over every call',
    'Allocations: median over five windows of N calls (two dropped before) of the heap growth with no collection, ' +
      'in a process of its own; check: the same windows in another process, collections let run, growth plus what ' +
      'each collection freed',
    `Load average: ${load(environment.loadBefore)} before, ${load(environment.loadAfter)} after`,
  ];
}

/** The Markdown table of a publication, one row per variant, in the order given. */
export function formatTable(rows: readonly TimeRow[]): string {
  const lines = [
    '| Scenario | Variant | Pass | Batch | Samples | Floor, ns | p50, ns | p99, ns | Min, ns | Max, ns ' +
      '| Mean ± margin, ns | RME | Bytes per call [window min, max] | Check |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const { scenario, variant, pass, time, alloc } of rows) {
    const { summary } = time;
    const rme = Number.isFinite(summary.rme) ? `${summary.rme.toFixed(2)} %` : 'n/a';
    lines.push(
      `| ${scenario} | ${variant} | ${pass} | ${time.batch} | ${summary.samples} | ${formatNs(time.floor)} ` +
        `| ${formatNs(summary.p50)} | ${formatNs(summary.p99)} | ${formatNs(summary.min)} | ${formatNs(summary.max)} ` +
        `| ${formatNs(summary.mean)} ± ${formatNs(summary.margin)} | ${rme} | ${formatBytes(alloc?.heap, true)} ` +
        `| ${formatBytes(alloc?.check, false)} |`,
    );
  }
  return lines.join('\n');
}

/** The p50 of each variant across passes: minimum, median, maximum, and their spread in percent of the median. */
export function passSpread(
  rows: readonly TimeRow[],
): { key: string; min: number; median: number; max: number; spread: number }[] {
  const byVariant = new Map<string, number[]>();
  for (const row of rows) {
    const key = `${row.scenario} ${row.variant}`;
    byVariant.set(key, [...(byVariant.get(key) ?? []), row.time.summary.p50]);
  }
  return [...byVariant].map(([key, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const median = quantile(sorted, 0.5);
    return { key, min, median, max, spread: median > 0 ? ((max - min) / median) * 100 : Infinity };
  });
}

/** The Markdown table of `passSpread`. */
export function formatPasses(rows: readonly TimeRow[]): string {
  const lines = [
    '| Scenario | Variant | p50 across passes: min, ns | median, ns | max, ns | Spread |',
    '|---|---|---:|---:|---:|---:|',
  ];
  for (const { key, min, median, max, spread } of passSpread(rows)) {
    const [scenario, variant] = key.split(' ');
    const shown = Number.isFinite(spread) ? `${spread.toFixed(1)} %` : 'n/a';
    lines.push(`| ${scenario} | ${variant} | ${formatNs(min)} | ${formatNs(median)} | ${formatNs(max)} | ${shown} |`);
  }
  return lines.join('\n');
}
