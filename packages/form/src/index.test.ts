import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Issue } from '@yaltaan/core/issue';
import { createGraph } from '@yaltaan/core/reactive';
import type { Result } from '@yaltaan/core/result';
import { number, object, picklist, string, type StandardResult, type StandardSchema } from '@yaltaan/schema';
import { CallbackError, declareAdversarial, HostileError, type Callback } from '@yaltaan/testing';
import * as v from 'valibot';

import { createForm, field, group, type FormNode } from './index.ts';

const SUBPATH = '@yaltaan/form';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** A Standard Schema whose answers the test gives, each by a call of the function it records. */
function deferred(answer: (value: unknown) => StandardResult<unknown>): {
  schema: StandardSchema;
  asked: unknown[];
  settle: ((how?: 'reject') => void)[];
} {
  const asked: unknown[] = [];
  const settle: ((how?: 'reject') => void)[] = [];
  const schema: StandardSchema = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) => {
        asked.push(value);
        return new Promise((resolve, reject) => {
          settle.push((how) =>
            how === 'reject' ? reject(new Error(`refused ${String(value)}`)) : resolve(answer(value)),
          );
        });
      },
    },
  };
  return { schema, asked, settle };
}

const codes = (node: FormNode<unknown, unknown>): string[] => node.issues.get().map((issue) => issue.code);

test('a schema of @yaltaan/schema gives issues with their code and data, each on its field', () => {
  const form = createForm(
    group(
      {
        email: field('', { schema: string({ minLength: 3 }) }),
        address: group({ city: field(''), country: field('') }),
      },
      {
        schema: object({
          email: string(),
          address: object({ city: string({ minLength: 1 }), country: picklist(['FR']) }),
        }),
      },
    ),
  );
  assert.deepEqual(form.children.email.issues.get(), [
    { code: 'schema.too_short', path: ['email'], params: { length: 0, minimum: 3 } },
  ]);
  assert.deepEqual(codes(form.children.address.children.city), ['schema.too_short']);
  assert.deepEqual(form.children.address.children.country.issues.get(), [
    { code: 'schema.invalid_value', path: ['address', 'country'], params: { expected: ['FR'] } },
  ]);
  assert.deepEqual(form.children.address.issues.get(), []);
  const parsed = form.children.address.parsed.get();
  assert.ok(!parsed.ok);
  assert.deepEqual(
    parsed.error.map((issue) => issue.path),
    [
      ['address', 'city'],
      ['address', 'country'],
    ],
  );
  form.set({ email: 'ada@example.org', address: { city: 'Paris', country: 'FR' } });
  assert.deepEqual(form.parsed.get(), {
    ok: true,
    value: { email: 'ada@example.org', address: { city: 'Paris', country: 'FR' } },
  });
});

test('another engine gives issue.external with its message, and its output is the parsed value', () => {
  const asNumber: StandardSchema<unknown, number> = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) =>
        /^\d+$/.test(String(value))
          ? { value: Number(value) }
          : { issues: [{ message: 'digits only', path: [{ key: 'deep' }, 0] }] },
    },
  };
  const form = createForm(group({ age: field('4x', { schema: asNumber }) }));
  assert.deepEqual(form.children.age.issues.get(), [
    {
      code: 'issue.external',
      path: ['age', 'deep', 0],
      params: { message: 'digits only' },
      cause: { message: 'digits only', path: [{ key: 'deep' }, 0] },
    },
  ]);
  form.children.age.set('42');
  assert.deepEqual(form.children.age.parsed.get(), { ok: true, value: 42 });
  assert.deepEqual(form.parsed.get(), { ok: true, value: { age: 42 } });
  assert.equal(form.raw.get().age, '42');
});

