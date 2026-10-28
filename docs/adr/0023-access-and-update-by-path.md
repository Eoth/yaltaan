# ADR 0023 — Reading and writing a value by `Path`

- Date: 2026-10-28
- Status: accepted (design choices delegated by the owner, reported for review)

## Context

ARCHITECTURE.md §7.1 lists `get`, `set`, `has`, `remove` by `Path` and a localized `update` with structural sharing, and settles two rules: a write on a missing path is a `Result` error unless creation is asked for (`createMissing: 'object' | 'array-if-numeric'`), and an `InPlace` variant, if any, throws a `TypeError` on a frozen object. §5.3 refuses `__proto__`, `constructor` and `prototype` on writes (`checkWritablePath`, T1.3). The rest is open: what a missing path is for each function, how a number segment meets a record, what removing an array element does, what a `{ key }` segment designates, what the copy along the path keeps, and what the result is typed as.

The nearest implementations are lodash's, reproduced by es-toolkit's `compat` entry (`get`, `set`, `has`, `unset`, `update`), which becomes the judge of these functions (ADR 0022). They read a number and its string alike, create holes when an index lies past the end, mutate their input, and answer `undefined` for a missing path and for a field that holds `undefined` alike.

## Options

1. **Native, or do nothing.** Optional chaining reads (`a?.b?.[0]`), but only along a path written in the code; a path that is data (a server error, a form field) has no native reader, and a copy with one field changed is a spread per level, written by hand.
2. **lodash's semantics**, as es-toolkit's `compat` entry has them. Familiar; but a missing path and an `undefined` field cannot be told apart, holes appear in arrays, a string segment reads an array's `length`, and the input is mutated.
3. **Strict segments, `Result` for every missing path, copies along the path only.** Kept, with the rules below.

## Measurements

Behaviour of es-toolkit 1.52.0 `compat` on 2026-10-28 (Node 24.21.0): `get({ a: [{ b: 1 }] }, ['a', 0, 'b'])` → `1`; `set({}, ['a', 0, 'b'], 1)` → `{ a: [{ b: 1 }] }`, input mutated; `has({ a: { b: undefined } }, ['a', 'b'])` → `true`; `update({ a: 1 }, ['a'], (x) => x + 1)` → `{ a: 2 }`, input mutated. The differences that remain are measured by the judge and listed in the module (ADR 0022). Size: see the commit of the functions.

## Decision

- **Segments are strict.** A string or symbol segment names an own enumerable property of a record; a number segment an index of a plain array; a `{ key }` segment the element of a plain array whose `keyOf(element)` equals `key` by SameValueZero, `keyOf` being an option (a `{ key }` segment without it is a `TypeError`: the caller knows whether its paths hold one). A number on a record, a string on an array, or any segment on another value (a `Map`, a `Date`, a class instance, a primitive) designates nothing: `path.not_traversable`, with the index of the segment.
- **`get` and `has`**: `get` returns `ok(value)` or `err(path.missing | path.not_traversable)`, so that a field holding `undefined` and a missing one differ; `has` is `get(…).ok`.
- **Writes** (`set`, `update`, `remove`) first pass `checkWritablePath` (`path.forbidden_segment`), copy each record and array along the path, and share everything else. A record copied keeps its prototype (`null` or `Object.prototype`) and every own enumerable key, symbols included: a write changes the path, nothing else. An array copied keeps its holes.
- **What is missing.** `set` may add the last segment: a new field, or the index equal to the length of the array (an append). Any other absent segment is `path.missing`, unless `createMissing` is given: `'object'` creates records, `'array-if-numeric'` an array where the next segment is a number. No write ever creates a hole: an index past the length is `path.missing`, even with `createMissing`. `update` needs the value it updates: an absent last segment is `path.missing` unless `createMissing`, and then `update` receives `undefined`. `remove` of an absent segment is `path.missing`.
- **Removing an array element** splices it: the elements after it move down one index, the length drops by one. A hole would be read as a missing element by `equal` and as `null` by JSON.
- **No copy for no change.** When the new value is the current one (`Object.is`), `set` and `update` return the input itself: `update(x, p, (v) => v) === x`.
- **Types.** `get` gives `unknown`; `set`, `update` and `remove` give the type of their input, which the caller vouches for: typed paths (`Path<T>`, `PathValue<T, P>`, ARCHITECTURE.md §5.3) are a later ticket. Paths are read whole: no text form here (`parsePath` is the boundary).
- **No `InPlace` variant**: no benchmark asks for one.
- New codes `path.missing` and `path.not_traversable`, with `index`, the segment where the walk stopped; the issue's `path` is the path given.

## Consequences

- An application tells a missing field from an `undefined` one, and a wrong path from an absent value, by the code.
- A write on frozen data works: nothing is ever mutated.
- Unlike lodash, `["0"]` on an array and `[0]` on a record designate nothing; a path read by `parsePath` has one form per segment, so this only bites a path built by hand.

## Review condition

Typed paths delivered (the result types change); a benchmark that shows an application paying for the copies along long paths (an `InPlace` variant); a form adapter that needs a `{ key }` resolver of another shape.
