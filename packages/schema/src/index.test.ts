import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runInNewContext } from 'node:vm';

import { fromStandardIssue } from '@yaltaan/core/issue';
import { declareAdversarial, fc, HostileError, type Callback } from '@yaltaan/testing';
import {
  fromShape,
  placesOf,
  readStandard,
  schemaCases,
  standardValidate,
  type SchemaCase,
  type Shape,
  type ShapeLibrary,
} from '@yaltaan/testing/schema-judge';

import * as schema from './index.ts';
import {
  array,
  boolean,
  discriminatedUnion,
  literal,
  nullable,
  number,
  object,
  optional,
  parse,
  picklist,
  string,
  withMessages,
  type Schema,
  type SchemaIssue,
  type SchemaLiteral,
  type UnknownKeys,
} from './index.ts';

const SUBPATH = '@yaltaan/schema';
const library = schema as unknown as ShapeLibrary<Schema>;

const build = ({ shape }: SchemaCase): Schema => fromShape(shape, library);

function issuesOf<I, O>(read: Schema<I, O>, input: unknown): readonly SchemaIssue[] {
  const result = parse(read, input);
  return result.ok ? [] : result.error;
}

function freezeDeep(value: unknown): void {
  if ((Array.isArray(value) || (typeof value === 'object' && value !== null)) && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value as object)) {
      freezeDeep((value as Record<PropertyKey, unknown>)[key]);
    }
  }
}

// The invariants of ARCHITECTURE.md §7.9, on the schemas and inputs the judge generates.

test('a read is deterministic: same schema and input, same result, the schema built twice too', () => {
  fc.assert(
    fc.property(schemaCases, (drawn) => {
      const first = parse(build(drawn), drawn.input);
      assert.deepStrictEqual(parse(build(drawn), drawn.input), first);
      const read = build(drawn);
      assert.deepStrictEqual(parse(read, drawn.input), parse(read, drawn.input));
    }),
    { numRuns: 300 },
  );
});

test('a valid value read again gives the same value, and parse is idempotent', () => {
  let valid = 0;
  fc.assert(
    fc.property(schemaCases, (drawn) => {
      const read = build(drawn);
      const first = parse(read, drawn.input);
      if (first.ok) {
        valid += 1;
        assert.deepStrictEqual(parse(read, first.value), first);
      }
    }),
    { numRuns: 1000 },
  );
  assert.ok(valid >= 250, `${valid} valid inputs of 1 000`);
});

test('a read never mutates its input: a frozen input reads the same', () => {
  fc.assert(
    fc.property(schemaCases, (drawn) => {
      const read = build(drawn);
      const before = parse(read, drawn.input);
      freezeDeep(drawn.input);
      assert.deepStrictEqual(parse(read, drawn.input), before);
    }),
    { numRuns: 300 },
  );
});

test('~standard answers what parse answers, with the code as the message', () => {
  fc.assert(
    fc.property(schemaCases, (drawn) => {
      const read = build(drawn);
      const result = parse(read, drawn.input);
      const standard = read['~standard'].validate(drawn.input);
      if (result.ok) {
        assert.deepStrictEqual(standard, { value: result.value });
      } else {
        assert.deepStrictEqual(standard, {
          issues: result.error.map(({ code, path }) =>
            path.length === 0 ? { message: code } : { message: code, path },
          ),
        });
      }
      assert.deepStrictEqual(
        readStandard(read, drawn.input),
        result.ok
          ? { valid: true, value: result.value }
          : { valid: false, paths: result.error.map(({ path }) => path) },
      );
    }),
    { numRuns: 300 },
  );
});

// Walks an output beside its input: every array and object the shape declares must be a container of its own.
function assertFresh(shape: Shape, input: unknown, output: unknown): void {
  switch (shape.kind) {
    case 'optional':
    case 'nullable':
      if (input !== undefined && input !== null) {
        assertFresh(shape.inner, input, output);
      }
      break;
    case 'array':
      assert.notEqual(output, input);
      (output as unknown[]).forEach((element, index) => {
        assertFresh(shape.element, (input as unknown[])[index], element);
      });
      break;
    case 'object':
      assert.notEqual(output, input);
      for (const [key, inner] of shape.entries) {
        if (Object.hasOwn(input as object, key)) {
          assertFresh(inner, (input as Record<string, unknown>)[key], (output as Record<string, unknown>)[key]);
        }
      }
      break;
    case 'union': {
      const held = input as Record<string, unknown>;
      const option = shape.options.find(({ literal }) => literal === held[shape.key])!;
      assertFresh({ kind: 'object', entries: option.entries, unknownKeys: 'strip' }, input, output);
      break;
    }
    default:
  }
}

test('every container a schema declares is new in the output, at every level, and nothing reaches a prototype', () => {
  let valid = 0;
  fc.assert(
    fc.property(schemaCases, (drawn) => {
      const result = parse(build(drawn), drawn.input);
      if (result.ok) {
        valid += 1;
        assertFresh(drawn.shape, drawn.input, result.value);
      }
      assert.equal(({} as { polluted?: unknown }).polluted, undefined);
      assert.deepEqual(Object.keys(Object.prototype), []);
    }),
    { numRuns: 1000 },
  );
  assert.ok(valid >= 250, `${valid} valid inputs of 1 000`);
});

// What the judge leaves out of its comparison on purpose must still be judged: where valibot accepts and we say we
// refuse, we refuse, at every depth and in every mode. An input it reaches is read from a place both libraries walk.
test('an input the judge leaves to a refusing difference is refused, at any depth and in any mode', () => {
  const refuses = ({ shape, input }: { readonly shape: Shape; readonly input: unknown }): boolean => {
    if (shape.kind === 'number') {
      return input === Infinity || input === -Infinity;
    }
    if ((shape.kind !== 'object' && shape.kind !== 'union') || typeof input !== 'object' || input === null) {
      return false;
    }
    const prototype: unknown = Object.getPrototypeOf(input);
    if (prototype !== null && prototype !== Object.prototype) {
      return true;
    }
    return (
      shape.kind === 'object' &&
      shape.unknownKeys === 'reject' &&
      Object.keys(input).some((key) => !shape.entries.some(([declared]) => declared === key))
    );
  };
  let reached = 0;
  fc.assert(
    fc.property(schemaCases, (drawn) => {
      if ([...placesOf(drawn.shape, drawn.input)].some(refuses)) {
        reached += 1;
        assert.equal(parse(build(drawn), drawn.input).ok, false);
      }
    }),
    { numRuns: 3000 },
  );
  assert.ok(reached >= 200, `${reached} inputs of 3 000 reach a refusing difference`);
});

