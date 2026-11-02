# @yaltaan/schema

Schemas that read unknown data into a `Result` of typed values or of every issue found. Each is built by a function, so that an application ships only what it calls, and each implements [Standard Schema](https://standardschema.dev) version 1: Angular Signal Forms, TanStack Form and any other engine that reads the interface takes it with no bridge.

**Not published yet**: the package is private until its first release. Every export is `@experimental`: it may change in a minor version until the contracts are frozen.

```ts
import { array, object, optional, parse, string, type InferOutput } from '@yaltaan/schema';

const contact = object({
  name: string({ minLength: 1 }),
  email: string({ pattern: /^[^@\s]+@[^@\s]+$/, maxLength: 254 }),
  tags: optional(array(string())),
});

type Contact = InferOutput<typeof contact>;

const read: Contact = { name: 'Ada', email: 'ada@example.com' };

parse(contact, { ...read, unknown: 'dropped' }); // → { ok: true, value: read }
parse(contact, { name: '', email: 'ada' }); // → { ok: false, error: [{ code: 'schema.too_short', path: ['name'], params: { length: 0, minimum: 1 } }, { code: 'schema.invalid_format', path: ['email'], params: { pattern: '^[^@\\s]+@[^@\\s]+$' } }] }
```

- [Guide](../../docs/guide/en/schema.md), with the three states of a field, unknown keys and messages for an engine.
- [Reference](../../docs/reference/schema.md) and [issue codes](../../docs/issue-codes/schema.md).
- [Why it is built this way](../../docs/adr/0032-schema-package.md).

Zero third-party runtime dependencies: `@yaltaan/core` only. ESM only, `"sideEffects": false`.
