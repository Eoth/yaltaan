// The laws of the form, judged against a naive model: plain values for each field (raw, initial, touched) and for the
// form (submitted), every state computed again from them at each look, by the rules the module's documentation
// states, with no graph. Random programs build a tree of fields and groups up to three levels deep, some with a
// schema answering at once, with a promise, or either depending on the value, whose output differs from what it
// reads, and some with a disabled condition reading any node; then they set, touch, reset, submit, batch, and settle
// or reject the promises the schemas gave, in any order, the late ones included. After each step, for every node:
//   - consistency: raw, dirty, touched, submitted, disabled, pending, issues and parsed are the model's, the keys of
//     every object in the order of the description;
//   - one validation per change: each schema has been asked exactly once for each value its node took between two
//     looks, never twice for the same, and an answer settled for a value since replaced changes nothing;
//   - notification, when every state of every node is watched from the start: a listener is called once by a step
//     that changes its state, never by a step that leaves it as it was. A field's raw value changes by `Object.is`,
//     a group's when one of its fields' does, a read value when it turns ok or not, when its issues change by content,
//     or when its value is another (a schema's output is a new value each time it is asked); issues change by content;
//   - a write that throws (a group set to anything else than an object, at any level) writes nothing, and a batch
//     keeps the writes made before it.
// Values are small integers and, now and then, a list built anew at each write, which is never the same value as
// another and always equal by content. Blind spots: `equals`, `NaN` and `-0` are left to the examples of
// index.test.ts; schemas and conditions never throw, left to the examples too, with schemas of @yaltaan/schema, whose
// issues keep their code (here every issue comes from the Standard Schema interface, `issue.external`, or is the
// form's own); a listener never reads another node during a write, so what one batch holds is left to the examples;
// every state is read at each look, so laziness is left to the examples; and so is the cost of a step.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import type { Issue } from '@yaltaan/core/issue';
import type { ReadableNode } from '@yaltaan/core/reactive';
import type { Result } from '@yaltaan/core/result';
import type { StandardResult, StandardSchema } from '@yaltaan/schema';
import { fc } from '@yaltaan/testing';

import { createForm, field, group, type FormNode, type Spec } from './index.ts';

type SchemaKind = 'sync' | 'async' | 'mixed';

interface Shape {
  readonly kind: 'field' | 'group';
  readonly initial: number;
  readonly children: readonly Shape[];
  readonly schema: SchemaKind | null;
  readonly condition: { readonly reads: readonly number[]; readonly salt: number } | null;
}

/** A node of the program's tree: its shape, its place, and what the model holds for it. */
interface Model {
  readonly id: number;
  readonly shape: Shape;
  readonly key: string;
  readonly path: readonly string[];
  readonly parent: Model | undefined;
  children: readonly Model[];
  reads: readonly Model[];
  raw: unknown;
  initial: unknown;
  touched: boolean;
}

/** A question a schema was asked: its value, its answer, and how its promise, if any, settled. */
interface Request {
  readonly value: unknown;
  readonly answer: StandardResult<unknown>;
  settled: 'resolved' | 'rejected' | undefined;
}

/** A question as the schema recorded it, with the function that settles its promise. */
interface Asked {
  readonly value: unknown;
  readonly settle: ((how: 'resolve' | 'reject') => void) | undefined;
  settled: boolean;
}

type Write =
  | { readonly kind: 'set'; readonly node: number; readonly seed: readonly number[] }
  | { readonly kind: 'touch'; readonly node: number }
  | { readonly kind: 'reset'; readonly node: number; readonly seed: readonly number[] | null };

type Step =
  | Write
  | { readonly kind: 'submit' }
  | { readonly kind: 'settle'; readonly node: number; readonly which: number; readonly how: 'resolve' | 'reject' }
  | { readonly kind: 'batch'; readonly steps: readonly Write[] };

