# ADR 0031 — The judges of `@yaltaan/schema`: valibot and the Standard Schema specification

- Date: 2026-11-01
- Status: accepted

## Context

`@yaltaan/schema` will say two things about itself: that it implements Standard Schema, version 1, and that it reads data the way the common schema engines do, but for differences it documents. Our own laws and hand-made mutations are written by the same hand as the code (ADR 0022 made the same point for `core`). Both claims need a judge that is not ours, plugged in before the first schema exists, so that the first test of the first schema already runs against it.

valibot is the size and instruction reference of the bench (ADR 0009, ADR 0016): it is installed and pinned, but no test imports it. Standard Schema is a family of TypeScript interfaces.

## Options

1. **Native, or do nothing.** Laws only. Costs nothing, and leaves "conforms to Standard Schema" unverified by anything but our reading of it.
2. **The published test suite of Standard Schema.** None exists. On 2026-11-01, the registry holds `@standard-schema/spec` (types) and `@standard-schema/utils` (`SchemaError`, `getDotPath`); `npm search` finds no conformance package; the repository at commit `86764d8` holds no suite: `packages/examples` has two examples (`implement.ts`, `integrate.ts`), and the only test files are those of the two utilities.
3. **The specification's types and text, made executable.** `@standard-schema/spec` 1.1.0 as a development dependency, to judge our copied interfaces by the compiler, both ways; every requirement the interface states, written as a table of named checks that reads any schema through `~standard`; the generic consumer of its `integrate.ts`, copied as it is. Kept. The specification's advice against a development dependency concerns a library whose public types import the package: ours copy them (ARCHITECTURE.md §5.4), and no published file imports it.
4. **`@standard-schema/utils`** to read paths. Rejected: the only thing it would judge is `getDotPath`, about twenty lines, which a segment that is `{ key }` or a property key does not need; one more package for no more verdicts.
5. **valibot 1.5.0, already installed, as a differential judge** on generated schemas and inputs: same verdict, same output, same issue paths, read through `~standard` on both sides. Kept: it is the closest design (an API of functions, `strip` by default, `exactOptional`, a discriminated union), so that a difference is a choice and not a difference of model.
6. **Zod 4 or ArkType as the differential judge.** Rejected for now: a new package each (Zod 4.x about 4 MB unpacked), for the same questions. Zod would be the judge to add if a user-visible behaviour of Zod mattered that valibot does not share; T5.7 brings it to the interoperability matrix anyway.

## Measurements

On 2026-11-01, Ubuntu 26.04 x64, Node 24.21.0, npm 11:

- **Footprint**: valibot adds nothing, it is already in `package-lock.json`. `@standard-schema/spec` 1.1.0: 1 package, no dependency, MIT, types only, 22 634 bytes unpacked; lock 50 → 51 third-party entries; `node_modules` 96 116 955 → 96 139 798 bytes.
- **The judge bites**: `packages/testing/src/schema-judge.test.ts` holds 21 deliberate defects of a schema library, made on the valibot side, all drawn from the seed of the control that agrees, so that only the defect can fail a draw, and one defect per row of the 13 rows of the conformance table, refused by the row it names. All are refused. The first version of the generator drew `NaN` too rarely on a number: this test failed once the seed was shared, and the generator now draws the values a number refuses at the number itself.
- **Time**: the whole file 2.7 to 3.5 s of wall clock; the comparison itself, 1 000 inputs, 1.2 s.

## Decision

- **Conformance**: `@yaltaan/testing/schema-judge` holds `STANDARD_SCHEMA_TABLE`, one row per requirement the specification states on the props, the result, the issues and the options, and `readStandard`, which reads any schema through `~standard` and applies the table to what it returns. valibot passes the table on every generated input, so the table cannot be stricter than a real implementation by accident.
- **Types**: a type test of `@yaltaan/schema` compares our copied interfaces with those of `@standard-schema/spec`, both ways.
- **Differential**: `@yaltaan/testing/schema-judge` generates shapes (data that describes a schema) and inputs near each shape, and builds the same schema through a `ShapeLibrary`: one implementation over valibot, one over `@yaltaan/schema`. The comparison runs through `createJudge` of ADR 0022: 1 000 inputs seeded by the test's name; a difference is a line of the block `// Differences from valibot <version>` in the header of the module, which the judge reads and checks both ways.
- **The list comes from the code**: the test of `@yaltaan/schema` lists the module's exports and fails on one that is neither a kind of shape nor named as having no equivalent; the generator's test fails when it stops reaching a kind of shape, or draws less than a quarter of valid or of invalid inputs.
- valibot and `@standard-schema/spec` are imported by test support only: `@yaltaan/testing/schema-judge` is a sub-path of its own, so that a test of `core` does not load them.

## Consequences

- A new version of valibot fails the judge until the block names it, as for es-toolkit.
- About one second more per gate; the review condition below holds it.
- What the judges do not see is written beside them: codes and parameters of issues (valibot has neither, the laws of `@yaltaan/schema` judge them); what no generator draws (getters, proxies: the adversarial catalogue reaches them); an input both libraries mishandle alike. The table only states what the specification states: it says nothing of how an engine uses a schema, which is T2.2's check with Angular and TanStack Form, then the matrix of T5.7.

## Review condition

Standard Schema publishes an executable suite (it then replaces the table); valibot unmaintained (no release for six months), or a release that changes a judged behaviour without saying so; the judge takes more than 5 s of the gate.