test('an issue goes to the deepest node its path names, and stays on a field whose value it points into', () => {
  const everywhere: StandardSchema = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: () => ({
        issues: [
          { message: 'root' },
          { message: 'unknown', path: ['nope', 'deeper'] },
          { message: 'into a list', path: ['roles', 0] },
          { message: 'below a missing key', path: ['address', 'zip', 'x'] },
          { message: 'a symbol', path: [Symbol('s')] },
          { message: 'an index', path: [0] },
        ],
      }),
    },
  };
  const form = createForm(group({ roles: field(['a']), address: group({ city: field('') }) }, { schema: everywhere }));
  const messages = (node: FormNode<unknown, unknown>): unknown[] =>
    node.issues.get().map((issue) => issue.params?.['message']);
  assert.deepEqual(messages(form), ['root', 'unknown', 'a symbol', 'an index']);
  assert.deepEqual(messages(form.children.roles), ['into a list']);
  assert.deepEqual(messages(form.children.address), ['below a missing key']);
  assert.deepEqual(messages(form.children.address.children.city), []);
  assert.deepEqual(form.children.roles.issues.get()[0]?.path, ['roles', 0]);
});

test('dirty compares by equal unless equals says otherwise', () => {
  const form = createForm(
    group({
      roles: field(['billing']),
      at: field(new Date(0)),
      name: field('Ada', { equals: (initial, raw) => initial.trim() === raw.trim() }),
      count: field(Number.NaN),
      zero: field(0),
    }),
  );
  form.children.roles.set(['billing']);
  form.children.at.set(new Date(0));
  form.children.name.set(' Ada ');
  form.children.count.set(Number.NaN);
  form.children.zero.set(-0);
  assert.equal(form.dirty.get(), false);
  form.children.roles.set(['billing', 'sales']);
  assert.equal(form.children.roles.dirty.get(), true);
  assert.equal(form.dirty.get(), true);
  form.children.roles.set(['billing']);
  assert.equal(form.dirty.get(), false);
  form.children.name.set('Grace');
  assert.equal(form.dirty.get(), true);
});

test('reset gives back the initial values, or makes new ones; only the root clears submitted', () => {
  const form = createForm(group({ a: field(1), inner: group({ b: field(2) }) }));
  form.set({ a: 10, inner: { b: 20 } });
  form.children.a.touch();
  assert.equal(form.submit().ok, true);
  assert.deepEqual(
    [form.touched.get(), form.submitted.get(), form.children.inner.children.b.touched.get()],
    [true, true, true],
  );
  form.children.inner.reset();
  assert.deepEqual(form.raw.get(), { a: 10, inner: { b: 2 } });
  assert.deepEqual([form.children.inner.touched.get(), form.touched.get(), form.submitted.get()], [false, true, true]);
  form.reset({ a: 5, inner: { b: 6 } });
  assert.deepEqual(form.raw.get(), { a: 5, inner: { b: 6 } });
  assert.deepEqual([form.dirty.get(), form.touched.get(), form.submitted.get()], [false, false, false]);
  form.children.a.set(1);
  assert.equal(form.dirty.get(), true);
  form.reset();
  assert.deepEqual(form.raw.get(), { a: 5, inner: { b: 6 } });
  assert.equal(form.children.a.reset(), undefined);
});

test('set reads every value first: a group given anything else than an object writes nothing', () => {
  const form = createForm(group({ a: field(1), inner: group({ b: field(2) }) }));
  for (const bad of [null, undefined, 3, 'text', { a: 9, inner: null }, { a: 9 }]) {
    assert.throws(() => form.set(bad as never), { name: 'TypeError', message: 'a group is set to an object' });
    assert.deepEqual(form.raw.get(), { a: 1, inner: { b: 2 } });
  }
  form.set({ inner: { b: 3 } } as never);
  assert.deepEqual(form.raw.get(), { a: undefined, inner: { b: 3 } });
  const inherited = Object.create({ a: 7 }) as { inner: { b: number } };
  inherited.inner = { b: 4 };
  form.set(inherited as never);
  assert.equal(form.children.a.raw.get(), undefined, 'an inherited property is not read');
  let reads = 0;
  form.set({
    get a() {
      reads += 1;
      return 8;
    },
    inner: { b: 5 },
  });
  assert.equal(reads, 1);
  assert.throws(
    () =>
      form.set({
        a: 1,
        get inner(): { b: number } {
          throw new HostileError('getter');
        },
      }),
    HostileError,
  );
  assert.deepEqual(form.raw.get(), { a: 8, inner: { b: 5 } });
});