/** A write with the value it gives, built once and handed to the form and to the model alike. */
type Resolved =
  | { readonly kind: 'set'; readonly node: number; readonly value: unknown }
  | { readonly kind: 'touch'; readonly node: number }
  | { readonly kind: 'reset'; readonly node: number; readonly value: unknown };

const ABSENT = Symbol('absent');

const shapes = (depth: number): fc.Arbitrary<Shape> => {
  const options = {
    schema: fc.constantFrom<SchemaKind | null>(null, null, 'sync', 'async', 'mixed'),
    condition: fc.option(fc.record({ reads: fc.array(fc.nat(30), { minLength: 1, maxLength: 2 }), salt: fc.nat(3) }), {
      freq: 3,
    }),
  };
  const leaf = fc.record({
    kind: fc.constant('field' as const),
    initial: fc.nat(3),
    children: fc.constant([]),
    ...options,
  });
  if (depth === 0) {
    return leaf;
  }
  const node = fc.record({
    kind: fc.constant('group' as const),
    initial: fc.constant(0),
    children: fc.array(shapes(depth - 1), { minLength: 1, maxLength: 3 }),
    ...options,
  });
  return fc.oneof(leaf, node);
};

const seeds = fc.array(fc.nat(5), { minLength: 1, maxLength: 8 });

const writes: fc.Arbitrary<Write> = fc.oneof(
  fc.record({ kind: fc.constant('set' as const), node: fc.nat(30), seed: seeds }),
  fc.record({ kind: fc.constant('touch' as const), node: fc.nat(30) }),
  fc.record({ kind: fc.constant('reset' as const), node: fc.nat(30), seed: fc.option(seeds) }),
);

const steps: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: writes, weight: 6 },
  { arbitrary: fc.record({ kind: fc.constant('submit' as const) }), weight: 1 },
  {
    arbitrary: fc.record({
      kind: fc.constant('settle' as const),
      node: fc.nat(30),
      which: fc.nat(3),
      how: fc.constantFrom<'resolve' | 'reject'>('resolve', 'resolve', 'resolve', 'reject'),
    }),
    weight: 4,
  },
  {
    arbitrary: fc.record({ kind: fc.constant('batch' as const), steps: fc.array(writes, { maxLength: 4 }) }),
    weight: 1,
  },
);

interface Program {
  readonly root: Shape;
  readonly steps: readonly Step[];
  readonly watched: boolean;
}

const programs: fc.Arbitrary<Program> = fc.record({
  root: fc.oneof(
    { arbitrary: shapes(3), weight: 1 },
    {
      arbitrary: fc.record({
        kind: fc.constant('group' as const),
        initial: fc.constant(0),
        children: fc.array(shapes(2), { minLength: 1, maxLength: 3 }),
        schema: fc.constantFrom<SchemaKind | null>(null, 'sync', 'async', 'mixed'),
        condition: fc.constant(null),
      }),
      weight: 4,
    },
  ),
  steps: fc.array(steps, { minLength: 4, maxLength: 30 }),
  watched: fc.boolean(),
});

/**
 * The value a seed gives to a node: small integers, a list built anew, a key left out now and then, and a group that
 * is not an object.
 */
function valueOf(shape: Shape, seed: readonly number[], cursor = { at: 0 }): unknown {
  const next = seed[cursor.at++ % seed.length]!;
  if (next === 4) {
    return ABSENT;
  }
  if (shape.kind === 'field') {
    return next === 5 ? [1] : next;
  }
  const value: Record<string, unknown> = {};
  shape.children.forEach((child, index) => {
    const childValue = valueOf(child, seed, cursor);
    if (childValue !== ABSENT) {
      value[`k${index}`] = childValue;
    }
  });
  return value;
}

const given = (value: unknown): unknown => (value === ABSENT ? undefined : value);

/** What a condition says of the raw values it reads: a hash of all of them, so that every value and its place count. */
function holds(values: readonly unknown[], salt: number): boolean {
  let hash = salt;
  for (const character of String(JSON.stringify(values))) {
    hash = (hash * 31 + character.charCodeAt(0)) % 1009;
  }
  return hash % 3 === 0;
}

