// The functions of the module against their es-toolkit equivalents, on generated inputs (see the judge in
// @yaltaan/testing). `redact` has no equivalent there. Blind spot: masks are judged one level deep only, since the
// main entry of es-toolkit takes a list of keys and the paths of its `compat` entry follow none of the rules of a
// nested mask (a mask on an array applies to each element; a field walked into is kept even when nothing in it is).
import { cloneDeep, mapKeys as theirMapKeys, mapValues as theirMapValues, omit as theirOmit } from 'es-toolkit';
import { pick as theirPick, toMerged } from 'es-toolkit';
import { defaultsDeep } from 'es-toolkit/compat';

import { createJudge, fc } from '@yaltaan/testing';

import { defaults, mapKeys, mapValues, merge, omit, pick, type UntypedMask } from './index.ts';

const judge = createJudge(new URL('./index.ts', import.meta.url), 'es-toolkit');

const SYMBOL = Symbol('s');

// What makes the two libraries differ, each drawn for one input in four, so that three inputs in ten hold none of them
// and are compared whole: records without prototype, symbol keys, "__proto__" as an own key, `undefined` values.
interface Traits {
  readonly bare: boolean;
  readonly symbol: boolean;
  readonly proto: boolean;
  readonly undef: boolean;
}
const oneInFour = fc.nat(3).map((roll) => roll === 0);
const traits: fc.Arbitrary<Traits> = fc.record({
  bare: oneInFour,
  symbol: oneInFour,
  proto: oneInFour,
  undef: oneInFour,
});

const namesOf = ({ proto }: Traits): fc.Arbitrary<string> =>
  fc.constantFrom('a', 'b', 'c', 'constructor', 'toString', '0', ...(proto ? ['__proto__'] : []));
const list = fc.array(fc.integer(), { maxLength: 3 });
const leafOf = ({ undef }: Traits): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc.integer(),
    fc.string({ maxLength: 2 }),
    fc.constant(null),
    list,
    ...(undef ? [fc.constant(undefined)] : []),
  );

