# @yaltaan/rules

Rules across fields, declared as data and pure: required if, all or none, at least n, exactly n, mutually exclusive, unique in a list, ordered. Each says what it reads and where it marks, a required field is derived and never written, and `refine` puts them behind any Standard Schema, so that Angular Signal Forms, TanStack Form and any other engine that reads the interface takes them with no bridge.

**Not published yet**: the package is private until its first release. Every export is `@experimental`: it may change in a minor version until the contracts are frozen.

```ts
import { allOrNone, atLeast, checkRules, each, ordered, requiredIf, requiredPaths } from '@yaltaan/rules';

const rules = [
  requiredIf({ reads: [['country']], when: (country) => country === 'FR' }, [['siren']]),
  allOrNone([['contract'], ['signedOn']]),
  ordered(['from'], ['to']),
  atLeast(1, { list: ['contacts'], at: ['billing'], where: (billing) => billing === true }),
  each(['contacts'], [requiredIf({ reads: [['billing']], when: (billing) => billing === true }, [['email']])]),
];

const values = { country: 'FR', contract: 'C-1', from: 2, to: 1, contacts: [{ billing: true }] };

checkRules(rules, values); // → [{ code: 'rules.required_if', path: ['siren'] }, { code: 'rules.all_or_none', path: ['signedOn'] }, { code: 'rules.ordered', path: ['to'] }, { code: 'rules.required_if', path: ['contacts', 0, 'email'] }]
requiredPaths(rules, values); // → [['siren'], ['signedOn'], ['contacts', 0, 'email']]
```

- [Guide](../../docs/guide/en/rules.md), with lists, rules of your own and the bridge to an engine.
- [Reference](../../docs/reference/rules.md) and [issue codes](../../docs/issue-codes/rules.md).
- [Why it is built this way](../../docs/adr/0034-rules-package.md).

Zero third-party runtime dependencies: `@yaltaan/core`, and the types of `@yaltaan/schema`. ESM only, `"sideEffects": false`.