interface Raised {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { key: string })[];
}

/** A field's schema: an integer that is even, 2 a failure without an issue; its output, ten times the integer. */
function fieldAnswer(value: unknown): StandardResult<unknown> {
  if (typeof value !== 'number') {
    return { issues: [{ message: 'not a number' }] };
  }
  if (value === 2) {
    return { issues: [] };
  }
  return value % 2 === 1 ? { issues: [{ message: 'odd' }] } : { value: value * 10 };
}

function leaves(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.values(value).reduce<number>((sum, inner) => sum + leaves(inner), 0)
    : 0;
}

/**
 * A group's schema: a 3 on a child, a 2 on a grandchild, a `{ key }` segment for a 1, a sum that is a multiple of
 * four on the group itself, and now and then a path that names no child, which stays on the group; its output, a new
 * object holding the value and its sum.
 */
function groupAnswer(value: unknown): StandardResult<unknown> {
  const issues: Raised[] = [];
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (child === 3) {
      issues.push({ message: 'three', path: [key] });
    } else if (child === 1) {
      issues.push({ message: 'one', path: [{ key }] });
    } else if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
      for (const [inner, grandchild] of Object.entries(child)) {
        if (grandchild === 2) {
          issues.push({ message: 'two', path: [key, inner] });
        }
      }
    }
  }
  const sum = leaves(value);
  if (sum % 4 === 0) {
    issues.push({ message: 'sum' });
  }
  if (sum % 5 === 1) {
    issues.push({ message: 'ghost', path: ['zz', 'k0'] });
  }
  return issues.length ? { issues } : { value: { ...record, sum } };
}

const answerOf = (shape: Shape, value: unknown): StandardResult<unknown> =>
  shape.kind === 'field' ? fieldAnswer(value) : groupAnswer(value);

const isAsync = (kind: SchemaKind, value: unknown): boolean =>
  kind === 'async' || (kind === 'mixed' && String(JSON.stringify(value)).length % 2 === 1);

function buildModel(
  shape: Shape,
  key: string,
  path: readonly string[],
  parent: Model | undefined,
  all: Model[],
): Model {
  const model: Model = {
    id: all.length,
    shape,
    key,
    path,
    parent,
    children: [],
    reads: [],
    raw: shape.initial,
    initial: shape.initial,
    touched: false,
  };
  all.push(model);
  model.children = shape.children.map((child, index) =>
    buildModel(child, `k${index}`, [...path, `k${index}`], model, all),
  );
  return model;
}

/** The description of a node, with the schema that records every question it is asked. */
function specOf(model: Model, asked: Map<number, Asked[]>): Spec {
  const { shape } = model;
  const options: {
    schema?: StandardSchema;
    disabled?: { reads: string[][]; when: (...values: unknown[]) => boolean };
  } = {};
  if (shape.schema) {
    const kind = shape.schema;
    options.schema = {
      '~standard': {
        version: 1,
        vendor: 'law',
        validate: (value: unknown) => {
          const requests = asked.get(model.id) ?? [];
          asked.set(model.id, requests);
          if (!isAsync(kind, value)) {
            requests.push({ value, settle: undefined, settled: true });
            return answerOf(shape, value);
          }
          return new Promise((resolve, reject) => {
            const settle = (how: 'resolve' | 'reject'): void =>
              how === 'resolve' ? resolve(answerOf(shape, value)) : reject(new Error('unreachable'));
            requests.push({ value, settle, settled: false });
          });
        },
      },
    };
  }
  if (shape.condition) {
    const { salt } = shape.condition;
    options.disabled = { reads: model.reads.map((read) => [...read.path]), when: (...values) => holds(values, salt) };
  }
  if (shape.kind === 'field') {
    return field(shape.initial, options);
  }
  return group(Object.fromEntries(model.children.map((child) => [child.key, specOf(child, asked)])), options);
}

