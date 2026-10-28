# Reading and writing by path: get, has, set, update, remove

`import { get, has, set, update, remove } from '@yaltaan/core/object';`

## The problem

A path often arrives as data: the field of a server error, the control of a form, a line of an import report. Reading it with `a?.b?.[0]` needs the path written in the code; writing it means one spread per level, by hand. The usual helpers answer `undefined` both for a missing field and for a field that holds `undefined`, change the object they are given, and create holes in arrays when an index lies past the end.

## get and has: read, and know why nothing is there

`get` returns a `Result`: the value, or an issue that says where the walk stopped. A field holding `undefined` is a value; a missing one is not.

```ts
import { get, has } from '@yaltaan/core/object';

const order = { lines: [{ sku: 'A1', qty: 2 }], note: undefined };
get(order, ['lines', 0, 'qty']); // → { ok: true, value: 2 }
get(order, ['note']); // → { ok: true, value: undefined }
get(order, ['lines', 3, 'qty']); // → { ok: false, error: { code: 'path.missing', path: ['lines', 3, 'qty'], params: { index: 1 } } }
get(order, ['lines', 0, 'qty', 'unit']); // → { ok: false, error: { code: 'path.not_traversable', path: ['lines', 0, 'qty', 'unit'], params: { index: 3 } } }
has(order, ['note']); // → true
```

`path.missing` means the container is there but holds nothing at that segment; `path.not_traversable` means the value at that point cannot be walked by it. `index` is the segment where the walk stopped.

## set, update, remove: a copy with one place changed

A write copies the objects and arrays along the path and shares everything else. Nothing is ever changed in place, so frozen data works, and a write that changes nothing gives back the value itself.

```ts
import { remove, set, update } from '@yaltaan/core/object';

const form = { user: { name: 'Ada' }, tags: ['a', 'b', 'c'] };
set(form, ['user', 'name'], 'Grace'); // → { ok: true, value: { user: { name: 'Grace' }, tags: ['a', 'b', 'c'] } }
set(form, ['tags', 3], 'd'); // → { ok: true, value: { user: { name: 'Ada' }, tags: ['a', 'b', 'c', 'd'] } }
update(form, ['tags'], (tags) => (tags as string[]).length); // → { ok: true, value: { user: { name: 'Ada' }, tags: 3 } }
remove(form, ['tags', 1]); // → { ok: true, value: { user: { name: 'Ada' }, tags: ['a', 'c'] } }
```

`set` may add the last segment: a new field, or the index equal to the length of an array (an append). Any other missing segment fails, unless you ask for it to be created: `createMissing: 'object'` creates objects, `'array-if-numeric'` an array where the next segment is a number. No write ever creates a hole: an index past the end fails.

```ts
import { set, update } from '@yaltaan/core/object';

set({}, ['address', 'city'], 'Lyon'); // → { ok: false, error: { code: 'path.missing', path: ['address', 'city'], params: { index: 0 } } }
set({}, ['address', 'city'], 'Lyon', { createMissing: 'object' }); // → { ok: true, value: { address: { city: 'Lyon' } } }
set({}, ['lines', 0, 'qty'], 1, { createMissing: 'array-if-numeric' }); // → { ok: true, value: { lines: [{ qty: 1 }] } }
update({}, ['visits'], (n) => ((n as number | undefined) ?? 0) + 1, { createMissing: 'object' }); // → { ok: true, value: { visits: 1 } }
```

## Elements by identity: the { key } segment

An index changes when a list is sorted or an element is removed. A `{ key }` segment designates the element whose key, read by your `keyOf`, is that key.

```ts
import { get, remove } from '@yaltaan/core/object';

const cart = { lines: [{ id: 'x', qty: 2 }, { id: 'y', qty: 5 }] };
const keyOf = (line: unknown) => (line as { id: string }).id;
get(cart, ['lines', { key: 'y' }, 'qty'], { keyOf }); // → { ok: true, value: 5 }
remove(cart, ['lines', { key: 'x' }], { keyOf }); // → { ok: true, value: { lines: [{ id: 'y', qty: 5 }] } }
```

## What a segment designates

- A string or a symbol names an own enumerable field of a plain object (`Object.create(null)` included): never an inherited one such as `toString`.
- A number is an index of a plain array; `'0'` on an array, or `0` on an object, designates nothing. A path read by `parsePath` has one form per segment, so this only matters for a path built by hand.
- `Map`, `Set`, dates, class instances and primitives are not walked.
- `__proto__`, `constructor` and `prototype` are refused for a write, with the issue `path.forbidden_segment`.
- Removing an array element splices it out: the elements after it move down one index.

The result of `set`, `update` and `remove` has the type of the value given: the compiler does not follow the path, so you vouch that the write keeps its shape.

## Laws they keep

Each holds for any value and path, checked on thousands of generated ones and compared with es-toolkit's lodash-compatible functions:

- `get(set(x, p, v).value, p)` is `v`; every branch the path does not follow is the same object as before.
- `update(x, p, (v) => v)` and `set(x, p, get(x, p).value)` give `x` itself.
- `has(x, p)` is `get(x, p).ok`; when it fails, the path up to `index` is there and the next segment is not.
- No call changes what it is given.

## What it costs

Minified and compressed with brotli: `get` alone about 570 bytes (es-toolkit's lodash-compatible `get`, 780), `set` alone about 1,320 (es-toolkit's `set`, 1,174, which changes its argument), all five about 1,430 (es-toolkit's five, 1,483).
