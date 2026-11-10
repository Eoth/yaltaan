// Examples of the arrays of the form: what the laws of properties.test.ts leave to them (fields with `equals`,
// conditions through an item, schemas that throw nothing but name items by `{ key }`, errors and their order, removed
// items, laziness, cost) and the types.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Issue } from '@yaltaan/core/issue';
import type { Result } from '@yaltaan/core/result';
import type { StandardResult, StandardSchema } from '@yaltaan/schema';
import { assertType, declareAdversarial, HostileError, type Equal } from '@yaltaan/testing';

import { array, createForm, field, group, type ArrayNode, type FieldNode, type ItemOf } from './index.ts';

const SUBPATH = '@yaltaan/form';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** A Standard Schema that answers at once with `answer`, and records each value it reads. */
function recording(answer: (value: unknown) => StandardResult<unknown>): { schema: StandardSchema; asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    schema: { '~standard': { version: 1, vendor: 'test', validate: (value) => (asked.push(value), answer(value)) } },
  };
}

/** An invoice line: a label, a quantity and a price. */
const line = () => group({ label: field(''), quantity: field(1), price: field(0) });

const lines = (form: { children: { lines: ArrayNode<ReturnType<typeof line>> } }) => form.children.lines;

const labels = (node: ArrayNode<ReturnType<typeof line>>): string[] =>
  node.items.get().map((item) => item.children.label.raw.get());

test('items hold the keys the form gives them, from 0 in the order it builds them, business keys or not', () => {
  const form = createForm(
    group({
      lines: array(line(), { initial: [{ label: 'a', quantity: 1, price: 1 }] }),
      tags: array(group({ code: field(''), name: field('') }), {
        identity: ['code'],
        initial: [{ code: 'x', name: 'X' }],
      }),
    }),
  );
  const added = form.children.lines.insert(1, { label: 'b', quantity: 2, price: 2 });
  assert.deepEqual(
    form.children.lines.items.get().map((item) => item.key),
    [0, 2],
  );
  assert.deepEqual(added.path, ['lines', { key: 2 }]);
  assert.deepEqual(added.children.label.path, ['lines', { key: 2 }, 'label']);
  const [tag] = form.children.tags.items.get();
  assert.equal(tag!.key, 1);
  assert.deepEqual(tag!.children.name.path, ['tags', { key: 1 }, 'name']);
  tag!.children.code.set('y');
  assert.equal(tag!.key, 1, 'a key is kept for the life of the item');
  assert.equal(createForm(array(field(0), { initial: [5, 6] })).items.get()[1]!.key, 1, 'an array at the root');
});

test('a moved item keeps its states and its issues; its own schema is not asked again, the array schema is', () => {
  const own = recording((value) =>
    (value as { quantity: number }).quantity > 0 ? { value } : { issues: [{ message: 'none', path: ['quantity'] }] },
  );
  const whole = recording((value) => {
    const list = value as { label: string }[];
    const issues = list.flatMap((item, index) => (item.label ? [] : [{ message: 'empty', path: [index, 'label'] }]));
    return issues.length ? { issues } : { value };
  });
  const form = createForm(
    group({
      lines: array(group({ label: field(''), quantity: field(1) }, { schema: own.schema }), {
        schema: whole.schema,
        initial: [
          { label: 'a', quantity: 0 },
          { label: '', quantity: 1 },
        ],
      }),
    }),
  );
  const node = form.children.lines;
  const [a, b] = node.items.get();
  a!.children.label.set('A');
  a!.touch();
  const seen: string[] = [];
  b!.children.label.issues.subscribe(() => seen.push('b label'));
  a!.children.quantity.issues.subscribe(() => seen.push('a quantity'));
  assert.deepEqual(
    a!.children.quantity.issues.get().map((issue) => issue.path),
    [['lines', { key: 0 }, 'quantity']],
  );
  assert.deepEqual(b!.children.label.issues.get()[0]!.path, ['lines', { key: 1 }, 'label']);
  const asked = [own.asked.length, whole.asked.length];
  assert.equal(node.move(a!, 1), true);
  assert.deepEqual(
    node.items.get().map((item) => item.key),
    [1, 0],
  );
  assert.deepEqual([a!.dirty.get(), a!.touched.get(), b!.touched.get()], [true, true, false]);
  assert.deepEqual(a!.children.quantity.issues.get()[0]!.path, ['lines', { key: 0 }, 'quantity']);
  // The array schema reads the list again and gives index 0 now: placed on the same item, under its key.
  assert.deepEqual(b!.children.label.issues.get()[0]!.path, ['lines', { key: 1 }, 'label']);
  assert.deepEqual(b!.children.label.issues.get()[0]!.cause, { message: 'empty', path: [0, 'label'] });
  assert.deepEqual([own.asked.length, whole.asked.length], [asked[0], asked[1]! + 1]);
  assert.deepEqual(seen, ['b label'], 'the cause, with its index, changed; the issue of the item schema did not');
});

