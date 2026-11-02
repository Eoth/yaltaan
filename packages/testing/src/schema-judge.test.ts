// The judges of a schema library, judged. valibot against itself must agree on every generated input and pass the
// conformance table, which shows the table is not stricter than a real implementation; each defect made on purpose
// below must then be refused. Defects are made on the valibot side, so that the judge is seen to bite before any
// schema of ours exists.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StandardSchemaV1 } from '@standard-schema/spec';
import fc from 'fast-check';
import * as v from 'valibot';

import { runComparison } from './judge.ts';
import {
  brokenRequirements,
  fromShape,
  readStandard,
  schemaCases,
  SHAPE_KINDS,
  STANDARD_SCHEMA_TABLE,
  standardValidate,
  valibotLibrary,
  type RequirementName,
  type SchemaCase,
  type Shape,
  type ShapeLibrary,
  type Verdict,
} from './schema-judge.ts';

// A defect fails on its first counterexample: shrinking one through chained generators is not what this file tests.
fc.configureGlobal({ endOnFailure: true });

type Library = typeof valibotLibrary;
type AnySchema = Parameters<Library['nullable']>[0];

const reference = ({ shape, input }: SchemaCase): Verdict => readStandard(fromShape(shape, valibotLibrary), input);

// One seed for the control and for every defect: what the control draws passes, so only the defect can fail a draw.
const SEEDED_BY = 'valibot against itself';

test('valibot agrees with itself on 1 000 generated cases, and passes the conformance table on each', (context) => {
  context.diagnostic(runComparison(SEEDED_BY, { input: schemaCases, ours: reference, theirs: reference }));
});

function kindsIn(shape: Shape): Shape['kind'][] {
  switch (shape.kind) {
    case 'optional':
    case 'nullable':
      return [shape.kind, ...kindsIn(shape.inner)];
    case 'array':
      return [shape.kind, ...kindsIn(shape.element)];
    case 'object':
      return [shape.kind, ...shape.entries.flatMap(([, inner]) => kindsIn(inner))];
    case 'union':
      return [shape.kind, ...shape.options.flatMap(({ entries }) => entries.flatMap(([, inner]) => kindsIn(inner)))];
    default:
      return [shape.kind];
  }
}

test('the generator reaches every kind of shape, and draws valid and invalid inputs alike', () => {
  const cases = fc.sample(schemaCases, { seed: 7, numRuns: 1000 });
  const seen = new Map<Shape['kind'], number>();
  let valid = 0;
  let manyIssues = 0;
  const depths = new Set<number>();
  for (const drawn of cases) {
    for (const kind of kindsIn(drawn.shape)) {
      seen.set(kind, (seen.get(kind) ?? 0) + 1);
    }
    const verdict = reference(drawn);
    if (verdict.valid) {
      valid += 1;
    } else {
      manyIssues += verdict.paths.length > 1 ? 1 : 0;
      verdict.paths.forEach((path) => depths.add(path.length));
    }
  }
  for (const kind of SHAPE_KINDS) {
    assert.ok((seen.get(kind) ?? 0) >= 50, `${kind} drawn ${seen.get(kind) ?? 0} times`);
  }
  assert.ok(valid >= 250, `${valid} valid inputs of 1 000`);
  assert.ok(cases.length - valid >= 250, `${cases.length - valid} invalid inputs of 1 000`);
  assert.ok(manyIssues >= 50, `${manyIssues} inputs with several issues`);
  assert.deepEqual([...depths].sort().slice(0, 3), [0, 1, 2], 'issues at the root and at depth 1 and 2');
});

/** A defect: what a library gets wrong, as a change of the library or of what its schemas answer. */
interface Defect {
  readonly name: string;
  readonly library?: Partial<Library>;
  readonly answer?: (verdict: Verdict, input: unknown) => Verdict;
}

