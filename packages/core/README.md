# @yaltaan/core

The shared contracts and data primitives of Yaltaan. The other packages build on them, and they depend on nothing.

**Empty today**: the package holds no code yet, is private and is not published.

It will hold one sub-path per domain, each imported on its own (`@yaltaan/core/result`), so that an application ships only what it imports:

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

## License

MIT, see [LICENSE](../../LICENSE).
