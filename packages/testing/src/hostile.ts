// Hostile objects: objects that refuse writes, lack the prototype a walk assumes, carry the keys that pollute a
// prototype when copied naively, throw when read, or are Proxies that observe or refuse every operation.
import fc from 'fast-check';

import { defineCategory, named, type Category } from './category.ts';

/** The error every throwing case of this category throws, so a test can tell it from its own failures. */
export class HostileError extends Error {
  override readonly name = 'HostileError';
}

function throwHostile(): never {
  throw new HostileError('hostile object');
}

function throwingGetter(): object {
  return Object.defineProperty({ before: 1 }, 'trap', { enumerable: true, get: throwHostile });
}

function throwingProxy(): object {
  return new Proxy(
    { a: 1 },
    {
      get: throwHostile,
      set: throwHostile,
      has: throwHostile,
      deleteProperty: throwHostile,
      ownKeys: throwHostile,
      getOwnPropertyDescriptor: throwHostile,
      defineProperty: throwHostile,
      getPrototypeOf: throwHostile,
    },
  );
}

function revokedProxy(): object {
  const { proxy, revoke } = Proxy.revocable({ a: 1 }, {});
  revoke();
  return proxy;
}

function nonEnumerable(): object {
  return Object.defineProperty({ visible: 1 }, 'hidden', { value: 2, enumerable: false, writable: true });
}

// The wrappers turn a generated object into a hostile one, in place: fast-check builds a new object for every
// generated or shrunk value, so freezing it reaches no other test.
const wrappers: readonly ((value: object) => object)[] = [
  (value) => value,
  (value) => Object.freeze(value),
  (value) => Object.seal(value),
  (value) => Object.preventExtensions(value),
  (value) => Object.setPrototypeOf(value, null),
  (value) => new Proxy(value, {}),
];

const dangerousKey = fc.constantFrom('__proto__', 'constructor', 'prototype');

export const hostile: Category<object> = defineCategory<object>(
  'hostile',
  [
    named('frozen object', () => Object.freeze({ a: 1, nested: { b: 2 } })),
    named('frozen array', () => Object.freeze([1, 2, 3])),
    named('sealed object', () => Object.seal({ a: 1 })),
    named('non-extensible object', () => Object.preventExtensions({ a: 1 })),
    named('null prototype', () => Object.assign(Object.create(null) as object, { a: 1 })),
    // JSON.parse defines "__proto__" as an own key, as a parsed payload does; an object literal would set the
    // prototype instead.
    named('__proto__ key', () => JSON.parse('{"__proto__": {"polluted": true}}') as object),
    named('constructor key', () => ({ constructor: { prototype: { polluted: true } } })),
    named('prototype key', () => ({ prototype: { polluted: true } })),
    named('throwing getter', throwingGetter),
    named('transparent Proxy', () => new Proxy({ a: 1 }, {})),
    named('throwing Proxy', throwingProxy),
    named('revoked Proxy', revokedProxy),
    named('symbol key', () => ({ a: 1, [Symbol('hidden')]: 2 })),
    named('non-enumerable property', nonEnumerable),
  ],
  fc
    .tuple(
      fc.dictionary(fc.oneof(fc.string(), dangerousKey), fc.anything({ maxDepth: 2 }), { maxKeys: 6 }),
      fc.constantFrom(...wrappers),
    )
    .map(([value, wrap]) => wrap(value)),
);
