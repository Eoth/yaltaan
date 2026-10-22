// The statistics of the timed harness, kept pure so that a test can check them on known samples. A sample is the mean
// time of one call over a batch of calls, so every quantile here is a quantile of batch means, not of single calls.

/** What the harness publishes for one variant, in nanoseconds per call once the loop floor is subtracted. */
export interface TimeSummary {
  readonly samples: number;
  readonly p50: number;
  readonly p99: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  /** Half the width of the 95 % confidence interval of the mean, in nanoseconds. */
  readonly margin: number;
  /** The margin in percent of the mean; `Infinity` when the mean is zero or below, as for an empty function. */
  readonly rme: number;
}

/** The `q`-quantile of ascending values, interpolated between the two closest ranks (Hyndman and Fan, type 7). */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0 || !(q >= 0 && q <= 1)) {
    throw new Error(`a quantile needs values and a rank in [0, 1], got ${sorted.length} values and ${q}`);
  }
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const low = sorted[below] ?? 0;
  const high = sorted[Math.min(below + 1, sorted.length - 1)] ?? low;
  return low + (high - low) * (position - below);
}

/**
 * The two-sided 95 % critical value of Student's t for `df` degrees of freedom, by the Cornish-Fisher expansion
 * around the normal quantile: within 0.1 % of the tables from 10 degrees of freedom on, and the harness never
 * publishes fewer than 30 samples.
 */
export function tCritical95(df: number): number {
  if (!(df >= 1)) {
    throw new Error(`degrees of freedom must be at least 1, got ${df}`);
  }
  const z = 1.959963984540054;
  const z3 = z ** 3;
  const z5 = z ** 5;
  return (
    z +
    (z3 + z) / (4 * df) +
    (5 * z5 + 16 * z3 + 3 * z) / (96 * df ** 2) +
    (3 * z ** 7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df ** 3)
  );
}

/** The published figures of `perCall` samples (nanoseconds per call), with `floor` subtracted from every one. */
export function summarize(perCall: readonly number[], floor: number): TimeSummary {
  if (perCall.length < 2) {
    throw new Error(`a summary needs at least two samples, got ${perCall.length}`);
  }
  const sorted = perCall.map((value) => value - floor).sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const margin = (tCritical95(n - 1) * Math.sqrt(variance)) / Math.sqrt(n);
  return {
    samples: n,
    p50: quantile(sorted, 0.5),
    p99: quantile(sorted, 0.99),
    min: sorted[0] ?? 0,
    max: sorted[n - 1] ?? 0,
    mean,
    margin,
    rme: mean > 0 ? (margin / mean) * 100 : Infinity,
  };
}
