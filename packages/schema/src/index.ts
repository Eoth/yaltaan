// The schemas of ARCHITECTURE.md §7.9: functions that read unknown data into a Result of typed values or of every
// issue found, and that speak Standard Schema version 1 to any engine. Nothing runs on import, and a bundler drops
// every function nobody calls: that is why these are functions and not methods.
//
// A read writes nothing to its input and reads each field once, so that what comes out is what was checked, whatever a
// getter would answer next (a union reads its key once more to choose its option, whose own read then decides). Every
// container a schema declares is fresh in the output; a value kept by `passthrough` is unchecked, and shared.
//
// The path is one stack pushed and popped along the walk, so that a success copies no path at all. What an input can
// make a read hold is bounded: `MAX_ISSUES` issues, after which the walk stops, and `MAX_ELEMENTS` elements unless the
// schema says otherwise, checked before the first is read. The rest of the work is linear in the input, and the depth
// that of the schema, without recursion. A pattern comes from the application: `pattern` requires `maxLength`, so that
// it only meets a bounded text, and a pattern that backtracks exponentially stays the application's to avoid.
//
// Differences from valibot 1.5.0, each checked by the judge of this package:
//   - parse: number takes finite numbers only; valibot also takes an infinite one
//   - parse: object and discriminatedUnion take a plain object only, whose prototype is Object.prototype or null;
//     valibot also takes an array, a Date, a Map or a class instance, and reads their keys
//   - parse: a key is read only if it is the object's own; valibot also reads an inherited one, such as toString
//   - parse: reject gives every unknown key an issue; valibot stops at the first
//   - parse: an array over maxLength gets that one issue and its elements are not read; valibot reads them too
//   - parse: the count of an array under minLength is reported even when an element is invalid; valibot skips it when
//     an element has the wrong type
//   - parse: a pattern is not tested on a text over maxLength; valibot tests it as well, and gives a second issue
import { toStandardIssue, type IssueFormatter, type StandardIssue } from '@yaltaan/core/issue';
import { checkWritablePath } from '@yaltaan/core/path';
import { err, ok, type Result } from '@yaltaan/core/result';

/**
 * Where an issue of a schema is: property names and indexes, from the root of the value read.
 * @since 0.2
 * @experimental
 */
export type SchemaPath = readonly (string | number)[];

/**
 * A value a literal schema can hold.
 * @since 0.2
 * @experimental
 */
export type SchemaLiteral = string | number | boolean | null;

/**
 * An expected failure of a read:
 * - `schema.invalid_type`: the value is not a `string`, a finite `number`, an `array` or a plain `object`;
 * - `schema.invalid_value`: the value is none of the literals of `expected`;
 * - `schema.missing`: the object has no own key here, and its schema is not `optional`;
 * - `schema.unknown_key`: the object has a key its schema does not declare, under `unknownKeys: 'reject'`;
 * - `schema.too_short`, `schema.too_long`: the text has `length` code units, outside `minimum` or `maximum`;
 * - `schema.too_small`, `schema.too_large`: the number or the number of elements is outside `minimum` or `maximum`;
 * - `schema.not_integer`: the number has a fraction;
 * - `schema.invalid_format`: the text does not match `pattern`, the source of the regular expression;
 * - `schema.too_many_issues`: the read stopped at `maximum` issues, the last in the list, at the root.
 * @since 0.2
 * @experimental
 */
