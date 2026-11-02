// The judges of a schema library (ADR 0031). The Standard Schema specification publishes no test suite, so its
// requirements are written here as a table of named checks, applied to whatever a schema returns through `~standard`.
// valibot judges the behaviour: a shape, plain data that describes a schema, is built by each library through a
// `ShapeLibrary`, and both read the same input through `~standard`: same verdict, same output, same issue paths.
//
// Blind spots: codes and parameters of issues (valibot has neither); getters, proxies, symbol and non-enumerable keys,
// which no generator draws (the adversarial catalogue and the laws of the package reach them); more than a few issues
// or elements, so no limit of a library; an input both libraries mishandle alike; the same seeds on every run; and how
// an engine uses a schema, which only a real engine can say.
import type { StandardSchemaV1 } from '@standard-schema/spec';
import fc from 'fast-check';
import * as v from 'valibot';

/** How an object schema treats a key it does not declare. */
export type UnknownKeys = 'strip' | 'reject' | 'passthrough';

/** A value a literal schema can hold. */
export type LiteralValue = string | number | boolean | null;

/** One alternative of a discriminated union: its literal under the union's key, and its other fields. */
export interface UnionOption {
  readonly literal: LiteralValue;
  readonly entries: readonly (readonly [string, Shape])[];
  readonly unknownKeys: UnknownKeys;
}

/** A schema described as data, which any `ShapeLibrary` can build. */
export type Shape =
  | { readonly kind: 'string'; readonly options: StringOptions }
  | { readonly kind: 'number'; readonly options: NumberOptions }
  | { readonly kind: 'literal'; readonly value: LiteralValue }
  | { readonly kind: 'optional'; readonly inner: Shape; readonly exact: boolean }
  | { readonly kind: 'nullable'; readonly inner: Shape }
  | { readonly kind: 'array'; readonly element: Shape; readonly options: LengthOptions }
  | { readonly kind: 'object'; readonly entries: UnionOption['entries']; readonly unknownKeys: UnknownKeys }
  | { readonly kind: 'union'; readonly key: string; readonly options: readonly UnionOption[] };

export interface LengthOptions {
  readonly minLength?: number;
  readonly maxLength?: number;
}

export interface StringOptions extends LengthOptions {
  readonly pattern?: RegExp;
}

export interface NumberOptions {
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
}

/** Every kind of shape, for the checks that a library or a generator covers them all; the compiler keeps it whole. */
export const SHAPE_KINDS: readonly Shape['kind'][] = Object.keys({
  string: true,
  number: true,
  literal: true,
  optional: true,
  nullable: true,
  array: true,
  object: true,
  union: true,
} satisfies Record<Shape['kind'], true>) as Shape['kind'][];

/** What a library must offer to be judged. `S` is its schema type; every schema also speaks Standard Schema. */
export interface ShapeLibrary<S extends StandardSchemaV1 = StandardSchemaV1> {
  string(options?: StringOptions): S;
  number(options?: NumberOptions): S;
  literal(value: LiteralValue): S;
  optional(inner: S, options?: { readonly exactOptional?: boolean }): S;
  nullable(inner: S): S;
  array(element: S, options?: LengthOptions): S;
  object(entries: Readonly<Record<string, S>>, options?: { readonly unknownKeys?: UnknownKeys }): S;
  discriminatedUnion(key: string, options: readonly S[]): S;
}

/** Builds the schema `shape` describes with `library`. Keys arrive in the same order for every library. */
export function fromShape<S extends StandardSchemaV1>(shape: Shape, library: ShapeLibrary<S>): S {
  const child = (inner: Shape): S => fromShape(inner, library);
  const entriesOf = (entries: UnionOption['entries']): Record<string, S> =>
    Object.fromEntries(entries.map(([key, inner]) => [key, child(inner)]));
  switch (shape.kind) {
    case 'string':
      return library.string(shape.options);
    case 'number':
      return library.number(shape.options);
    case 'literal':
      return library.literal(shape.value);
    case 'optional':
      return library.optional(child(shape.inner), { exactOptional: shape.exact });
    case 'nullable':
      return library.nullable(child(shape.inner));
    case 'array':
      return library.array(child(shape.element), shape.options);
    case 'object':
      return library.object(entriesOf(shape.entries), { unknownKeys: shape.unknownKeys });
    case 'union':
      return library.discriminatedUnion(
        shape.key,
        shape.options.map((option) =>
          library.object(
            { [shape.key]: library.literal(option.literal), ...entriesOf(option.entries) },
            { unknownKeys: option.unknownKeys },
          ),
        ),
      );
  }
}