test('a field alone is a form', () => {
  const form = createForm(field('x', { schema: string({ maxLength: 1 }) }));
  form.set('xy');
  assert.deepEqual(codes(form), ['schema.too_long']);
  assert.deepEqual(form.submit(), { ok: false, error: form.issues.get() });
  assert.equal(form.touched.get(), true);
  form.reset('ab');
  assert.deepEqual([form.dirty.get(), form.submitted.get(), form.raw.get()], [false, false, 'ab']);
});

test('disabled holds while its condition does, on the node and every node below it', () => {
  const form = createForm(
    group({
      same: field(true),
      billing: group(
        { street: field(''), city: field('', { disabled: { reads: [['billing', 'street']], when: (s) => s === '' } }) },
        { disabled: { reads: [['same']], when: (same) => same === true } },
      ),
    }),
  );
  const { billing } = form.children;
  assert.deepEqual(
    [form.disabled.get(), billing.disabled.get(), billing.children.street.disabled.get()],
    [false, true, true],
  );
  form.children.same.set(false);
  assert.deepEqual(
    [billing.disabled.get(), billing.children.street.disabled.get(), billing.children.city.disabled.get()],
    [false, false, true],
  );
  billing.children.street.set('1 rue');
  assert.equal(billing.children.city.disabled.get(), false);
  const listened: boolean[] = [];
  billing.children.city.disabled.subscribe(() => listened.push(billing.children.city.disabled.get()));
  form.children.same.set(true);
  assert.deepEqual(listened, [true]);
});

test('a condition reads whole groups too, and is refused when a path names no node', () => {
  const seen: unknown[] = [];
  const form = createForm(
    group({
      address: group({ city: field('Paris') }),
      note: field('', {
        disabled: { reads: [['address'], []], when: (address, all) => (seen.push(address, all), false) },
      }),
    }),
  );
  assert.equal(form.children.note.disabled.get(), false);
  assert.deepEqual(seen, [{ city: 'Paris' }, { address: { city: 'Paris' }, note: '' }]);
  for (const reads of [
    [['missing']],
    [['address', 'city', 'deeper']],
    [[0]],
    [['address', { key: 'city' }]],
    [['toString']],
  ]) {
    assert.throws(
      () =>
        createForm(
          group({ address: group({ city: field('') }), x: field(0, { disabled: { reads, when: () => true } }) }),
        ),
      { name: 'TypeError', message: 'a condition reads a path that names no node of this form' },
    );
  }
  assert.throws(
    () => createForm(group({ x: field(0, { disabled: { reads: ['x' as never], when: () => true } }) })),
    TypeError,
  );
});

test('what a schema or a condition throws is thrown by every state that reads it, and by nothing else', async () => {
  const broken = new Error('schema bug');
  const throwing: StandardSchema = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) => {
        if (value === 'boom') {
          throw broken;
        }
        return { value };
      },
    },
  };
  const form = createForm(
    group({
      a: field('boom', { schema: throwing }),
      b: field('', {
        disabled: {
          reads: [['a']],
          when: (a) => {
            if (a === 'boom') throw broken;
            return false;
          },
        },
      }),
    }),
  );
  for (const state of [
    form.children.a.parsed,
    form.children.a.issues,
    form.children.a.pending,
    form.parsed,
    form.pending,
  ]) {
    assert.throws(() => state.get(), broken);
  }
  assert.throws(() => form.children.b.disabled.get(), broken);
  assert.deepEqual([form.children.b.parsed.get().ok, form.dirty.get(), form.touched.get()], [true, false, false]);
  form.children.a.set('fine');
  assert.deepEqual([form.parsed.get().ok, form.children.b.disabled.get()], [true, false]);
});