export type SchemaIssue =
  | {
      readonly code: 'schema.invalid_type';
      readonly path: SchemaPath;
      readonly params: { readonly expected: 'string' | 'number' | 'array' | 'object' };
    }
  | {
      readonly code: 'schema.invalid_value';
      readonly path: SchemaPath;
      readonly params: { readonly expected: readonly SchemaLiteral[] };
    }
  | { readonly code: 'schema.missing'; readonly path: SchemaPath }
  | { readonly code: 'schema.unknown_key'; readonly path: SchemaPath }
  | {
      readonly code: 'schema.too_short';
      readonly path: SchemaPath;
      readonly params: { readonly length: number; readonly minimum: number };
    }
  | {
      readonly code: 'schema.too_long';
      readonly path: SchemaPath;
      readonly params: { readonly length: number; readonly maximum: number };
    }
  | { readonly code: 'schema.too_small'; readonly path: SchemaPath; readonly params: { readonly minimum: number } }
  | { readonly code: 'schema.too_large'; readonly path: SchemaPath; readonly params: { readonly maximum: number } }
  | { readonly code: 'schema.not_integer'; readonly path: SchemaPath }
  | {
      readonly code: 'schema.too_many_issues';
      readonly path: SchemaPath;
      readonly params: { readonly maximum: number };
    }
  | {
      readonly code: 'schema.invalid_format';
      readonly path: SchemaPath;
      readonly params: { readonly pattern: string };
    };

// The types of the Standard Schema interface, version 1, copied as the specification allows (ARCHITECTURE.md §5.4).

/**
 * The options of `validate` in the Standard Schema interface. Schemas of this package read none of them.
 * @since 0.2
 * @experimental
 */
export interface StandardOptions {
  readonly libraryOptions?: Record<string, unknown> | undefined;
}

/**
 * The inferred types a Standard Schema advertises to a consumer.
 * @since 0.2
 * @experimental
 */
export interface StandardTypes<Input = unknown, Output = Input> {
  readonly input: Input;
  readonly output: Output;
}

/**
 * The result of `validate` in the Standard Schema interface: a value, or issues.
 * @since 0.2
 * @experimental
 */
export type StandardResult<Output> =
  { readonly value: Output; readonly issues?: undefined } | { readonly issues: readonly StandardIssue[] };

/**
 * The properties of the Standard Schema interface, version 1.
 * @since 0.2
 * @experimental
 */
export interface StandardProps<Input = unknown, Output = Input> {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (
    value: unknown,
    options?: StandardOptions | undefined,
  ) => StandardResult<Output> | Promise<StandardResult<Output>>;
  readonly types?: StandardTypes<Input, Output> | undefined;
}

/**
 * The Standard Schema interface, version 1: what any engine that accepts a schema reads.
 * @since 0.2
 * @experimental
 */
export interface StandardSchema<Input = unknown, Output = Input> {
  readonly '~standard': StandardProps<Input, Output>;
}

interface Reading {
  readonly path: (string | number)[];
  readonly issues: SchemaIssue[];
}

interface SynchronousProps<Input, Output> extends StandardProps<Input, Output> {
  readonly validate: (value: unknown, options?: StandardOptions | undefined) => StandardResult<Output>;
}

/**
 * A schema: it reads an unknown value into an `Output`, and is the type of a value of its own `Input`. Its `validate`
 * is synchronous, and its issues carry the code as their message until `withMessages` gives them words.
 * @since 0.2
 * @experimental
 */
export interface Schema<Input = unknown, Output = Input> extends StandardSchema<Input, Output> {
  readonly '~standard': SynchronousProps<Input, Output>;
  /** The read itself, for the schemas that hold this one. Not part of the contract: call `parse`. */
  readonly '~run': (input: unknown, reading: Reading) => Output;
}

/**
 * The type of a value a schema takes.
 * @since 0.2
 * @experimental
 */
export type InferInput<S extends StandardSchema> = NonNullable<S['~standard']['types']>['input'];

/**
 * The type of the value a schema gives.
 * @since 0.2
 * @experimental
 */
export type InferOutput<S extends StandardSchema> = NonNullable<S['~standard']['types']>['output'];

function make<S>(run: Schema['~run'], extra?: object): S {
  const schema = { ...extra, '~run': run } as { '~standard': unknown } & Schema;
  schema['~standard'] = propsOf(schema, (issue) => issue.code);
  return schema as S;
}