type AnyValibot = v.GenericSchema & StandardSchemaV1;

function piped(
  schema: AnyValibot,
  actions: readonly (v.BaseValidation<never, never, never> | undefined)[],
): AnyValibot {
  const present = actions.filter((action) => action !== undefined);
  return present.length === 0 ? schema : (v.pipe(schema, ...(present as [never])) as unknown as AnyValibot);
}

/** The same shapes in valibot, its object, strictObject and looseObject standing for the three `unknownKeys`. */
export const valibotLibrary: ShapeLibrary<AnyValibot> = {
  string: ({ minLength, maxLength, pattern } = {}) =>
    piped(v.string(), [
      minLength === undefined ? undefined : (v.minLength(minLength) as never),
      maxLength === undefined ? undefined : (v.maxLength(maxLength) as never),
      pattern === undefined ? undefined : (v.regex(pattern) as never),
    ]),
  number: ({ min, max, integer } = {}) =>
    piped(v.number(), [
      min === undefined ? undefined : (v.minValue(min) as never),
      max === undefined ? undefined : (v.maxValue(max) as never),
      integer === true ? (v.integer() as never) : undefined,
    ]),
  literal: (value) => (value === null ? v.null_() : v.literal(value)) as AnyValibot,
  optional: (inner, { exactOptional } = {}) =>
    (exactOptional === true ? v.exactOptional(inner) : v.optional(inner)) as unknown as AnyValibot,
  nullable: (inner) => v.nullable(inner) as unknown as AnyValibot,
  array: (element, { minLength, maxLength } = {}) =>
    piped(v.array(element) as unknown as AnyValibot, [
      minLength === undefined ? undefined : (v.minLength(minLength) as never),
      maxLength === undefined ? undefined : (v.maxLength(maxLength) as never),
    ]),
  object: (entries, { unknownKeys = 'strip' } = {}) => {
    if (unknownKeys === 'reject') {
      return v.strictObject(entries) as unknown as AnyValibot;
    }
    return (unknownKeys === 'passthrough' ? v.looseObject(entries) : v.object(entries)) as unknown as AnyValibot;
  },
  discriminatedUnion: (key, options) => v.variant(key, options as never) as unknown as AnyValibot,
};

// The conformance table. One row per requirement of the interface of @standard-schema/spec 1.1.0.

/** What a row is shown: the schema, and what its `validate` returned for the input. */
export interface Reading {
  readonly schema: StandardSchemaV1;
  readonly input: unknown;
  readonly result: unknown;
}

/** One requirement of the specification; `holds` says whether a reading meets it. */
export interface ConformanceRow {
  readonly says: string;
  readonly holds: (reading: Reading) => boolean;
}

function propsOf(schema: StandardSchemaV1): Readonly<Record<string, unknown>> {
  return schema['~standard'] as unknown as Readonly<Record<string, unknown>>;
}

function issuesOf(result: unknown): readonly unknown[] {
  const { issues } = result as { readonly issues?: unknown };
  return Array.isArray(issues) ? (issues as readonly unknown[]) : [];
}

function isPropertyKey(value: unknown): value is PropertyKey {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'symbol';
}

function isSegment(segment: unknown): boolean {
  return (
    isPropertyKey(segment) ||
    (typeof segment === 'object' && segment !== null && isPropertyKey((segment as { key?: unknown }).key))
  );
}

function everyIssue(result: unknown, holds: (issue: { message?: unknown; path?: unknown }) => boolean): boolean {
  return issuesOf(result).every((issue) => holds(issue as { message?: unknown; path?: unknown }));
}

