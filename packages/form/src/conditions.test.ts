// Examples of what a disabled, hidden or read-only node and an optional group do (ADR 0047): what the form submits and
// what each check reads, where an issue placed on a node left out goes, what a condition reads, what the types say,
// which options a form refuses, and what the laws of properties.test.ts leave to examples: blanks other than
// `undefined`, a field that starts with `false`, the schema of a group with a child left out, an item left out of a
// list a rule or a schema reads, and laziness.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { atLeast, mutuallyExclusive, requiredIf, type Condition } from '@yaltaan/rules';
import { number, object, optional, string } from '@yaltaan/schema';

import {
  array,
  createForm,
  field,
  group,
  type FieldOptions,
  type FieldSpec,
  type FormNode,
  type GroupOptions,
  type OutputOf,
  type RawOf,
} from './index.ts';

const codes = (node: FormNode<unknown, unknown>): string[] => node.issues.get().map((issue) => issue.code);

const whenTrue = (path: string) => ({ reads: [[path]], when: (value: unknown) => value === true });

test('a disabled or hidden node keeps its raw value and is left out of the submission; a read-only one is not', () => {
  const form = createForm(
    group({
      off: field(true),
      a: field('kept', { disabled: whenTrue('off') }),
      b: field('kept', { hidden: whenTrue('off') }),
      c: field('kept', { readonly: whenTrue('off') }),
      list: array(field(0), { initial: [1, 2] }),
    }),
  );
  assert.deepEqual(form.raw.get(), { off: true, a: 'kept', b: 'kept', c: 'kept', list: [1, 2] });
  assert.deepEqual(form.submit(), {
    ok: true,
    value: { off: true, a: undefined, b: undefined, c: 'kept', list: [1, 2] },
  });
  assert.deepEqual(Object.keys((form.parsed.get() as { value: object }).value), ['off', 'a', 'b', 'c', 'list']);
  // The node's own read value is an error while it is left out: it submits nothing.
  assert.deepEqual(form.children.a.parsed.get(), { ok: false, error: [] });
  form.children.off.set(false);
  assert.deepEqual(form.submit(), { ok: true, value: { off: false, a: 'kept', b: 'kept', c: 'kept', list: [1, 2] } });
});

test('nothing is asked of a node left out, nor below it; a read-only node is checked', async () => {
  let asked = 0;
  const counting = {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate: (value: unknown) => {
        asked++;
        return { issues: [{ message: `bad ${String(value)}` }] };
      },
    },
  };
  let validated = 0;
  const form = createForm(
    group({
      off: field(true),
      sub: group(
        { a: field('x', { schema: counting }), b: field('y', { validate: () => (validated++, []) }) },
        { hidden: whenTrue('off'), rules: [{ reads: [['a']], targets: [], check: () => [{ code: 'r', path: [] }] }] },
      ),
      fixed: field('', { schema: string({ minLength: 1 }), readonly: whenTrue('off') }),
    }),
  );
  assert.deepEqual([codes(form.children.sub), codes(form.children.sub.children.a)], [[], []]);
  assert.deepEqual(codes(form.children.fixed), ['schema.too_short']);
  form.children.sub.children.b.pending.get();
  assert.deepEqual([asked, validated], [0, 0]);
  form.children.off.set(false);
  assert.deepEqual(codes(form.children.sub), ['r']);
  assert.deepEqual(codes(form.children.sub.children.a), ['issue.external']);
  assert.equal(asked, 1);
  // Hidden and shown again between two reads: nothing changed for the form, and nothing is asked.
  form.children.off.set(true);
  form.children.off.set(false);
  codes(form.children.sub.children.a);
  assert.equal(asked, 1);
  // Read while hidden, then shown with the same value: the schema is asked again, as for a node that comes back.
  form.children.off.set(true);
  codes(form.children.sub.children.a);
  form.children.off.set(false);
  codes(form.children.sub.children.a);
  assert.equal(asked, 2);
});