function propsOf(schema: Schema, format: IssueFormatter): Schema['~standard'] {
  return {
    version: 1,
    vendor: 'yaltaan',
    validate: (value) => {
      const result = parse(schema, value);
      return result.ok
        ? { value: result.value }
        : { issues: result.error.map((issue) => toStandardIssue(issue, { format })) };
    },
  };
}

// Enough for any form a person fills in, and little enough that a body built to fail costs a few hundred kilobytes.
const MAX_ISSUES = 1000;
// The first of the limits of ARCHITECTURE.md §7.9: an array announces its length without holding its elements.
const MAX_ELEMENTS = 1_000_000;

function fail(reading: Reading, code: SchemaIssue['code'], params?: object): void {
  const { issues } = reading;
  if (issues.length < MAX_ISSUES) {
    const issue = { code, path: reading.path.slice() };
    issues.push((params === undefined ? issue : { ...issue, params }) as SchemaIssue);
  } else if (issues.length === MAX_ISSUES) {
    issues.push({ code: 'schema.too_many_issues', path: [], params: { maximum: MAX_ISSUES } });
  }
}

// A bound of a schema: a bug in the calling code when it cannot bound anything.
function checkBounds(low: number | undefined, high: number | undefined, valid: (bound: number) => boolean): void {
  for (const bound of [low, high]) {
    if (bound !== undefined && !valid(bound)) {
      throw new TypeError(`not a bound: ${String(bound)}`);
    }
  }
  if ((low as number) > (high as number)) {
    throw new TypeError(`bounds cross: ${String(low)} over ${String(high)}`);
  }
}

function isLength(bound: number): boolean {
  return Number.isSafeInteger(bound) && bound >= 0;
}

function checkSchema(schema: unknown): void {
  if (typeof (schema as Partial<Schema> | null | undefined)?.['~run'] !== 'function') {
    throw new TypeError(`not a schema: ${String(schema)}`);
  }
}

/**
 * The bounds of a text, in UTF-16 code units, and the pattern it must match. A pattern requires `maxLength`: it is not
 * tested on a text over it, so that it only ever meets a bounded text.
 * @since 0.2
 * @experimental
 */
export type StringOptions =
  | { readonly minLength?: number; readonly maxLength?: number; readonly pattern?: undefined }
  | {
      readonly minLength?: number;
      readonly maxLength: number;
      /** Without the `g` or `y` flag, whose `lastIndex` would make two reads differ. */
      readonly pattern: RegExp;
    };

/**
 * A schema of strings, any string by default: empty, with lone surrogates, of any length.
 * @pure
 * @sharing structural
 * @complexity O(1) to build; a read is O(1), plus the cost of `pattern`
 * @throws TypeError when a bound is not a whole number from 0, `minLength` is over `maxLength`, or `pattern` has the
 *   `g` or `y` flag or comes without `maxLength`
 * @since 0.2
 * @experimental
 * @example parse(string({ minLength: 2 }), 'a') // an error, code 'schema.too_short'
 */
export function string(options: StringOptions = {}): Schema<string> {
  const { minLength, maxLength, pattern } = options;
  checkBounds(minLength, maxLength, isLength);
  if (pattern !== undefined && (pattern.global || pattern.sticky || maxLength === undefined)) {
    throw new TypeError(`a pattern needs maxLength, and no g or y flag, which keeps a state: ${String(pattern)}`);
  }
  return make((input, reading) => {
    if (typeof input !== 'string') {
      fail(reading, 'schema.invalid_type', { expected: 'string' });
      return input;
    }
    const { length } = input;
    if (length < (minLength as number)) {
      fail(reading, 'schema.too_short', { length, minimum: minLength });
    }
    if (length > (maxLength as number)) {
      fail(reading, 'schema.too_long', { length, maximum: maxLength });
    } else if (pattern?.test(input) === false) {
      fail(reading, 'schema.invalid_format', { pattern: pattern.source });
    }
    return input;
  });
}

