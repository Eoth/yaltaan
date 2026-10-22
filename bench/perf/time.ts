// The timed process: times one variant of a scenario and prints its figures as JSON, for scripts/perf-time.ts. One
// variant per process, so that no other variant's code shares its call sites or its heap.
//
// Usage: node time.js <scenario file> <variant> <warmup ms> <budget ms>
//
// Method. A read of the clock costs more than a short call, so a sample times a batch of calls and is divided by the
// batch: the batch doubles from 1, after the warmup, until the shortest of three batches lasts at least 10 µs, and
// grows again, the samples taken so far dropped, whenever the median of the last 30 samples lasts less (code the
// optimizing compiler finishes after the warmup runs faster than the code the batch was sized on). The same loop
// around a function that returns its argument (the floor) is timed at the same batch size, its samples interleaved
// with the variant's, and its median per call is subtracted from every figure: what remains is the call, not the loop
// or the clock. Samples are taken until the budget is spent and at least 30 of each are in.
import { loadVariant, positiveInteger } from './load.ts';
import { quantile, summarize, type TimeSummary } from './statistics.ts';

/** What one timed run prints. */
export interface TimeResult {
  readonly batch: number;
  /** The median time of one iteration of the loop around the floor function, in nanoseconds: what was subtracted. */
  readonly floor: number;
  readonly summary: TimeSummary;
}

const minimumSampleNs = 10_000;
const minimumSamples = 30;
const identity = (index: number): number => index;
// Results are kept in a small ring, so that the optimizing compiler cannot prove a call useless and drop it.
const kept: unknown[] = new Array<unknown>(16);

// Two copies of the same loop, one for the floor and one for the variant: a single loop would see two functions at
// its call site, and both would be timed through a polymorphic call that neither copy alone makes.
function timeFloor(call: (index: number) => unknown, batch: number): number {
  const start = process.hrtime.bigint();
  for (let i = 0; i < batch; i++) {
    kept[i & 15] = call(i);
  }
  return Number(process.hrtime.bigint() - start);
}

function timeVariant(call: (index: number) => unknown, batch: number): number {
  const start = process.hrtime.bigint();
  for (let i = 0; i < batch; i++) {
    kept[i & 15] = call(i);
  }
  return Number(process.hrtime.bigint() - start);
}

function elapsedMs(since: bigint): number {
  return Number(process.hrtime.bigint() - since) / 1e6;
}

/** Times `call` as the header says. */
function timeCall(call: (index: number) => unknown, warmupMs: number, budgetMs: number): TimeResult {
  // Warmup: both loops run, the batch growing with the calls, until the optimizing compiler has seen them long enough.
  const warmupStart = process.hrtime.bigint();
  let batch = 1;
  do {
    if (timeVariant(call, batch) < minimumSampleNs) {
      batch *= 2;
    }
    timeFloor(identity, batch);
  } while (elapsedMs(warmupStart) < warmupMs);
  // A batch sized on one sample would follow an interrupt; the shortest of three is the call's own time.
  while (Math.min(timeVariant(call, batch), timeVariant(call, batch), timeVariant(call, batch)) < minimumSampleNs) {
    batch *= 2;
  }
  let floorSamples: number[] = [];
  let samples: number[] = [];
  let start = process.hrtime.bigint();
  while (elapsedMs(start) < budgetMs || samples.length < minimumSamples) {
    floorSamples.push(timeFloor(identity, batch) / batch);
    samples.push(timeVariant(call, batch) / batch);
    if (samples.length % minimumSamples === 0) {
      const median =
        quantile(
          samples.slice(-minimumSamples).sort((a, b) => a - b),
          0.5,
        ) * batch;
      if (median < minimumSampleNs) {
        batch *= 2 ** Math.ceil(Math.log2(minimumSampleNs / Math.max(median, 1)));
        floorSamples = [];
        samples = [];
        start = process.hrtime.bigint();
      }
    }
  }
  const floor = quantile(
    floorSamples.sort((a, b) => a - b),
    0.5,
  );
  return { batch, floor, summary: summarize(samples, floor) };
}

const [file = '', variant = '', warmup, budget] = process.argv.slice(2);
const result = timeCall(
  await loadVariant(file, variant),
  positiveInteger('warmup', warmup),
  positiveInteger('budget', budget),
);
process.stdout.write(`${JSON.stringify(result)}\n`);