test('the generic consumer of the specification reads a schema of ours without a bridge', async () => {
  const login = object({ email: string(), password: string({ minLength: 8 }) });
  const value = { email: 'a@b.cd', password: 'analytical' };
  assert.deepEqual(await standardValidate(login, value), value);
  await assert.rejects(standardValidate(login, { email: 1, password: 'short' } as never), (error: Error) => {
    assert.deepEqual(JSON.parse(error.message), [
      { message: 'schema.invalid_type', path: ['email'] },
      { message: 'schema.too_short', path: ['password'] },
    ]);
    return true;
  });
});

// Codes and parameters, which no reference can judge.

const notString = fc.anything().filter((value) => typeof value !== 'string');

test('string: anything else than a string is one issue at the root, naming what was expected', () => {
  fc.assert(
    fc.property(notString, (value) => {
      assert.deepStrictEqual(parse(string(), value), {
        ok: false,
        error: [{ code: 'schema.invalid_type', path: [], params: { expected: 'string' } }],
      });
    }),
  );
});

test('string: any text is read as it is, lone surrogates included', () => {
  fc.assert(
    fc.property(fc.string({ unit: 'binary' }), (text) => {
      assert.deepStrictEqual(parse(string(), text), { ok: true, value: text });
    }),
  );
});

test('string: the bounds count code units, both are included, and each gives its issue with its parameters', () => {
  fc.assert(
    fc.property(fc.string({ unit: 'binary', maxLength: 8 }), fc.nat(8), fc.nat(8), (text, low, span) => {
      const { length } = text;
      const expected: SchemaIssue[] = [];
      if (length < low) {
        expected.push({ code: 'schema.too_short', path: [], params: { length, minimum: low } });
      }
      if (length > low + span) {
        expected.push({ code: 'schema.too_long', path: [], params: { length, maximum: low + span } });
      }
      assert.deepStrictEqual(issuesOf(string({ minLength: low, maxLength: low + span }), text), expected);
    }),
  );
});

test('string: a pattern gives invalid_format with its source, and is never tested on a text over maxLength', () => {
  const pattern = /^[a-z]+$/;
  assert.deepStrictEqual(issuesOf(string({ pattern, maxLength: 8 }), 'a1'), [
    { code: 'schema.invalid_format', path: [], params: { pattern: '^[a-z]+$' } },
  ]);
  assert.deepStrictEqual(issuesOf(string({ pattern, maxLength: 8 }), 'ab'), []);
  for (const bounds of [{ maxLength: 1 }, { minLength: 0, maxLength: 1 }, { minLength: 1, maxLength: 1 }]) {
    const tested: string[] = [];
    const spying = /x/;
    spying.test = (text: string): boolean => {
      tested.push(text);
      return false;
    };
    assert.deepStrictEqual(issuesOf(string({ ...bounds, pattern: spying }), 'long'), [
      { code: 'schema.too_long', path: [], params: { length: 4, maximum: 1 } },
    ]);
    assert.deepEqual(tested, []);
    assert.equal(issuesOf(string({ ...bounds, pattern: spying }), 'l')[0]?.code, 'schema.invalid_format');
    assert.deepEqual(tested, ['l']);
  }
});

test('number: only a finite number is read, -0 kept', () => {
  fc.assert(
    fc.property(fc.anything(), (value) => {
      const result = parse(number(), value);
      assert.equal(result.ok, typeof value === 'number' && Number.isFinite(value));
    }),
  );
  fc.assert(
    fc.property(fc.double(), (value) => {
      assert.deepStrictEqual(
        parse(number(), value),
        Number.isFinite(value)
          ? { ok: true, value }
          : { ok: false, error: [{ code: 'schema.invalid_type', path: [], params: { expected: 'number' } }] },
      );
    }),
  );
});

test('number: NaN and the infinities are one issue under any options, whatever a bound would say', () => {
  const bound = fc.option(fc.integer(), { nil: undefined });
  fc.assert(
    fc.property(
      bound,
      fc.nat(),
      fc.boolean(),
      fc.boolean(),
      fc.constantFrom(Number.NaN, Infinity, -Infinity),
      (min, span, bounded, integer, value) => {
        const options = {
          ...(min === undefined ? {} : { min }),
          ...(bounded ? { max: (min ?? 0) + span } : {}),
          integer,
        };
        assert.deepStrictEqual(issuesOf(number(options), value), [
          { code: 'schema.invalid_type', path: [], params: { expected: 'number' } },
        ]);
      },
    ),
  );
});

test('number: both bounds are included, and each limit gives its issue', () => {
  fc.assert(
    fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), fc.integer(), fc.nat(), (value, min, span) => {
      const expected: SchemaIssue[] = [];
      if (value < min) {
        expected.push({ code: 'schema.too_small', path: [], params: { minimum: min } });
      }
      if (value > min + span) {
        expected.push({ code: 'schema.too_large', path: [], params: { maximum: min + span } });
      }
      if (!Number.isInteger(value)) {
        expected.push({ code: 'schema.not_integer', path: [] });
      }
      assert.deepStrictEqual(issuesOf(number({ min, max: min + span, integer: true }), value), expected);
    }),
  );
  for (const bound of [-1.5, 0, 2]) {
    assert.deepStrictEqual(issuesOf(number({ min: bound, max: bound }), bound), []);
  }
});

