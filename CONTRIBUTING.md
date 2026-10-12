# Contributing

These are the engineering rules of this repository: how a change is decided, tested, measured and described before it lands. Vulnerabilities are never reported in a public issue: see [SECURITY.md](SECURITY.md).

**Ask before writing a large change.** Open an issue first for a new function, a new package, a change to a shared contract or anything else that touches the public API, so that the design is agreed before the code: many proposals are settled by the relevance test of the [README](README.md#principles) or by a decision already recorded. Small fixes (a typo, a wrong sentence in the documentation, an obvious bug with its test) can come as a pull request alone.

## Read first

- [ARCHITECTURE.md](ARCHITECTURE.md): the design in force (thesis, non-goals, target platforms, shared contracts, packages and their allowed dependency graph, domains, measurement, quality). It changes only through a decision record.
- [docs/adr/](docs/adr/): the decisions and their reasons. A question settled there is reopened by a new record, not by a pull request.
- [ROADMAP.md](ROADMAP.md) (in French): the tickets in execution order, and the non-goals with their reasons in section 4.

## Setting up

- Node.js 22.18 or later and npm 10.9 or later. Scripts and tests are TypeScript that Node runs directly, with no build step.
- `npm ci`. The repository's `.npmrc` refuses the install scripts of dependencies, records exact versions and never picks a version published less than 7 days ago.
- Once per clone: `git config core.hooksPath githooks`. The pre-commit hook checks what you stage, commit-msg checks the message, pre-push runs the full gate. CI runs the same checks whether or not you enabled them.
- `bash scripts/verify.sh` is the gate. It runs every step even after one fails, then prints `OK` or the list of failed steps. On Windows, run it from Git Bash.

## Definition of done

A change is done when all of these hold, not when its own tests pass:

1. `bash scripts/verify.sh` prints `OK`: the repository guards, formatting, types, tests, build, package manifests and contents, the lockfile's sources, integrity and licences, the dependency audit and the workflows; then, as each harness arrives, import size, type-checking cost, the dependency graph between packages, contract tags, the adversarial catalogue and the platform baseline. A step that cannot run (a tool missing, the registry unreachable) is reported as skipped, never as passed.
2. A bug fixed comes with its regression test in the same commit, seen failing before the fix: remove the fix, watch the test fail, put the fix back.
3. A bug that reveals a gap in the process (a check nobody ran, a gate that could not fail) also gets a mechanical guard, a script, a hook or a CI job, that stops the whole class of error, not only the case found.
4. A decision record, written before the code, in every case listed in [docs/adr/README.md](docs/adr/README.md) (a new package, a new dependency, a change to a shared contract, an exception to a rule, a promotion to `@stable`…).
5. Import size and type-checking cost stay within their budgets, once their harnesses exist. A change to a recorded size is explained in the commit message, by package and sub-path; an unexplained increase blocks the change.
6. A user-visible change has its entry in [CHANGELOG.md](CHANGELOG.md), under `Unreleased`.

A verdict from an in-house checker counts only once a second, independent method agrees: an external tool, a measurement by hand, another runtime. A problem found along the way and outside the change's scope becomes an issue of its own, never a comment left in the code.

## Tests

- Tests use `node:test` and `node:assert/strict`, live in `*.test.ts` files separate from production code, and never ship: each package's `files` field leaves them out.
- `npm test` pins the time zone to UTC before any test runs, and a test that depends on a locale names it. Contributors' machines run in other zones and locales than CI: a test gives the same result on both.
- A runner that reports "0 tests" is not green: read the counts.
- Timers and scheduling are injected (a `clock` option), so that no test waits on real time.
- Levels, as their tooling arrives:
  - unit tests for every public export, nominal and boundary cases;
  - property-based tests for everything with an invariant (parsers, codecs, dates, paths, diff): the invariants written in [ARCHITECTURE.md](ARCHITECTURE.md) are tests, not intentions, and a race found becomes a test replayable from its seed;
  - type tests: the inference expected, and the compilation errors expected with `@ts-expect-error`, their messages read for clarity;
  - bundle checks: import leaks between packages, side effects, size budgets;
  - type-checking cost, measured on a reference project with and without the library, within a budget;
  - benchmarks on hot paths, comparing native code, the best reference library and Yaltaan, with the method published;
  - adapters tested on real components.

## Dependency policy

- Zero runtime dependencies in `core`, `temporal`, `schema`, `rules` and `form`; an adapter has only a peer dependency on its framework.
- Development dependencies are pinned to exact versions, come from the npm registry only (never a git repository or a tarball URL), never run install scripts, and are at least 7 days old when picked: a compromised release is usually caught within days.
- Every package in the lockfile has a licence from the allowlist that the gate checks: permissive licences only, never one of the GPL family.
- `package-lock.json` is committed, and changes only in a commit that says why, with the installed footprint before and after.
- A development dependency that enters the build or the gate needs a decision record: what it does and why the platform or a short script cannot, its measured weight (`npm ls --all`, installed size), its own dependencies, its licence, its maintenance.
- No telemetry, no network call, no install script, no secret in the repository.

## Code style

- [Prettier](https://prettier.io), pinned to an exact version, with `.prettierrc.json`: 2-space indentation, 120 columns, single quotes. `.editorconfig` sets the same for every editor. No line exceeds 120 characters in any file but Markdown, comments and strings included.
- LF line endings and UTF-8 everywhere (`.gitattributes`), never a tab.
- TypeScript: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`; only syntax that types can be erased from (no `enum`, `namespace` or parameter properties); `import type` for types; relative imports with their `.ts` extension; the `node:` prefix for built-in modules. Public functions declare their return types.
- Comments say why the code is the way it is today: an invariant, a pitfall, a specification reference such as "ECMA-262 §7.2.10 SameValueZero". No dates, no ticket numbers, no account of how something was found: history lives in git.
- One source of truth: a list (issue codes, the table of native equivalents, budgets) lives in one file, and everything else derives from it.
- A production file stays within 1 200 lines, and a function aims at 150 lines at most. A split follows responsibilities and is a pure move, never mixed with a change of logic.
- No exception for an expected failure (return a `Result`), no silent `catch`, and every `switch` over a union is exhaustive, checked against `never`.
- Markdown: one line per paragraph or list item, never wrapped by hand; tables unpadded.
- Everything tracked is in English (code, tests, decision records, documents, commit messages), except the roadmap, which is in French.

## Commit messages

- [Conventional Commits](https://www.conventionalcommits.org/), in English, in the imperative: `fix(path): refuse __proto__ as a segment on write`. The subject has at most 100 characters and no final period; the commit-msg hook checks it.
- One commit, one logical change. A change of form only, such as a new formatter version, goes in a commit of its own.
- The body says why: the root cause, the measurements before and after, the trade-offs made. Every figure in it comes from a command run before committing. The commit message is the history: neither the code nor the documentation repeats it.
- A commit has one author, who answers for it: no trailer that credits a co-author or a generator.
- Never `--no-verify`: a failing hook is fixed, not skipped.

## Proposing a decision

A decision is an architecture decision record in `docs/adr/`, written before the code it decides and never rewritten once accepted: [docs/adr/README.md](docs/adr/README.md) says when one is required and gives its format (context, options with "native" or "do nothing" among them, measurements, decision, consequences, review condition).

A request that goes against a principle is answered with the principle it touches, its concrete cost (bytes, CPU, complexity, an ambiguous contract), the alternative, and what would have to be measured to change the answer.

## Licensing

Yaltaan is under the [MIT license](LICENSE). By contributing, you agree that your contribution is licensed under the same terms: inbound equals outbound, and no contributor licence agreement is asked.