/** Every requirement the specification states, by the name a verdict gives it. */
export const STANDARD_SCHEMA_TABLE = {
  props: {
    says: 'a schema holds its Standard Schema properties in `~standard`',
    holds: ({ schema }) => typeof schema['~standard'] === 'object' && schema['~standard'] !== null,
  },
  version: {
    says: '`version` is the number of the standard, 1',
    holds: ({ schema }) => propsOf(schema)['version'] === 1,
  },
  vendor: {
    says: '`vendor` is the name of the schema library, a string',
    holds: ({ schema }) => typeof propsOf(schema)['vendor'] === 'string',
  },
  validate: {
    says: '`validate` is a function',
    holds: ({ schema }) => typeof propsOf(schema)['validate'] === 'function',
  },
  types: {
    says: '`types`, when present, is an object or undefined',
    holds: ({ schema }) => {
      const { types } = propsOf(schema);
      return types === undefined || (typeof types === 'object' && types !== null);
    },
  },
  synchronous: {
    says: 'a synchronous schema returns its result, not a `Promise`, which some consumers refuse',
    holds: ({ result }) => !(result instanceof Promise),
  },
  result: {
    says: '`validate` returns a success or a failure, each an object',
    holds: ({ result }) => typeof result === 'object' && result !== null,
  },
  success: {
    says: 'a success holds its `value`, and its `issues` are falsy',
    holds: ({ result }) => Boolean((result as { issues?: unknown }).issues) || 'value' in (result as object),
  },
  failure: {
    says: 'a failure holds its `issues` in an array that is not empty',
    holds: ({ result }) => {
      const { issues } = result as { readonly issues?: unknown };
      return !issues || (Array.isArray(issues) && issues.length > 0);
    },
  },
  message: {
    says: 'an issue holds its message, a string',
    holds: ({ result }) => everyIssue(result, ({ message }) => typeof message === 'string'),
  },
  path: {
    says: 'the path of an issue is absent, undefined or an array',
    holds: ({ result }) => everyIssue(result, ({ path }) => path === undefined || Array.isArray(path)),
  },
  segment: {
    says: 'a segment of a path is a property key, or an object whose `key` is one',
    holds: ({ result }) =>
      everyIssue(result, ({ path }) => !Array.isArray(path) || (path as readonly unknown[]).every(isSegment)),
  },
  options: {
    says: '`validate` takes the options `libraryOptions`, or none, and answers the same',
    holds: ({ schema, input, result }) => {
      const validate = schema['~standard'].validate;
      const verdict = (answer: unknown): boolean => Boolean((answer as { issues?: unknown }).issues);
      const expected = verdict(result);
      return (
        verdict(validate(input, undefined)) === expected &&
        verdict(validate(input, { libraryOptions: {} })) === expected
      );
    },
  },
} as const satisfies Readonly<Record<string, ConformanceRow>>;

/** The name of a requirement of `STANDARD_SCHEMA_TABLE`. */
export type RequirementName = keyof typeof STANDARD_SCHEMA_TABLE;

/** The names of the requirements `reading` breaks, in the order of the table. */
export function brokenRequirements(reading: Reading): RequirementName[] {
  const broken: RequirementName[] = [];
  for (const name of Object.keys(STANDARD_SCHEMA_TABLE) as RequirementName[]) {
    let holds: boolean;
    try {
      holds = STANDARD_SCHEMA_TABLE[name].holds(reading);
    } catch {
      holds = false;
    }
    if (!holds) {
      broken.push(name);
    }
  }
  return broken;
}

/** What a schema answers for an input, in the words both libraries share. */
export type Verdict =
  | { readonly valid: true; readonly value: unknown }
  | { readonly valid: false; readonly paths: readonly (readonly PropertyKey[])[] };

/**
 * Reads `input` through the `~standard` interface of `schema`, the only thing the two libraries share. Throws an error
 * that names the requirement when what the schema returned breaks the table.
 */