test('a schema that rejects, or fails without an issue, places form.validation_failed on its node', async () => {
  const later = deferred((value) => (value === 'empty' ? { issues: [] } : { value }));
  const form = createForm(group({ name: field('x', { schema: later.schema }) }));
  const { name } = form.children;
  assert.equal(form.pending.get(), true);
  later.settle[0]!('reject');
  await tick();
  assert.equal(form.pending.get(), false);
  const [failure] = name.issues.get();
  assert.deepEqual(
    [failure?.code, failure?.path, (failure?.cause as Error).message],
    ['form.validation_failed', ['name'], 'refused x'],
  );
  assert.deepEqual(form.parsed.get(), { ok: false, error: [failure] });
  name.set('empty');
  assert.equal(form.pending.get(), true);
  later.settle[1]!();
  await tick();
  assert.deepEqual(name.issues.get(), [{ code: 'form.validation_failed', path: ['name'] }]);
  name.set('y');
  assert.equal(form.pending.get(), true);
  later.settle[2]!();
  await tick();
  assert.deepEqual(form.parsed.get(), { ok: true, value: { name: 'y' } });
  const garbled: StandardSchema = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: async () => ({ issues: [{ message: 3 as unknown as string }] }),
    },
  };
  const unreadable = createForm(field(0, { schema: garbled }));
  assert.equal(unreadable.pending.get(), true);
  await tick();
  assert.equal(unreadable.pending.get(), false);
  assert.ok(unreadable.issues.get()[0]?.cause instanceof TypeError, 'an answer the form cannot read');
  const silent: StandardSchema = { '~standard': { version: 1, vendor: 'test', validate: () => ({ issues: [] }) } };
  assert.deepEqual(createForm(field(0, { schema: silent })).issues.get(), [
    { code: 'form.validation_failed', path: [] },
  ]);
});

test("pending holds a node that its schema, an ancestor's or a descendant's may still mark", async () => {
  const outer = deferred(() => ({ issues: [{ message: 'late', path: ['b'] }] }));
  const form = createForm(group({ a: field(0), inner: group({ b: field(0) }, { schema: outer.schema }) }));
  assert.deepEqual(
    [
      form.pending.get(),
      form.children.a.pending.get(),
      form.children.inner.pending.get(),
      form.children.inner.children.b.pending.get(),
    ],
    [true, false, true, true],
  );
  assert.deepEqual(form.children.inner.children.b.parsed.get(), { ok: false, error: [] });
  assert.deepEqual(form.children.a.parsed.get(), { ok: true, value: 0 });
  outer.settle[0]!();
  await tick();
  assert.equal(form.pending.get(), false);
  assert.deepEqual(codes(form.children.inner.children.b), ['issue.external']);
});

test('an answer for a value since replaced is never delivered, even when it settles last', async () => {
  const later = deferred((value) => (value === 'bad' ? { issues: [{ message: 'bad' }] } : { value }));
  const form = createForm(group({ name: field('bad', { schema: later.schema }) }));
  const seen: boolean[] = [];
  form.pending.subscribe(() => seen.push(form.pending.get()));
  form.children.name.set('good');
  later.settle[1]!();
  await tick();
  assert.deepEqual(form.parsed.get(), { ok: true, value: { name: 'good' } });
  later.settle[0]!();
  await tick();
  assert.deepEqual(form.parsed.get(), { ok: true, value: { name: 'good' } });
  assert.deepEqual(seen, [false]);
  assert.deepEqual(later.asked, ['bad', 'good']);
});