test('set keeps items by position, or by key with identity; values left build items, items left are removed', () => {
  const plain = createForm(group({ lines: array(line(), { initial: [{ label: 'a', quantity: 1, price: 0 }] }) }));
  const [first] = lines(plain).items.get();
  first!.touch();
  plain.set({
    lines: [
      { label: 'z', quantity: 1, price: 0 },
      { label: 'b', quantity: 1, price: 0 },
    ],
  });
  assert.equal(lines(plain).items.get()[0], first, 'kept by position');
  assert.deepEqual([labels(lines(plain)), first!.touched.get()], [['z', 'b'], true]);
  const [, built] = lines(plain).items.get();
  assert.deepEqual([built!.dirty.get(), built!.key], [false, 1], 'an item built takes the value it is built with');
  plain.set({ lines: [] });
  assert.deepEqual(lines(plain).items.get(), []);

  const keyed = createForm(
    group({
      tags: array(group({ code: field(''), name: field('') }), {
        identity: ['code'],
        initial: [
          { code: 'x', name: 'X' },
          { code: 'y', name: 'Y' },
        ],
      }),
    }),
  );
  const [x, y] = keyed.children.tags.items.get();
  keyed.children.tags.set([
    { code: 'y', name: 'Y2' },
    { code: 'w', name: 'W' },
    { code: 'x', name: 'X' },
  ]);
  const after = keyed.children.tags.items.get();
  assert.deepEqual([after[0], after[2]], [y, x], 'kept by key, in the order of the values');
  assert.deepEqual(
    after.map((item) => item.key),
    [1, 2, 0],
  );
  assert.equal(y!.children.name.raw.get(), 'Y2');
  const before = keyed.raw.get();
  for (const value of [
    [{ code: 'x' }, { code: 'x' }],
    [{ code: '' }],
    [{ name: 'no key' }],
    [{ code: null }],
    'not an array',
    [3],
  ]) {
    assert.throws(() => keyed.children.tags.set(value as never), TypeError, JSON.stringify(value));
  }
  assert.throws(
    () => keyed.children.tags.set(Array.from({ length: 1001 }, (_, code) => ({ code: String(code), name: '' }))),
    RangeError,
  );
  assert.deepEqual(keyed.raw.get(), before, 'nothing written by a write refused');
  assert.equal(keyed.children.tags.items.get()[0], y);
});

test('a key is compared on its first 16,000 code units, as rules compare one', () => {
  const long = 'k'.repeat(16_000);
  const node = createForm(array(group({ id: field('') }), { identity: ['id'] }));
  assert.throws(() => node.set([{ id: `${long}a` }, { id: `${long}b` }]), TypeError);
  node.set([{ id: `${long}a` }]);
  assert.throws(() => node.insert(1, { id: `${long}b` }), TypeError);
});

test('a write reads at most maxItems items, every array counted, so that nesting cannot multiply maxLength', () => {
  const nested = createForm(array(array(field(0), { maxLength: 1000 }), { maxLength: 1000 }));
  const rows = Array.from({ length: 101 }, () => Array.from({ length: 99 }, () => 0));
  assert.throws(() => nested.set(rows), RangeError, '101 + 101 × 99 items, over 10,000');
  assert.deepEqual(nested.raw.get(), []);
  nested.set(rows.slice(1));
  assert.equal(nested.items.get().length, 100, '100 + 100 × 99 items, 10,000');
  const small = createForm(array(array(field(0))), { maxItems: 5 });
  assert.throws(() => small.insert(0, [1, 2, 3, 4, 5, 6]), RangeError);
  small.insert(0, [1, 2, 3, 4, 5]);
  assert.throws(() => createForm(array(field(0), { initial: [1, 2, 3] }), { maxItems: 2 }), RangeError);
  for (const maxItems of [-1, 1.5, '3', null]) {
    assert.throws(() => createForm(field(0), { maxItems } as never), TypeError, String(maxItems));
  }
});

