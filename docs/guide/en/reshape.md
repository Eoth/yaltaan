# Merging and reshaping objects: merge, defaults, mapValues, mapKeys

`import { merge, defaults, mapValues, mapKeys } from '@yaltaan/core/object';`

## The problem

Settings are written in layers (the product's defaults, then the customer's, then the user's), and an options object arrives with holes that a default must fill. A spread `{ ...base, ...overrides }` merges one level only: `{ ...defaults, retry: { delay: 500 } }` loses `retry.count`. The usual deep merges change their first argument, decide alone what happens to arrays, and write a `"__proto__"` key of parsed JSON into a prototype.

## merge: overrides laid over a base

Two plain objects are merged field by field, at every depth, the fields of `overrides` winning. Anything else is `overrides` itself, even `undefined`, as a spread does. You choose what happens to arrays: `'replace'` takes the overrides' array whole, `'concat'` joins both. There is no default, so a reader of the call knows which one runs.

```ts
import { merge } from '@yaltaan/core/object';

const product = { retry: { count: 3, delay: 100 }, hosts: ['eu.example.com'] };
const customer = { retry: { delay: 500 }, hosts: ['us.example.com'] };
merge(product, customer, { arrays: 'replace' }); // → { retry: { count: 3, delay: 500 }, hosts: ['us.example.com'] }
merge(product, customer, { arrays: 'concat' }); // → { retry: { count: 3, delay: 500 }, hosts: ['eu.example.com', 'us.example.com'] }
merge(product, { retry: undefined }, { arrays: 'replace' }); // → { retry: undefined, hosts: ['eu.example.com'] }
```

Neither value is changed: the result is new wherever both sides held an object, and shares everything else with them.

## defaults: fill what is missing

`defaults(value, fallback)` keeps what `value` holds and takes from `fallback` what it lacks: a missing field, or one holding `undefined`, at every depth where both are objects. `undefined` itself gives the fallback, so optional options need no `?? {}`. As a default in a destructuring, `null` is a value and stays; an array is a value too, never joined.

```ts
import { defaults } from '@yaltaan/core/object';

const DEFAULTS = { retry: { count: 3, delay: 100 }, verbose: false };
defaults({ retry: { count: 5 } }, DEFAULTS); // → { retry: { count: 5, delay: 100 }, verbose: false }
defaults({ retry: { count: undefined }, verbose: null }, DEFAULTS); // → { retry: { count: 3, delay: 100 }, verbose: null }
defaults(undefined, DEFAULTS); // → DEFAULTS
```

`defaults(value, fallback)` gives the same fields as `merge(fallback, value, { arrays: 'replace' })` when no field of `value` is `undefined`; the result keeps the prototype and the field order of `value`.

## mapValues and mapKeys: one record into another

```ts
import { mapKeys, mapValues } from '@yaltaan/core/object';

const stock = { apples: 3, pears: 5 };
mapValues(stock, (count) => count * 2); // → { apples: 6, pears: 10 }
mapValues(stock, (count, fruit) => `${fruit}: ${count}`); // → { apples: 'apples: 3', pears: 'pears: 5' }
mapKeys({ first_name: 'Ada', last_name: 'Lovelace' }, (key) => key.replace('_n', 'N')); // → { firstName: 'Ada', lastName: 'Lovelace' }
mapKeys({ Accept: 'a', accept: 'b' }, (key) => key.toLowerCase()); // → { accept: 'b' }
```

`mapValues` keeps the keys and their types: `mapValues(stock, …)` has the fields `apples` and `pears`, nothing else. When `mapKeys` gives two fields the same name, the later one wins, as with `Object.fromEntries`: rename only when the new names cannot collide, or when losing the earlier value is what you want.

## Laws they keep

Each of these holds for any value, and the tests check it on thousands of generated ones, `"__proto__"` keys and objects without a prototype included:

- `merge(x, {}, o)` and `merge({}, x, o)` hold the fields of `x`; `merge(x, x, { arrays: 'replace' })` too.
- `merge(merge(a, b, o), c, o)` equals `merge(a, merge(b, c, o), o)` when `a`, `b` and `c` have objects at the same places.
- `mapValues(x, (v) => v)` is a copy of `x`; mapping by `f` then by `g` equals mapping once by `g` after `f`.
- `mapKeys(mapKeys(x, (k) => p + k), (k) => k.slice(p.length))` gives `x` back.
- No call changes its arguments, and no key of the data reaches a prototype.

## What is walked, and what is taken whole

As for [selecting fields](object.md): plain objects (and objects from `Object.create(null)`) are walked by their own enumerable string keys, symbol keys only with `{ symbols: true }`; arrays are joined or replaced, never walked; anything else (`Map`, `Set`, dates, class instances) is a value taken whole. A copy keeps the prototype of its object, a `"__proto__"` key stays a key, and each getter is read once. `mapValues` and `mapKeys` take a plain object only, and throw a `TypeError` for anything else.

## What it costs

Minified and compressed with brotli: `merge` about 520 bytes (es-toolkit's `toMerged`, which does not change its argument either, 1,446), `defaults` about 410 (es-toolkit's lodash-compatible `defaultsDeep`, 463), `mapValues` about 380 and `mapKeys` about 420, all four together about 740. `mapValues` and `mapKeys` cost more than a bare loop (es-toolkit's weigh about 105): the extra bytes keep the prototype, refuse `"__proto__"` as a prototype, and check the input.