test('a listener that throws while a late answer is delivered rejects a promise that nobody awaits', () => {
  // In a process of its own: the test runner takes an unhandled rejection for a failure of the test that runs.
  const script = `
    import { createForm, field } from '@yaltaan/form';
    let settle;
    const validate = (value) => new Promise((resolve) => (settle = () => resolve({ value })));
    const form = createForm(field('x', { schema: { '~standard': { version: 1, vendor: 'test', validate } } }));
    form.pending.subscribe(() => {
      throw new Error('listener bug');
    });
    process.on('unhandledRejection', (error) => console.log(error.message, JSON.stringify(form.parsed.get())));
    settle();
  `;
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' });
  assert.equal(run.stdout.trim(), 'listener bug {"ok":true,"value":"x"}', run.stderr);
});

test('a thenable that calls back at once still settles after the read, outside any computation', async () => {
  const eager: StandardSchema = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) =>
        ({
          then: (resolve: (result: object) => void) => resolve({ issues: [{ message: `no ${String(value)}` }] }),
        }) as never,
    },
  };
  const form = createForm(field('x', { schema: eager }));
  assert.equal(form.pending.get(), true);
  await tick();
  assert.equal(form.pending.get(), false);
  assert.deepEqual(codes(form), ['issue.external']);
});

test('nothing is validated before a state that needs it is read, and once per value', () => {
  let calls = 0;
  const counted: StandardSchema = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) => {
        calls += 1;
        return { value };
      },
    },
  };
  const form = createForm(group({ a: field(1, { schema: counted }), b: field(2) }, { schema: counted }));
  form.raw.get();
  form.dirty.get();
  form.touched.get();
  form.disabled.get();
  form.children.a.set(3);
  assert.equal(calls, 0);
  form.parsed.get();
  form.parsed.get();
  form.children.a.issues.get();
  assert.equal(calls, 2);
  form.children.b.set(4);
  form.parsed.get();
  assert.equal(calls, 3, 'the field a was not asked again');
});

test('a write to one field computes the states of that field and its ancestors only', () => {
  const size = 200;
  let compared = 0;
  const equals = (a: number, b: number): boolean => {
    compared += 1;
    return a === b;
  };
  const children = Object.fromEntries(Array.from({ length: size }, (_, index) => [`f${index}`, field(0, { equals })]));
  const form = createForm(group(children));
  const nodes = Object.values(form.children);
  for (const node of nodes) {
    node.dirty.subscribe(() => undefined);
  }
  form.parsed.subscribe(() => undefined);
  compared = 0;
  nodes[7]!.set(1);
  nodes[150]!.set(1);
  assert.equal(compared, 2);
  assert.equal(form.dirty.get(), true);
});

test('a schema of valibot, which has a ~run of its own, is read through its Standard Schema interface', () => {
  const form = createForm(
    group(
      { email: field('a'), age: field('x', { schema: v.pipe(v.string(), v.transform(Number)) }) },
      { schema: v.object({ email: v.pipe(v.string(), v.minLength(3)), age: v.string() }) },
    ),
  );
  assert.deepEqual(
    form.children.email.issues.get().map((issue) => issue.code),
    ['issue.external'],
  );
  assert.deepEqual(form.raw.get(), { email: 'a', age: 'x' });
  assert.equal(form.parsed.get().ok, false);
  form.children.email.set('ada@example.org');
  form.children.age.set('42');
  assert.deepEqual(form.children.age.parsed.get(), { ok: true, value: 42 });
  assert.deepEqual(form.parsed.get(), { ok: true, value: { email: 'ada@example.org', age: '42' } });
});

test('the output of a schema of ours is the parsed value: object drops the keys it does not know', () => {
  const form = createForm(
    field<Record<string, unknown>>({ name: 'Ada', note: 'draft' }, { schema: object({ name: string() }) }),
  );
  assert.deepEqual(form.parsed.get(), { ok: true, value: { name: 'Ada' } });
});