test('with identity, keys compare on what the values hold now, so that the raw value of a form writes back', () => {
  const form = createForm(
    array(group({ id: field(''), name: field('') }), { identity: ['id'], initial: [{ id: 'a', name: 'A' }] }),
  );
  const [first] = form.items.get();
  first!.touch();
  first!.children.id.set('b');
  assert.throws(() => form.insert(1, { id: 'b', name: '' }), TypeError, 'b is held now');
  const again = form.insert(1, { id: 'a', name: 'again' });
  assert.deepEqual(
    form.items.get().map((item) => item.path),
    [[{ key: 0 }], [{ key: 1 }]],
    'paths never shared',
  );
  form.set(form.raw.get());
  assert.deepEqual(form.items.get(), [first, again]);
  assert.equal(first!.touched.get(), true);
  form.set([
    { id: 'a', name: 'again' },
    { id: 'b', name: 'A' },
  ]);
  assert.deepEqual(form.items.get(), [again, first], 'kept by the keys their values hold');
  for (const id of [[], undefined, null, '']) {
    assert.throws(() => form.insert(0, { id, name: '' } as never), TypeError, JSON.stringify(id));
  }
});

test('a key past 16,000 code units keeps its item by its first 16,000, and names it in an issue', () => {
  const long = `${'k'.repeat(16_000)}`;
  const node = createForm(
    array(group({ id: field('') }), {
      identity: ['id'],
      initial: [{ id: `${long}a` }],
      schema: {
        '~standard': { version: 1, vendor: 'yaltaan', validate: () => ({ issues: [{ message: 'unused' }] }) },
        '~run': (value: unknown, reading: { issues: Issue[] }) => {
          reading.issues.push({ code: 'test.long', path: [{ key: `${long}z` }] });
          return value;
        },
      } as unknown as StandardSchema,
    }),
  );
  const [item] = node.items.get();
  node.set([{ id: `${long}b` }]);
  assert.equal(node.items.get()[0], item);
  assert.deepEqual(
    item!.issues.get().map((issue) => issue.code),
    ['test.long'],
  );
});

test('a list is read through its own elements: a hole is undefined, whatever its prototype holds', () => {
  const node = createForm(array(field<unknown>(0)));
  const holed: unknown[] = [];
  holed[1] = 1;
  Object.setPrototypeOf(holed, Object.assign(Object.create(Array.prototype) as object, { 0: 'inherited' }));
  node.set(holed);
  assert.deepEqual(node.raw.get(), [undefined, 1]);
});

test('keys compare by SameValueZero: NaN is one key, -0 and 0 are one key', () => {
  const node = createForm(
    array(group({ id: field<unknown>(0) }), {
      identity: ['id'],
      initial: [{ id: Number.NaN }],
      schema: {
        '~standard': { version: 1, vendor: 'yaltaan', validate: () => ({ issues: [{ message: 'unused' }] }) },
        '~run': (value: unknown, reading: { issues: Issue[] }) => {
          reading.issues.push({ code: 'test.nan', path: [{ key: Number.NaN }] });
          return value;
        },
      } as unknown as StandardSchema,
    }),
  );
  assert.deepEqual(
    node.items
      .get()[0]!
      .issues.get()
      .map((issue) => issue.code),
    ['test.nan'],
  );
  assert.throws(() => node.insert(1, { id: Number.NaN }), TypeError);
  node.insert(1, { id: 0 });
  assert.throws(() => node.insert(2, { id: -0 }), TypeError);
  assert.throws(() => node.set([{ id: 0 }, { id: -0 }]), TypeError);
});

test('every state of a node is one node, whichever read reaches it first', () => {
  const form = createForm(group({ lines: array(group({ label: field('') }), { initial: [{ label: 'a' }] }) }));
  const [item] = form.children.lines.items.get();
  for (const node of [form, form.children.lines, item!, item!.children.label]) {
    for (const state of ['raw', 'parsed', 'issues', 'dirty', 'touched', 'pending', 'submitted', 'disabled'] as const) {
      assert.equal(node[state], node[state], state);
    }
  }
});