const literals = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null));

test('literal: only what === its value is read, and it gives back what it read', () => {
  fc.assert(
    fc.property(literals, fc.oneof(literals, fc.anything()), (value, input) => {
      assert.deepStrictEqual(
        parse(literal(value as SchemaLiteral), input),
        input === value
          ? { ok: true, value: input }
          : { ok: false, error: [{ code: 'schema.invalid_value', path: [], params: { expected: [value] } }] },
      );
    }),
  );
  fc.assert(
    fc.property(literals, (value) => {
      assert.ok(parse(literal(value as SchemaLiteral), value).ok);
    }),
  );
  assert.ok(Object.is((parse(literal(0), -0) as { value: number }).value, -0));
});

test('boolean: true and false only, given back as read', () => {
  fc.assert(
    fc.property(fc.oneof(fc.boolean(), fc.anything()), (input) => {
      assert.deepStrictEqual(
        parse(boolean(), input),
        typeof input === 'boolean'
          ? { ok: true, value: input }
          : { ok: false, error: [{ code: 'schema.invalid_type', path: [], params: { expected: 'boolean' } }] },
      );
    }),
  );
  for (const input of [0, 1, 'true', 'false', '', null, new Boolean(true), [true]]) {
    assert.equal(parse(boolean(), input).ok, false, String(input));
  }
});

const choices = fc.uniqueArray(
  fc.oneof(fc.string(), fc.integer(), fc.double({ noNaN: true, noDefaultInfinity: true })),
  {
    minLength: 1,
    maxLength: 5,
    comparator: (one, other) => one === other,
  },
);

test('picklist: only what === one of its options is read, and it gives back what it read', () => {
  fc.assert(
    fc.property(
      choices,
      fc.oneof(
        choices.chain((options) => fc.constantFrom(...options)),
        fc.anything(),
      ),
      (options, input) => {
        assert.deepStrictEqual(
          parse(picklist(options), input),
          options.some((option) => option === input)
            ? { ok: true, value: input }
            : { ok: false, error: [{ code: 'schema.invalid_value', path: [], params: { expected: options } }] },
        );
      },
    ),
  );
  fc.assert(
    fc.property(choices, (options) => {
      for (const option of options) {
        assert.ok(parse(picklist(options), option).ok);
      }
    }),
  );
  assert.ok(Object.is((parse(picklist([0]), -0) as { value: number }).value, -0));
  assert.equal(parse(picklist([5.5, 10, 20]), '10').ok, false);
});

// Absent, `undefined` and `null`: the whole table, every field schema against every state.
const THREE_STATES = [
  {
    name: 'required',
    field: string(),
    absent: 'schema.missing',
    undefined: 'schema.invalid_type',
    null: 'schema.invalid_type',
  },
  { name: 'optional', field: optional(string()), absent: true, undefined: true, null: 'schema.invalid_type' },
  {
    name: 'exactOptional',
    field: optional(string(), { exactOptional: true }),
    absent: true,
    undefined: 'schema.invalid_type',
    null: 'schema.invalid_type',
  },
  {
    name: 'nullable',
    field: nullable(string()),
    absent: 'schema.missing',
    undefined: 'schema.invalid_type',
    null: true,
  },
  {
    name: 'nullable optional',
    field: nullable(optional(string())),
    absent: 'schema.missing',
    undefined: true,
    null: true,
  },
  { name: 'optional nullable', field: optional(nullable(string())), absent: true, undefined: true, null: true },
] as const;

for (const row of THREE_STATES) {
  test(`absent, undefined and null are three states for a field that is ${row.name}`, () => {
    const read = object({ a: row.field as Schema<unknown, unknown> });
    const inputs = { absent: {}, undefined: { a: undefined }, null: { a: null } } as const;
    for (const state of ['absent', 'undefined', 'null'] as const) {
      const expected = row[state];
      const result = parse(read, inputs[state]);
      if (expected === true) {
        assert.deepStrictEqual(result, { ok: true, value: inputs[state] }, state);
      } else {
        assert.equal(result.ok, false, state);
        assert.deepEqual(
          issuesOf(read, inputs[state]).map(({ code, path }) => [code, path]),
          [[expected, ['a']]],
          state,
        );
      }
    }
  });
}

test('optional and nullable leave every other value to the schema they hold', () => {
  fc.assert(
    fc.property(fc.anything(), (value) => {
      if (value !== undefined) {
        assert.deepStrictEqual(parse(optional(string()), value), parse(string(), value));
        assert.deepStrictEqual(parse(optional(string(), { exactOptional: true }), value), parse(string(), value));
      }
      if (value !== null) {
        assert.deepStrictEqual(parse(nullable(string()), value), parse(string(), value));
      }
    }),
  );
  assert.equal(issuesOf(optional(string(), { exactOptional: true }), undefined)[0]?.code, 'schema.invalid_type');
});

test('array: over maxLength one issue; otherwise each invalid element, in order, then minLength', () => {
  const entries = fc.array(fc.oneof(fc.string(), fc.integer()), { maxLength: 8 });
  fc.assert(
    fc.property(entries, fc.nat(4), fc.nat(4), (elements, low, span) => {
      const read = array(number(), { minLength: low, maxLength: low + span });
      const expected: SchemaIssue[] = [];
      if (elements.length > low + span) {
        expected.push({ code: 'schema.too_large', path: [], params: { maximum: low + span } });
      } else {
        elements.forEach((element, index) => {
          if (typeof element !== 'number') {
            expected.push({ code: 'schema.invalid_type', path: [index], params: { expected: 'number' } });
          }
        });
        if (elements.length < low) {
          expected.push({ code: 'schema.too_small', path: [], params: { minimum: low } });
        }
      }
      assert.deepStrictEqual(issuesOf(read, elements), expected);
    }),
  );
});

