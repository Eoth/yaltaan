# Schemas: reading what comes from outside

`import { array, discriminatedUnion, literal, nullable, number, object, optional, parse, string, withMessages } from '@yaltaan/schema';`

## The problem

A form, a request body or a stored file holds what it holds, whatever the types say. Checking it by hand takes a test per field, stops at the first error or forgets one, and leaves the compiler believing a cast. A schema says once what the data must be: it checks it, gives the type, and reports every problem with a code and a path.

## What you write

Build a schema with functions, and read with `parse`: a `Result` of the output, or of every issue found.

```ts
import { number, object, optional, parse, string, type InferOutput } from '@yaltaan/schema';

const signUp = object({
  email: string({ pattern: /^[^@\s]+@[^@\s]+$/, maxLength: 254 }),
  password: string({ minLength: 8 }),
  age: optional(number({ min: 18, integer: true })),
});

type SignUp = InferOutput<typeof signUp>;

const valid: SignUp = { email: 'ada@example.com', password: 'analytical' };

parse(signUp, valid); // → { ok: true, value: valid }
parse(signUp, { email: 'ada', age: 17.5 }); // → { ok: false, error: [{ code: 'schema.invalid_format', path: ['email'], params: { pattern: '^[^@\\s]+@[^@\\s]+$' } }, { code: 'schema.missing', path: ['password'] }, { code: 'schema.too_small', path: ['age'], params: { minimum: 18 } }, { code: 'schema.not_integer', path: ['age'] }] }
```

`parse` never changes its input and never throws for bad data. The output is a new object that holds what was checked. A read keeps at most 1,000 issues: it then adds `schema.too_many_issues` and stops, so that a body built to fail costs little. An array over `maxLength`, 1,000,000 unless you name another, gets that one issue, and its elements are not read. A schema built with a wrong argument (a bound that is not a number, two options with the same literal) is a bug, and throws a `TypeError` when it is built.

## The bounds

| Schema | Options | Issues |
|---|---|---|
| `string` | `minLength`, `maxLength`, in UTF-16 code units; `pattern` | `schema.too_short`, `schema.too_long`, `schema.invalid_format` |
| `number` | `min`, `max`, both included; `integer` | `schema.too_small`, `schema.too_large`, `schema.not_integer` |
| `array` | `minLength`, `maxLength`, in elements | `schema.too_small`, `schema.too_large` |

`number` takes finite numbers only: `NaN` and the infinities are `schema.invalid_type`. A `pattern` requires `maxLength`, and is not tested on a text over it, so that it only meets a bounded text; a pattern with nested repetitions can still take exponential time, and stays yours to avoid. Use `graphemeLength` of [`@yaltaan/core/string`](string.md) to count what a reader sees.

## Absent, `undefined` and `null`

These are three states, and a field says which it takes:

| Field | Key absent | `undefined` | `null` |
|---|---|---|---|
| `string()` | `schema.missing` | `schema.invalid_type` | `schema.invalid_type` |
| `optional(string())` | valid | valid | `schema.invalid_type` |
| `optional(string(), { exactOptional: true })` | valid | `schema.invalid_type` | `schema.invalid_type` |
| `nullable(string())` | `schema.missing` | `schema.invalid_type` | valid |
| `optional(nullable(string()))` | valid | valid | valid |
| `nullable(optional(string()))` | `schema.missing` | valid | valid |

The output keeps the state: a key that was absent stays absent, and an explicit `undefined` stays there. The types say the same under `exactOptionalPropertyTypes`.

```ts
import { object, optional, parse, string } from '@yaltaan/schema';

const profile = object({ nick: optional(string()) });

parse(profile, {}); // → { ok: true, value: {} }
parse(profile, { nick: undefined }); // → { ok: true, value: { nick: undefined } }
parse(profile, { nick: null }); // → { ok: false, error: [{ code: 'schema.invalid_type', path: ['nick'], params: { expected: 'string' } }] }
```

## Keys the schema does not declare

`strip`, the default, drops them: a field added by a newer server does not break a deployed client. Use `reject` on untrusted input: each one gets its own issue. `passthrough` keeps them unchecked and uncopied, but for the keys `__proto__`, `constructor` and `prototype` of that object: a value it keeps is not walked, so never merge it deeply without checking it.

```ts
import { object, parse, string } from '@yaltaan/schema';

const input: unknown = JSON.parse('{ "name": "Ada", "admin": true, "__proto__": { "polluted": true } }');
const entries = { name: string() };

parse(object(entries), input); // → { ok: true, value: { name: 'Ada' } }
parse(object(entries, { unknownKeys: 'passthrough' }), input); // → { ok: true, value: { name: 'Ada', admin: true } }
parse(object(entries, { unknownKeys: 'reject' }), input); // → { ok: false, error: [{ code: 'schema.unknown_key', path: ['admin'] }, { code: 'schema.unknown_key', path: ['__proto__'] }] }
```

`object` reads the own keys of a plain object only. An array, a `Date`, a `Map`, a class instance or an object of another realm is `schema.invalid_type`, instead of losing its content, and a key inherited from a polluted `Object.prototype` satisfies nothing.

## Several forms of one object

`discriminatedUnion` chooses the option by the literal under a key, so that the issues are those of the form the data says it has.

```ts
import { discriminatedUnion, literal, number, object, parse, string } from '@yaltaan/schema';

const payment = discriminatedUnion('by', [
  object({ by: literal('card'), pan: string({ minLength: 12 }) }),
  object({ by: literal('transfer'), days: number({ max: 60 }) }),
]);

parse(payment, { by: 'transfer', days: 30 }); // → { ok: true, value: { by: 'transfer', days: 30 } }
parse(payment, { by: 'card', pan: '42' }); // → { ok: false, error: [{ code: 'schema.too_short', path: ['pan'], params: { length: 2, minimum: 12 } }] }
parse(payment, { by: 'cash' }); // → { ok: false, error: [{ code: 'schema.invalid_value', path: ['by'], params: { expected: ['card', 'transfer'] } }] }
```

## In a form engine

Every schema implements Standard Schema version 1: pass it to `validateStandardSchema` of Angular Signal Forms, or to the validators of TanStack Form, as it is. The library writes no message: an engine reads the code as the message until you give it words, with your [formatter](issue.md), on the one schema it reads.

```ts
import { number, object, withMessages } from '@yaltaan/schema';

const order = object({ quantity: number({ min: 1 }) });
const worded = withMessages(order, (issue) => (issue.code === 'schema.too_small' ? 'Order at least one.' : 'Invalid.'));

order['~standard'].validate({ quantity: 0 }); // → { issues: [{ message: 'schema.too_small', path: ['quantity'] }] }
worded['~standard'].validate({ quantity: 0 }); // → { issues: [{ message: 'Order at least one.', path: ['quantity'] }] }
```

## What it does not do yet

Refinements, transformations, `record`, `tuple`, `union`, recursion and options for the limits come in later versions; a read takes time linear in the input it walks. The [roadmap](../../../ROADMAP.md) has their tickets.
