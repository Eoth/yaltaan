# @yaltaan/core

The shared contracts and data primitives of Yaltaan. The other packages build on them, and they depend on nothing.

**Not published yet**: the package is private until its first release. Every export is `@experimental`: it may change in a minor version until the contracts are frozen.

It holds one sub-path per domain, each imported on its own (`@yaltaan/core/result`), so that an application ships only what it imports. Available today: `result`, `issue`, `path` and `equal`. The others are planned:

| Sub-path | Holds |
|---|---|
| `result` | `Result<T, E>`, a read-only object discriminated by `ok`, and free functions over it. |
| `issue` | `Issue`, the one shape of every expected failure: a stable namespaced code, a `Path` and parameters, never a message. |
| `path` | `Path` and its segments, including a key segment that follows an array element when it moves; a text form at the boundaries only. |
| `object` | Picking, omitting and merging properties, and reading and updating by `Path` with structural sharing. |
| `collection` | What arrays and iterators lack natively: grouping by a unique key, top-k, multi-key sorting, chunks and windows. |
| `string` | Length and truncation by grapheme, slugs, detection of invisible and bidirectional control characters. |
| `number` | Strict parsing to a `Result`, named rounding modes, exact conversions between `number` and `bigint`. |
| `equal` | Configurable deep equality. |
| `diff` | Diffs and patches addressed by `Path`. |
| `async` | Timeouts, retries, concurrency limits, debouncing and throttling, each cancellable by an `AbortSignal`, with an injectable clock. |
| `cache` | Bounded caches, whose maximum size is mandatory, and memoization. |
| `reactive` | Reactive nodes: lazy, glitch-free derived values behind the `get` and `subscribe` contract of React's `useSyncExternalStore`. |

Zero runtime dependencies. ESM only, `"sideEffects": false`.

## `result`

An expected failure is a value, not an exception: a function that can fail returns a `Result`, and `ok` tells the two sides apart.

```ts
import { err, mapResult, ok, unwrapOr, type Result } from '@yaltaan/core/result';

const parseAge = (text: string): Result<number, 'not_a_number'> => {
  const age = Number(text);
  return Number.isInteger(age) ? ok(age) : err('not_a_number');
};

mapResult(parseAge('41'), (age) => age + 1); // → { ok: true, value: 42 }
unwrapOr(parseAge('forty'), 0); // → 0
```

## `path`

Inside the library a path is an array of segments: property names, array indexes, symbols, and `{ key }` segments that follow an array element by its id when it moves. Text exists only at the boundaries, to read a field name or a server error and to write one back.

```ts
import { checkWritablePath, formatPath, parsePath } from '@yaltaan/core/path';

parsePath('lines[2]["unit price"]'); // → { ok: true, value: ['lines', 2, 'unit price'] }
formatPath(['lines', 2, 'unit price']); // → { ok: true, value: 'lines[2]["unit price"]' }
checkWritablePath(['__proto__', 'isAdmin']).ok; // → false
```

The text form has one spelling per path: a name where the key is an ASCII identifier, an index in brackets, any other key as a JSON string in brackets (`["a.b"]`, `["3"]`, `["prénom"]`, `[""]`), so that every runtime reads and writes the same text whatever its Unicode version. `parsePath` reads untrusted text: 4,096 code units and 64 segments at most by default, a time linear in the length, and an issue that says where the text breaks the grammar, never a guess. A symbol or a `{ key }` segment has no text form: `formatPath` returns the issue `path.not_textual`. Before writing through a path that came from outside, `checkWritablePath` refuses `__proto__`, `constructor` and `prototype`.

## `issue`

Every expected failure of the library is an `Issue`: a stable code, a `Path` and parameters, never a message. The application formats it, and converts it at the Standard Schema boundary, in both directions.

```ts
import { fromStandardIssue, toStandardIssue } from '@yaltaan/core/issue';

const issue = fromStandardIssue({ message: 'Too short', path: [{ key: 'name' }] });
issue.path; // → ['name']
toStandardIssue(issue, { format: (held) => `${held.code}` }); // → { message: 'issue.external', path: ['name'] }
```

The codes the package produces are listed in its [registry](../../docs/issue-codes/core.md).

## `equal`

Deep equality, by SameValueZero (or `Object.is` with `equality: 'SameValue'`): plain objects by their own enumerable string keys in any order, arrays, `Map`, `Set`, `Date`, typed arrays, and Temporal objects through their `equals`; anything else, class instances included, by identity.

```ts
import { equal } from '@yaltaan/core/equal';

equal({ tags: ['a'], at: new Date(0) }, { at: new Date(0), tags: ['a'] }); // → true
equal(new Set([{ id: 1 }]), new Set([{ id: 1 }])); // → false
```

`Map` keys and `Set` elements are matched as `has` matches them, by SameValueZero. A hole in an array differs from `undefined`, as a missing key differs from one that holds `undefined`. The walk keeps its own stack and the pairs it has met: cycles end, a branch shared by several places is compared once, and depth costs no call stack.

How to use each sub-path, in English and in French: the [guide](../../docs/guide/README.md). The contract of each export is in the [reference](../../docs/reference/core.md).

## License

MIT, see [LICENSE](../../LICENSE).