test('insert, remove and move: what they return, what they refuse, nothing written when they do', () => {
  const form = createForm(group({ lines: array(line(), { maxLength: 2 }) }));
  const node = lines(form);
  const a = node.insert(0, { label: 'a', quantity: 1, price: 0 });
  const b = node.insert(0);
  assert.deepEqual(labels(node), ['', 'a']);
  assert.deepEqual(b.children.quantity.raw.get(), 1, 'an item from the initial value of the element');
  assert.throws(() => node.insert(0), RangeError, 'past maxLength');
  for (const index of [-1, 3, 1.5, Number.NaN]) {
    assert.throws(() => node.move(a, index), RangeError, String(index));
  }
  assert.throws(() => node.move(a, 2), RangeError);
  assert.throws(() => createForm(array(line())).insert(1), RangeError);
  assert.throws(() => node.insert(0, 3 as never), RangeError, 'maxLength is checked before the value');
  assert.equal(node.move(a, 0), true);
  assert.equal(node.move(a, 0), true, 'to the same place: nothing changes');
  assert.deepEqual(labels(node), ['a', '']);
  assert.equal(node.remove(a), true);
  assert.equal(node.remove(a), false, 'removed once');
  assert.equal(node.move(a, 0), false, 'a removed item moves nowhere');
  assert.equal(node.remove(form as never), false, 'a node that is not an item');
  assert.deepEqual(labels(node), ['']);
  a.children.label.set('detached');
  assert.deepEqual([a.children.label.raw.get(), labels(node)], ['detached', ['']], 'a removed item lives on alone');
  const empty = createForm(array(group({ a: field(0) })));
  assert.throws(() => empty.insert(0, 3 as never), TypeError, 'a value that does not fit the element');
  assert.deepEqual(empty.items.get(), []);
});

test('dirty compares the raw value of an array with its initial list, by the comparisons of its fields', () => {
  const form = createForm(
    group({
      names: array(field('', { equals: (a, b) => a.trim() === b.trim() }), { initial: ['a', 'b'] }),
    }),
  );
  const node = form.children.names;
  const [a, b] = node.items.get();
  node.move(a!, 1);
  assert.equal(node.dirty.get(), true);
  node.move(a!, 0);
  assert.equal(node.dirty.get(), false);
  b!.set('b ');
  assert.deepEqual([b!.dirty.get(), node.dirty.get()], [false, false], "a field's equals");
  node.remove(b!);
  assert.equal(node.dirty.get(), true);
  const again = node.insert(1, 'b');
  assert.deepEqual([node.dirty.get(), again.dirty.get()], [false, false], 'equal values: not dirty');
  node.reset();
  assert.deepEqual([node.items.get(), node.dirty.get()], [[a, b], false]);
  assert.equal(b!.raw.get(), 'b', 'the items of the last reset, given back their values');
});

test('reset with a list makes its items those to give back; reset() gives them back, in order, untouched', () => {
  const form = createForm(group({ lines: array(line(), { initial: [{ label: 'a', quantity: 1, price: 0 }] }) }));
  const node = lines(form);
  const [a] = node.items.get();
  form.reset({
    lines: [
      { label: 'r', quantity: 2, price: 0 },
      { label: 's', quantity: 3, price: 0 },
    ],
  });
  const [r, s] = node.items.get();
  assert.equal(r, a, 'kept by position');
  node.move(s!, 0);
  node.insert(2);
  s!.touch();
  form.submit();
  form.reset();
  assert.deepEqual(node.items.get(), [r, s]);
  assert.deepEqual(
    [labels(node), form.touched.get(), form.dirty.get(), form.submitted.get()],
    [['r', 's'], false, false, false],
  );
});

test('a condition reads a field of its own item through { key: undefined }, and a field outside the array', () => {
  const any = { key: undefined };
  const form = createForm(
    group({
      vat: field(true),
      lines: array(
        group({
          taxable: field(false),
          rate: field(0, {
            disabled: { reads: [['vat'], ['lines', any, 'taxable']], when: (vat, taxable) => !vat || !taxable },
          }),
        }),
        { initial: [{ taxable: true, rate: 20 }] },
      ),
    }),
  );
  const [first] = form.children.lines.items.get();
  const second = form.children.lines.insert(1);
  assert.deepEqual([first!.children.rate.disabled.get(), second.children.rate.disabled.get()], [false, true]);
  second.children.taxable.set(true);
  form.children.vat.set(false);
  assert.deepEqual([first!.children.rate.disabled.get(), second.children.rate.disabled.get()], [true, true]);
  for (const reads of [[['lines', 0, 'rate']], [['lines', { key: 'x' }, 'rate']], [['lines', any, 'nothing']]]) {
    assert.throws(
      () => createForm(group({ lines: array(group({ rate: field(0, { disabled: { reads, when: () => true } }) })) })),
      TypeError,
      `inside an item: ${JSON.stringify(reads)}`,
    );
  }
  assert.throws(
    () =>
      createForm(
        group({
          others: array(group({ x: field(0) })),
          lines: array(group({ rate: field(0, { disabled: { reads: [['others', any, 'x']], when: () => true } }) })),
        }),
      ),
    { name: 'TypeError', message: 'a condition reads a path that names no node of this form' },
    'through an array that does not hold the condition',
  );
  for (const reads of [[['lines', any]], [['lines', 0, 'taxable']], [['lines', any, 'nothing']]]) {
    assert.throws(
      () => createForm(group({ lines: array(field(0)), other: field(0, { disabled: { reads, when: () => true } }) })),
      TypeError,
      JSON.stringify(reads),
    );
  }
  const nested = createForm(
    array(
      group({ on: field(true), parts: array(field(0, { disabled: { reads: [[any, 'on']], when: (on) => !on } })) }),
      {
        initial: [{ on: false, parts: [1] }],
      },
    ),
  );
  assert.equal(nested.items.get()[0]!.children.parts.items.get()[0]!.disabled.get(), true, 'through nested arrays');
});