test('every remaining check reads what the form submits: a rule finds a hidden field blank, a schema undefined', () => {
  const form = createForm(
    group(
      {
        country: field('FR'),
        siren: field('123456789'),
        foreign: field('B-1234', { hidden: { reads: [['country']], when: (country) => country === 'FR' } }),
        sub: group(
          { zip: field('75001', { disabled: whenTrue('lock') }) },
          { schema: object({ zip: optional(string()) }) },
        ),
        lock: field(true),
      },
      {
        rules: [
          mutuallyExclusive([['siren'], ['foreign']]),
          requiredIf({ reads: [['country']], when: (country) => country !== 'FR' }, [['foreign']]),
        ],
      },
    ),
  );
  // The hidden registration is not read: siren alone is filled, so they are not both filled.
  assert.deepEqual([codes(form.children.siren), codes(form.children.foreign)], [[], []]);
  assert.deepEqual(form.children.sub.parsed.get(), { ok: true, value: { zip: undefined } });
  form.children.country.set('BE');
  assert.deepEqual(codes(form.children.siren), ['rules.mutually_exclusive']);
});

test('no issue is hidden: what a rule says of a node left out shows on it and blocks the submission', () => {
  const form = createForm(
    group(
      { hide: field(true), name: field('', { hidden: whenTrue('hide') }) },
      { rules: [requiredIf({ reads: [['hide']], when: () => true }, [['name']])] },
    ),
  );
  assert.deepEqual(codes(form.children.name), ['rules.required_if']);
  assert.equal(form.children.name.required.get(), true);
  assert.equal(form.submit().ok, false);
});

test('an optional group is absent while none of its fields holds a value, a blank of any kind', () => {
  const form = createForm(
    group(
      {
        has: field(true),
        parent: group(
          { name: field<string | null>(null), tags: field<string[]>([]), note: field(''), items: array(field(0)) },
          { optional: true },
        ),
      },
      { rules: [requiredIf({ reads: [['has']], when: (has) => has === true }, [['parent']])] },
    ),
  );
  const { parent } = form.children;
  assert.deepEqual(codes(parent), ['rules.required_if']);
  assert.deepEqual(form.submit(), {
    ok: false,
    error: [{ code: 'rules.required_if', path: ['parent'] }],
  });
  parent.children.items.insert(0);
  assert.deepEqual(codes(parent), []);
  assert.deepEqual(form.submit(), {
    ok: true,
    value: { has: true, parent: { name: null, tags: [], note: '', items: [0] } },
  });
  parent.children.items.remove(parent.children.items.items.get()[0]!);
  parent.children.tags.set(['a']);
  assert.deepEqual(codes(parent), []);
});

test('a field that starts with false keeps its optional group present, and its fields checked', () => {
  const form = createForm(
    group({
      parent: group(
        { name: field('', { schema: string({ minLength: 1 }) }), listed: field(false) },
        { optional: true },
      ),
    }),
  );
  assert.deepEqual(codes(form.children.parent.children.name), ['schema.too_short']);
  assert.deepEqual(form.raw.get(), { parent: { name: '', listed: false } });
});

test('an item left out is dropped from the list a rule, a schema and the read value hold, indexes following', () => {
  const form = createForm(
    group(
      {
        rows: array(
          group({
            skip: field(false),
            qty: field(0, { hidden: { reads: [['rows', { key: undefined }, 'skip']], when: (skip) => skip === true } }),
          }),
          {
            initial: [
              { skip: false, qty: 1 },
              { skip: true, qty: 5 },
              { skip: false, qty: 3 },
            ],
            schema: {
              '~standard': {
                version: 1,
                vendor: 'test',
                validate: (value: unknown) => {
                  const list = value as { qty?: number }[];
                  const at = list.findIndex((row) => row.qty === 3);
                  return at < 0 ? { value } : { issues: [{ message: 'three', path: [at, 'qty'] }] };
                },
              },
            },
          },
        ),
      },
      { rules: [atLeast(1, { list: ['rows'], at: ['qty'], where: (qty) => qty === 5 })] },
    ),
  );
  const rows = form.children.rows.items.get();
  // The second row's quantity is hidden: no row holds 5, and the schema's index 1 names the third row.
  assert.deepEqual(codes(form.children.rows), ['rules.at_least']);
  assert.deepEqual(codes(rows[2]!.children.qty), ['issue.external']);
  assert.deepEqual(codes(rows[1]!.children.qty), []);
});

