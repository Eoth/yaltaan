# ADR 0022 — es-toolkit as the differential judge of `@yaltaan/core`

- Date: 2026-10-28
- Status: accepted

## Context

The tests of `@yaltaan/core` state laws over generated values (fast-check, ADR 0013) and see each law bite on a mutation made by hand. A law only checks what its author thought of stating, and the mutations only those the author thought of making: both are written by the same hand as the code. Before 0.1.0, the functions that ship need a judge that is not ours.

es-toolkit is already the size and instruction reference of the bench (ADR 0009, ADR 0016): it is installed, pinned and audited. For most functions of `core` that have a counterpart in another library, es-toolkit or its `compat` entry (the lodash-compatible one) has it. It is a development dependency of the root; until now it entered only the size report and the bench scenarios, not the test files.

## Options

1. **Native, or do nothing.** Keep the laws and the hand-made mutations. Costs nothing more; leaves every behaviour nobody thought of unjudged.
2. **Node's own functions as judges** (`util.isDeepStrictEqual` for `equal`). Covers one function out of eight; and Node's equality differs from ours on purpose in four cases of ADR 0020, so it would judge mostly what we chose not to do. Kept only as the comparison of outcomes, below.
3. **es-toolkit 1.52.0, already installed, as a test dependency**: each function of ours with an equivalent runs beside it on the same generated inputs; every disagreement is either a defect, fixed, or a difference the module documents and the judge checks. Kept.
4. **lodash 4.18.1** (2026-04-01, after no release from 2021 to 2026-01). The behaviour most applications were written against, but a new package in the tree: 1 413 741 bytes unpacked (CommonJS; `lodash-es` 634 630 bytes), for functions es-toolkit's `compat` entry already reads the lodash way (`toPath`, `defaultsDeep`). Rejected; it would be the judge to add if a lodash behaviour mattered that `compat` does not reproduce.

## Measurements

On 2026-10-28, Ubuntu 26.04 x64, Node 24.21.0, npm 11:

- **Footprint**: no package added; `package-lock.json` unchanged; `node_modules` 95 862 726 bytes before and after; es-toolkit 4 231 890 bytes, MIT, no dependency, no install script.
- **Equivalents judged**: `pick`, `omit`, `mapValues`, `mapKeys`, `merge` (`toMerged`), `defaults` (`compat/defaultsDeep`), `equal` (`isEqual`), `parsePath` (`compat/toPath`). Without equivalent: `redact`, `formatPath`, `checkWritablePath`, `ok`, `err`, `mapResult`, `unwrapOr`, `toStandardIssue`, `fromStandardIssue`.
- **Disagreements found**: 23 function and difference pairs, in 13 lines of documentation; each matches a choice already made (ADR 0019 to ADR 0021, and the support tables of the modules); no defect. Two were found only once the judge drew 1 000 inputs instead of 300 (`defaults` with an array on both sides) or once records with a key in common became likely.
- **The judge bites**: 8 deliberate defects in the code (`pick`, `merge`, `defaults`, `mapValues`, `mapKeys`, `equal`, `parsePath` twice) and 4 in the judge itself, each restored by copy afterwards: all 12 fail a test. One, `defaults` no longer filling an `undefined` field, passed at 300 inputs and fails at 1 000.
- **Time**: the four judge test files alone, 1.7 to 2.2 s of wall clock (three runs); the whole test suite, median of three runs 6.71 s without them and 7.33 s with them, on a machine shared with other work (runs from 6.6 to 11.3 s).

## Decision

- es-toolkit becomes a dependency of the verification gate as the differential judge of `core`, imported by test files only (`judge.test.ts` beside each judged module).
- The judge lives in `@yaltaan/testing` (`createJudge`, `runComparison`): outcomes, the value returned or the name of the error thrown, compared by `util.isDeepStrictEqual`, neither our `equal` nor the reference's own.
- A difference is documented in the header comment of the module, in a block that names the installed version of the reference, one line per difference with the functions it concerns. The judge reads that block: a difference used by a comparison must be written there, every written line must be used by a comparison, each must be reached by at least one input and change at least one outcome, and at least a quarter of the inputs must be compared outside every difference.
- 1 000 inputs per comparison by default, seeded by the test's name: the same inputs on every run and machine.
- A function added to `core` with an equivalent in es-toolkit gets its comparison in the same change, from its first test.
- Before 0.1.0, no other new tool enters the gate but a judge.

## Consequences

- A new version of es-toolkit fails every judge until each module's block names it: an update is read, judged and documented, never taken on trust.
- The documented differences are part of the contract a user reads, and stay true by construction.
- What the judge does not see is written beside it: nested masks (the paths of `compat` follow none of their rules), `arrays: 'concat'` (no equivalent), cycles, symbol keys and class instances in `equal`; an input both libraries mishandle alike.
- Around half a second more per gate, inside the dispersion of the machine.

## Review condition

es-toolkit unmaintained (no release for six months) or a release that changes a judged behaviour without saying so; a judged function whose equivalent disappears; a judge that takes more than 5 s of the gate.
