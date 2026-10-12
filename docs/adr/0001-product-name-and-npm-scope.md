# ADR 0001 — Product name and npm scope

- Date: 2026-10-12
- Status: proposed — recommendation, awaiting the owner

## Context

The library ships as several npm packages (core, temporal, schema, rules, form, framework adapters), so it needs one name and one npm scope before anything is published. Renaming after a publication is a breaking change for every user (new package names, new imports); renaming before costs a search and replace in unpublished manifests.

A name that describes the function ("ts-stdlib", "app-utils") makes a weak trademark: it is refused at registration or cannot be defended, and a forced rename comes later, at the worst moment.

## Options

1. **Do nothing: keep a placeholder.** Blocks the first publication, and every document written meanwhile carries a name that will change.
2. **A descriptive name.** Immediately understood, but a weak trademark (see Context), and every common descriptive npm name is taken.
3. **Pien, under the scope `@pien`.** Short, pronounceable in French and in English, not descriptive (its sense is "clear", what the contracts aim to be). The scope is held by a third-party account (see Measurements).
4. **Pien, under the scope `@pienjs`.** Same name; the scope adds the suffix that several JavaScript projects already use for their organisation (`@vitejs` for Vite), and it is free.

## Measurements

Checked on 2026-10-12 against the public registry and DNS:

- `https://registry.npmjs.org/-/org/pien/package` answers `{}`: the scope exists and holds no package, so it belongs to someone; `https://registry.npmjs.org/-/org/pienjs/package` answers `{"error":"Scope not found"}`: free.
- `https://registry.npmjs.org/pien` answers 404: the unscoped package name is free.
- `https://api.github.com/users/pienjs` answers 404: no GitHub user or organisation of that name.
- `pien.dev`, `pien.com`, `pienjs.dev`, `pienjs.com`: no DNS answer; registration status not checked (needs a WHOIS lookup).
- Not done: trademark searches (INPI, EUIPO, WIPO, classes 9 and 42).

## Decision

Recommended: option 4. The product is named **Pien**; its packages are `@pienjs/core`, `@pienjs/temporal`, `@pienjs/schema`, `@pienjs/rules`, `@pienjs/form`, `@pienjs/angular`, `@pienjs/react`, `@pienjs/vue`.

Until the owner accepts this record and the trademark searches come back clear, every package stays `"private": true` and nothing is published, registered or bought under the name.

## Consequences

- Manifests, documentation and imports in examples use `@pienjs/…` from now on; a rename before the first publication is a mechanical replacement.
- The unscoped `pien` package can be reserved later if a meta-package or a CLI ever needs it.

## Review condition

A trademark conflict found by the searches; the `@pien` scope becoming available; or the owner choosing another name.