test('an issue goes down through the own string keys of children only', () => {
  const at = (path: readonly PropertyKey[]): StandardSchema => ({
    '~standard': { version: 1, vendor: 'test', validate: () => ({ issues: [{ message: 'here', path }] }) },
  });
  const inherited = createForm(group({ a: field(0) }, { schema: at(['toString']) }));
  assert.deepEqual(
    inherited.issues.get().map((issue) => issue.path),
    [['toString']],
  );
  assert.equal(inherited.parsed.get().ok, false);
  const numeric = createForm(group({ 0: field(0) }, { schema: at([0]) }));
  assert.deepEqual([numeric.issues.get().length, numeric.children[0].issues.get().length], [1, 0]);
  const named = createForm(group({ 0: field(0) }, { schema: at(['0']) }));
  assert.deepEqual([named.issues.get().length, named.children[0].issues.get().length], [0, 1]);
});

test('equals gets the initial value first, and a condition holds on any truthy answer', () => {
  const seen: unknown[] = [];
  const form = createForm(
    group({
      a: field(1, { equals: (initial, raw) => (seen.push([initial, raw]), initial >= raw) }),
      b: field(0, { disabled: { reads: [['a']], when: () => 1 as unknown as boolean } }),
    }),
  );
  form.children.a.set(2);
  assert.equal(form.children.a.dirty.get(), true);
  form.children.a.set(0);
  assert.equal(form.children.a.dirty.get(), false);
  assert.deepEqual(seen, [
    [1, 2],
    [1, 0],
  ]);
  assert.equal(form.children.b.disabled.get(), true);
});

test('touch, submit and set write in one batch: a listener sees every field already written', () => {
  const form = createForm(group({ a: field(' ada '), b: field('') }));
  const seen: unknown[] = [];
  form.children.a.touched.subscribe(() => seen.push(['touched', form.children.b.touched.get(), form.submitted.get()]));
  form.children.a.raw.subscribe(() => seen.push(['raw', form.children.b.raw.get()]));
  form.submit();
  form.reset();
  form.touch();
  form.set({ a: 'x', b: 'y' });
  assert.deepEqual(seen, [
    ['touched', true, true],
    ['touched', false, false],
    ['touched', true, false],
    ['raw', 'y'],
  ]);
  form.submitted.subscribe(() => form.children.a.set(form.children.a.raw.get().trim()));
  form.children.a.set(' ada ');
  assert.deepEqual(form.submit(), { ok: true, value: { a: 'ada', b: 'y' } });
});

test('a group raw value holds the very values of its fields, even equal ones', () => {
  const form = createForm(group({ at: field(new Date(0)), zero: field(0), tags: field(['a']) }));
  const at = new Date(0);
  const tags = ['a'];
  form.set({ at, zero: -0, tags });
  const raw = form.raw.get();
  assert.ok(raw.at === at && raw.tags === tags && Object.is(raw.zero, -0));
  assert.ok(form.parsed.get().ok && (form.parsed.get() as { value: { at: Date } }).value.at === at);
  assert.equal(form.dirty.get(), false);
  assert.deepEqual(Object.keys(raw), ['at', 'zero', 'tags']);
});

test('set reads the value of each group once, and refuses a group given anything else than an object', () => {
  let reads = 0;
  const form = createForm(group({ inner: group({ a: field(0), b: field(0), c: field(0) }), empty: group({}) }));
  form.set({
    get inner() {
      reads += 1;
      return { a: reads, b: reads, c: reads };
    },
    empty: {},
  });
  assert.deepEqual([reads, form.raw.get().inner], [1, { a: 1, b: 1, c: 1 }]);
  assert.throws(() => form.set({ inner: { a: 1, b: 1, c: 1 }, empty: 'text' } as never), TypeError);
  assert.throws(() => createForm(group({})).set(3 as never), TypeError);
});

