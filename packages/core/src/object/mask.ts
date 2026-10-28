// What the functions of the module share: which values they walk, which keys they read, and how a mask entry is read.
// Internal to the package: no sub-path exports it. The copy helpers (`blank`, `put`) are not here: each module that
// calls them in a loop keeps its own, since a function imported from another module is not inlined by V8 there, and
// costs a wide `omit` about 1.8 % more instructions per call.

/** A record: an object whose prototype is `Object.prototype` or `null`. */
export function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/**
 * An array of this realm whose prototype is `Array.prototype`. A subclass is a class instance; walking it with `map`
 * would also run the constructor its `Symbol.species` names, which the data may choose.
 */
export function isPlainArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}

/** The own enumerable string keys of `object`, in their order, then its own enumerable symbols when asked. */
export function keysOf(object: object, symbols: boolean): PropertyKey[] {
  const keys: PropertyKey[] = Object.keys(object);
  if (symbols) {
    for (const symbol of Object.getOwnPropertySymbols(object)) {
      if (Object.prototype.propertyIsEnumerable.call(object, symbol)) {
        keys.push(symbol);
      }
    }
  }
  return keys;
}

/** Throws unless `mask` is a record: an array or a class instance is no mask. Returns it; `at` names it. */
export function checkMask(mask: unknown, at: unknown): object {
  if (!isRecord(mask)) {
    throw new TypeError(`not a mask: ${String(at)}`);
  }
  return mask;
}

/**
 * The entry of `mask` for `key`: `true`, a nested mask, or `undefined` when the mask does not name the key. Only an own
 * enumerable entry counts, so that no mask names "constructor" or "toString" through `Object.prototype`.
 */
export function maskEntry(mask: object, key: PropertyKey): object | true | undefined {
  if (!Object.prototype.propertyIsEnumerable.call(mask, key)) {
    return undefined;
  }
  const entry: unknown = (mask as Readonly<Record<PropertyKey, unknown>>)[key];
  return entry === true || entry === undefined ? entry : checkMask(entry, key);
}