/**
 * The bounds of a number, both included, and whether it must be whole.
 * @since 0.2
 * @experimental
 */
export interface NumberOptions {
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
}

/**
 * A schema of finite numbers: `NaN` and the infinities are refused, as they are by JSON; `-0` is kept.
 * @pure
 * @sharing structural
 * @complexity O(1)
 * @throws TypeError when a bound is not a finite number, or `min` is over `max`
 * @since 0.2
 * @experimental
 * @example parse(number({ max: 10 }), 11) // an error, code 'schema.too_large'
 */
export function number(options: NumberOptions = {}): Schema<number> {
  const { min, max, integer } = options;
  checkBounds(min, max, Number.isFinite);
  return make((input, reading) => {
    if (!Number.isFinite(input)) {
      fail(reading, 'schema.invalid_type', { expected: 'number' });
      return input;
    }
    const value = input as number;
    if (value < (min as number)) {
      fail(reading, 'schema.too_small', { minimum: min });
    }
    if (value > (max as number)) {
      fail(reading, 'schema.too_large', { maximum: max });
    }
    if (integer === true && !Number.isInteger(value)) {
      fail(reading, 'schema.not_integer');
    }
    return value;
  });
}

/**
 * A schema that holds its literal, which an option of a `discriminatedUnion` reads.
 * @since 0.2
 * @experimental
 */
export interface LiteralSchema<T extends SchemaLiteral> extends Schema<T> {
  readonly literal: T;
}

/**
 * A schema of one value, compared by `===`: `literal(0)` also takes `-0`, and gives back what it read.
 * @pure
 * @sharing identity-preserving
 * @complexity O(1)
 * @throws TypeError when `value` is `NaN`, which no value equals, or is not a literal
 * @since 0.2
 * @experimental
 * @example parse(literal('card'), 'cash') // an error, code 'schema.invalid_value'
 */
export function literal<const T extends SchemaLiteral>(value: T): LiteralSchema<T> {
  if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' && !Number.isFinite(value)) {
    throw new TypeError(`not a literal: ${String(value)}`);
  }
  const expected = Object.freeze([value]);
  return make(
    (input, reading) => {
      if (input !== value) {
        fail(reading, 'schema.invalid_value', { expected });
      }
      return input;
    },
    { literal: value },
  );
}

/**
 * A schema an object may leave out.
 * @since 0.2
 * @experimental
 */
export interface OptionalSchema<Input, Output = Input> extends Schema<Input, Output> {
  readonly optional: true;
}

/**
 * The options of `optional`.
 * @since 0.2
 * @experimental
 */
export interface OptionalOptions {
  /** Takes an absent key only, and refuses an explicit `undefined`. */
  readonly exactOptional?: boolean;
}

/**
 * `schema`, or nothing: an object may leave the key out, and an explicit `undefined` is kept as it is, unless
 * `exactOptional` refuses it. Under `exactOptionalPropertyTypes`, the types say the same.
 * @pure
 * @sharing structural
 * @complexity O(1) to build; a read costs that of `schema`
 * @throws TypeError when `schema` is not a schema
 * @since 0.2
 * @experimental
 * @example parse(object({ age: optional(number()) }), {}) // { ok: true, value: {} }
 */
export function optional<I, O, const Exact extends boolean = false>(
  schema: Schema<I, O>,
  options: OptionalOptions & { readonly exactOptional?: Exact } = {},
): OptionalSchema<Exact extends true ? I : I | undefined, Exact extends true ? O : O | undefined> {
  checkSchema(schema);
  const exact = options.exactOptional === true;
  return make((input, reading) => (input === undefined && !exact ? input : schema['~run'](input, reading)), {
    optional: true,
  });
}

/**
 * `schema`, or `null`. An object must still hold the key: absence and `null` are two states, stated one by one.
 * @pure
 * @sharing structural
 * @complexity O(1) to build; a read costs that of `schema`
 * @throws TypeError when `schema` is not a schema
 * @since 0.2
 * @experimental
 * @example parse(nullable(string()), null) // { ok: true, value: null }
 */
