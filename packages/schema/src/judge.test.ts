// The schemas against valibot, on schemas and inputs both generated, read through `~standard` on both sides (see
// @yaltaan/testing/schema-judge): same verdict, same output, same issue paths. Codes and parameters are the laws' to
// judge, valibot having neither. `parse` and `withMessages` have no equivalent there, and are read through the others.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createJudge } from '@yaltaan/testing';
import {
  fromShape,
  placesOf,
  readStandard,
  schemaCases,
  SHAPE_KINDS,
  valibotLibrary,
  type SchemaCase,
  type Shape,
  type ShapeLibrary,
} from '@yaltaan/testing/schema-judge';

import * as schema from './index.ts';

const judge = createJudge(new URL('./index.ts', import.meta.url), 'valibot');
const library = schema as unknown as ShapeLibrary<schema.Schema>;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isPlain(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

const anywhere =
  (holds: (shape: Shape, input: unknown) => boolean) =>
  ({ shape, input }: SchemaCase): boolean => {
    for (const place of placesOf(shape, input)) {
      if (holds(place.shape, place.input)) {
        return true;
      }
    }
    return false;
  };

const isValid = (shape: Shape, input: unknown): boolean => readStandard(fromShape(shape, valibotLibrary), input).valid;

judge.compare<SchemaCase>('parse', {
  input: schemaCases,
  ours: ({ shape, input }) => readStandard(fromShape(shape, library), input),
  theirs: ({ shape, input }) => readStandard(fromShape(shape, valibotLibrary), input),
  differences: [
    {
      text: 'number takes finite numbers only; valibot also takes an infinite one',
      applies: anywhere((shape, input) => shape.kind === 'number' && (input === Infinity || input === -Infinity)),
    },
    {
      text:
        'object and discriminatedUnion take a plain object only, whose prototype is Object.prototype or null; ' +
        'valibot also takes an array, a Date, a Map or a class instance, and reads their keys',
      applies: anywhere(
        (shape, input) => (shape.kind === 'object' || shape.kind === 'union') && isObject(input) && !isPlain(input),
      ),
    },
    {
      text: "a key is read only if it is the object's own; valibot also reads an inherited one, such as toString",
      applies: anywhere(
        (shape, input) =>
          shape.kind === 'object' &&
          isObject(input) &&
          shape.entries.some(([key]) => key in input && !Object.hasOwn(input, key)),
      ),
    },
    {
      text: 'reject gives every unknown key an issue; valibot stops at the first',
      applies: anywhere((shape, input) => {
        if (shape.kind !== 'object' || shape.unknownKeys !== 'reject' || !isObject(input)) {
          return false;
        }
        const declared = new Set(shape.entries.map(([key]) => key));
        return Object.keys(input).filter((key) => !declared.has(key)).length >= 2;
      }),
    },
    {
      text: 'an array over maxLength gets that one issue and its elements are not read; valibot reads them too',
      applies: anywhere((shape, input) => {
        if (shape.kind !== 'array' || !Array.isArray(input)) {
          return false;
        }
        const { maxLength = Infinity } = shape.options;
        return input.length > maxLength && Array.from(input).some((element) => !isValid(shape.element, element));
      }),
    },
    {
      text:
        'the count of an array under minLength is reported even when an element is invalid; valibot skips it when ' +
        'an element has the wrong type',
      applies: anywhere((shape, input) => {
        if (shape.kind !== 'array' || !Array.isArray(input)) {
          return false;
        }
        const { minLength = 0 } = shape.options;
        return input.length < minLength && Array.from(input).some((element) => !isValid(shape.element, element));
      }),
    },
    {
      text: 'a pattern is not tested on a text over maxLength; valibot tests it as well, and gives a second issue',
      applies: anywhere((shape, input) => {
        if (shape.kind !== 'string' || typeof input !== 'string' || shape.options.pattern === undefined) {
          return false;
        }
        const { maxLength = Infinity, pattern } = shape.options;
        return input.length > maxLength && !pattern.test(input);
      }),
    },
  ],
});

test('every export that runs is judged, or is named as having no equivalent', () => {
  const judged = {
    string: 'string',
    number: 'number',
    literal: 'literal',
    optional: 'optional',
    nullable: 'nullable',
    array: 'array',
    object: 'object',
    discriminatedUnion: 'union',
  } satisfies Record<keyof ShapeLibrary, Shape['kind']>;
  const noEquivalent = ['parse', 'withMessages'];
  assert.deepEqual(Object.keys(schema).sort(), [...Object.keys(judged), ...noEquivalent].sort());
  assert.deepEqual(Object.values(judged).sort(), [...SHAPE_KINDS].sort());
});