test('an issue names an item by its index in the value its schema read, or by { key }; past the end, it stays', () => {
  // A schema of @yaltaan/schema, as `refine` of @yaltaan/rules writes one: its issues keep `{ key }` segments.
  const keyed = {
    '~standard': { version: 1, vendor: 'yaltaan', validate: () => ({ issues: [{ message: 'unused' }] }) },
    '~run': (value: unknown, reading: { issues: Issue[] }) => {
      reading.issues.push({ code: 'test.keyed', path: [{ key: 'y' }, 'name'] });
      reading.issues.push({ code: 'test.index', path: [0] });
      reading.issues.push({ code: 'test.past', path: [5, 'name'] });
      reading.issues.push({ code: 'test.unknown', path: [{ key: 'none' }] });
      return value;
    },
  } as unknown as StandardSchema;
  const form = createForm(
    array(group({ code: field(''), name: field('') }), {
      identity: ['code'],
      schema: keyed,
      initial: [
        { code: 'x', name: '' },
        { code: 'y', name: '' },
      ],
    }),
  );
  const [x, y] = form.items.get();
  assert.deepEqual(
    y!.children.name.issues.get().map((issue) => [issue.code, issue.path]),
    [['test.keyed', [{ key: 1 }, 'name']]],
  );
  assert.deepEqual(
    x!.issues.get().map((issue) => [issue.code, issue.path]),
    [['test.index', [{ key: 0 }]]],
  );
  assert.deepEqual(
    form.issues.get().map((issue) => [issue.code, issue.path]),
    [
      ['test.past', [5, 'name']],
      ['test.unknown', [{ key: 'none' }]],
    ],
  );
  form.move(y!, 0);
  assert.deepEqual(y!.issues.get()[0]!.path, [{ key: 1 }], 'index 0 now names y');
  assert.deepEqual(y!.children.name.issues.get()[0]!.path, [{ key: 1 }, 'name']);
  y!.children.code.set('z');
  assert.deepEqual(y!.children.name.issues.get(), [], 'the key the value holds now');
});

test('a removed item is read by no state of the form, and its late answer changes nothing', async () => {
  let settle: (() => void) | undefined;
  const late: StandardSchema = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: () => new Promise((resolve) => (settle = () => resolve({ issues: [{ message: 'late' }] }))),
    },
  };
  const form = createForm(group({ lines: array(field(0, { schema: late }), { initial: [1] }) }));
  const node = form.children.lines;
  const [item] = node.items.get();
  assert.equal(form.pending.get(), true);
  node.remove(item!);
  assert.deepEqual([form.pending.get(), form.parsed.get()], [false, { ok: true, value: { lines: [] } }]);
  settle!();
  await tick();
  assert.deepEqual([form.parsed.get(), item!.issues.get().length], [{ ok: true, value: { lines: [] } }, 1]);
});

test('dirty and parsed are built on their first read; a schema is asked when a state that needs it is read', () => {
  let compared = 0;
  const asked = recording((value) => ({ value }));
  const form = createForm(
    array(
      field(0, {
        equals: (a, b) => (compared++, a === b),
        schema: asked.schema,
      }),
      { initial: [1, 2] },
    ),
  );
  const [one] = form.items.get();
  one!.set(3);
  assert.deepEqual([compared, asked.asked.length], [0, 0]);
  assert.equal(one!.dirty.get(), true);
  assert.deepEqual([compared, asked.asked.length], [1, 0]);
  assert.equal(form.parsed.get().ok, true);
  assert.deepEqual(asked.asked, [3, 2]);
});