export function nullable<I, O>(schema: Schema<I, O>): Schema<I | null, O | null> {
  checkSchema(schema);
  return make((input, reading) => (input === null ? input : schema['~run'](input, reading)));
}

/**
 * The bounds of the number of elements of an array. `maxLength` is 1,000,000 unless given; it may be larger.
 * @since 0.2
 * @experimental
 */
export interface ArrayOptions {
  readonly minLength?: number;
  readonly maxLength?: number;
}

/**
 * A schema of arrays. An array over `maxLength` gets that one issue, and no element is read. Otherwise each element is
 * read in turn, a hole as `undefined`, and `minLength` is checked after them, so that one read reports them all. The
 * output is a new dense array.
 * @pure
 * @sharing structural
 * @complexity O(n) (n = number of elements), times the cost of `element`
 * @throws TypeError when `element` is not a schema, a bound is not a whole number from 0, or `minLength` is over
 *   `maxLength`
 * @since 0.2
 * @experimental
 * @example parse(array(number()), [1, 'a']) // an error at path [1], code 'schema.invalid_type'
 */
export function array<I, O>(element: Schema<I, O>, options: ArrayOptions = {}): Schema<I[], O[]> {
  const { minLength, maxLength = MAX_ELEMENTS } = options;
  checkSchema(element);
  checkBounds(minLength, maxLength, isLength);
  return make((input, reading) => {
    if (!Array.isArray(input)) {
      fail(reading, 'schema.invalid_type', { expected: 'array' });
      return input;
    }
    const { length } = input;
    if (length > maxLength) {
      fail(reading, 'schema.too_large', { maximum: maxLength });
      return input;
    }
    const { path, issues } = reading;
    const output: O[] = [];
    for (let index = 0; index < length && issues.length <= MAX_ISSUES; index += 1) {
      path.push(index);
      output.push(element['~run'](input[index], reading));
      path.pop();
    }
    if (length < (minLength as number)) {
      fail(reading, 'schema.too_small', { minimum: minLength });
    }
    return output;
  });
}

/**
 * The fields of an object schema: a schema per key.
 * @since 0.2
 * @experimental
 */
export type Entries = Readonly<Record<string, Schema<unknown, unknown>>>;

/**
 * What an object does with a key it does not declare: drop it (`strip`), give it the issue `schema.unknown_key`
 * (`reject`, for untrusted input), or keep it unchecked (`passthrough`), but for `__proto__`, `constructor` and
 * `prototype` among the keys of that object. A value kept is not walked: what it holds is its own.
 * @since 0.2
 * @experimental
 */
export type UnknownKeys = 'strip' | 'reject' | 'passthrough';

/**
 * The options of `object`.
 * @since 0.2
 * @experimental
 */
export interface ObjectOptions<U extends UnknownKeys = UnknownKeys> {
  /** `strip` by default. */
  readonly unknownKeys?: U;
}

type OptionalKeys<E> = { [K in keyof E]: E[K] extends { readonly optional: true } ? K : never }[keyof E];

// One object type in an editor's tooltip, where two mapped types would show as an intersection.
type Flatten<T> = { [K in keyof T]: T[K] } & {};

/**
 * The type of a value an object schema takes.
 * @since 0.2
 * @experimental
 */
export type ObjectInput<E extends Entries> = Flatten<
  { -readonly [K in Exclude<keyof E, OptionalKeys<E>>]: InferInput<E[K]> } & {
    -readonly [K in OptionalKeys<E>]?: InferInput<E[K]>;
  }
>;

/**
 * The type of the value an object schema gives.
 * @since 0.2
 * @experimental
 */
export type ObjectOutput<E extends Entries> = Flatten<
  { -readonly [K in Exclude<keyof E, OptionalKeys<E>>]: InferOutput<E[K]> } & {
    -readonly [K in OptionalKeys<E>]?: InferOutput<E[K]>;
  }
