# @yaltaan/form

Form state on reactive nodes: describe fields and groups, and every value and state is a node you can read and watch, computed when read and again only once what it reads has changed. A field holds its raw value, what its input shows; a schema, any Standard Schema, reads it into the parsed value, and each of its issues lands on the field its path names. `dirty`, `touched`, `pending`, `submitted` and `disabled` are derived from values, never set by hand.

**Not published yet**: the package is private until its first release. Every export is `@experimental`, and the package itself exists only if the vertical slice shows its value over Angular Signal Forms and TanStack Form (a go/no-go decision).

```ts
import { createForm, field, group } from '@yaltaan/form';
import { object, string } from '@yaltaan/schema';

const form = createForm(
  group(
    { email: field(''), password: field('') },
    { schema: object({ email: string({ minLength: 3 }), password: string({ minLength: 8 }) }) },
  ),
);

form.children.email.set('ada@example.org');
form.children.password.issues.get(); // → [{ code: 'schema.too_short', path: ['password'], params: { length: 0, minimum: 8 } }]
form.dirty.get(); // → true
form.children.password.set('analytical');
form.submit(); // → { ok: true, value: { email: 'ada@example.org', password: 'analytical' } }
```

- [Guide](../../docs/guide/en/form.md), with the states, asynchronous schemas and a recipe to show errors accessibly.
- [Reference](../../docs/reference/form.md) and [issue codes](../../docs/issue-codes/form.md).
- [Why it is built this way](../../docs/adr/0043-form-package.md).

Zero third-party runtime dependencies: `@yaltaan/core`, `@yaltaan/schema`, and the types of `@yaltaan/rules`. ESM only, `"sideEffects": false`.
