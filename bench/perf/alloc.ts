// The allocation process: reads the bytes one call of a variant allocates on the V8 heap and prints them as JSON, for
// scripts/perf-time.ts. Separate from the timed process, whose figures a forced collection would disturb.
//
// Usage: node --expose-gc --single-threaded --min-semi-space-size=64 --max-semi-space-size=64 \
//          alloc.js <scenario file> <variant> <warmup ms>
//        node --expose-gc --single-threaded --max-semi-space-size=1 alloc.js <scenario file> <variant> <warmup ms> \
//          --accounted
//
// Heap growth, the published figure: after a full collection, the heap's used size before and after a window of N
// calls with no collection in it (the young generation is sized at 64 MB so that none is needed, and V8's GC profiler
// says whether one ran; a window that saw one is halved). V8 allocates by moving a pointer, so the growth is the
// bytes allocated, plus the unused end of a page when an object does not fit in what remains of it.
//
// --accounted, the check: collections are let run (a young generation of 1 MB makes them frequent), and the bytes
// allocated are the heap's growth over the window plus what each collection freed, as the GC profiler reports the
// heap before and after it. The same calls, read through the collector's accounting instead of a window free of it.
//
// Both readings take seven windows of N calls, drop the first two and keep the median per call of the other five:
// the first windows compile the loop that makes the calls (on-stack replacement allocates code on the heap), and a
// compilation landing in one window would shift a single reading by hundreds of bytes per call. `--single-threaded`
// compiles on the main thread, so that no optimized code lands halfway through a window. Memory outside the V8 heap
// (the contents of an ArrayBuffer) is not counted.
import { performance } from 'node:perf_hooks';
import v8 from 'node:v8';
import { loadVariant, positiveInteger } from './load.ts';
import { quantile } from './statistics.ts';

/**
 * What one allocation run prints: the median, minimum and maximum bytes per call over the kept windows of `calls`
 * calls; `bytes` is `null` when no window was free of a collection, even of a single call.
 */
export interface AllocResult {
  readonly calls: number;
  readonly bytes: number | null;
  readonly min: number | null;
  readonly max: number | null;
}

const windowBytes = 8 * 1024 * 1024;
const windowMs = 100;
const maximumCalls = 100_000;
const droppedWindows = 2;
const keptWindows = 5;
const kept: unknown[] = new Array<unknown>(16);

const collect = (): void => {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) {
    throw new Error('the allocation process needs --expose-gc');
  }
  gc();
  gc();
};

function run(call: (index: number) => unknown, calls: number): void {
  for (let i = 0; i < calls; i++) {
    kept[i & 15] = call(i);
  }
}

/**
 * The bytes `calls` calls allocate, and whether a collection ran meanwhile. The GC profiler reports the collections
 * when it stops, synchronously; a performance observer's `gc` entries arrive tens of milliseconds later.
 */
function window(call: (index: number) => unknown, calls: number): { bytes: number; collected: boolean } {
  collect();
  const profiler = new v8.GCProfiler();
  profiler.start();
  const before = process.memoryUsage().heapUsed;
  run(call, calls);
  const after = process.memoryUsage().heapUsed;
  const { statistics } = profiler.stop();
  let freed = 0;
  for (const { beforeGC, afterGC } of statistics) {
    freed += beforeGC.heapStatistics.usedHeapSize - afterGC.heapStatistics.usedHeapSize;
  }
  return { bytes: after - before + freed, collected: statistics.length > 0 };
}

/** As many calls as fit in the window of bytes and of time, from a warmup that measured both. */
function windowCalls(bytesPerCall: number, msPerCall: number): number {
  return Math.max(
    1,
    Math.min(maximumCalls, Math.floor(windowBytes / Math.max(bytesPerCall, 1)), Math.floor(windowMs / msPerCall)),
  );
}

function measure(call: (index: number) => unknown, warmupMs: number, accounted: boolean): AllocResult {
  let warmed = 0;
  const warmupStart = performance.now();
  do {
    run(call, 1);
    warmed++;
  } while (performance.now() - warmupStart < warmupMs);
  const msPerCall = (performance.now() - warmupStart) / warmed;
  const probe = Math.max(1, Math.min(warmed, 64));
  let calls = windowCalls(window(call, probe).bytes / probe, msPerCall);
  for (;;) {
    const perCall: number[] = [];
    let spoiled = false;
    for (let i = 0; i < droppedWindows + keptWindows && !spoiled; i++) {
      const { bytes, collected } = window(call, calls);
      spoiled = collected && !accounted;
      if (i >= droppedWindows) {
        perCall.push(bytes / calls);
      }
    }
    if (!spoiled) {
      perCall.sort((a, b) => a - b);
      return {
        calls,
        bytes: quantile(perCall, 0.5),
        min: perCall[0] ?? null,
        max: perCall[perCall.length - 1] ?? null,
      };
    }
    if (calls === 1) {
      return { calls, bytes: null, min: null, max: null };
    }
    calls = Math.max(1, Math.floor(calls / 2));
  }
}

const [file = '', variant = '', warmup, option] = process.argv.slice(2);
if (option !== undefined && option !== '--accounted') {
  throw new Error(`unknown option ${option}`);
}
const result = measure(await loadVariant(file, variant), positiveInteger('warmup', warmup), option === '--accounted');
process.stdout.write(`${JSON.stringify(result)}\n`);
