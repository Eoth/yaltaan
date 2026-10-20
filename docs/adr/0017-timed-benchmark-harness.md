# ADR 0017 — Timed benchmark harness written in the repository, with batched samples

- Date: 2026-10-20
- Status: accepted (decided by the owner, against the recommendation of tinybench)

## Context

ARCHITECTURE.md §9.2 promises timed benchmarks of every hot path against the platform and the best reference library, on seeded datasets, published with the CPU, the OS, the runtime and its version, the command, the dataset, the warmup, the iterations and the dispersion (p50, p99, spread), plus the bytes allocated per operation. It names two candidate tools, mitata and tinybench, and leaves the choice to a record: a development dependency that enters the benchmarks is one.

The decision between two commits does not rest on this harness. ADR 0016 counts instructions under Callgrind, which is deterministic where a clock on a shared machine is not. The timed harness publishes what a user would see, on the scenarios of `bench/perf/` that the count already runs; its figures are read, not judged by the gate.

What a timed harness must get right is the cost of the clock itself. A hot path of the library may take ten nanoseconds; reading `process.hrtime` costs more than that. A harness that times each call alone reports the timer, and a comparison between two such figures shrinks every ratio towards one.

## Options

1. **Native, or do nothing beyond Node.** A loop around `process.hrtime.bigint()` and sorted samples, in the repository. No dependency. Its first form, timing batches of calls through a closure, read 34 to 35 ns for an object spread that mitata reads at 9 to 10 ns: the loop and the indirect call were measured with the operation, and nothing outside the harness would have said so. Getting it right means writing and maintaining the statistics (quantiles, relative margin of error), the warmup and time budgets, and an overhead correction, with no second reading inside the repository. Kept by the owner, under the rules of the decision.
2. **mitata 1.0.34**: batches calls and corrects the loop overhead itself, the most accurate reading of the probe (9 to 10 ns for the spread, the same as option 3 with batches). No dependency, MIT, 135 023 bytes installed. Its last release is 1.0.34 of 2025-02-04, twenty months ago, by its only npm maintainer, and it carries no provenance attestation. Rejected: a tool that fails ADR 0013's own review condition (twelve months without a release) on its first day.
3. **tinybench 6.2.2** (2026-10-10): tasks with a time budget and a warmup, latency and throughput statistics (p50, p75, p99, p995, p999, mean, variance, relative margin of error), asynchronous tasks, hooks around each task. No dependency, MIT, 87 315 bytes installed, provenance attestation verified, three npm maintainers, six releases between 2026-08-28 and 2026-10-10; the engine behind Vitest's `bench`. It times each call alone, so the harness would give it samples of a batch of calls. Recommended, not kept: the owner prefers no dependency for a harness whose figures are published and never judged.

## Measurements

On 2026-10-20, Ubuntu 26.04 x64, 12th Gen Intel Core i7-12700H (20 logical processors), Node 24.21.0, npm 11.19.0, machine shared with other work (load average 1.2 to 5), three passes of each:

- **Footprint, in a copy of the repository's real tree** (a clone, `npm ci --ignore-scripts`, then `npm install -D <tool>`, the repository's `.npmrc` with `install-strategy=shallow` and `min-release-age=7`): tinybench adds one lock entry and 87 315 bytes (`node_modules` 95 862 726 → 95 950 041 bytes); mitata one entry and 135 023 bytes. Neither ships a command: `node_modules/.bin` stays `esbuild prettier rollup tsc tsc6`, `npx tsc -v` stays `Version 7.0.2`. `npm audit signatures`: 9 verified attestations with tinybench against 8 before; 8 with mitata. The lockfile check passes with tinybench (45 entries).
- **Import cost**: `import('tinybench')` 1.6 to 1.7 ms; `import('mitata')` 2.0 ms.
- **Readings of the same two operations**, an object spread and a `structuredClone` of a five-field object, 500 ms per task after 100 ms of warmup:

| Harness | spread, p50 | spread, p99 | `structuredClone`, p50 | `structuredClone`, p99 |
|---|---|---|---|---|
| mitata | 9 to 10 ns | 22 to 23 ns | 1 370 to 1 415 ns | 1 599 to 2 298 ns |
| tinybench, one call per sample | 28 ns | 34 to 45 ns | 1 377 to 1 396 ns | 1 550 to 1 628 ns |
| tinybench, 256 (spread) or 16 (`structuredClone`) calls per sample | 9.1 to 9.5 ns | 11.4 to 13.1 ns | 1 327 to 1 337 ns | 1 455 to 1 537 ns |
| native loop, batched, no overhead correction | 34 to 35 ns | 45 to 48 ns | 1 389 to 1 460 ns | 1 879 to 2 839 ns |

  An empty loop of 256 iterations under tinybench reads 0.6 ns per iteration: what a batch adds to each call. Above a microsecond the four readings agree within 10 % at p50; below a hundred nanoseconds only the batched ones are right.

## Decision

Option 1, decided by the owner, with the rules that make it read what the probe's first form did not.

- **No dependency**: the harness lives in `bench/perf/` and uses `process.hrtime.bigint()` and `node:perf_hooks` only.
- **Batched samples**: before timing, the harness sizes a batch per scenario so that one sample lasts at least 10 µs (the batch doubles from 1 until it does), and divides each sample by it; the batch size is published with the figures. p50 and p99 are then quantiles of batch means, which the publication says.
- **The loop is subtracted**: the same batch loop around a function that returns its argument is timed in the same run, and its p50 per call is subtracted from each scenario's figures and published beside them, so that a reader sees the floor under every figure.
- **A reading checked by the harness's own tests**: an empty function reads within a nanosecond of zero once the loop is subtracted, and a workload doing twice the work of another (the same loop, twice the length) reads between 1.8 and 2.2 times its time.
- **A second reading, outside the repository**: the figures of a scenario are compared once with tinybench and mitata installed in a scratch copy, never in the lockfile, and the comparison is recorded where the harness is introduced; it is repeated when the review condition below fires.
- **Publication**: CPU model, processor count, OS, runtime and version, command, dataset, warmup, time budget, samples, batch size, loop floor, p50, p99, minimum, maximum, relative margin of error; native, reference and Yaltaan side by side for each dataset.
- **Allocations**: bytes allocated per operation are read from V8 in a separate run of each scenario, not from the timed run, whose figures they would disturb. Node 24's `v8.getHeapStatistics()` has no allocation counter; the reading (GC tracing totals over a known number of calls, or heap sampling) is chosen and checked against a second method with the harness. Not measured here.
- **Not a gate step**: the figures are published, not judged; the A/B decision stays with the instruction count of ADR 0016. The harness's own tests run in the gate like any other.

## Consequences

- No lock entry, no byte installed, no maintainer outside the repository.
- The harness and its statistics are code of the repository, with their tests: estimated at 150 to 250 lines, not measured.
- Nothing published changes.
- The batch and the subtracted loop are rules of the harness: a scenario timed without them would publish the clock.

## Review condition

A scenario where the harness and the outside reading (tinybench or mitata in a scratch copy) disagree by more than the published spread; the harness's statistics growing past 300 lines or needing asynchronous tasks; or a need to time in browsers (§9.2, through Playwright), which a tool would serve; tinybench, recommended here, is then the first option to weigh.