test('array: over maxLength no element is read, and a length with nothing behind it costs nothing', () => {
  let reads = 0;
  const counted = new Proxy([1, 2, 3], {
    get: (target, key, receiver) => {
      reads += typeof key === 'string' && key !== 'length' ? 1 : 0;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  assert.equal(issuesOf(array(number(), { maxLength: 2 }), counted)[0]?.code, 'schema.too_large');
  assert.equal(reads, 0);
  const announced: unknown[] = [];
  announced[2 ** 32 - 2] = 1;
  assert.deepStrictEqual(issuesOf(array(number(), { maxLength: 10 }), announced), [
    { code: 'schema.too_large', path: [], params: { maximum: 10 } },
  ]);
  assert.deepStrictEqual(issuesOf(array(optional(number())), announced), [
    { code: 'schema.too_large', path: [], params: { maximum: 1_000_000 } },
  ]);
});

test('array: the default limit is 1,000,000 elements, included, and a schema can name a larger one', () => {
  const read = array(optional(number()));
  assert.ok(parse(read, new Array(1_000_000)).ok);
  assert.ok(!parse(read, new Array(1_000_001)).ok);
  assert.ok(parse(array(optional(number()), { maxLength: 1_000_001 }), new Array(1_000_001)).ok);
});

test('a read keeps 1,000 issues, then says so once at the root, and stops walking', () => {
  for (const [count, kept] of [
    [999, 999],
    [1000, 1000],
    [1001, 1001],
    [5000, 1001],
  ] as const) {
    const issues = issuesOf(
      array(string()),
      Array.from({ length: count }, () => 0),
    );
    assert.equal(issues.length, kept, `${count} invalid elements`);
    assert.deepStrictEqual(
      issues.at(-1),
      count > 1000
        ? { code: 'schema.too_many_issues', path: [], params: { maximum: 1000 } }
        : { code: 'schema.invalid_type', path: [count - 1], params: { expected: 'string' } },
    );
  }
  let reads = 0;
  const elements = new Proxy(
    Array.from({ length: 5000 }, () => 0),
    {
      get: (target, key, receiver) => {
        reads += typeof key === 'string' && key !== 'length' ? 1 : 0;
        return Reflect.get(target, key, receiver) as unknown;
      },
    },
  );
  issuesOf(array(string()), elements);
  assert.equal(reads, 1001);
  const unknown = Object.fromEntries(Array.from({ length: 5000 }, (_, index) => [`k${index}`, 0]));
  assert.equal(issuesOf(object({}, { unknownKeys: 'reject' }), unknown).length, 1001);
  const wide = object(Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`f${index}`, string()])));
  const many = issuesOf(
    array(wide),
    Array.from({ length: 5000 }, () => ({})),
  );
  assert.equal(many.length, 1001);
  assert.equal(many.at(-1)?.code, 'schema.too_many_issues');
});

// A read of n elements against one of 32n: a linear cost takes 32 times the time, a quadratic one 1,024 times. The time
// of `read` is the fastest of five: a pause of the machine or of the collector lengthens one run, rarely all five.
// 200 times and 2 ms leave room for a loaded machine, where an array's growth and the collector cost several times what
// they cost at rest: six copies of this test on two cores read up to 40 times for 8n.
test('a read takes time proportional to its input', () => {
  const fastest = (read: Schema, input: unknown): number => {
    let best = Infinity;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const start = performance.now();
      parse(read, input);
      best = Math.min(best, performance.now() - start);
    }
    return best;
  };
  const record = (n: number): Record<string, number> =>
    Object.fromEntries(Array.from({ length: n }, (_, index) => [`k${index}`, index]));
  const cases: readonly [string, Schema, (n: number) => unknown][] = [
    ['array', array(number(), { maxLength: 1_000_000 }), (n) => Array.from({ length: n }, (_, index) => index)],
    ['array over its bound', array(number(), { maxLength: 1 }), (n) => Array.from({ length: n }, (_, index) => index)],
    ['strip', object({ k1: number() }), record],
    ['passthrough', object({ k1: number() }, { unknownKeys: 'passthrough' }), record],
    ['reject', object({ k1: number() }, { unknownKeys: 'reject' }), record],
  ];
  for (const [name, read, make] of cases) {
    const times = [5_000, 160_000].map((n) => fastest(read, make(n)));
    assert.ok(times[1]! <= 200 * times[0]! + 2, `${name}: ${times.map((time) => time.toFixed(2)).join(', ')} ms`);
  }
});

test('array: a hole is read as undefined, and the output is dense and new', () => {
  // eslint-disable-next-line no-sparse-arrays
  const holes = [1, , 3];
  const result = parse(array(optional(number())), holes);
  assert.deepStrictEqual(result, { ok: true, value: [1, undefined, 3] });
  assert.notEqual((result as { value: unknown }).value, holes);
  assert.deepEqual(issuesOf(array(number()), holes), [
    { code: 'schema.invalid_type', path: [1], params: { expected: 'number' } },
  ]);
  assert.equal(issuesOf(array(number()), { length: 0 })[0]?.code, 'schema.invalid_type');
});

const undeclared = fc.uniqueArray(fc.constantFrom('x', 'y', '__proto__', 'constructor', 'prototype', 'toString'), {
  maxLength: 6,
});

function withKeys(base: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const record = { ...base };
  for (const key of keys) {
    Object.defineProperty(record, key, { value: 'extra', writable: true, enumerable: true, configurable: true });
  }
  return record;
}

test('object: strip drops every unknown key, by default and by name', () => {
  fc.assert(
    fc.property(
      undeclared,
      fc.constantFrom<{ unknownKeys?: 'strip' }>({}, { unknownKeys: 'strip' }),
      (keys, options) => {
        const read = object({ a: number() }, options);
        assert.deepStrictEqual(parse(read, withKeys({ a: 1 }, keys)), { ok: true, value: { a: 1 } });
      },
    ),
  );
});

test('object: reject gives every unknown key its own issue, a key of the prototype included', () => {
  fc.assert(
    fc.property(undeclared, (keys) => {
      const read = object({ a: number() }, { unknownKeys: 'reject' });
      assert.deepStrictEqual(
        issuesOf(read, withKeys({ a: 1 }, keys)),
        keys.map((key) => ({ code: 'schema.unknown_key', path: [key] })),
      );
    }),
  );
});