export function readStandard(schema: StandardSchemaV1, input: unknown): Verdict {
  const props = schema['~standard'] as StandardSchemaV1['~standard'] | undefined;
  const result: unknown = typeof props?.validate === 'function' ? props.validate(input) : undefined;
  const broken = brokenRequirements({ schema, input, result });
  if (broken.length > 0) {
    throw new Error(`not Standard Schema: ${broken.join(', ')}`);
  }
  const { value, issues } = result as { readonly value?: unknown; readonly issues?: readonly StandardSchemaV1.Issue[] };
  if (!issues) {
    return { valid: true, value };
  }
  return {
    valid: false,
    paths: issues.map(({ path = [] }) => path.map((segment) => (typeof segment === 'object' ? segment.key : segment))),
  };
}

/**
 * The generic consumer of the specification, `standardValidate` of its `integrate.ts`, as it is: what a library that
 * accepts any schema does with one. It throws the issues as JSON.
 */
export async function standardValidate<T extends StandardSchemaV1>(
  schema: T,
  input: StandardSchemaV1.InferInput<T>,
): Promise<StandardSchemaV1.InferOutput<T>> {
  let result = schema['~standard'].validate(input);
  if (result instanceof Promise) result = await result;

  // if the `issues` field exists, the validation failed
  if (result.issues) {
    throw new Error(JSON.stringify(result.issues, null, 2));
  }

  return result.value;
}

// The generators. Keys are drawn from names that break a careless reader: an inherited name, an index, a non-ASCII one.

const DECLARED_KEYS = ['a', 'b', 'c', 'toString', 'valueOf', '0', 'é'];
const UNKNOWN_KEYS = ['x', 'y', 'z', '__proto__', 'constructor', 'prototype', 'hasOwnProperty'];
const DISCRIMINATORS = ['kind', 'type'];
const LITERALS: readonly LiteralValue[] = ['a', 'b', '', 0, 1, -1, true, false, null];

class Instance {
  a = 'a';
  b = 1;
}

/** Values no schema of a generated shape is built around: every kind JavaScript has that a reader must tell apart. */
const JUNK: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  null,
  undefined,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -0,
  0,
  1.5,
  '',
  'a',
  '\uD800',
  true,
  1n,
  [],
  [1],
  // Two holes: a reader sees `undefined` at each index, and `in` sees nothing.
  new Array<unknown>(2),
  {},
  { a: 'a' },
  new Date(0),
  new Map([['a', 'a']]),
  new Set(['a']),
  new Instance(),
  Object.create({ a: 'a', b: 1 }) as object,
  Object.create(null) as object,
  Symbol.for('a'),
  () => 'a',
);

const lengths = fc.oneof(
  { weight: 2, arbitrary: fc.constant<LengthOptions>({}) },
  fc.nat({ max: 3 }).map((minLength): LengthOptions => ({ minLength })),
  fc.nat({ max: 3 }).map((maxLength): LengthOptions => ({ maxLength })),
  fc
    .tuple(fc.nat({ max: 2 }), fc.nat({ max: 2 }))
    .map(([minLength, extra]): LengthOptions => ({ minLength, maxLength: minLength + extra })),
);

const PATTERNS: readonly RegExp[] = [/^[a-z]+$/, /^\d{2,3}$/, /a/, /^.$/su];

// A pattern comes with `maxLength`: a library may require it, so that the pattern only meets a bounded text.
const stringShape: fc.Arbitrary<Shape> = fc
  .tuple(lengths, fc.option(fc.constantFrom(...PATTERNS), { nil: undefined }), fc.integer({ min: 3, max: 8 }))
  .map(([options, pattern, longest]): Shape => {
    if (pattern === undefined) {
      return { kind: 'string', options };
    }
    const maxLength = options.maxLength ?? Math.max(options.minLength ?? 0, longest);
    return { kind: 'string', options: { ...options, maxLength, pattern } };
  });

const numberShape: fc.Arbitrary<Shape> = fc
  .record(
    { min: fc.integer({ min: -3, max: 3 }), span: fc.nat({ max: 4 }), integer: fc.boolean() },
    { requiredKeys: ['integer'] },
  )
  .map(({ min, span, integer }): Shape => {
    const bounded = min === undefined ? {} : { min, ...(span === undefined ? {} : { max: min + span }) };
    return { kind: 'number', options: integer ? { ...bounded, integer } : bounded };
  });