test('two writes of a batch that give an array back its items still give it a new raw value, told once', () => {
  const form = createForm(group({ lines: array(field(0)) }));
  let told = 0;
  form.raw.subscribe(() => told++);
  const before = form.raw.get();
  form.graph.batch(() => {
    form.children.lines.insert(0);
    form.set({ lines: [] });
  });
  assert.deepEqual([told, form.raw.get()], [1, { lines: [] }]);
  assert.notEqual(form.raw.get(), before);
  form.set({ lines: [] });
  assert.equal(told, 1, 'the same items: nothing told');
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

test('scale: inserting, moving and removing in an array of n watched items costs O(n) each', () => {
  const steps = (count: number) => {
    const form = createForm(
      group(
        {
          lines: array(line(), {
            maxLength: count + 1,
            initial: Array.from({ length: count }, () => ({ label: 'a', quantity: 1, price: 0 })),
          }),
        },
        { schema: recording((value) => ({ value })).schema },
      ),
    );
    form.parsed.subscribe(() => {});
    form.children.lines.items.get()[0]!.children.label.issues.subscribe(() => {});
    return () => {
      for (let round = 0; round < 20; round++) {
        const added = form.children.lines.insert(0);
        form.children.lines.move(added, count);
        form.children.lines.remove(added);
      }
    };
  };
  const [small, large] = [steps(250), steps(2_000)];
  fastest(small);
  // Eight times the items: about 8 times as long when linear, 64 when quadratic.
  const ratio = fastest(large) / fastest(small);
  assert.ok(ratio < 24, `${ratio.toFixed(1)} times as long for 8 times the items`);
});

test('types: raw and parsed values of arrays, items with their key, insert typed by the element', () => {
  const form = createForm(group({ lines: array(group({ label: field(''), quantity: field(1) })) }));
  type Line = { label: string; quantity: number };
  assertType<Equal<ReturnType<typeof form.raw.get>, { lines: Line[] }>>();
  assertType<Equal<ReturnType<typeof form.parsed.get>, Result<{ lines: Line[] }, readonly Issue[]>>>();
  const item: ItemOf<ReturnType<typeof line>> = undefined as never;
  assertType<Equal<typeof item.key, number>>();
  assertType<Equal<typeof item.children.label, FieldNode<string, string>>>();
  const node = form.children.lines;
  assertType<Equal<ReturnType<typeof node.insert>['children']['quantity'], FieldNode<number, number>>>();
  // @ts-expect-error: an item of the element only
  node.insert(0, { label: 1, quantity: 1 });
  const root = createForm(array(field(0)));
  assertType<Equal<ReturnType<typeof root.submit>, Result<number[], readonly Issue[]>>>();
});

// Adversarial declarations.

/** Only the hostile value's own error comes out, or the form's `TypeError` or `RangeError`. */
function ownErrorOnly(run: () => void): void {
  try {
    run();
  } catch (error) {
    assert.ok(
      error instanceof HostileError || error instanceof TypeError || error instanceof RangeError,
      String(error),
    );
  }
}

declareAdversarial(SUBPATH, 'array', {
  boundary: (value) => {
    const form = createForm(array(field(value), { initial: [value] }));
    assert.ok(Object.is(form.items.get()[0]!.raw.get(), value));
    form.set([value, value]);
    assert.ok(Object.is(form.raw.get()[1], value));
  },
  structures: (value) =>
    ownErrorOnly(() => {
      const form = createForm(array(group({ id: field<unknown>(0) }), { identity: ['id'], initial: [{ id: value }] }));
      assert.ok(Object.is(form.items.get()[0]!.children.id.raw.get(), value));
    }),
  hostile: (value) =>
    ownErrorOnly(() => {
      const form = createForm(array(field(0), value as never));
      form.set(value as never);
      form.insert(0, value as never);
    }),
  unicode: (text) => {
    const form = createForm(array(group({ id: field('') }), { identity: ['id'] }));
    if (text === '') {
      assert.throws(() => form.insert(0, { id: text }), TypeError);
    } else {
      assert.equal(form.insert(0, { id: text }).children.id.raw.get(), text);
    }
  },
  callbacks: { na: 'array calls nothing: the callbacks of its element run in the form, declared by createForm' },
  async: { na: 'array is synchronous and takes no signal' },
});