test('object: passthrough keeps unknown keys but those a write refuses, and they reach no prototype', () => {
  fc.assert(
    fc.property(undeclared, (keys) => {
      const read = object({ a: number() }, { unknownKeys: 'passthrough' });
      const result = parse(read, withKeys({ a: 1 }, keys));
      const kept = keys.filter((key) => !['__proto__', 'constructor', 'prototype'].includes(key));
      assert.ok(result.ok);
      assert.deepEqual(Object.keys(result.value).sort(), ['a', ...kept].sort());
      assert.equal(Object.getPrototypeOf(result.value), Object.prototype);
      assert.equal(({} as { extra?: unknown }).extra, undefined);
    }),
  );
  const value = { nested: true };
  const kept = parse(object({}, { unknownKeys: 'passthrough' }), { value });
  assert.ok(kept.ok);
  assert.equal((kept.value as { value: unknown }).value, value, 'an unknown value is kept unchecked, not copied');
});

test('object: JSON text with __proto__ pollutes nothing under any mode', () => {
  const input: unknown = JSON.parse(
    '{"a":1,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
  );
  for (const unknownKeys of ['strip', 'passthrough'] as const) {
    const result = parse(object({ a: number() }, { unknownKeys }), input);
    assert.deepStrictEqual(result, { ok: true, value: { a: 1 } });
  }
  assert.deepEqual(
    issuesOf(object({ a: number() }, { unknownKeys: 'reject' }), input).map(({ path }) => path),
    [['__proto__'], ['constructor']],
  );
  assert.equal(({} as { polluted?: unknown }).polluted, undefined);
});

const MODES = ['strip', 'reject', 'passthrough'] as const;

for (const unknownKeys of MODES) {
  test(`object under ${unknownKeys}: a value that is no plain object is one issue, whatever it holds`, () => {
    class Point {
      a = 1;
    }
    const read = object({}, { unknownKeys });
    for (const input of [
      null,
      undefined,
      1,
      'a',
      true,
      [],
      [1, 2],
      new Date(0),
      new Map(),
      new Set(),
      new Point(),
      () => 1,
    ]) {
      assert.deepStrictEqual(parse(read, input), {
        ok: false,
        error: [{ code: 'schema.invalid_type', path: [], params: { expected: 'object' } }],
      });
    }
    assert.ok(!parse(read, Object.create({ a: 1 })).ok);
    assert.ok(!parse(read, runInNewContext('({})')).ok, 'an object of another realm');
    const dictionary = Object.create(null) as object;
    assert.deepStrictEqual(parse(read, dictionary), { ok: true, value: {} });
  });

  test(`object under ${unknownKeys}: only own keys are read, so a polluted prototype satisfies nothing`, () => {
    const read = object({ toString: optional(string()), admin: literal(true) }, { unknownKeys });
    assert.deepEqual(
      issuesOf(read, {}).map(({ code, path }) => [code, path]),
      [['schema.missing', ['admin']]],
    );
    (Object.prototype as { admin?: boolean }).admin = true;
    try {
      assert.equal(issuesOf(read, {})[0]?.code, 'schema.missing');
    } finally {
      delete (Object.prototype as { admin?: boolean }).admin;
    }
  });

  test(`object under ${unknownKeys}: a symbol or a key that is not enumerable is neither read nor kept`, () => {
    const input = Object.defineProperty({ a: 1, [Symbol.for('s')]: 2 }, 'hidden', { value: 3, enumerable: false });
    const result = parse(object({ a: number() }, { unknownKeys }), input);
    assert.deepStrictEqual(result, { ok: true, value: { a: 1 } });
  });

  test(`object under ${unknownKeys}: a key named as a prototype's is an own key of the output`, () => {
    const input = JSON.parse('{ "toString": "x" }') as object;
    const declared = object({ toString: string() }, { unknownKeys });
    assert.deepEqual(Object.getOwnPropertyDescriptor((parse(declared, input) as { value: object }).value, 'toString'), {
      value: 'x',
      writable: true,
      enumerable: true,
      configurable: true,
    });
  });
}

test('object: a setter or a read-only property planted on Object.prototype neither takes a value nor throws', () => {
  const taken: unknown[] = [];
  Object.defineProperty(Object.prototype, 'plantedSetter', {
    set: (value: unknown) => taken.push(value),
    configurable: true,
  });
  Object.defineProperty(Object.prototype, 'plantedConstant', { value: 1, writable: false, configurable: true });
  try {
    const input = { plantedSetter: 'secret', plantedConstant: 2 };
    const expected = {
      plantedSetter: { value: 'secret', writable: true, enumerable: true, configurable: true },
      plantedConstant: { value: 2, writable: true, enumerable: true, configurable: true },
    };
    const reads = [
      object({ plantedSetter: string(), plantedConstant: number() }),
      object({}, { unknownKeys: 'passthrough' }),
    ];
    for (const read of reads) {
      const result = parse(read as Schema, input);
      assert.ok(result.ok);
      assert.deepEqual(Object.getOwnPropertyDescriptors(result.value), expected);
    }
    assert.deepEqual(taken, []);
  } finally {
    delete (Object.prototype as { plantedSetter?: unknown }).plantedSetter;
    delete (Object.prototype as { plantedConstant?: unknown }).plantedConstant;
  }
});