>;

/**
 * A schema of objects, which holds its fields.
 * @since 0.2
 * @experimental
 */
export interface ObjectSchema<E extends Entries, U extends UnknownKeys = 'strip'> extends Schema<
  ObjectInput<E>,
  U extends 'passthrough' ? ObjectOutput<E> & { readonly [key: string]: unknown } : ObjectOutput<E>
> {
  readonly entries: E;
}

// A data property where the prototype holds the name, never a write through it: a read-only or a setter planted on
// Object.prototype, which a hardened application may have frozen, would throw or take the value.
function put(output: Record<string, unknown>, key: string, value: unknown): void {
  if (key in output) {
    Object.defineProperty(output, key, { value, writable: true, enumerable: true, configurable: true });
  } else {
    output[key] = value;
  }
}

// Same rule as `@yaltaan/core/object`, whose helper no sub-path exports: an array, a Date, a Map or a class instance
// would pass `typeof` and lose its content in the copy. An object of another realm is refused too.
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/**
 * A schema of plain objects: a prototype of `Object.prototype` or `null`, own keys only. An absent key is
 * `schema.missing` unless its schema is `optional`; the output holds the keys the input held, in a new object.
 * @pure
 * @sharing structural
 * @complexity O(k) (k = number of declared keys), plus the fields' cost and, unless `strip`, the keys of the input
 * @throws TypeError when `entries` is not a plain object (`{ __proto__: string() }` sets its prototype), an entry is
 *   not a schema, or its key is `__proto__`, `constructor` or `prototype`
 * @throws what a getter or a Proxy trap of the input throws, unchanged, when reading
 * @since 0.2
 * @experimental
 * @example parse(object({ name: string() }), { name: 'Ada', x: 1 }) // { ok: true, value: { name: 'Ada' } }
 */
export function object<const E extends Entries, const U extends UnknownKeys = 'strip'>(
  entries: E,
  options: ObjectOptions<U> = {},
): ObjectSchema<E, U> {
  const { unknownKeys = 'strip' } = options;
  if (!isRecord(entries)) {
    throw new TypeError('the entries of an object are a plain object, of which `__proto__` cannot be a key');
  }
  const keys = Object.keys(entries);
  const declared = new Set(keys);
  // Taken now: a later write to `entries` must not change what this schema reads.
  const fields = keys.map((key) => {
    if (!checkWritablePath([key]).ok) {
      throw new TypeError(`a key that a write refuses cannot be declared: ${key}`);
    }
    checkSchema(entries[key]);
    return entries[key] as Schema;
  });
  return make(
    (input, reading) => {
      if (!isRecord(input)) {
        fail(reading, 'schema.invalid_type', { expected: 'object' });
        return input;
      }
      const { path } = reading;
      const output: Record<string, unknown> = {};
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!;
        const field = fields[index] as Schema & { readonly optional?: true };
        path.push(key);
        if (Object.hasOwn(input, key)) {
          put(output, key, field['~run'](input[key], reading));
        } else if (field.optional !== true) {
          fail(reading, 'schema.missing');
        }
        path.pop();
      }
      if (unknownKeys !== 'strip') {
        for (const key of Object.keys(input)) {
          if (declared.has(key)) {
            continue;
          }
          if (unknownKeys === 'passthrough') {
            if (checkWritablePath([key]).ok) {
              put(output, key, input[key]);
            }
          } else {
            path.push(key);
            fail(reading, 'schema.unknown_key');
            path.pop();
          }
        }
      }
      return output;
    },
    { entries: { ...entries } },
  );
}

/**
 * An option of a discriminated union under the key `K`: an object schema whose field `K` is a literal.
 * @since 0.2
 * @experimental
 */
export type UnionOption<K extends string> = Schema<unknown, unknown> & {
  readonly entries: { readonly [Key in K]: LiteralSchema<SchemaLiteral> };
};

