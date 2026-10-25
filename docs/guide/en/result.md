# Results: failing without exceptions

`import { err, mapResult, ok, unwrapOr, type Result } from '@yaltaan/core/result';`

## The problem

A function that reads user input fails often, and normally: an empty field, a word where a number was expected. Throwing an exception for that hides the failure from the type system (nothing tells the caller to handle it) and costs a stack trace each time. Returning `null` hides why it failed.

## What you write

A function that can fail returns a `Result`: either `{ ok: true, value }` or `{ ok: false, error }`. The type says both cases exist, and the compiler makes the caller look at `ok` before reaching the value.

```ts
import { err, ok, type Result } from '@yaltaan/core/result';

function parseQuantity(text: string): Result<number, 'not_a_whole_number'> {
  const quantity = Number(text);
  return text !== '' && Number.isSafeInteger(quantity) ? ok(quantity) : err('not_a_whole_number');
}

parseQuantity('12'); // → { ok: true, value: 12 }
parseQuantity('twelve'); // → { ok: false, error: 'not_a_whole_number' }
```

## Reading a result

Test `ok`: in each branch, TypeScript knows which side you hold.

```ts
import { err, ok, type Result } from '@yaltaan/core/result';

function describe(result: Result<number, string>): string {
  return result.ok ? `quantity ${result.value}` : `refused: ${result.error}`;
}

describe(ok(3)); // → 'quantity 3'
describe(err('empty')); // → 'refused: empty'
```

## Transforming and falling back

`mapResult` changes the value of a success and lets a failure through untouched; `unwrapOr` gives the value or a fallback.

```ts
import { err, mapResult, ok, unwrapOr } from '@yaltaan/core/result';

mapResult(ok(12), (quantity) => quantity * 2); // → { ok: true, value: 24 }
mapResult(err('empty'), (quantity: number) => quantity * 2); // → { ok: false, error: 'empty' }
unwrapOr(err('empty'), 1); // → 1
```

## Good to know

- A result is a plain object: it serializes to JSON, crosses a `postMessage`, and compares with `deepEqual` in tests.
- There are no methods (`result.map(...)`): a bundler can drop a function you never import, never a method. That keeps the import to about 120 bytes.
- The objects are read-only by their type, not frozen: freezing would cost time on every call.
- In the rest of Yaltaan, the error side of a result is an [`Issue`](issue.md).