test('reset(undefined) gives back the initial value, as reset() does', () => {
  const form = createForm(group({ name: field('Ada') }));
  form.children.name.set('Grace');
  form.children.name.reset(undefined);
  assert.equal(form.children.name.raw.get(), 'Ada');
  form.set({ name: 'Lin' });
  form.reset(undefined);
  assert.deepEqual(form.raw.get(), { name: 'Ada' });
});

/** The fastest of five runs, in nanoseconds: the least disturbed by the rest of the machine. */
function fastest(run: () => void): number {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 5; attempt++) {
    const started = process.hrtime.bigint();
    run();
    best = Math.min(best, Number(process.hrtime.bigint() - started));
  }
  return best;
}

test('scale: the issues of one field are placed in time linear in their number', () => {
  const placing = (count: number) => () => {
    const schema: StandardSchema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({
          issues: Array.from({ length: count }, (_, index) => ({ message: `${index}`, path: ['a'] })),
        }),
      },
    };
    assert.equal(createForm(group({ a: field(0) }, { schema })).children.a.issues.get().length, count);
  };
  fastest(placing(4_000));
  // Eight times the issues: about 8 times as long when linear, 64 when each issue copies the list before it.
  const ratio = fastest(placing(32_000)) / fastest(placing(4_000));
  assert.ok(ratio < 24, `${ratio.toFixed(1)} times as long for eight times the issues`);
});

test('two forms on one graph batch together; listeners may write, computations may not', () => {
  const graph = createGraph();
  const first = createForm(field('a'), { graph });
  const second = createForm(field('b'), { graph });
  assert.equal(first.graph, graph);
  const seen: string[] = [];
  first.raw.subscribe(() => seen.push(`first ${first.raw.get()} ${second.raw.get()}`));
  graph.batch(() => {
    first.set('A');
    second.set('B');
  });
  assert.deepEqual(seen, ['first A B']);
  const upper = createForm(field('x'));
  upper.raw.subscribe(() => upper.set(upper.raw.get().toUpperCase()));
  upper.set('abc');
  assert.equal(upper.raw.get(), 'ABC');
  const inside = graph.derived([first.raw], () => {
    second.set('no');
    return 0;
  });
  assert.throws(() => inside.get(), {
    name: 'TypeError',
    message: 'a computation reads or writes a node of this graph',
  });
  assert.equal(second.raw.get(), 'B');
});

test('a description is refused when it is not one, and builds a new form each time', () => {
  for (const options of [
    null,
    3,
    { schema: {} },
    { schema: null },
    { disabled: { reads: 'a', when: () => true } },
    { disabled: null },
    { equals: 1 },
  ]) {
    assert.throws(() => field(0, options as never), TypeError);
    assert.throws(() => group({}, options as never), TypeError);
  }
  for (const children of [null, 3, { a: 1 }, { a: { kind: 'other' } }, { a: null }]) {
    assert.throws(() => group(children as never), TypeError);
  }
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => group({ [key]: field(0) }), { name: 'TypeError', message: `${key} cannot name a child` });
  }
  for (const spec of [null, undefined, {}, { kind: 'list' }]) {
    assert.throws(() => createForm(spec as never), { name: 'TypeError', message: 'spec is a spec of field or group' });
  }
  const spec = group({ a: field(1), b: field(1) });
  const one = createForm(spec);
  const two = createForm(spec);
  one.children.a.set(2);
  assert.deepEqual(
    [one.raw.get(), two.raw.get()],
    [
      { a: 2, b: 1 },
      { a: 1, b: 1 },
    ],
  );
  const shared = field(0);
  const twice = createForm(group({ x: shared, y: shared }));
  twice.children.x.set(5);
  assert.deepEqual(twice.raw.get(), { x: 5, y: 0 });
  assert.deepEqual(twice.children.y.path, ['y']);
});