const withoutKey = <T extends object>(options: T | undefined, key: keyof T): T => {
  const copy = { ...options } as T;
  delete copy[key];
  return copy;
};

const DEFECTS: readonly Defect[] = [
  {
    name: 'string takes a number',
    library: { string: (options) => v.union([valibotLibrary.string(options), v.number()]) as unknown as AnySchema },
  },
  { name: 'string ignores minLength', library: { string: (o) => valibotLibrary.string(withoutKey(o, 'minLength')) } },
  { name: 'string ignores maxLength', library: { string: (o) => valibotLibrary.string(withoutKey(o, 'maxLength')) } },
  { name: 'string ignores pattern', library: { string: (o) => valibotLibrary.string(withoutKey(o, 'pattern')) } },
  {
    name: 'number takes NaN',
    library: { number: (options) => v.union([valibotLibrary.number(options), v.nan()]) as unknown as AnySchema },
  },
  { name: 'number ignores min', library: { number: (o) => valibotLibrary.number(withoutKey(o, 'min')) } },
  { name: 'number ignores max', library: { number: (o) => valibotLibrary.number(withoutKey(o, 'max')) } },
  { name: 'number ignores integer', library: { number: (o) => valibotLibrary.number(withoutKey(o, 'integer')) } },
  {
    name: 'literal compares loosely',
    // eslint-disable-next-line eqeqeq
    library: { literal: (value) => v.custom((input) => input == value) as unknown as AnySchema },
  },
  {
    name: 'optional requires the key',
    library: {
      optional: (inner) => v.union([inner as never, v.undefined_()]) as unknown as AnySchema,
    },
  },
  { name: 'exactOptional takes undefined', library: { optional: (inner) => valibotLibrary.optional(inner) } },
  { name: 'nullable refuses null', library: { nullable: (inner) => inner } },
  { name: 'array checks no element', library: { array: (_, o) => valibotLibrary.array(v.unknown() as never, o) } },
  {
    name: 'array ignores minLength',
    library: { array: (e, o) => valibotLibrary.array(e, withoutKey(o, 'minLength')) },
  },
  {
    name: 'an object rejects nothing',
    library: {
      object: (entries, options) =>
        valibotLibrary.object(entries, options?.unknownKeys === 'reject' ? {} : (options ?? {})),
    },
  },
  {
    name: 'an object strips what it passes through',
    library: {
      object: (entries, options) =>
        valibotLibrary.object(entries, options?.unknownKeys === 'passthrough' ? {} : (options ?? {})),
    },
  },
  {
    name: 'an object keeps what it strips',
    library: {
      object: (entries, options) =>
        valibotLibrary.object(entries, { unknownKeys: options?.unknownKeys === 'reject' ? 'reject' : 'passthrough' }),
    },
  },
  {
    name: 'a union reads only its first option',
    library: { discriminatedUnion: (_, options) => options[0]! },
  },
  {
    name: 'issues lose the first step of their path',
    answer: (verdict) => (verdict.valid ? verdict : { valid: false, paths: verdict.paths.map((p) => p.slice(1)) }),
  },
  {
    name: 'only the first issue is reported',
    answer: (verdict) => (verdict.valid ? verdict : { valid: false, paths: verdict.paths.slice(0, 1) }),
  },
  {
    name: 'a success returns its input as it is',
    answer: (verdict, input) => (verdict.valid ? { valid: true, value: input } : verdict),
  },
];

for (const { name, library, answer } of DEFECTS) {
  test(`the judge refuses a library where ${name}`, () => {
    const faulty: ShapeLibrary<AnySchema> = { ...valibotLibrary, ...library };
    const ours = ({ shape, input }: SchemaCase): Verdict => {
      const verdict = readStandard(fromShape(shape, faulty), input);
      return answer === undefined ? verdict : answer(verdict, input);
    };
    assert.throws(() => runComparison(SEEDED_BY, { input: schemaCases, ours, theirs: reference }), {
      name: 'Error',
      message: /Property failed/,
    });
  });
}

