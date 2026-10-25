# Issues: one error shape for everything

`import { fromStandardIssue, toStandardIssue, type Issue, type IssueFormatter } from '@yaltaan/core/issue';`

## The problem

A parser returns one error format, a validation library another, the server a third, and the application writes glue code to show them all next to the right field, in the right language. Each library also ships its own messages, in English, which you then translate or override.

## The shape

Every failure of Yaltaan is an `Issue`:

| Field | Holds | Example |
|---|---|---|
| `code` | A stable code, `<namespace>.<name>`: what to match on to choose a message. | `'path.syntax'` |
| `path` | Where the issue is, as a [`Path`](path.md); empty for the whole value. | `['lines', 2, 'quantity']` |
| `params` | The data a message is built from. | `{ index: 6 }` |
| `severity` | `'error'` (when absent) blocks; `'warning'` is shown without blocking. | `'warning'` |
| `cause` | What caused it, for whoever needs more than the code. | the server's answer |

```ts
import type { Issue } from '@yaltaan/core/issue';
import { parsePath } from '@yaltaan/core/path';

const read = parsePath('lines[2]quantity');
const issue: Issue | undefined = read.ok ? undefined : read.error;
issue?.code; // → 'path.syntax'
issue?.params; // → { index: 8 }
```

Codes are a public contract: a code is never renamed, and removed only in a major version. Each package lists its codes in a registry, checked on every change: [`@yaltaan/core`](../../issue-codes/core.md).

## Your messages, in your languages: the formatter

Yaltaan writes no message. You write a function `(issue) => string` once, per language, and every error of every layer goes through it.

```ts
import type { IssueFormatter } from '@yaltaan/core/issue';

type Params = Readonly<Record<string, unknown>>;
const messages = new Map<string, (params: Params) => string>([
  ['path.syntax', (params) => `Unreadable path at character ${String(params['index'])}.`],
  ['schema.too_small', (params) => `At least ${String(params['minimum'])}.`],
]);
const format: IssueFormatter = (issue) => messages.get(issue.code)?.(issue.params ?? {}) ?? 'Invalid value.';

format({ code: 'schema.too_small', path: ['quantity'], params: { minimum: 1 } }); // → 'At least 1.'
format({ code: 'shop.out_of_stock', path: [] }); // → 'Invalid value.'
```

A `Map` (or `Object.hasOwn`) matters: with a plain object, the code `toString` would find the function every object inherits. A complete English formatter to copy is in [`examples/recipes/format-issue-en.ts`](../../../examples/recipes/format-issue-en.ts); its test fails as soon as a registry lists a code it has no message for.

## To a form engine: `toStandardIssue`

Angular Signal Forms, TanStack Form and react-hook-form read errors in the Standard Schema format: a message and a path of property names. `toStandardIssue` builds it with your formatter.

```ts
import { toStandardIssue, type Issue, type ToStandardIssueOptions } from '@yaltaan/core/issue';

const lines = [{ id: 'a7' }, { id: 'b2' }];
const options: ToStandardIssueOptions = {
  format: (issue) => issue.code,
  resolveKey: (segment) => lines.findIndex((line) => line.id === segment.key),
};
const issue: Issue = { code: 'schema.too_small', path: ['lines', { key: 'b2' }, 'quantity'] };

toStandardIssue(issue, options); // → { message: 'schema.too_small', path: ['lines', 1, 'quantity'] }
toStandardIssue({ code: 'rules.at_least', path: [] }, options); // → { message: 'rules.at_least' }
```

A form engine does not know [`{ key }` segments](path.md#following-a-list-element-when-it-moves--key-): `resolveKey` gives the element's index at the moment of the conversion. When the element is gone (or you pass no `resolveKey`), the path stops before it and the error shows on the list, never on a field that does not exist.

```ts
import { toStandardIssue } from '@yaltaan/core/issue';

const gone = { code: 'schema.too_small', path: ['lines', { key: 'zz' }, 'quantity'] };
toStandardIssue(gone, { format: (issue) => issue.code }); // → { message: 'schema.too_small', path: ['lines'] }
```

## From another validator: `fromStandardIssue`

The issues of zod, valibot, arktype or any Standard Schema validator become Yaltaan issues with the code `issue.external`: their message is kept in `params.message`, the original issue in `cause`.

```ts
import { fromStandardIssue } from '@yaltaan/core/issue';

const issue = fromStandardIssue({ message: 'Too short', path: [{ key: 'name' }] });
issue.code; // → 'issue.external'
issue.path; // → ['name']
issue.params.message; // → 'Too short'
```

Your formatter then shows that message as it is, or replaces it by reading `cause`.

## Good to know

- Converting copies nothing when the path has no `{ key }` segment: the same array is reused.
- `format` must return a string, and `resolveKey` an index, -1 or `undefined`: anything else is a bug in the calling code and throws a `TypeError`.
- About 500 bytes (minified and brotli-compressed) for both conversions; the `Issue` type alone costs nothing.
