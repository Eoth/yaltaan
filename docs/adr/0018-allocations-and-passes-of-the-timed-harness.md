# ADR 0018 — Bytes allocated per call, passes and self-checks of the timed harness

- Date: 2026-10-23
- Status: accepted (technical choice)

## Context

ADR 0017 left two things to the harness's first implementation. The bytes allocated per operation: Node 24's `v8.getHeapStatistics()` has no allocation counter, so the reading had to be chosen and checked against a second method. And the harness's own tests: an empty function under a nanosecond, twice the work between 1.8 and 2.2 times the time.

Writing the harness showed three facts that the record did not foresee. A run of one variant per process is moved by the machine as a whole: on the development laptop (a hybrid processor, twelve fast and eight slow logical processors, on battery with the `powersave` governor) the same workload read 247 to 293 ns from one process to the next. The two tests of ADR 0017 stay green with batches of one call, because the floor, timed at the same batch size, also subtracts the cost of the clock: they do not guard the rule they were written for. And a batch sized at the end of the warmup can be too short once the optimizing compiler finishes: medians of 2.5 to 9 µs per sample were seen against the 10 µs rule.

## Options

For the bytes allocated:

1. **Do nothing**: publish times only. Rejected: §9.2 of ARCHITECTURE.md promises the bytes, and an allocation is what the levers of §9.3 remove first.
2. **Heap growth with no collection**: after a full collection, the heap's used size before and after a window of N calls, with the young generation sized so that no collection runs. Exact up to the unused end of a page when an object does not fit in it; cheap; the code runs as it runs in production. Needs a way to know that no collection ran.
3. **The collector's accounting**: collections let run, the heap's growth plus what each collection freed, as `v8.GCProfiler` reports the heap before and after each. Reads the same counters through the collector, and checks that the window free of collections did not change what is allocated.
4. **V8's sampling heap profiler** through `node:inspector`: an allocation recorded about every 32 bytes and scaled, independent of the heap's counters. Kept out of the repository's code: the class that drives the inspector carries a word the repository's guard on internal vocabulary refuses in every tracked file, with no exception. Used once, outside the tracked files, as the independent reading (below), like the outside reading of the timed figures.
5. **`--trace-gc` totals or heap snapshots** (named in §9.2): a total per collection or the live objects at one instant. Neither counts what a call allocates and the next collection frees, which is most of what a hot path allocates.

For the passes and the checks:

1. **One run per variant, and the two tests of ADR 0017 alone.** Rejected: see the context.
2. **Passes**: every variant timed several times, the passes one after the other, so that a change of the machine's state shows as a spread across passes instead of shifting one variant against another; the power source and the frequency governor published with the figures. Plus two tests that guard the batch and the floor directly.

## Measurements

On 2026-10-22 and 23, Ubuntu 26.04 x64, 12th Gen Intel Core i7-12700H, Node 24.21.0, on battery, load average about 2:

- **One window is not enough**: the first form compared one window of N calls with one of 2N. Its readings moved with N and with what ran before: valibot's login schema read 1 131, 405, 343 then 336 bytes per call for N = 1 000, 10 000, 25 811 and 50 000, and 206 in the harness's own sequence; the platform's `omit` on 100 records 37 688, 78 634, 97 650, 98 512 for N = 10 to 1 000. The warmup made single calls, so the loop that makes N calls was compiled (on-stack replacement, which allocates code on the heap) inside a window, the first or the second. Seven windows of N calls, the first two dropped and the median of the five others kept, settle it.
- **Three readings, median of five windows**: heap growth, the collector's accounting and the sampling profiler read a three-field object literal 48.0, 48.0 and 48.4 bytes (the V8 layout gives 48); an array of 1 000 holes 8 192.1, 8 208.7 and 8 050.3 (layout 8 048: the first two count the end of each 256 KB page that the next 8 KB array no longer fits in); the twelve scenario variants within 0.0 to 1.8 % between heap growth and the profiler, except valibot's login schema on one input, 349.3 against 376.2 (7.7 %), whose five windows themselves span 272 to 359. Heap growth and the collector's accounting agree within 0.2 % on every variant.
- **Knowing that no collection ran**: a `PerformanceObserver` on `gc` entries delivered none within a turn of the event loop and 18 some 50 ms later, so a first form of the check never saw a collection; `v8.GCProfiler` reports them synchronously when it stops (18 with a 1 MB young generation, 0 with 64 MB).
- **Passes**: the platform's `omit` on one record, three passes: 686.5, 696.6, 697.6 ns; valibot on 100 inputs: 43 284, 43 425, 49 222 ns. Over two runs of the twelve variants, the spread of p50 across three passes ranged from 0.2 % to 14.3 %.
- **The self-checks** (calibration variants, three passes): an empty function −0.24 to −0.28 ns; the floor function itself −0.12 to 0.00 ns over a floor of 0.74 ns, and 0.92 ns once the subtraction is removed; a chain of 512 dependent steps against one of 256, 1.90 to 2.11 times the time over six runs. The chain carries its value from one call to the next: independent calls overlapped in the processor's out-of-order window and read 2.45 times for twice the work. With ten, then twenty busy loops on the machine (half, then all of its logical processors), the checks held in five runs out of five (three, then two). Run inside the test run, beside the other test files, they failed in two runs out of eight (twice the work read 2.26, then 1.70 times on the second attempt; 2.39 once the processes were pinned to a fast core, which the other files then competed for); run alone after the test run, they held in six runs out of seven under a load average of 6 to 9 from other work, the failing run's message not kept.

## Decision

- **Bytes allocated per call**: heap growth over windows of N calls with no collection, in a process of its own (`--expose-gc --single-threaded`, young generation of 64 MB); seven windows, two dropped, the median of five published with the smallest and largest; a window spoiled by a collection (seen by `v8.GCProfiler`) halves N.
- **Its check**: the same windows in another process with a young generation of 1 MB, read through the collector's accounting, published beside the figure. The sampling profiler's reading is repeated outside the tracked files when the review condition fires.
- **Passes**: three by default, each variant in a fresh process each time; the publication gives each pass and the spread of p50 across passes, the power source and the governor, and says that p50 leaves the cost of collections out where the mean spreads it. `--cpu <n>` pins every measured process to one logical processor (Linux, `taskset`), so that on a hybrid processor no variant runs on a slower core than another; the header says whether a run was pinned.
- **Self-checks**, beside those of ADR 0017: the median sample of every variant lasts at least 10 µs, and the harness's own floor function reads within a third of the floor of zero. The batch grows again, its samples dropped, whenever the median of the last 30 samples lasts less than 10 µs. The ratio of twice the work is read on the fastest of three passes of each workload, since load only slows a pass down. The timing checks live in `bench/perf/time.serial-test.ts`, outside the test run's `*.test.ts` files, and the gate runs them alone in a step after it, pinned to the last fast core when Linux reports a hybrid processor; the allocation checks, which no load moves, stay in the test run.

## Consequences

- Two processes per variant for the bytes; a run of the twelve reference variants takes 37 s with the defaults.
- The bytes of an ArrayBuffer's contents, outside the V8 heap, are not counted.
- The gate gains a step, the timing checks alone, about 2.3 s; the allocation checks add about 2 s to the test run. The test jobs that run the test files on other Node versions do not run the timing checks; the gate does, in CI as on the development machine.

## Review condition

Heap growth and its check disagreeing by more than 1 %, or a variant whose windows span more than 10 % of their median (then the sampling profiler reads it again outside the tracked files); Node exposing an allocation counter (then it replaces heap growth); a scenario whose single call allocates more than the young generation holds (it then reads "n/a").
