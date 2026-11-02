// The types a schema gives, and the copied interface judged by the specification's own, both ways (ADR 0031). Nothing
// here runs but the empty test that keeps the file a test: the compiler is the judge.
import { test } from 'node:test';

import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { StandardIssue } from '@yaltaan/core/issue';
import { assertType, type Equal } from '@yaltaan/testing';

import {
  array,
  discriminatedUnion,
  literal,
  nullable,
  number,
  object,
  optional,
  string,
  withMessages,
  type InferInput,
  type InferOutput,
  type Schema,
  type StandardOptions,
  type StandardProps,
  type StandardResult,
  type StandardSchema,
  type StandardTypes,
} from './index.ts';

// Assignable in both directions: the specification states readonly members and optional ones, which `Equal` would
// tell apart from the same members written through a named alias.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

assertType<Same<StandardSchema<string, number>, StandardSchemaV1<string, number>>>();
assertType<Same<StandardProps<string, number>, StandardSchemaV1.Props<string, number>>>();
assertType<Same<StandardResult<number>, StandardSchemaV1.Result<number>>>();
assertType<Same<StandardOptions, StandardSchemaV1.Options>>();
assertType<Same<StandardTypes<string, number>, StandardSchemaV1.Types<string, number>>>();
assertType<Same<StandardIssue, StandardSchemaV1.Issue>>();

const login = object({
  email: string(),
  age: optional(number()),
  nick: optional(string(), { exactOptional: true }),
  plan: nullable(literal('free')),
  tags: array(string()),
  inner: object({ deep: optional(nullable(number())) }),
});

interface Login {
  email: string;
  age?: number | undefined;
  nick?: string;
  plan: 'free' | null;
  tags: string[];
  inner: { deep?: number | null | undefined };
}

assertType<Equal<InferOutput<typeof login>, Login>>();
assertType<Equal<InferInput<typeof login>, Login>>();
assertType<Equal<StandardSchemaV1.InferOutput<typeof login>, Login>>();
assertType<Equal<StandardSchemaV1.InferInput<typeof login>, Login>>();

// What any library that accepts a Standard Schema writes in its signature, and what Angular's validator asks.
const accepted: StandardSchemaV1<Login, Login> = login;
assertType<Equal<typeof accepted, StandardSchemaV1<Login, Login>>>();

const stringSchema = string();
assertType<Equal<InferOutput<typeof stringSchema>, string>>();
const numberSchema = number();
assertType<Equal<InferOutput<typeof numberSchema>, number>>();
const literalString = literal('a');
assertType<Equal<InferOutput<typeof literalString>, 'a'>>();
const literalNull = literal(null);
assertType<Equal<InferOutput<typeof literalNull>, null>>();
const nullableOptional = object({ a: nullable(optional(string())) });
// `nullable` over `optional` still requires the key: the type says what a read does.
assertType<Equal<InferOutput<typeof nullableOptional>, { a: string | null | undefined }>>();

const loose = object({ a: string() }, { unknownKeys: 'passthrough' });
const looseValue = {} as InferOutput<typeof loose>;
assertType<Equal<typeof looseValue.a, string>>();
assertType<Equal<(typeof looseValue)['anything'], unknown>>();

const strict = object({ a: string() }, { unknownKeys: 'reject' });
assertType<Equal<InferOutput<typeof strict>, { a: string }>>();

const union = discriminatedUnion('by', [
  object({ by: literal('card'), pan: string() }),
  object({ by: literal('cash'), rounded: optional(number()) }),
]);
assertType<
  Equal<InferOutput<typeof union>, { by: 'card'; pan: string } | { by: 'cash'; rounded?: number | undefined }>
>();

const worded = withMessages(login, (issue) => issue.code);
assertType<Equal<typeof worded, typeof login>>();

// Never called: each line states a compile error, and would throw if it ran.
export function refusedByTheCompiler(): Schema[] {
  return [
    // @ts-expect-error a number has no pattern
    number({ pattern: /a/ }),
    // @ts-expect-error a pattern needs maxLength
    string({ pattern: /a/ }),
    // @ts-expect-error a literal is no bigint: no schema of numbers reads one, and JSON cannot carry one
    literal(1n),
    // @ts-expect-error a string has no min
    string({ min: 1 }),
    // @ts-expect-error unknownKeys names one of three modes
    object({}, { unknownKeys: 'keep' }),
    // @ts-expect-error an entry is a schema
    object({ a: 1 }),
    // @ts-expect-error a literal is a primitive
    literal({}),
    // @ts-expect-error an option needs a literal under the key
    discriminatedUnion('by', [object({ by: string() })]),
    // @ts-expect-error an option needs the key
    discriminatedUnion('by', [object({ other: literal(1) })]),
    // @ts-expect-error optional holds a schema
    optional('a'),
  ];
}

test('the types of a schema are checked by the compiler', () => {});
