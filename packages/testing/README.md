# @yaltaan/testing

Test support shared by the Yaltaan packages. **Never published**: it is an internal package of the workspace ([ARCHITECTURE.md §6](../../ARCHITECTURE.md)), imported by test files only, and no package depends on it.

It holds:

- `adversarial`, the shared adversarial catalogue of [ARCHITECTURE.md §10.1](../../ARCHITECTURE.md): one generator per category (`boundary`, `structures`, `hostile`, `unicode`, `callbacks`, `async`), each with named cases and random values beyond them;
- `declareAdversarial`, which ties a public export to the catalogue and which the verification gate reads back from the test run;
- `fc`, fast-check itself, for property tests and for race tests with `fc.scheduler()` ([ADR 0013](../../docs/adr/0013-adversarial-catalogue-on-fast-check.md)).

## Declaring an export

Every public export that runs (a function, a constant that can be called, a class) declares each of the six categories in its test file, once:

```ts
import assert from 'node:assert/strict';

import { declareAdversarial, HostileError } from '@yaltaan/testing';

// Stands for the export under test: the number of own enumerable keys of an object.
function countKeys(target: object): number {
  return Object.keys(target).length;
}

declareAdversarial('@yaltaan/core/object', 'countKeys', {
  boundary: { na: 'countKeys takes an object, and its type refuses a primitive' },
  structures: (value) => {
    assert.equal(countKeys(value), Object.keys(value).length);
  },
  hostile: (value) => {
    try {
      assert.ok(countKeys(value) >= 0);
    } catch (error) {
      // A hostile object may refuse to list its keys; only its own error may come out.
      assert.ok(error instanceof HostileError || error instanceof TypeError, String(error));
    }
  },
  unicode: { na: 'countKeys takes no string' },
  callbacks: { na: 'countKeys takes no callback' },
  async: { na: 'countKeys is synchronous' },
});
```

- A **check** receives one value of the category. It runs against every named case, each built fresh, then against 100 random values (`{ numRuns }` changes the number), from a seed derived from the export's name: a failure replays identically.
- `{ na: reason }`: the category does not concern the export.
- `{ deferred: reason }`: it does, and its tests wait. Allowed while the export is `@experimental`; the gate refuses it once the export is `@stable`.
- The example above runs as a test of this package, so it stays true.
- An interface, a type alias or a constant that cannot be called declares nothing.

The gate fails on an export that runs without a declaration, a declaration that names no export, a check that failed or did not run, and a `@stable` export that defers a category.

## Property tests

For a domain's own properties, `adversarial.<category>.arbitrary` draws a named case or a random value, boxed with its label: fast-check cannot inspect a revoked Proxy, and a counterexample then prints as `hostile: revoked Proxy`.

```ts
import { adversarial, fc } from '@yaltaan/testing';

fc.assert(fc.property(adversarial.unicode.arbitrary, ({ value }) => value.length >= 0));
```

## The reporter

`npm test` runs `node:test` with the reporter of this package (`@yaltaan/testing/reporter`): Node's `spec` report and, when the gate sets `YALTAAN_ADVERSARIAL_RECORDS=1`, one record line per adversarial category test that finished. `scripts/check-adversarial.ts` reads those lines.