function recordOf(value: fc.Arbitrary<unknown>, drawn: Traits): fc.Arbitrary<Record<PropertyKey, unknown>> {
  return fc
    .tuple(
      fc.dictionary(namesOf(drawn), value, { maxKeys: 4, noNullPrototype: true }),
      drawn.symbol ? fc.option(value) : fc.constant(null),
      drawn.bare ? fc.boolean() : fc.constant(false),
    )
    .map(([fields, symbolValue, bare]) => {
      const record: Record<PropertyKey, unknown> = bare ? Object.create(null) : {};
      for (const key of Object.keys(fields)) {
        Object.defineProperty(record, key, {
          value: fields[key],
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      if (symbolValue !== null) {
        record[SYMBOL] = symbolValue;
      }
      return record;
    });
}

const dataOf = (drawn: Traits): fc.Arbitrary<unknown> =>
  fc.letrec((tie) => ({ value: fc.oneof({ depthSize: 'small' }, leafOf(drawn), recordOf(tie('value'), drawn)) })).value;
const recordsOf = (drawn: Traits): fc.Arbitrary<Record<PropertyKey, unknown>> => recordOf(dataOf(drawn), drawn);
const symbolOption = fc.boolean();
const maskOf = (names: readonly string[]): UntypedMask => Object.fromEntries(names.map((name) => [name, true]));

// One record and the key names of a mask, a callback or a second record, all drawn with the same traits.
const recordAndKeys = traits.chain((drawn) =>
  fc.tuple(recordsOf(drawn), fc.uniqueArray(namesOf(drawn), { maxLength: 4 }), symbolOption),
);
const recordAndMap = traits.chain((drawn) => fc.tuple(recordsOf(drawn), fc.func(dataOf(drawn)), symbolOption));
const recordAndRename = traits.chain((drawn) => fc.tuple(recordsOf(drawn), fc.func(namesOf(drawn)), symbolOption));
const twoRecords = traits.chain((drawn) => fc.tuple(recordsOf(drawn), recordsOf(drawn), symbolOption));

const isObject = (value: unknown): value is Record<PropertyKey, unknown> => typeof value === 'object' && value !== null;
// Whether `test` holds for a record of one of `values`, at any depth.
function somewhere(test: (record: Record<PropertyKey, unknown>) => boolean, ...values: unknown[]): boolean {
  return values.some(
    (value) =>
      isObject(value) &&
      !Array.isArray(value) &&
      (test(value) || Reflect.ownKeys(value).some((key) => somewhere(test, value[key]))),
  );
}
const hasSymbol = (record: object): boolean => Object.getOwnPropertySymbols(record).length > 0;
const withoutPrototype = (record: object): boolean => Object.getPrototypeOf(record) === null;
const ownProto = (record: object): boolean => Object.hasOwn(record, '__proto__');
// Whether an array meets an array or a record at the same place of `base` and `overrides`.
function arraysMeet(base: unknown, overrides: unknown): boolean {
  if (!isObject(base) || !isObject(overrides)) {
    return false;
  }
  if (Array.isArray(base) || Array.isArray(overrides)) {
    return true;
  }
  return Reflect.ownKeys(overrides).some((key) => Object.hasOwn(base, key) && arraysMeet(base[key], overrides[key]));
}
const holdsUndefined = (record: Record<PropertyKey, unknown>): boolean =>
  Reflect.ownKeys(record).some((key) => record[key] === undefined);

const NO_PROTOTYPE = 'a dictionary without prototype stays one; es-toolkit returns an `Object` instance';
const PROTO_KEY = 'a "__proto__" key stays a key; es-toolkit assigns it, which replaces the prototype of the copy';
const PROTO_SKIPPED = 'a "__proto__" key stays a key; es-toolkit skips it';
const ARRAYS_KEPT = 'an array is a value, kept whole; es-toolkit fills its missing indexes from the fallback';
const UNDEFINED_COPIED = 'an `undefined` field of the overrides is copied, as a spread does; es-toolkit skips it';
const ARRAYS_MERGED =
  "an array that meets an array or a record is replaced, or joined by `arrays: 'concat'`; " +
  'es-toolkit merges them by index';
const SYMBOLS = 'a symbol key counts only with `symbols: true`; es-toolkit always copies it';
const SYMBOLS_LAID =
  'symbol keys of both values count only with `symbols: true`; ' +
  'es-toolkit keeps those of the first and ignores the second';
const SYMBOLS_READ = '`symbols: true` maps symbol keys too; es-toolkit never reads them';

judge.compare('pick', {
  input: recordAndKeys,
  ours: ([record, names, symbols]) => pick(record, maskOf(names), { symbols }),
  theirs: ([record, names]) => theirPick(record, names),
  differences: [
    { text: PROTO_KEY, applies: ([record, names]) => names.includes('__proto__') && ownProto(record) },
    { text: NO_PROTOTYPE, applies: ([record]) => withoutPrototype(record) },
  ],
});

judge.compare('omit', {
  input: recordAndKeys,
  ours: ([record, names, symbols]) => omit(record, maskOf(names), { symbols }),
  theirs: ([record, names]) => theirOmit(record, names),
  differences: [
    { text: SYMBOLS, applies: ([record, , symbols]) => !symbols && hasSymbol(record) },
    { text: NO_PROTOTYPE, applies: ([record]) => withoutPrototype(record) },
  ],
});

judge.compare('mapValues', {
  input: recordAndMap,
  ours: ([record, map, symbols]) => mapValues(record, (value, key) => map(value, key), { symbols }),
  theirs: ([record, map]) => theirMapValues(record, (value, key) => map(value, key)),
  differences: [
    { text: PROTO_KEY, applies: ([record]) => ownProto(record) },
    { text: SYMBOLS_READ, applies: ([record, , symbols]) => symbols && hasSymbol(record) },
    { text: NO_PROTOTYPE, applies: ([record]) => withoutPrototype(record) },
  ],
});

judge.compare('mapKeys', {
  input: recordAndRename,
  ours: ([record, rename, symbols]) => mapKeys(record, (key, value) => rename(key, value), { symbols }),
  theirs: ([record, rename]) => theirMapKeys(record, (value, key) => rename(key, value)),
  differences: [
    {
      text: PROTO_KEY,
      applies: ([record, rename]) => Object.keys(record).some((key) => rename(key, record[key]) === '__proto__'),
    },
    { text: SYMBOLS_READ, applies: ([record, , symbols]) => symbols && hasSymbol(record) },
    { text: NO_PROTOTYPE, applies: ([record]) => withoutPrototype(record) },
  ],
});

judge.compare('merge', {
  input: twoRecords,
  ours: ([base, overrides, symbols]) => merge(base, overrides, { arrays: 'replace', symbols }),
  theirs: ([base, overrides]) => toMerged(base, overrides),
  differences: [
    { text: PROTO_SKIPPED, applies: ([base, overrides]) => somewhere(ownProto, base, overrides) },
    { text: UNDEFINED_COPIED, applies: ([, overrides]) => somewhere(holdsUndefined, overrides) },
    { text: ARRAYS_MERGED, applies: ([base, overrides]) => arraysMeet(base, overrides) },
    { text: SYMBOLS_LAID, applies: ([base, overrides]) => somewhere(hasSymbol, base, overrides) },
    { text: NO_PROTOTYPE, applies: ([base, overrides]) => somewhere(withoutPrototype, base, overrides) },
  ],
});

judge.compare('defaults', {
  input: twoRecords,
  ours: ([value, fallback, symbols]) => defaults(value, fallback, { symbols }),
  theirs: ([value, fallback]) => defaultsDeep(cloneDeep(value), fallback),
  differences: [
    { text: PROTO_SKIPPED, applies: ([value, fallback]) => somewhere(ownProto, value, fallback) },
    { text: ARRAYS_KEPT, applies: ([value, fallback]) => arraysMeet(value, fallback) },
    { text: SYMBOLS_LAID, applies: ([value, fallback]) => somewhere(hasSymbol, value, fallback) },
    { text: NO_PROTOTYPE, applies: ([value, fallback]) => somewhere(withoutPrototype, value, fallback) },
  ],
});