// The example of the specification's `implement.ts`, with the one change each row needs.
interface Props {
  version?: unknown;
  vendor?: unknown;
  types?: unknown;
  validate?: unknown;
}

function exampleSchema(change: Props = {}): StandardSchemaV1 {
  const message = 'Invalid type';
  return {
    '~standard': {
      version: 1,
      vendor: 'valizod',
      validate: (value: unknown) => (typeof value === 'string' ? { value } : { issues: [{ message, path: [] }] }),
      ...change,
    },
  } as unknown as StandardSchemaV1;
}

const answering = (answer: unknown): Props => ({ validate: () => answer });

/** A schema that breaks each requirement, and an input it is read on. A new row of the table needs its own here. */
const BROKEN: Readonly<Record<RequirementName, { readonly schema: StandardSchemaV1; readonly input?: unknown }>> = {
  props: { schema: { '~standard': 1 } as unknown as StandardSchemaV1 },
  version: { schema: exampleSchema({ version: 2 }) },
  vendor: { schema: exampleSchema({ vendor: 1 }) },
  validate: { schema: exampleSchema({ validate: 'not a function' }) },
  types: { schema: exampleSchema({ types: 'not an object' }) },
  synchronous: { schema: exampleSchema(answering(Promise.resolve({ value: 1 }))) },
  result: { schema: exampleSchema(answering('a text')) },
  success: { schema: exampleSchema(answering({})) },
  failure: { schema: exampleSchema(answering({ issues: [] })) },
  message: { schema: exampleSchema(answering({ issues: [{ message: 1 }] })) },
  path: { schema: exampleSchema(answering({ issues: [{ message: 'm', path: 'a' }] })) },
  segment: { schema: exampleSchema(answering({ issues: [{ message: 'm', path: [{ key: {} }] }] })) },
  options: {
    schema: exampleSchema({
      validate: (_: unknown, options?: unknown) =>
        options === undefined ? { value: 1 } : { issues: [{ message: 'm' }] },
    }),
  },
};

test('the example of the specification passes the conformance table', () => {
  for (const input of ['text', 1]) {
    const schema = exampleSchema();
    const result = schema['~standard'].validate(input);
    assert.deepEqual(brokenRequirements({ schema, input, result }), []);
  }
  assert.deepEqual(readStandard(exampleSchema(), 'text'), { valid: true, value: 'text' });
  assert.deepEqual(readStandard(exampleSchema(), 1), { valid: false, paths: [[]] });
});

for (const name of Object.keys(STANDARD_SCHEMA_TABLE) as RequirementName[]) {
  test(`the conformance table refuses a schema that breaks: ${name}`, () => {
    const { schema, input = 'text' } = BROKEN[name];
    const validate = (schema['~standard'] as { validate?: unknown } | undefined)?.validate;
    const result: unknown =
      typeof validate === 'function' ? (validate as (value: unknown) => unknown)(input) : undefined;
    assert.ok(brokenRequirements({ schema, input, result }).includes(name), name);
    assert.throws(() => readStandard(schema, input), new RegExp(`not Standard Schema: .*${name}`));
  });
}

test('a segment may be a property key of any kind or an object that holds one', () => {
  const issues = [
    { message: 'm', path: ['a', 0, Symbol.for('s'), { key: 'b' }, { key: 1 }, { key: Symbol.for('t') }] },
  ];
  const schema = exampleSchema(answering({ issues }));
  assert.deepEqual(readStandard(schema, 'text'), {
    valid: false,
    paths: [['a', 0, Symbol.for('s'), 'b', 1, Symbol.for('t')]],
  });
});

test('the generic consumer of the specification reads a value, and throws the issues', async () => {
  assert.equal(await standardValidate(exampleSchema(), 'text'), 'text');
  await assert.rejects(standardValidate(exampleSchema(), 1), /Invalid type/);
});