test('a condition reads raw values: a hidden field can still hide another', () => {
  const form = createForm(
    group({
      a: field(true),
      b: field(true, { hidden: whenTrue('a') }),
      c: field('', { hidden: whenTrue('b') }),
    }),
  );
  assert.deepEqual([form.children.b.hidden.get(), form.children.c.hidden.get()], [true, true]);
});

test('none of the three shows touched; dirty follows what is submitted, so a read-only node shows it', () => {
  const form = createForm(
    group({
      lock: field(false),
      sub: group({ a: field(''), b: field('') }, { readonly: whenTrue('lock') }),
      gone: group({ c: field('') }, { disabled: whenTrue('lock') }),
    }),
  );
  const { a } = form.children.sub.children;
  const { c } = form.children.gone.children;
  a.set('changed');
  c.set('changed');
  a.touch();
  c.touch();
  form.children.lock.set(true);
  assert.deepEqual([a.readonly.get(), a.dirty.get(), a.touched.get()], [true, true, false]);
  assert.deepEqual(
    [c.disabled.get(), c.dirty.get(), c.touched.get(), form.children.gone.dirty.get()],
    [true, false, false, false],
  );
  assert.deepEqual([form.children.sub.dirty.get(), form.children.sub.touched.get()], [true, false]);
  form.submit();
  form.children.lock.set(false);
  assert.deepEqual([c.dirty.get(), c.touched.get()], [true, true]);
});

test('scale: with a node that may be left out, a write costs the same in a form of 500 fields as of 4,000', () => {
  const time = (n: number): number => {
    const form = createForm(
      group({
        box: field(false),
        note: field('', { hidden: whenTrue('box') }),
        fields: group(
          Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, field('', { schema: string() })])),
        ),
      }),
    );
    const fields = Object.values(form.children.fields.children);
    const stops = fields.map((node) => node.issues.subscribe(() => undefined));
    let best = Infinity;
    for (let round = 0; round < 5; round++) {
      const start = performance.now();
      for (let i = 0; i < 200; i++) {
        fields[i % 50]!.set(String(i));
      }
      best = Math.min(best, performance.now() - start);
    }
    stops.forEach((stop) => stop());
    return best;
  };
  time(500);
  const small = time(500);
  const large = time(4000);
  assert.ok(large < small * 4 + 5, `200 writes: ${small.toFixed(2)} ms at 500 fields, ${large.toFixed(2)} ms at 4,000`);
});

test('what a condition throws is thrown by its node, those below it and what reads them, nothing else', () => {
  const broken = new Error('condition bug');
  const form = createForm(
    group({
      x: field('', { schema: string({ minLength: 1 }) }),
      y: field('', {
        hidden: {
          reads: [['x']],
          when: () => {
            throw broken;
          },
        },
      }),
    }),
  );
  assert.deepEqual(codes(form.children.x), ['schema.too_short']);
  assert.equal(form.children.x.pending.get(), false);
  for (const state of [form.children.y.hidden, form.children.y.parsed, form.parsed]) {
    assert.throws(() => state.get(), broken);
  }
});

test('nothing is computed before a state that needs it is read', () => {
  let when = 0;
  const form = createForm(
    group({ a: field(1), b: field(2, { hidden: { reads: [['a']], when: () => (when++, false) } }) }),
  );
  form.children.a.set(3);
  assert.equal(when, 0);
  form.children.b.hidden.get();
  assert.equal(when, 1);
});