interface Plain {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: unknown;
}

type PlainResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: Plain[] };

/** A value's identity, for the notification law: `Object.is` of each leaf, through the groups. */
type Identity = { readonly leaf: unknown } | { readonly group: readonly Identity[] };

function sameIdentity(a: Identity, b: Identity): boolean {
  if ('leaf' in a) {
    return 'leaf' in b && Object.is(a.leaf, b.leaf);
  }
  return 'group' in b && a.group.length === b.group.length && a.group.every((x, i) => sameIdentity(x, b.group[i]!));
}

/** The naive model: every state from the plain values, at each look. */
class Naive {
  readonly requests = new Map<number, Request[]>();
  readonly root: Model;
  readonly all: readonly Model[];
  submitted = false;

  constructor(root: Model, all: readonly Model[]) {
    this.root = root;
    this.all = all;
  }

  raw(model: Model): unknown {
    return model.shape.kind === 'field'
      ? model.raw
      : Object.fromEntries(model.children.map((child) => [child.key, this.raw(child)]));
  }

  /** The identity of a raw value, given as the model holds it now or as it was recorded for a question. */
  identity(model: Model, value: unknown): Identity {
    return model.shape.kind === 'field'
      ? { leaf: value }
      : { group: model.children.map((child) => this.identity(child, (value as Record<string, unknown>)[child.key])) };
  }

  dirty(model: Model): boolean {
    return model.shape.kind === 'field'
      ? !isDeepStrictEqual(model.raw, model.initial)
      : model.children.some((child) => this.dirty(child));
  }

  touched(model: Model): boolean {
    return model.shape.kind === 'field' ? model.touched : model.children.some((child) => this.touched(child));
  }

  disabled(model: Model): boolean {
    const { condition } = model.shape;
    const values = model.reads.map((read) => this.raw(read));
    return (condition !== null && holds(values, condition.salt)) || (!!model.parent && this.disabled(model.parent));
  }

  /** Records the question a schema is asked when its node's value changed since the last one: called at each look. */
  ask(): void {
    for (const model of this.all) {
      if (model.shape.schema) {
        const value = this.raw(model);
        const requests = this.requests.get(model.id) ?? [];
        this.requests.set(model.id, requests);
        const last = requests.at(-1);
        if (last === undefined || !sameIdentity(this.identity(model, last.value), this.identity(model, value))) {
          const settled = isAsync(model.shape.schema, value) ? undefined : 'resolved';
          requests.push({ value, answer: answerOf(model.shape, value), settled });
        }
      }
    }
  }

  /** The issues and the output of a node's schema now, as the form reads them; `undefined` while pending. */
  answer(model: Model): { readonly issues: readonly Raised[] | 'failed'; readonly output?: unknown } | undefined {
    const request = this.requests.get(model.id)!.at(-1)!;
    if (request.settled === undefined) {
      return undefined;
    }
    const { answer } = request;
    if (request.settled === 'rejected' || answer.issues?.length === 0) {
      return { issues: 'failed' };
    }
    return answer.issues ? { issues: answer.issues as Raised[] } : { issues: [], output: answer.value };
  }

  ownPending(model: Model): boolean {
    return model.shape.schema !== null && this.answer(model) === undefined;
  }

  pending(model: Model): boolean {
    const below = (node: Model): boolean => this.ownPending(node) || node.children.some(below);
    let above = false;
    for (let at = model.parent; at; at = at.parent) {
      above ||= this.ownPending(at);
    }
    return above || below(model);
  }

