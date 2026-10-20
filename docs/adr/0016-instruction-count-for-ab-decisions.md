# ADR 0016 — Instruction count under Callgrind to decide between two commits

- Date: 2026-10-20
- Status: accepted (technical choice)

## Context

ARCHITECTURE.md §9.2 asks that a regression on a hot path be detected despite noisy machines, "a dedicated machine or instruction counting", and holds a 5 % blocking threshold as a hypothesis to calibrate by measurement. The development machine is a laptop shared with other work; CI runners are shared too. A clock there moves by several percent between two runs of the same code (the timed probe of ADR 0017 read up to 22 % of relative margin of error on one task), so a change of a few percent cannot be judged by timing, let alone one of a tenth of a percent.

The question is how to compare the work of a commit with the work of its parent, reproducibly, with the tools at hand, and what threshold then separates a real change from noise.

## Options

1. **Do nothing, or time on this machine.** Free, but the noise is larger than the regressions to catch. Rejected.
2. **A dedicated quiet machine timing both commits.** None exists, and even a quiet machine judges in percent, not in tenths of a percent. Rejected.
3. **Hardware counters (`perf stat -e instructions`).** Fast, but `perf_event_paranoid` is 4 on Ubuntu 26.04 and the account has no root to lower it; counts also include interrupts and differ between processors. Rejected.
4. **Callgrind (valgrind 3.26.0, a system package, not an npm dependency)**: counts the instructions a process executes, the same on every run of the same work on the same binary, at the price of running 30 to 60 times slower. V8 adds its own sources of variation: random and hash seeds, background compilation and garbage collection threads, and delayed tasks. Kept, with the rules below.

## Measurements

On 2026-10-20, Ubuntu 26.04 x64, 12th Gen Intel Core i7-12700H, Node 24.21.0, valgrind 3.26.0, load average 1 to 5 from other work:

- **V8's flags matter.** The same workload (`omit` and a `Map` over 200 records, 2 000 times) counted three times: 2 208 271 892 to 2 208 273 848 instructions with `--predictable --random-seed=1 --hash-seed=1 --single-threaded --v8-pool-size=0`, a spread of 1 956 (0.0001 %); 2 797 539 110 to 2 805 874 208 without them (0.3 %). Node 24 is deterministic enough; no other runtime is needed.
- **Type stripping is not.** With the runner and the scenarios loaded as `.ts`, ten counts of the same process in parallel split into two groups, 836 186 704 to 836 208 537 and 864 562 468 to 864 581 309 instructions: about 28.4 million more in some processes, spent in Turboshaft compiling, among others, WebAssembly code. Node strips types with a WebAssembly build of a compiler, and the optimizing compilation lands, or not, with a delayed task. `--no-wasm-tier-up` does not remove it (ten counts, the same two groups). Loading the same modules as JavaScript, their types stripped beforehand by `module.stripTypeScriptTypes`, gives one group: ten counts from 422 081 923 to 422 089 760 (a spread of 7 837 instructions, 0.002 %), half the instructions, and no WebAssembly compiled.
- **Noise per call.** Each variant is counted in two processes, N and 2N calls, and the difference divided by N is the work of one call. Five counts of the same tree, every variant, eight processes at a time: spreads (max − min over min) of 0.0164 % (`login native/micro`, 1 002 instructions per call over 50 000 calls), 0.0054 %, 0.0291 % (`login native/realistic`, 103 510 per call over 300 calls, the widest), 0.0038 %, 0.0124 %, 0.0019 % for the six variants of `login`; 0.0020 %, 0.0022 %, 0.0056 %, 0.0126 %, 0.0021 % and 0.0040 % for the six of `omit` (the two pathological ones at 100 calls; at 20 calls one of them spread to 0.0370 %, and at 20 calls a realistic variant of 2 million instructions in all to 0.34 %: a variant needs some 30 million counted instructions). Each process varies by a few thousand instructions, which the calls divide.
- **A fabricated regression.** In a throwaway clone, commit A holds the scenarios, commit B makes `omit native/realistic` copy 105 records instead of 100. `perf-count.sh A B` reports that variant at 1 416 104.1 → 1 474 472.8 instructions per call, +4.122 %, "MORE work", exit status 3; the eleven others moved by 0.018 % at most, all "same work". The count took 1 min 22 s for both commits, extraction included.

## Decision

Option 4, as `scripts/perf-count.sh <A> <B>` (the logic in `scripts/perf-count.ts`):

- **What is counted**: every variant of `bench/perf/scenarios/` (native, reference libraries, and the library's own side once its hot paths exist), each in two processes of one runner that make N and 2N calls; the work of one call is their difference over N, so that Node's start, the loading of the modules and the building of the input cancel out. N is set per dataset by each scenario so that the counted work is at least about 30 million instructions.
- **Determinism**: V8 flags `--predictable --random-seed=1 --hash-seed=1 --single-threaded --v8-pool-size=0`; the runner and the scenarios run as JavaScript, types stripped beforehand; the same Node for both commits (the one that runs the script), the same environment, the same runner (taken from the working tree for both sides), the same arguments.
- **Commits**: each tree is extracted once and reused; its packages are built as the commit has them; a commit with the working tree's lock file links its dependencies, another installs them with `npm ci --ignore-scripts`.
- **Threshold**: a variant does more or less work when its instructions per call move by more than 0.10 % (`PERF_COUNT_THRESHOLD`): 3.4 times the widest spread measured between repeated counts of the same tree (0.0291 %), and far below the 4 % of the fabricated regression. Exit status 3 when a variant does more work, so a script can stop on it.
- **Use**: a series of commits that touches a hot path is counted from the parent of its first commit (A) to its last commit (B); the table goes in the message of the last commit of the series. More work is explained in that message, or fixed by a separate commit. The count is not a gate step: valgrind is not on the CI runners, and a count takes minutes.
- §9.2 of ARCHITECTURE.md is rewritten accordingly: a count detects a change from 0.10 %, where a clock could not have seen 5 %; the rule that a regression above 5 % on a hot path blocks without a decision record stays.

## Consequences

- No npm dependency; valgrind must be installed where counts are made (it is on the development machine).
- A count of the current two scenarios at two commits takes about 1.5 min on 8 processes, and grows with each scenario.
- Callgrind sees V8's builtins and runtime by name, but not the code V8 compiles at run time: a "more work" is explained by the scenario and the diff, not by a profile of JavaScript functions.
- Counts compare work, not time: a change that trades instructions for cache misses, or the reverse, is not seen. The timed harness of ADR 0017 publishes times; it does not decide.

## Review condition

A spread between repeated counts of the same tree above half the threshold on any variant (`perf-count.sh --repeat`); a Node major whose counts are not deterministic under these flags; a platform where valgrind does not run (macOS on Apple silicon, if a contributor counts there); or a need to judge by cycles (memory layout, caches), which Callgrind's cache simulation could estimate.