/**
 * A schema of objects of several forms, told apart by the literal under `key`: the option it names reads the object,
 * and the issues are those of that option alone. An absent `key` is `schema.missing`, and a value no option names is
 * `schema.invalid_value`, both at `key`.
 * @pure
 * @sharing structural
 * @complexity O(n) to build (n = number of options); a read is O(1), plus the cost of the option
 * @throws TypeError when an option is not a schema or has no literal under `key`, or two options have the same one
 * @throws what a getter or a Proxy trap of the input throws, unchanged, when reading
 * @since 0.2
 * @experimental
 * @example
 * const pay = discriminatedUnion('by', [object({ by: literal('card') }), object({ by: literal('cash') })]);
 * parse(pay, { by: 'cash' }) // { ok: true, value: { by: 'cash' } }
 */
export function discriminatedUnion<K extends string, const O extends readonly UnionOption<K>[]>(
  key: K,
  options: O,
): Schema<InferInput<O[number]>, InferOutput<O[number]>> {
  const optionOf = new Map<unknown, Schema>();
  for (const option of options) {
    checkSchema(option);
    const field = (option as Partial<UnionOption<K>> | undefined)?.entries?.[key] as
      Partial<LiteralSchema<SchemaLiteral>> | undefined;
    if (field === undefined || !('literal' in field) || optionOf.has(field.literal)) {
      throw new TypeError(`an option needs its own literal under ${key}`);
    }
    optionOf.set(field.literal, option);
  }
  const expected = Object.freeze([...optionOf.keys()]);
  return make((input, reading) => {
    if (!isRecord(input)) {
      fail(reading, 'schema.invalid_type', { expected: 'object' });
      return input;
    }
    const { path } = reading;
    const present = Object.hasOwn(input, key);
    const option = present ? optionOf.get(input[key]) : undefined;
    if (option !== undefined) {
      return option['~run'](input, reading);
    }
    path.push(key);
    if (present) {
      fail(reading, 'schema.invalid_value', { expected });
    } else {
      fail(reading, 'schema.missing');
    }
    path.pop();
    return input;
  });
}

/**
 * Reads `input` by `schema`: a `Result` of the output, or of every issue found, in the order of the schema, up to
 * 1,000 and then `schema.too_many_issues`. Never mutates `input`; the same input and schema give the same result, and
 * parsing an output again gives an equal one.
 * @pure
 * @sharing structural
 * @complexity O(n) (n = size of the part of `input` the schema reads); memory bounded by n and 1,000 issues
 * @throws what a getter or a Proxy trap of the input throws, unchanged
 * @since 0.2
 * @experimental
 * @example parse(number(), '1') // an error at path [], code 'schema.invalid_type'
 */
export function parse<I, O>(schema: Schema<I, O>, input: unknown): Result<O, readonly SchemaIssue[]> {
  const reading: Reading = { path: [], issues: [] };
  const value = schema['~run'](input, reading);
  return reading.issues.length === 0 ? ok(value) : err(reading.issues);
}

/**
 * `schema` with the application's words: the issues its `~standard` interface gives carry what `format` builds, where
 * they would carry their code. Call it on the one schema an engine reads; the schemas it holds need nothing. The
 * schema is not changed, and `parse` gives the same issues as before.
 * @pure
 * @sharing structural
 * @complexity O(1), plus one call of `format` per issue of a read through `~standard`
 * @throws TypeError when `schema` is not a schema
 * @throws TypeError when `format` is not a function, or returns something else than a string, at the read
 * @since 0.2
 * @experimental
 * @example withMessages(number(), (issue) => `Invalid: ${issue.code}`)
 */
export function withMessages<S extends Schema<unknown, unknown>>(schema: S, format: IssueFormatter): S {
  checkSchema(schema);
  return { ...schema, '~standard': propsOf(schema, format) };
}
