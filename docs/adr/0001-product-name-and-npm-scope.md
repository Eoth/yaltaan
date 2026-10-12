# ADR 0001 — Product name and npm scope

- Date: 2026-10-12
- Status: accepted (the owner's choice, 2026-10-12)

## Context

The library ships as several npm packages (core, temporal, schema, rules, form, framework adapters), so it needs one name and one npm scope before anything is published. Renaming after a publication is a breaking change for every user (new package names, new imports); renaming before costs a search and replace in unpublished manifests.

A name that describes the function ("ts-stdlib", "app-utils") makes a weak trademark: it is refused at registration or cannot be defended, and a forced rename comes later, at the worst moment.

## Options

1. **Do nothing: keep a placeholder.** Blocks the first publication, and every document written meanwhile carries a name that will change.
2. **A descriptive name.** Immediately understood, but a weak trademark (see Context), and every common descriptive npm name is taken.
3. **Pien, under the scope `@pienjs`.** The first working name; its own scope `@pien` is held by a third-party account, hence the suffix.
4. **Yaltaan, under the scope `@yaltaan`.** Not descriptive, pronounceable in French and in English; its sense, shared help, is the thesis of the library (one model shared by every domain). The scope bearing the product's own name is free, so no suffix is needed; `@yaltaanjs` and `@yaltaants`, also free, are not needed.

## Measurements

Checked on 2026-10-12 against the public registry and the GitHub API (`https://registry.npmjs.org/-/org/<name>/package` answers `{"error":"Scope not found"}` for a free scope, `{}` or a package map for a taken one):

- `@yaltaan`, `@yaltaanjs`, `@yaltaants`: free. The unscoped package `yaltaan`: free (404). GitHub user or organisation `yaltaan`: free (404).
- `@pien`: taken (an account without packages); `@pienjs`: free.
- Not done: trademark searches (INPI, EUIPO, WIPO, classes 9 and 42) and domain registration, left to the owner before the first publication.

## Decision

Option 4. The product is named **Yaltaan**; its packages are `@yaltaan/core`, `@yaltaan/temporal`, `@yaltaan/schema`, `@yaltaan/rules`, `@yaltaan/form`, `@yaltaan/angular`, `@yaltaan/react`, `@yaltaan/vue`. Every package stays `"private": true` until the release workflow exists and the trademark searches come back clear.

## Consequences

- Manifests, documentation and examples use `@yaltaan/…`; the repository folder and the GitHub repository are named `yaltaan`.
- The npm organisation `yaltaan` and the unscoped package `yaltaan` should be reserved by the owner early, before someone else takes them.

## Review condition

A trademark conflict found by the searches.
