# ADR 0020 — Deep equality: what `equal` compares, and how it ends on cycles

- Date: 2026-10-25
- Status: accepted

## Context

ARCHITECTURE.md §7.5 asks for a configurable deep `equal`: SameValueZero or `Object.is`, a listed set of special types (`Map`, `Set`, `Date`, typed arrays, Temporal objects through their `equals`), cycles detected, class instances opaque unless the function declares support for them (§7.1). `diff`, `update` and the form compare with it, so its answers become theirs. The platform has no deep equality outside Node (`util.isDeepStrictEqual`, absent from browsers), and the libraries disagree on most edge cases. Six questions are left open:

1. What a structure that contains itself equals.
2. How `Set` elements and `Map` keys are matched.
3. Whether a hole in an array equals `undefined`, and a null-prototype object an ordinary one.
4. Which keys a plain object is compared by.
5. Which other built-in types are compared by content.
6. How the walk survives 10,000 levels and an aliased graph whose tree is exponential.

## Options

### Cycles

1. **Pair each object with the first one it met (Node, es-toolkit).** A cycle ends when an object comes back, and the answer depends on the partner it got first: `a = { self: a }` differs from `b = { self: { self: b } }`, though no walk can tell them apart.
2. **Bisimulation: two values are equal when walking them in step never finds a difference.** A pair already being compared counts as equal; the walk ends because there are finitely many pairs. The relation is an equivalence (reflexive, symmetric, transitive), and an aliased subtree is compared once instead of once per path that reaches it.

### `Set` elements and `Map` keys

1. **By content (Node; es-toolkit for `Set` only).** Each element without an identical partner is searched for among the other set's elements, in O(n × m), and a failed candidate must undo what it assumed about cycles. `{ a: 1 }` and `{ a: 1 }` are two elements of one `Set` by the platform's own rule, yet would match the same element.
2. **By the collection's own rule, SameValueZero (`has`).** What the platform says membership is; linear; values of a `Map` are still compared deeply.

### Holes and prototypes

1. **A hole equals `undefined` (es-toolkit).** Contradicts the plain-object rule, where `{ a: undefined }` and `{}` differ because their keys differ.
2. **A hole differs from `undefined`, as a missing key differs from an `undefined` one (Node).**
3. **Prototypes must be the same (Node).** An object from `Object.create(null)`, which a safe parser builds, never equals the literal a test writes.
4. **`Object.prototype` and `null` are the same kind, a record; any other prototype must be the same on both sides.**

### Keys of a plain object

1. **Own enumerable keys, symbols included (Node, es-toolkit).**
2. **Own enumerable string keys, symbols opt-in (ARCHITECTURE.md §7.1, every object function of the library).** `diff` and `update` will walk the same keys `equal` compares.

### Other built-in types

1. **Compare `RegExp`, `ArrayBuffer`, `DataView`, `Error`, `URL` and boxed primitives by content now.** Bytes and decisions the ticket does not ask for, each type with its own question (is `lastIndex` part of a regular expression?).
2. **Opaque, compared by identity, until a ticket instructs them.** The support table says so.

### Depth and aliasing

1. **A recursive walk.** The shortest code; 10,000 levels overflow the call stack, and the exception says nothing about the data.
2. **A depth limit that refuses deeper data.** An exception for data the application already holds in memory, which is no bug of the caller.
3. **An explicit stack, and a memory of compared pairs from the 64th object pair on.** Depth costs heap, not call stack; small values allocate no memory table; a cycle is unrolled at most 64 times before the memory ends it; an exponential tree of aliases becomes linear.

## Measurements

Behaviour of the two nearest implementations on 2026-10-25 (es-toolkit 1.52.0 `isEqual`, Node 24.21.0 `util.isDeepStrictEqual`):

| Case | es-toolkit | Node | `equal` |
|---|---|---|---|
| `new Set([{ a: 1 }])` and the same set rebuilt | true | true | false |
| `new Map([[{ k: 1 }, 1]])` and the same map rebuilt | false | true | false |
| `{ a: 1 }` and a null-prototype `{ a: 1 }` | true | false | true |
| `0` and `-0` | true | false | true (false with `SameValue`) |
| `[, 1]` and `[undefined, 1]` | true | false | false |
| `{ [s]: 1 }` and `{ [s]: 2 }` | false | false | true (false with `symbols: true`) |
| `a = { self: a }` and a two-step cycle of the same shape | false | false | true |
| `/a/g` and `/a/g` | true | true | false |

Size, minified and brotli-compressed, the larger of esbuild and Rollup (`node scripts/size-report.ts`): es-toolkit `isEqual` 1 166 B; `equal` and its budget: see the `yaltaan/core-equal` scenario and its commit.

## Decision

- Cycles: option 2, bisimulation.
- `Set` elements and `Map` keys: option 2, SameValueZero, as `has` reads them.
- Holes: option 2. Prototypes: option 4.
- Keys: option 2; `symbols: true` adds own enumerable symbol keys.
- Other built-in types: option 2, opaque; T3.9 instructs them.
- Depth and aliasing: option 3.
- Primitives, numbers in typed arrays and time values of `Date` compare by SameValueZero by default, by SameValue (`Object.is`) with `equality: 'SameValue'`. A Temporal object is compared by its own `equals`, except `Temporal.Duration`, which has none and is compared field by field; both sides must have the same prototype.
- Budget of the `yaltaan/core-equal` scenario: one and a half times the reference, rounded up to ten bytes (ADR 0010), 1 750 B; no hypothesis existed.

## Consequences

- An application that keeps objects in a `Set` and wants them matched by content compares arrays of them instead, or keeps ids in the set.
- A `Map` subclass, an object of another realm (an iframe, `node:vm`) or a polyfilled Temporal object compared with a native one is opaque: identity only.
- Comparing two different cyclic graphs keeps a memory of at most n × m pairs (n and m objects on each side); comparing trees keeps at most one entry per object pair visited after the 64th.

## Review condition

A use in the pilot form or in `diff` that needs `Set` elements matched by content; a library or platform API that settles the semantics of deep equality; a measurement showing that the memory threshold of 64 pairs costs more than it saves.