  /** The issues placed on `model`, as plain data, the outermost schema first. */
  issues(model: Model): Plain[] {
    const ancestors: Model[] = [];
    for (let at: Model | undefined = model; at; at = at.parent) {
      ancestors.unshift(at);
    }
    const placed: Plain[] = [];
    for (const owner of ancestors) {
      const answer = owner.shape.schema ? this.answer(owner) : undefined;
      if (answer?.issues === 'failed') {
        if (owner === model) {
          placed.push({ code: 'form.validation_failed', path: owner.path, message: undefined });
        }
        continue;
      }
      for (const issue of answer?.issues ?? []) {
        const relative = (issue.path ?? []).map((segment) =>
          typeof segment === 'object' ? (segment as { key: PropertyKey }).key : segment,
        );
        let target = owner;
        for (const key of relative) {
          const next = target.children.find((child) => child.key === key);
          if (next === undefined) {
            break;
          }
          target = next;
        }
        if (target === model) {
          placed.push({ code: 'issue.external', path: [...owner.path, ...relative], message: issue.message });
        }
      }
    }
    return placed;
  }

  allIssues(model: Model): Plain[] {
    return [...this.issues(model), ...model.children.flatMap((child) => this.allIssues(child))];
  }

  output(model: Model): unknown {
    if (model.shape.schema) {
      return this.answer(model)?.output;
    }
    return model.shape.kind === 'field'
      ? model.raw
      : Object.fromEntries(model.children.map((child) => [child.key, this.output(child)]));
  }

  /** The identity of the read value: a schema's output is the one recorded with its question. */
  outputIdentity(model: Model): Identity {
    if (model.shape.schema) {
      return { leaf: this.answer(model)?.output };
    }
    return model.shape.kind === 'field'
      ? { leaf: model.raw }
      : { group: model.children.map((child) => this.outputIdentity(child)) };
  }

  parsed(model: Model): PlainResult {
    const errors = this.allIssues(model);
    return errors.length || this.pending(model)
      ? { ok: false, error: errors }
      : { ok: true, value: this.output(model) };
  }

  fields(model: Model): Model[] {
    return model.shape.kind === 'field' ? [model] : model.children.flatMap((child) => this.fields(child));
  }

  /** The value of each field below `model` in `value`, or a `TypeError` for a group given anything but an object. */
  read(model: Model, value: unknown): unknown[] | TypeError {
    if (model.shape.kind === 'field') {
      return [value];
    }
    if (typeof value !== 'object' || value === null) {
      return new TypeError('a group is set to an object');
    }
    const values: unknown[] = [];
    for (const child of model.children) {
      const inner = Object.hasOwn(value, child.key) ? (value as Record<string, unknown>)[child.key] : undefined;
      const read = this.read(child, inner);
      if (read instanceof TypeError) {
        return read;
      }
      values.push(...read);
    }
    return values;
  }

  /** Applies a write, or returns the error it throws, nothing written. */
  apply(write: Resolved): TypeError | undefined {
    const model = this.all[write.node % this.all.length]!;
    const targets = this.fields(model);
    if (write.kind === 'touch') {
      targets.forEach((target) => (target.touched = true));
      return undefined;
    }
    const values = write.kind === 'set' || write.value !== undefined ? this.read(model, write.value) : undefined;
    if (values instanceof TypeError) {
      return values;
    }
    targets.forEach((target, index) => {
      if (write.kind === 'set') {
        target.raw = values![index];
        return;
      }
      if (values) {
        target.initial = values[index];
      }
      target.raw = target.initial;
      target.touched = false;
    });
    if (write.kind === 'reset' && model === this.root) {
      this.submitted = false;
    }
    return undefined;
  }

  submit(): void {
    for (const target of this.fields(this.root)) {
      target.touched = true;
    }
    this.submitted = true;
  }
}

const plain = (issue: Issue): Plain => ({
  code: issue.code,
  path: issue.path as PropertyKey[],
  message: issue.params?.['message'],
});

function plainResult(result: Result<unknown, readonly Issue[]>): PlainResult {
  return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.map(plain) };
}

/** The keys of every object of `value`, in order, beside its leaves: what `deepStrictEqual` does not compare. */
function order(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Array.isArray(value) ? value.map(order) : Object.entries(value).map(([key, inner]) => [key, order(inner)]);
}

