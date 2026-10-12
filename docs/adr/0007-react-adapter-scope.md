# ADR 0007 — React adapter scope

- Date: 2026-10-12
- Status: proposed — recommendation, awaiting the owner

## Context

React is the second framework target, after Angular. React users who want a form engine mostly use TanStack Form or react-hook-form. The question is whether `@yaltaan/react` offers its own hooks only, or also an adapter for TanStack Form.

Facts checked on 2026-10-12: `@tanstack/form-core` 1.33.5 reads Standard Schema validators natively (it inlines the specification's types), and `@hookform/resolvers` has exported a `standardSchemaResolver` since 4.0.0. Every schema of `@yaltaan/schema` implements Standard Schema, and every rule of `@yaltaan/rules` can be used as a Standard Schema refinement.

## Options

1. **Do nothing: no React package.** Schemas and rules already work inside TanStack Form and react-hook-form through Standard Schema; but the reactive nodes of `@yaltaan/core` and `@yaltaan/form` would have no React binding.
2. **Own hooks only.** A bridge over `useSyncExternalStore` (the exact contract of the reactive node), plus `useField(form, path, selector?)` to limit re-renders; no context provider required.
3. **Own hooks and a TanStack Form adapter.** Saves glue code only if Standard Schema leaves some: rules exposed with their declared dependencies (targeted revalidation), issues with stable-key paths. Another package to maintain against another library's release cycle.

## Measurements

Not measured yet: the glue code a TanStack Form user writes around `@yaltaan/rules` can only be counted on a real form, which the vertical slice provides.

## Decision

Recommended: option 2. A TanStack Form adapter is reopened only if the vertical slice measures repeated glue code that Standard Schema does not remove.

## Consequences

- `@yaltaan/react` has `react` as its only peer dependency and no state of its own.
- TanStack Form and react-hook-form users rely on Standard Schema, documented with an example for each.

## Review condition

The vertical slice (or a second pilot under React) measuring glue code that an adapter would remove; a change in TanStack Form's validator interface.
