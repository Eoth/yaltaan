# Architecture decision records

One file per decision, `NNNN-short-title.md`, numbered in order from `0001`. A record is written before the code that depends on it, and is never rewritten once accepted: a later record replaces it, and both status lines say so.

A record is required for: a new package; a new dependency, including a development one when it enters the build or the verification gate; a change to a shared contract (`Result`, `Issue`, `Path`, the schema interface, the reactive node, the mutation tags); an exception to a rule of [CONTRIBUTING.md](../../CONTRIBUTING.md); reopening Rust or WebAssembly; promoting a module to `@stable`.

## Format

```markdown
# ADR NNNN — Title in sentence case

- Date: YYYY-MM-DD
- Status: proposed — recommendation, awaiting the owner | accepted | superseded by ADR NNNN

## Context
What forces the decision, with facts and their sources.

## Options
1. **Native, or do nothing.** Always one of the options, with what it costs.
2. **Another option.** What it gives, what it costs, why it is kept or rejected.

## Measurements
What was measured, how (command, versions, date), and the figures. "Not measured" is written when it is so.

## Decision
The option chosen, and the rules that follow from it.

## Consequences
What changes for users and for the code, including the costs accepted.

## Review condition
The fact or the measurement that would reopen the decision.
```

A `proposed` record is a recommendation. Work may proceed on it only where undoing it stays cheap (a name in unpublished manifests); nothing irreversible — a publication, a public API, a shipped default — depends on it until it is accepted.
