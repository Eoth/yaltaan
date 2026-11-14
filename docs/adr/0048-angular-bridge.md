# ADR 0048 — An Angular bridge, and Angular installed to build and test it

- Date: 2026-11-14
- Status: proposed — recommendation, awaiting the owner on the development dependency; the shape of the bridge decided by delegation of the owner (design choices), built only where undoing it stays cheap until the answer

## Context

Angular is the priority target (ARCHITECTURE.md §7.12): the rules of `@yaltaan/rules` exposed as validators of Angular Signal Forms, the nodes of `@yaltaan/form` as signals, no state of the bridge's own, Angular 22 and later (ADR 0006). The ticket is accepted once the pilot runs in a real Angular application, under component tests, within the size budget of the adapter (`yaltaan/angular-adapter`, 1,500 B brotli, a hypothesis).

Facts read on 2026-11-14 in the declarations of `@angular/forms` 22.2.4:

- `@angular/forms/signals` exports `form`, `validate`, `validateTree`, `validateAsync`, `validateStandardSchema`, `required`, `disabled`, `hidden`, `readonly`, `apply`, `applyEach`, `applyWhen` and `submit`, among others. The state of each field holds signals: `value`, `errors`, `valid`, `invalid`, `pending`, `dirty`, `touched`, `required`, `disabled`, `hidden` and `readonly`.
- Without a bridge, an application already reads a schema of `@yaltaan/schema` through `validateStandardSchema`, and rules through `refine` of `@yaltaan/rules` (`tests/interop/angular.mjs`, since T2.2 and T2.3). What it writes by hand is what a rule says field by field: `form-rules.mjs` writes one Angular validator per rule, which reads its other fields through `valueOf`, and one `required(…, { when })` per field a rule may require.
- The recipe `fromNode` of the reactive guide turns a node of the graph into an Angular signal (`tests/interop/reactive-angular.mjs`).
- The form shows `disabled`, `hidden` and `readonly` as they are, and `dirty` on a read-only field where Angular hides it (ADR 0047, `tests/interop/form-conditions.mjs`): a bridge that copied Angular's states would change what the form means.
- Nothing in the workspace installs Angular. `tests/interop/run.sh` installs it into a temporary project, outside the gate. A package that imports `@angular/core` cannot be compiled by the gate without it, nor its component tests run.

## Options

1. **Native: no bridge.** The application keeps `validateStandardSchema`, `refine` and the recipe, and writes its `required` and the placement of each rule by hand, field by field, as `form-rules.mjs` does; the pilot is never run in Angular. Costs the glue each application repeats, and leaves the ticket's criterion unmet.
2. **A bridge, with Angular installed as a development dependency of the workspace**, the bridge compiled against Angular's own declarations and its component tests in the gate. Costs the installation measured below.
3. **A bridge compiled against declarations of our own** of the few Angular types it uses, tested only outside the gate, by `tests/interop/`. Costs a copy of Angular's types that drifts silently from Angular's, and a gate that judges nothing of the bridge: a rule the gate does not check is not applied.
4. **A bridge in a repository of its own.** Rejected: it moves with the contracts of `@yaltaan/form` until they freeze (T2.7), and the graph of ARCHITECTURE.md §6 places it in this workspace.

## Measurements

On 2026-11-14, Ubuntu 26.04 x64, npm 11.19.0, each set installed into an empty project with `--ignore-scripts` and exact versions:

- **Angular**, to compile the bridge and run it under Node without a DOM (`@angular/common`, `@angular/compiler`, `@angular/core`, `@angular/forms` and `@angular/platform-browser` 22.2.4, `rxjs` 7.8.2): 9 packages, `tslib`, `zod` and `@standard-schema/spec` brought by `@angular/forms`; 58 MB; MIT 7, Apache-2.0 1 (`rxjs`), 0BSD 1 (`tslib`); no install script.
- **Angular and jsdom 30.1.3**, the DOM in which `tests/interop/` already runs Angular's `TestBed`, to render components: 45 packages, 84 MB; two of them under MIT-0 (`@csstools/color-helpers`, `@csstools/css-syntax-patches-for-csstree`), MIT without its attribution clause, a licence outside the list of CONTRIBUTING.md; no install script.
- **Angular and happy-dom 21.0.4** instead of jsdom: 18 packages, 81 MB (a second `@types/node` among them), licences within the list; not tried under `TestBed`.
- **The workspace today**: 47 third-party entries in the lockfile, `node_modules` 109 MB without its caches. Angular adds 9 entries and 58 MB (about half again), with jsdom 45 entries and 84 MB.
- The bridge itself: not written, not measured.

## Decision

Recommended: option 2, with jsdom, and MIT-0 added to the list of licences.

- **Development dependencies**, exact versions, recorded at the root as the other tools are: the six packages above and jsdom; the lockfile check admits MIT-0.
- **`@yaltaan/angular`**: depends on `@yaltaan/core`, `@yaltaan/rules` and `@yaltaan/form`; `@angular/core` and `@angular/forms` are peer dependencies, `^22.0.0`, a later major added once tested (ADR 0006).
- **API**, decided by delegation, `@experimental` until the contracts freeze (T2.7):
  - `fromNode(node, options?)`: a `Signal` that follows a node of the graph, created in an injection context or given an `injector`, subscribed until that injector is destroyed, throwing what the node throws: the recipe of the reactive guide, made a function.
  - `signalsOf(node)`: for a node of `@yaltaan/form`, each of its states as a signal made by `fromNode` on its first read (`raw`, `parsed`, `issues`, `required`, `dirty`, `touched`, `pending`, `submitted`, `disabled`, `hidden`, `readonly`), shown as the form gives them, `dirty` on a read-only node included; a group's children and an array's items reached the same way. Nothing is stored but the signals.
  - `validateRules(path, rules)`: inside the schema function of Signal Forms' `form`, checks the rules on the value at `path` through `validateTree`, each issue an error whose kind is its code, placed on the field its path names, and marks required through `required(…, { when })` the fields that `required` of a rule names.
  - Not in the bridge: markup or a directive (adapters impose no markup), Reactive Typed Forms (ADR 0006: when a pilot needs it).
- **Tests**: the bridge under Node in the gate, an injector without a DOM; the pilot rendered by components in jsdom under `TestBed`, in the gate; `tests/interop/` keeps comparing with Angular's own behaviour.
- **Until the answer**: the bridge may be written and run outside the gate, as `tests/interop/` runs the other scripts; nothing that needs Angular installed enters the gate or the build.

## Consequences

- The workspace installs about half as much again, or nearly twice as much with jsdom; `npm ci` in the CI takes longer, and the audit reads more packages.
- Every component test runs in jsdom, which is not a browser: layout and focus are not judged there; the pilot's display is judged on what the components render.
- If the answer is no: option 3 or 1. The bridge then stays outside the gate, written against declarations of our own, or is replaced by recipes in the guide; T2.5's criterion is rewritten by an ADR.

## Review condition

Angular's tooling moving to TypeScript 7; Signal Forms changing the signatures the bridge uses in a major; happy-dom proven under `TestBed` with fewer packages than jsdom; a pilot that needs Reactive Typed Forms.