test('object: under a frozen Object.prototype, a hardening some apply, a key of its names reads the same', () => {
  const module = new URL('./index.ts', import.meta.url).href;
  const script = `
    import { object, parse, string } from ${JSON.stringify(module)};
    Object.freeze(Object.prototype);
    const input = JSON.parse('{ "toString": "x", "valueOf": "y" }');
    const declared = parse(object({ toString: string(), valueOf: string() }), input);
    const kept = parse(object({}, { unknownKeys: 'passthrough' }), input);
    console.log(JSON.stringify([declared, kept]));
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '--no-warnings', '-e', script], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const value = { toString: 'x', valueOf: 'y' };
  assert.deepEqual(JSON.parse(run.stdout), [
    { ok: true, value },
    { ok: true, value },
  ]);
});

test('object: a key is read once, and the output holds what was checked', () => {
  let reads = 0;
  const input = {
    get a(): string {
      reads += 1;
      return reads === 1 ? 'checked' : 'changed';
    },
  };
  assert.deepStrictEqual(parse(object({ a: string() }), input), { ok: true, value: { a: 'checked' } });
  assert.equal(reads, 1);
});

test('object: a later write to the entries changes nothing the schema reads', () => {
  const entries: Record<string, Schema<unknown, unknown>> = { a: number() };
  const read = object(entries);
  entries['a'] = string();
  entries['b'] = string();
  assert.deepStrictEqual(parse(read, { a: 1 }), { ok: true, value: { a: 1 } });
  assert.deepEqual(Object.keys(read.entries), ['a']);
});

test('object: fields report in the order of the schema, nested paths whole', () => {
  const read = object({ b: number(), a: object({ c: array(object({ d: string() })) }) });
  assert.deepEqual(
    issuesOf(read, { a: { c: [{ d: 'ok' }, { d: 1 }, {}] }, b: 'x' }).map(({ code, path }) => [code, path]),
    [
      ['schema.invalid_type', ['b']],
      ['schema.invalid_type', ['a', 'c', 1, 'd']],
      ['schema.missing', ['a', 'c', 2, 'd']],
    ],
  );
});

const payment = (unknownKeys: UnknownKeys = 'strip'): ReturnType<typeof discriminatedUnion> =>
  discriminatedUnion('by', [
    object({ by: literal('card'), pan: string() }, { unknownKeys }),
    object({ by: literal(1), amount: number() }, { unknownKeys }),
    object({ by: literal(null) }, { unknownKeys }),
  ]);

test('discriminatedUnion: the literal names the option that reads the object, whose issues alone come out', () => {
  assert.deepStrictEqual(parse(payment(), { by: 'card', pan: '4', amount: 1 }), {
    ok: true,
    value: { by: 'card', pan: '4' },
  });
  assert.deepStrictEqual(parse(payment(), { by: 1, amount: 3 }), { ok: true, value: { by: 1, amount: 3 } });
  assert.deepStrictEqual(parse(payment(), { by: null }), { ok: true, value: { by: null } });
  assert.deepEqual(
    issuesOf(payment(), { by: 1, pan: 4 }).map(({ code, path }) => [code, path]),
    [['schema.missing', ['amount']]],
  );
  assert.deepEqual(
    issuesOf(payment('reject'), { by: null, x: 1 }).map(({ code, path }) => [code, path]),
    [['schema.unknown_key', ['x']]],
  );
});

test('discriminatedUnion: an absent key, an unnamed value and a non-object each give their issue', () => {
  assert.deepStrictEqual(issuesOf(payment(), {}), [{ code: 'schema.missing', path: ['by'] }]);
  assert.deepStrictEqual(issuesOf(payment(), { by: undefined }), [
    { code: 'schema.invalid_value', path: ['by'], params: { expected: ['card', 1, null] } },
  ]);
  assert.deepStrictEqual(issuesOf(payment(), { by: 'cash' }), [
    { code: 'schema.invalid_value', path: ['by'], params: { expected: ['card', 1, null] } },
  ]);
  for (const input of [null, 1, [], new Date(0)]) {
    assert.deepStrictEqual(issuesOf(payment(), input), [
      { code: 'schema.invalid_type', path: [], params: { expected: 'object' } },
    ]);
  }
  const inherited = Object.create({ by: 'card' }) as object;
  assert.equal(issuesOf(payment(), inherited)[0]?.code, 'schema.invalid_type');
  assert.equal(
    issuesOf(discriminatedUnion('toString', [object({ toString: literal('a') })]), {})[0]?.code,
    'schema.missing',
  );
});

test('withMessages: the interface says the words of format, parse keeps its codes, the schema is unchanged', () => {
  const read = object({ a: number() });
  const worded = withMessages(read, (issue) => `${issue.code} at ${issue.path.join('.')}`);
  assert.deepStrictEqual(worded['~standard'].validate({ a: 'x' }), {
    issues: [{ message: 'schema.invalid_type at a', path: ['a'] }],
  });
  assert.deepStrictEqual(read['~standard'].validate({ a: 'x' }), {
    issues: [{ message: 'schema.invalid_type', path: ['a'] }],
  });
  assert.deepStrictEqual(parse(worded, { a: 'x' }), parse(read, { a: 'x' }));
  assert.deepStrictEqual(worded['~standard'].validate({ a: 1 }), { value: { a: 1 } });
  assert.deepEqual(worded.entries, read.entries);
  assert.deepStrictEqual(parse(object({ b: withMessages(optional(number()), () => 'm') }), {}), {
    ok: true,
    value: {},
  });
});

test('withMessages: a format that returns no string is refused at the read, what it throws comes out', () => {
  const read = withMessages(number(), () => 1 as unknown as string);
  assert.throws(() => read['~standard'].validate('x'), TypeError);
  assert.deepStrictEqual(read['~standard'].validate(1), { value: 1 });
  const throwing = withMessages(number(), () => {
    throw new RangeError('format');
  });
  assert.throws(() => throwing['~standard'].validate('x'), RangeError);
});

test('an issue of another schema library crosses the boundary with its message and path', () => {
  const [issue] = (number()['~standard'].validate('x') as { issues: Parameters<typeof fromStandardIssue>[0][] }).issues;
  assert.deepStrictEqual(fromStandardIssue(issue!).params, { message: 'schema.invalid_type' });
});

test('a schema is built from valid arguments only: a bug in the calling code throws a TypeError', () => {
  const refused: readonly (() => unknown)[] = [
    () => string({ minLength: -1 }),
    () => string({ minLength: 1.5 }),
    () => string({ maxLength: Number.NaN }),
    () => string({ minLength: 2, maxLength: 1 }),
    () => string({ pattern: /a/g, maxLength: 1 }),
    () => string({ pattern: /a/y, maxLength: 1 }),
    () => string({ pattern: /a/ } as never),
    () => number({ min: Number.NaN }),
    () => number({ max: Number.POSITIVE_INFINITY }),
    () => number({ min: 2, max: 1 }),
    () => array(number(), { minLength: -1 }),
    () => array(number(), { minLength: 2, maxLength: 1 }),
    () => array(undefined as never),
    () => literal(Number.NaN),
    () => literal(Number.POSITIVE_INFINITY),
    () => literal(undefined as never),
    () => literal(1n as never),
    () => literal({} as never),
    () => picklist([]),
    () => picklist(['a', 'a']),
    () => picklist([0, -0]),
    () => picklist([Number.NaN]),
    () => picklist([Number.POSITIVE_INFINITY]),
    () => picklist([true] as never),
    () => picklist([null] as never),
    () => picklist('ab' as never),
    () => picklist(undefined as never),
    () => optional(1 as never),
    () => nullable(null as never),
    () => withMessages({} as never, () => ''),
    () => object({ a: 1 } as never),
    () => object(JSON.parse('{"__proto__":1}') as never),
    () => object({ ['__proto__']: string() }),
    () => object({ __proto__: string(), a: number() } as never),
    () => object(new Map() as never),
    () => object([] as never),
    () => object({ constructor: string() }),
    () => object({ prototype: string() }),
    () => discriminatedUnion('a', [number()] as never),
    () => discriminatedUnion('a', [object({ a: string() })] as never),
    () => discriminatedUnion('a', [object({})] as never),
    () => discriminatedUnion('a', [undefined] as never),
    () => discriminatedUnion('a', [{ entries: { a: literal(1) } }] as never),
    () => discriminatedUnion('a', [object({ a: literal(1) }), object({ a: literal(1) })]),
  ];
  refused.forEach((build, index) => {
    assert.throws(build, TypeError, `case ${index}`);
  });
  assert.deepStrictEqual(parse(string({ pattern: /a/iu, maxLength: 1 }), 'A'), { ok: true, value: 'A' });
  assert.deepStrictEqual(parse(string({ minLength: 1, maxLength: 1 }), 'a'), { ok: true, value: 'a' });
});

// The adversarial catalogue. What a hostile value throws must come out as its own error, or the read answers.

function ownErrorOnly(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof HostileError || error instanceof TypeError, String(error));
  }
}

const readsAs =
  (read: Schema, accepts: (value: unknown) => boolean) =>
  (value: unknown): void => {
    assert.equal(parse(read, value).ok, accepts(value));
  };

const isStringValue = (value: unknown): boolean => typeof value === 'string';
const isFiniteNumber = (value: unknown): boolean => Number.isFinite(value);

declareAdversarial(SUBPATH, 'string', {
  boundary: readsAs(string(), isStringValue),
  structures: readsAs(string(), isStringValue),
  hostile: (value) => ownErrorOnly(() => assert.ok(!parse(string(), value).ok)),
  unicode: (text) => assert.deepStrictEqual(parse(string(), text), { ok: true, value: text }),
  callbacks: { na: 'string takes no callback' },
  async: { na: 'string is synchronous and takes no signal' },
});

declareAdversarial(SUBPATH, 'number', {
  boundary: readsAs(number(), isFiniteNumber),
  structures: readsAs(number(), isFiniteNumber),
  hostile: (value) => ownErrorOnly(() => assert.ok(!parse(number(), value).ok)),
  unicode: (text) => assert.ok(!parse(number(), text).ok),
  callbacks: { na: 'number takes no callback' },
  async: { na: 'number is synchronous and takes no signal' },
});

declareAdversarial(SUBPATH, 'literal', {
  boundary: (value) => {
    assert.equal(parse(literal(null), value).ok, value === null);
    assert.equal(parse(literal(0), value).ok, value === 0);
    assert.equal(parse(literal(''), value).ok, value === '');
  },
  structures: (value) => assert.ok(!parse(literal('a'), value).ok),
  hostile: (value) => ownErrorOnly(() => assert.ok(!parse(literal('a'), value).ok)),
  unicode: (text) => {
    assert.ok(parse(literal(text), text).ok);
    assert.equal(parse(literal(text), `${text}x`).ok, false);
  },
  callbacks: { na: 'literal takes no callback' },
  async: { na: 'literal is synchronous and takes no signal' },
});

declareAdversarial(SUBPATH, 'boolean', {
  boundary: readsAs(boolean(), (value) => typeof value === 'boolean'),
  structures: (value) => assert.ok(!parse(boolean(), value).ok),
  hostile: (value) => ownErrorOnly(() => assert.ok(!parse(boolean(), value).ok)),
  unicode: (text) => assert.ok(!parse(boolean(), text).ok),
  callbacks: { na: 'boolean takes no callback' },
  async: { na: 'boolean is synchronous and takes no signal' },
});

declareAdversarial(SUBPATH, 'picklist', {
  boundary: (value) => {
    assert.equal(parse(picklist([0, '']), value).ok, value === 0 || value === '');
  },
  structures: (value) => assert.ok(!parse(picklist(['a']), value).ok),
  hostile: (value) => ownErrorOnly(() => assert.ok(!parse(picklist(['a']), value).ok)),
  unicode: (text) => {
    assert.ok(parse(picklist([text]), text).ok);
    assert.equal(parse(picklist([text]), `${text}x`).ok, false);
  },
  callbacks: { na: 'picklist takes no callback' },
  async: { na: 'picklist is synchronous and takes no signal' },
});

declareAdversarial(SUBPATH, 'optional', {
  boundary: readsAs(optional(string()), (value) => value === undefined || isStringValue(value)),
  structures: (value) => assert.ok(!parse(optional(string()), value).ok),
  hostile: (value) => ownErrorOnly(() => assert.ok(!parse(optional(string()), value).ok)),
  unicode: (text) => assert.ok(parse(optional(string()), text).ok),
  callbacks: { na: 'optional takes no callback' },
  async: { na: 'optional is synchronous and takes no signal' },
});

declareAdversarial(SUBPATH, 'nullable', {
  boundary: readsAs(nullable(string()), (value) => value === null || isStringValue(value)),
  structures: (value) => assert.ok(!parse(nullable(string()), value).ok),
  hostile: (value) => ownErrorOnly(() => assert.ok(!parse(nullable(string()), value).ok)),
  unicode: (text) => assert.ok(parse(nullable(string()), text).ok),
  callbacks: { na: 'nullable takes no callback' },
  async: { na: 'nullable is synchronous and takes no signal' },
});

const anyElement = array(optional(number()));

declareAdversarial(SUBPATH, 'array', {
  boundary: (value) => {
    const expected =
      Array.isArray(value) && value.every((element: unknown) => element === undefined || Number.isFinite(element));
    assert.equal(parse(anyElement, value).ok, expected);
  },
  structures: (value) => {
    // A cycle or a deep array ends: the depth of a read is that of the schema.
    const result = parse(array(optional(object({}))), value);
    assert.equal(typeof result.ok, 'boolean');
  },
  hostile: (value) => ownErrorOnly(() => parse(anyElement, value)),
  unicode: (text) => assert.deepStrictEqual(parse(array(string()), [text]), { ok: true, value: [text] }),
  callbacks: { na: 'array takes no callback' },
  async: { na: 'array is synchronous and takes no signal' },
});

const withAny = object({ a: optional(number()) }, { unknownKeys: 'passthrough' });

declareAdversarial(SUBPATH, 'object', {
  boundary: (value) => {
    const plain = typeof value === 'object' && value !== null && !Array.isArray(value);
    assert.equal(parse(object({}), value).ok, plain);
  },
  structures: (value) => {
    // A cycle or a deep object ends: the schema has one level, and passthrough copies no value.
    const result = parse(object({ self: optional(object({})) }, { unknownKeys: 'passthrough' }), value);
    assert.equal(typeof result.ok, 'boolean');
  },
  hostile: (value) =>
    ownErrorOnly(() => {
      const result = parse(withAny, value);
      assert.equal(({} as { polluted?: unknown }).polluted, undefined);
      if (result.ok) {
        assert.ok(!Object.hasOwn(result.value, '__proto__'));
        assert.ok(!Object.hasOwn(result.value, 'constructor'));
        assert.ok(!Object.hasOwn(result.value, 'prototype'));
      }
    }),
  unicode: (text) => {
    const input = { [text]: 1 };
    assert.deepStrictEqual(parse(object({ [text]: number() }), input), { ok: true, value: input });
    assert.deepStrictEqual(issuesOf(object({}, { unknownKeys: 'reject' }), input), [
      { code: 'schema.unknown_key', path: [text] },
    ]);
  },
  callbacks: { na: 'object takes no callback' },
  async: { na: 'object is synchronous and takes no signal' },
});

declareAdversarial(SUBPATH, 'discriminatedUnion', {
  boundary: (value) => assert.ok(!parse(payment(), value).ok),
  structures: (value) => assert.ok(!parse(payment(), value).ok),
  hostile: (value) => ownErrorOnly(() => assert.ok(!parse(payment(), value).ok)),
  unicode: (text) => {
    const read = discriminatedUnion('by', [object({ by: literal(text) })]);
    assert.deepStrictEqual(parse(read, { by: text }), { ok: true, value: { by: text } });
  },
  callbacks: { na: 'discriminatedUnion takes no callback' },
  async: { na: 'discriminatedUnion is synchronous and takes no signal' },
});

declareAdversarial(SUBPATH, 'parse', {
  boundary: (value) => assert.ok(isDeepStrictEqual(parse(optional(string()), value), parse(optional(string()), value))),
  structures: (value) => {
    const prototype: unknown = Object.getPrototypeOf(value);
    assert.equal(parse(object({}), value).ok, prototype === Object.prototype || prototype === null);
  },
  hostile: (value) => ownErrorOnly(() => parse(object({ a: optional(number()) }), value)),
  unicode: (text) => assert.deepStrictEqual(parse(string(), text), { ok: true, value: text }),
  callbacks: { na: 'parse takes no callback' },
  async: { na: 'parse is synchronous and takes no signal' },
});

declareAdversarial(SUBPATH, 'withMessages', {
  boundary: (value) => {
    // The format's answer is the message when it is a string, and a TypeError otherwise, whatever it is.
    const worded = withMessages(number(), () => value as string);
    if (typeof value === 'string') {
      assert.deepStrictEqual(worded['~standard'].validate('x'), { issues: [{ message: value }] });
    } else {
      assert.throws(() => worded['~standard'].validate('x'), TypeError);
    }
    assert.deepStrictEqual(worded['~standard'].validate(1), { value: 1 });
  },
  structures: { na: 'withMessages does not walk a value; the schema it holds does' },
  hostile: { na: 'withMessages does not read a value; the schema it holds does' },
  unicode: (text) => {
    const worded = withMessages(number(), () => text);
    assert.deepStrictEqual(worded['~standard'].validate('x'), { issues: [{ message: text }] });
  },
  callbacks: (callback: Callback) => {
    // What the format throws comes out as it is; what it returns must be a string.
    let thrown: { readonly value: unknown } | undefined;
    const format = (issue: unknown): string => {
      try {
        return callback(issue, 0, []) as string;
      } catch (error) {
        thrown = { value: error };
        throw error;
      }
    };
    try {
      withMessages(number(), format)['~standard'].validate('x');
    } catch (error) {
      if (thrown === undefined) {
        assert.ok(error instanceof TypeError, String(error));
      } else {
        assert.equal(error, thrown.value);
      }
    }
  },
  async: { na: 'withMessages is synchronous and takes no signal' },
});