const STATES = ['raw', 'dirty', 'touched', 'submitted', 'disabled', 'pending', 'issues', 'parsed'] as const;
type State = (typeof STATES)[number];

/** Every node of the form, by the id of its model: the root, then depth first in the order of the description. */
function nodesOf(form: FormNode<unknown, unknown>): FormNode<unknown, unknown>[] {
  const nodes = [form];
  const children = (form as { children?: Record<string, FormNode<unknown, unknown>> }).children;
  for (const child of Object.values(children ?? {})) {
    nodes.push(...nodesOf(child));
  }
  return nodes;
}

function expected(naive: Naive, model: Model, state: State): unknown {
  switch (state) {
    case 'raw':
      return naive.raw(model);
    case 'dirty':
      return naive.dirty(model);
    case 'touched':
      return naive.touched(model);
    case 'submitted':
      return naive.submitted;
    case 'disabled':
      return naive.disabled(model);
    case 'pending':
      return naive.pending(model);
    case 'issues':
      return naive.issues(model);
    case 'parsed':
      return naive.parsed(model);
  }
}

/** What tells a change of `state` to its listener, in the model: see the header. */
function seenBy(naive: Naive, model: Model, state: State, value: unknown): unknown {
  if (state === 'raw') {
    return naive.identity(model, naive.raw(model));
  }
  if (state === 'parsed') {
    const parsed = value as PlainResult;
    return parsed.ok ? { ok: true, identity: naive.outputIdentity(model) } : parsed;
  }
  return value;
}

function changed(state: State, before: unknown, after: unknown): boolean {
  if (state === 'raw') {
    return !sameIdentity(before as Identity, after as Identity);
  }
  const [a, b] = [before as { ok?: boolean; identity?: Identity }, after as { ok?: boolean; identity?: Identity }];
  if (state === 'parsed' && a.ok && b.ok) {
    return !sameIdentity(a.identity!, b.identity!);
  }
  return !isDeepStrictEqual(before, after);
}