test('the options are checked, and a condition reads only paths of the form', () => {
  for (const options of [{ hidden: {} }, { readonly: { reads: [] } }, { optional: 'yes' }, { hidden: null }]) {
    assert.throws(() => group({ a: field('') }, options as never), TypeError);
  }
  assert.throws(() => field('', { readonly: { when: () => true } } as never), TypeError);
  // `optional` belongs to a group: a field or an array given it is refused, not left silently present.
  assert.throws(() => field('', { optional: true } as never), /optional is a boolean of a group/);
  assert.throws(() => array(field(''), { optional: false } as never), /optional is a boolean of a group/);
  assert.doesNotThrow(() => group({ a: field('') }, { optional: false }));
  assert.throws(
    () => createForm(group({ a: field('', { hidden: { reads: [['nope']], when: () => true } }) })),
    /a condition reads a path that names no node of this form/,
  );
  assert.throws(
    () => createForm(group({ a: field('', { readonly: { reads: [['a', 'b']], when: () => true } }) })),
    /a condition reads a path that names no node of this form/,
  );
});

/** True exactly when `A` and `B` are the same type. */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

test('the types: a node that may be left out reads undefined in its group, exactly', () => {
  const when = { reads: [], when: () => false };
  const flag = Math.random() > 2;
  const wide: FieldOptions<string> = {};
  const spec = group({
    shown: field(''),
    hideable: field('', { hidden: when }),
    locked: field('', { schema: number(), disabled: when }),
    readOnly: field('', { readonly: when }),
    wide: field('', wide),
    parent: group({ name: field('') }, { optional: true }),
    plain: group({ name: field('') }),
    flagged: group({ name: field('') }, { optional: flag }),
    hiddenGroup: group({ name: field('') }, { hidden: when }),
    list: array(field(0)),
    hiddenList: array(field(0), { hidden: when }),
  });
  const read: Same<
    OutputOf<typeof spec>,
    {
      shown: string;
      hideable: string | undefined;
      locked: number | undefined;
      readOnly: string;
      wide: string | undefined;
      parent: { name: string } | undefined;
      plain: { name: string };
      flagged: { name: string } | undefined;
      hiddenGroup: { name: string } | undefined;
      list: number[];
      hiddenList: number[] | undefined;
    }
  > = true;
  const raw: Same<RawOf<typeof spec>['parent'], { name: string }> = true;
  const hidden: boolean = createForm(spec).children.parent.hidden.get();
  void [read, raw, hidden];
});

test('the types: a condition typed or inlined, a wider group, and type arguments written out, exactly', () => {
  const typed: Condition = { reads: [], when: () => false };
  const wideGroup: GroupOptions<{ name: string }> = {};
  const spec = group({
    typed: field('', { hidden: typed }),
    inline: field(1, { disabled: { reads: [['typed']], when: (value) => value === '' } }),
    notOptional: group({ name: field('') }, { optional: false }),
    wideGroup: group({ name: field('') }, wideGroup),
    list: array(group({ sku: field('') }), { identity: ['sku'], initial: [{ sku: 'a' }] }),
    nullable: field<string | null>(null),
    nullableHidden: field<string | null>(null, { hidden: typed }),
    listDisabled: field<string[]>([], { disabled: typed }),
    parsed: field<string, number>('', { schema: number() }),
    parsedHidden: field<string, number>('', { schema: number(), hidden: typed }),
    explicitGroup: group<{ name: FieldSpec<string> }>({ name: field('') }, { optional: true }),
  });
  const read: Same<
    OutputOf<typeof spec>,
    {
      typed: string | undefined;
      inline: number | undefined;
      notOptional: { name: string };
      wideGroup: { name: string } | undefined;
      list: { sku: string }[];
      nullable: string | null;
      nullableHidden: string | null | undefined;
      listDisabled: string[] | undefined;
      parsed: number;
      parsedHidden: number | undefined;
      explicitGroup: { name: string } | undefined;
    }
  > = true;
  void read;
  // @ts-expect-error a condition has its paths
  assert.throws(() => field('', { hidden: { when: () => true } }), TypeError);
  // @ts-expect-error when is a function
  assert.throws(() => field('', { disabled: { reads: [], when: 5 } }), TypeError);
  // @ts-expect-error optional is a group's
  assert.throws(() => array(field(0), { optional: true }), TypeError);
  // @ts-expect-error optional is a boolean
  assert.throws(() => group({ a: field('') }, { optional: 'yes' }), TypeError);
});
