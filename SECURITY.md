# Security policy

Pien is a library: it runs inside the applications that import it, in browsers and on servers, and several of its functions are designed to read strings that may come from untrusted sources, such as paths in text form, numbers, dates in declared formats and any value checked by a schema. A flaw in it can therefore reach those applications. This page says what counts as a vulnerability and how to report one privately.

## Threat surface

- **Prototype pollution**: a key such as `__proto__`, `constructor` or `prototype`, in a path or an object, that reaches a prototype on write.
- **Catastrophic regular expressions**: a pattern whose backtracking makes a short input take unbounded time.
- **Unbounded resource use**: a depth, a number of keys or elements, a string length, a cache size or a recursion that no default limit bounds.
- **Supply chain**: a published package that carries code absent from this repository. The packages have no runtime dependency; development dependencies are pinned, come from the npm registry only and never run install scripts; releases are to be published from CI with npm provenance and no long-lived token.

## Reporting a vulnerability

Please do not open a public issue, pull request or discussion for a vulnerability.

The repository is not public yet. Once it is, report through GitHub's private vulnerability reporting (the "Report a vulnerability" button in the repository's Security tab): only the maintainers see the report, and the discussion and the fix stay private until disclosure. A contact address will be added here before the first release, for reporters who cannot use GitHub.

A useful report gives:

- the package and its version, or the commit;
- the smallest input and calling code that trigger the problem;
- what happened and what you expected (time taken, memory used, the property written to a prototype);
- the runtime and its version (browser, Node.js, Deno or Bun).

## What happens next

- The report is acknowledged within 7 days.
- Once the vulnerability is confirmed, the fix is prepared privately, with a test that fails without it, and a GitHub security advisory is published with the release that carries the fix, listed under **Security** in [CHANGELOG.md](CHANGELOG.md).
- Coordinated disclosure: the advisory is published within 90 days of the report, sooner when the fix is ready, later only if you agree. Please keep the details private until then.
- The reporter is credited in the advisory unless they prefer not to be.

## Scope

In scope, for example:

- prototype pollution through any function of the library, whatever the input;
- an input that makes a function take unbounded time or memory, a catastrophic regular expression included, or that goes past a documented default limit without an error;
- an exception or a stack overflow on untrusted input where the documented contract returns a `Result`;
- code run from data: any path to `eval`, `new Function` or an equivalent;
- a network call, a file access or telemetry made by the library;
- a published package whose content differs from the tagged source, or a development dependency that can alter what is published.

Out of scope:

- vulnerabilities in an application's own code, its framework or the Temporal polyfill it installs, with no demonstrated path through Pien: please report them upstream;
- resource use beyond a limit that the caller explicitly raised or removed;
- bugs without a security impact, such as a wrong result on trusted input: please open a normal issue.

## Supported versions

No version has been released yet. Until 1.0, fixes land on `main` and ship in the next release.