function actual(node: FormNode<unknown, unknown>, state: State): unknown {
  const value = (node[state] as ReadableNode<unknown>).get();
  if (state === 'issues') {
    return (value as readonly Issue[]).map(plain);
  }
  return state === 'parsed' ? plainResult(value as Result<unknown, readonly Issue[]>) : value;
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface Counts {
  validations: number;
  settledLate: number;
  rejected: number;
  notifications: number;
  thrown: number;
  pendingSeen: number;
  failedSeen: number;
}

function resolveWrite(write: Write, all: readonly Model[]): Resolved {
  if (write.kind === 'touch') {
    return write;
  }
  const { shape } = all[write.node % all.length]!;
  return { kind: write.kind, node: write.node, value: write.seed ? given(valueOf(shape, write.seed)) : undefined };
}

function applyTo(nodes: readonly FormNode<unknown, unknown>[], write: Resolved): void {
  const node = nodes[write.node % nodes.length]!;
  if (write.kind === 'touch') {
    node.touch();
  } else if (write.kind === 'set') {
    node.set(write.value);
  } else {
    node.reset(write.value);
  }
}

async function run(program: Program, counts: Counts): Promise<void> {
  const all: Model[] = [];
  const root = buildModel(program.root, '', [], undefined, all);
  for (const model of all) {
    model.reads = (model.shape.condition?.reads ?? []).map((read) => all[read % all.length]!);
  }
  const asked = new Map<number, Asked[]>();
  const form = createForm(specOf(root, asked));
  const nodes = nodesOf(form);
  assert.equal(nodes.length, all.length);
  const naive = new Naive(root, all);
  const calls = new Map<string, number>();
  if (program.watched) {
    nodes.forEach((node, id) => {
      for (const state of STATES) {
        (node[state] as ReadableNode<unknown>).subscribe(() => {
          calls.set(`${id} ${state}`, (calls.get(`${id} ${state}`) ?? 0) + 1);
        });
      }
    });
  }
  let previous = new Map<string, unknown>();
  const look = (label: string): void => {
    naive.ask();
    const seen = new Map<string, unknown>();
    nodes.forEach((node, id) => {
      const model = all[id]!;
      for (const state of STATES) {
        const want = expected(naive, model, state);
        const got = actual(node, state);
        const at = `${label}: ${state} of node ${id} (${model.path.join('.')})`;
        assert.deepStrictEqual(got, want, at);
        assert.deepStrictEqual(order(got), order(want), `${at}, keys in order`);
        seen.set(`${id} ${state}`, seenBy(naive, model, state, want));
        counts.pendingSeen += state === 'pending' && want === true ? 1 : 0;
        if (state === 'issues' && (want as Plain[]).some((issue) => issue.code === 'form.validation_failed')) {
          counts.failedSeen++;
        }
      }
    });
    for (const model of all) {
      if (model.shape.schema) {
        const made = (asked.get(model.id) ?? []).map((request) => request.value);
        const want = naive.requests.get(model.id)!.map((request) => request.value);
        assert.deepStrictEqual(made, want, `${label}: questions asked of the schema of node ${model.id}`);
      }
    }
    if (program.watched && previous.size) {
      for (const [key, value] of seen) {
        const state = key.split(' ')[1] as State;
        const count = calls.get(key) ?? 0;
        const want = changed(state, previous.get(key), value) ? 1 : 0;
        assert.equal(count, want, `${label}: calls of the listener of ${key}`);
        counts.notifications += count;
      }
    }
    calls.clear();
    previous = seen;
  };
  look('built');
  for (const [index, step] of program.steps.entries()) {
    const label = `step ${index} ${JSON.stringify(step)}`;
    let thrown: unknown;
    let want: TypeError | undefined;
    if (step.kind === 'settle') {
      const owners = all.filter((model) => (asked.get(model.id) ?? []).some((request) => !request.settled));
      const owner = owners[step.node % Math.max(owners.length, 1)];
      if (owner) {
        const requests = asked.get(owner.id)!;
        const open = requests.filter((request) => !request.settled);
        const request = open[step.which % open.length]!;
        request.settled = true;
        naive.requests.get(owner.id)![requests.indexOf(request)]!.settled =
          step.how === 'resolve' ? 'resolved' : 'rejected';
        counts.settledLate += request === requests.at(-1) ? 0 : 1;
        counts.rejected += step.how === 'reject' ? 1 : 0;
        request.settle!(step.how);
      }
    } else if (step.kind === 'submit') {
      form.submit();
      naive.submit();
    } else {
      const resolved =
        step.kind === 'batch' ? step.steps.map((inner) => resolveWrite(inner, all)) : [resolveWrite(step, all)];
      try {
        form.graph.batch(() => resolved.forEach((write) => applyTo(nodes, write)));
      } catch (error) {
        thrown = error;
      }
      for (const write of resolved) {
        want = naive.apply(write);
        if (want) {
          break;
        }
      }
    }
    await tick();
    if (want) {
      counts.thrown++;
      assert.ok(thrown instanceof TypeError, `${label}: throws a TypeError`);
    } else {
      assert.equal(thrown, undefined, `${label}: throws nothing`);
    }
    look(label);
  }
  counts.validations += [...asked.values()].reduce((sum, requests) => sum + requests.length, 0);
}

test('every state of every node follows the naive model, through writes, submissions and late answers', async () => {
  const counts: Counts = {
    validations: 0,
    settledLate: 0,
    rejected: 0,
    notifications: 0,
    thrown: 0,
    pendingSeen: 0,
    failedSeen: 0,
  };
  await fc.assert(
    fc.asyncProperty(programs, (program) => run(program, counts)),
    { numRuns: 400 },
  );
  console.log(counts);
});