test('the types follow the description', () => {
  const form = createForm(
    group({
      email: field(''),
      age: field('', { schema: number() }),
      address: group({ city: field('') }),
      tags: field<string[]>([]),
    }),
  );
  const raw: { email: string; age: string; address: { city: string }; tags: string[] } = form.raw.get();
  const parsed: Result<{ email: string; age: number; address: { city: string }; tags: string[] }, readonly Issue[]> =
    form.parsed.get();
  const city: string = form.children.address.children.city.raw.get();
  void [raw, parsed, city];
  const never = (): void => {
    // @ts-expect-error a field takes its own type
    form.children.email.set(3);
    // @ts-expect-error a group takes an object of its children's types
    form.children.address.set({ city: 1 });
    // @ts-expect-error a field has no children
    void form.children.email.children;
    // @ts-expect-error only the root submits
    form.children.email.submit();
  };
  void never;
});

// Adversarial declarations.

function holds(value: unknown): void {
  const form = createForm(group({ value: field(value) }));
  assert.ok(Object.is(form.children.value.raw.get(), value));
  form.children.value.set(value);
  form.touch();
  form.reset(form.raw.get());
  assert.ok(Object.is(form.children.value.raw.get(), value));
}

/** Only the hostile value's own error comes out, or the form's `TypeError`. */
function ownErrorOnly(run: () => void): void {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof HostileError || error instanceof TypeError, String(error));
  }
}

declareAdversarial(SUBPATH, 'createForm', {
  boundary: holds,
  structures: (value) => {
    const form = createForm(group({ value: field(value) }));
    assert.equal(form.dirty.get(), false);
    ownErrorOnly(() => form.set(value as never));
    assert.ok(Array.isArray(form.issues.get()));
  },
  hostile: (value) =>
    ownErrorOnly(() => {
      const form = createForm(group({ value: field(value) }, { schema: object({ value: string() }) }));
      form.set({ value } as never);
      form.dirty.get();
      form.parsed.get();
      form.set(value as never);
    }),
  unicode: (text) => {
    const form = createForm(group({ [text === '__proto__' ? 'x' : text || 'x']: field(text) }));
    assert.deepEqual(Object.values(form.raw.get()), [text]);
  },
  callbacks: (callback: Callback) => {
    const form = createForm(
      group({
        a: field(1, { equals: (x, y) => callback(x, 0, [y]) === true }),
        b: field(2, { disabled: { reads: [['a']], when: (a) => callback(a, 0, []) === true } }),
      }),
    );
    for (const run of [() => form.dirty.get(), () => form.children.b.disabled.get(), () => form.children.a.set(3)]) {
      try {
        run();
      } catch (error) {
        assert.ok(error instanceof CallbackError || error === 'callback failure', String(error));
      }
    }
    assert.equal(form.children.a.raw.get(), 3);
  },
  async: { na: 'createForm takes no signal: what a schema answers late is judged by the laws and the examples' },
});

declareAdversarial(SUBPATH, 'field', {
  boundary: (value) => assert.equal(field(value).initial, value),
  structures: (value) => assert.equal(field(value).initial, value),
  hostile: (value) => ownErrorOnly(() => void field(0, value as never)),
  unicode: (text) => assert.equal(field(text).initial, text),
  callbacks: (callback: Callback) => {
    const spec = field(1, { equals: (x, y) => callback(x, 0, [y]) === true });
    assert.equal(spec.kind, 'field');
  },
  async: { na: 'field is synchronous and takes no signal' },
});

declareAdversarial(SUBPATH, 'group', {
  boundary: (value) => ownErrorOnly(() => void group(value as never)),
  structures: (value) => ownErrorOnly(() => void group(value as never)),
  hostile: (value) => ownErrorOnly(() => void group({ a: field(0) }, value as never)),
  unicode: (text) => {
    if (!['__proto__', 'constructor', 'prototype'].includes(text)) {
      assert.deepEqual(Object.keys(group({ [text]: field(0) }).children), [text]);
    }
  },
  callbacks: { na: 'group calls nothing: the callbacks of its children run in the form, declared by createForm' },
  async: { na: 'group is synchronous and takes no signal' },
});