const literalShape: fc.Arbitrary<Shape> = fc
  .constantFrom(...LITERALS)
  .map((value): Shape => ({ kind: 'literal', value }));

const unknownKeysMode = fc.constantFrom<UnknownKeys>('strip', 'reject', 'passthrough');

function entriesAt(child: fc.Arbitrary<Shape>): fc.Arbitrary<UnionOption['entries']> {
  return fc
    .uniqueArray(fc.constantFrom(...DECLARED_KEYS), { maxLength: 3 })
    .chain((keys) => fc.tuple(...keys.map((key) => child.map((shape) => [key, shape] as const))));
}

function shapeAt(depth: number): fc.Arbitrary<Shape> {
  const leaf = fc.oneof(stringShape, numberShape, literalShape);
  if (depth === 0) {
    return leaf;
  }
  const child = shapeAt(depth - 1);
  const entries = entriesAt(child);
  const option = fc.record({ entries, unknownKeys: unknownKeysMode });
  return fc.oneof(
    leaf,
    fc.tuple(child, fc.boolean()).map(([inner, exact]): Shape => ({ kind: 'optional', inner, exact })),
    child.map((inner): Shape => ({ kind: 'nullable', inner })),
    fc.tuple(child, lengths).map(([element, options]): Shape => ({ kind: 'array', element, options })),
    { weight: 2, arbitrary: option.map((body): Shape => ({ kind: 'object', ...body })) },
    fc
      .tuple(
        fc.constantFrom(...DISCRIMINATORS),
        fc.uniqueArray(fc.constantFrom(...LITERALS), { minLength: 1, maxLength: 3 }),
        fc.array(option, { minLength: 3, maxLength: 3 }),
      )
      .map(([key, literals, bodies]): Shape => ({
        kind: 'union',
        key,
        options: literals.map((literal, index) => ({ ...bodies[index]!, literal })),
      })),
  );
}

/** Shapes up to three levels deep. */
export const shapes: fc.Arbitrary<Shape> = shapeAt(3);

function textNear({ minLength = 0, maxLength = minLength + 3, pattern }: StringOptions): fc.Arbitrary<string> {
  const sized = fc.string({ unit: fc.constantFrom('a', 'b', '1', '2', ' ', 'é', '\uD800'), minLength, maxLength });
  const off = fc.oneof(
    fc.constant('a'.repeat(maxLength + 1)),
    fc.constant('a'.repeat(Math.max(minLength - 1, 0))),
    fc.string({ unit: 'binary', maxLength: 8 }),
  );
  if (pattern === undefined) {
    return fc.oneof({ weight: 5, arbitrary: sized }, off);
  }
  return fc.oneof({ weight: 5, arbitrary: fc.stringMatching(pattern) }, sized, off);
}

