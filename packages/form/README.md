# @yaltaan/form

Form state on reactive nodes: describe fields, groups and arrays, and every value and state is a node you can read and watch, computed when read and again only once what it reads has changed. A field holds its raw value, what its input shows; a schema, any Standard Schema, reads it into the parsed value, and each of its issues lands on the field its path names. An item of an array keeps a key for as long as it lives, so that its states and its issues follow it when it moves. Rules across fields, those of `@yaltaan/rules`, go in `rules`: each is checked again only once a value it reads changes, its issues keep their code, and `required` says which fields they require. A check only your server can make goes in `validate`: it runs once the schemas and the rules accept the value, with a signal that aborts when its answer can no longer count. A node `disabled` or `hidden` by a condition on other fields is left out of what the form submits, and neither its schema, its validator nor its rules are asked; a `readonly` one is submitted, checked, and shows `dirty`; a group marked `optional` is absent while nothing is entered in it, so that a rule finds it blank. `dirty`, `pending`, `disabled`, `hidden`, `readonly` and `required` are derived from values, never set by hand; `touched` and `submitted` record what the user did.

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

- [Guide](../../docs/guide/en/form.md), with the states, nodes disabled, hidden or read only, lists whose rows move, asynchronous schemas, rules across fields, checks only your server can make and a recipe to show errors accessibly.
- [Reference](../../docs/reference/form.md) and [issue codes](../../docs/issue-codes/form.md).
- Why it is built this way: [fields and groups](../../docs/adr/0043-form-package.md), [arrays](../../docs/adr/0044-form-arrays.md), [checks of the application](../../docs/adr/0045-form-validators.md), [rules](../../docs/adr/0046-rules-in-the-form.md), [what the form submits](../../docs/adr/0047-what-the-form-submits.md).

Zero third-party runtime dependencies: `@yaltaan/core`, `@yaltaan/schema`, and the types of `@yaltaan/rules`. ESM only, `"sideEffects": false`.