function numberNear({ min = -3, max = min + 4, integer = false }: NumberOptions): fc.Arbitrary<number> {
  const inside = integer ? fc.integer({ min, max }) : fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
  return fc.oneof(
    { weight: 4, arbitrary: inside },
    fc.constantFrom(min, max),
    fc.constantFrom(min - 1, max + 1, min + 0.5, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    fc.double({ noNaN: true }),
  );
}

function recordNear(
  entries: UnionOption['entries'],
  fixed: Readonly<Record<string, unknown>>,
): fc.Arbitrary<Record<string, unknown>> {
  const values = entries.map(([key, shape]) => {
    const required = shape.kind !== 'optional';
    const presence = required ? fc.nat({ max: 9 }).map((roll) => roll !== 0) : fc.boolean();
    return fc.tuple(fc.constant(key), presence, inputNear(shape));
  });
  const extras = fc.oneof(
    { weight: 2, arbitrary: fc.constant<string[]>([]) },
    fc.uniqueArray(fc.constantFrom(...UNKNOWN_KEYS), { minLength: 1, maxLength: 3 }),
  );
  return fc.tuple(fc.tuple(...values), extras).map(([drawn, unknown]) => {
    const record: Record<string, unknown> = { ...fixed };
    for (const [key, present, value] of drawn) {
      if (present) {
        record[key] = value;
      }
    }
    // JSON.parse is how an own "__proto__" key reaches an application; a plain assignment would set the prototype.
    return unknown.reduce<Record<string, unknown>>(
      (target, key) =>
        Object.defineProperty(target, key, { value: 'extra', enumerable: true, configurable: true, writable: true }),
      record,
    );
  });
}

function valueNear(shape: Shape): fc.Arbitrary<unknown> {
  switch (shape.kind) {
    case 'string':
      return textNear(shape.options);
    case 'number':
      return numberNear(shape.options);
    case 'literal':
      return fc.oneof(
        { weight: 5, arbitrary: fc.constant(shape.value) },
        fc.constantFrom(...LITERALS),
        ...(shape.value === 0 ? [fc.constant(-0)] : []),
      );
    case 'optional':
      return fc.oneof({ weight: 3, arbitrary: inputNear(shape.inner) }, fc.constant(undefined));
    case 'nullable':
      return fc.oneof({ weight: 3, arbitrary: inputNear(shape.inner) }, fc.constant(null));
    case 'array': {
      const { minLength = 0, maxLength = minLength + 3 } = shape.options;
      return fc.oneof(
        { weight: 5, arbitrary: fc.array(inputNear(shape.element), { minLength, maxLength }) },
        fc.array(inputNear(shape.element), { maxLength: maxLength + 2 }),
        fc.array(inputNear(shape.element), { maxLength: Math.max(minLength - 1, 0) }),
      );
    }
    case 'object':
      return recordNear(shape.entries, {});
    case 'union': {
      const { key, options } = shape;
      const chosen = fc
        .constantFrom(...options)
        .chain((option) => recordNear(option.entries, { [key]: option.literal }));
      const broken = chosen.chain((record) =>
        fc.oneof(
          fc.constant(Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))),
          fc.constantFrom(...LITERALS).map((literal) => ({ ...record, [key]: literal })),
        ),
      );
      return fc.oneof({ weight: 6, arbitrary: chosen }, broken);
    }
  }
}

function inputNear(shape: Shape): fc.Arbitrary<unknown> {
  return fc.oneof({ weight: 12, arbitrary: valueNear(shape) }, JUNK);
}

function isObjectValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/** Every place of `input` a reader of `shape` walks to, with the shape of that place; a union reads as its option. */
export function* placesOf(shape: Shape, input: unknown): Generator<{ readonly shape: Shape; readonly input: unknown }> {
  yield { shape, input };
  switch (shape.kind) {
    case 'optional':
    case 'nullable':
      yield* placesOf(shape.inner, input);
      break;
    case 'array':
      if (Array.isArray(input)) {
        for (const element of Array.from(input as unknown[])) {
          yield* placesOf(shape.element, element);
        }
      }
      break;
    case 'object':
      if (isObjectValue(input)) {
        for (const [key, inner] of shape.entries) {
          if (key in input) {
            yield* placesOf(inner, input[key]);
          }
        }
      }
      break;
    case 'union': {
      const option = isObjectValue(input)
        ? shape.options.find(({ literal }) => literal === input[shape.key])
        : undefined;
      if (option !== undefined) {
        const entries: UnionOption['entries'] = [
          [shape.key, { kind: 'literal', value: option.literal }],
          ...option.entries,
        ];
        yield* placesOf({ kind: 'object', entries, unknownKeys: option.unknownKeys }, input);
      }
      break;
    }
    default:
  }
}

/** One case of a judge: a schema described as data, and an input near it. */
export interface SchemaCase {
  readonly shape: Shape;
  readonly input: unknown;
}

/** Shapes with inputs near them: valid more than a quarter of the time, and broken at every depth. */
export const schemaCases: fc.Arbitrary<SchemaCase> = shapes.chain((shape) =>
  inputNear(shape).map((input) => ({ shape, input })),
);
