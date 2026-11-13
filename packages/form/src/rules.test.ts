// Examples of the rules of @yaltaan/rules read by the form (ADR 0046): what each rule reads and when it is checked
// again, counted call by call, where its issues go and with which code, what `required` says, what a sub-form left
// empty reads, which paths a form refuses, and what the laws of properties.test.ts leave to examples: laziness, a rule
// that throws, warnings, the validators a rule holds back, the paths of `each` by a business key, and the cost of a
// write through a long list.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Issue } from '@yaltaan/core/issue';
import {
  allOrNone,
  anyElement,
  atLeast,
  checkRules,
  each,
  exactly,
  mutuallyExclusive,
  ordered,
  requiredIf,
  requiredPaths,
  unique,
  type Rule,
} from '@yaltaan/rules';
import { string } from '@yaltaan/schema';

import { array, createForm, field, group, type FormNode, type Validation } from './index.ts';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const issues = (node: FormNode<unknown, unknown>): string[] =>
  node.issues.get().map((issue) => `${issue.code} ${JSON.stringify(issue.path)}`);

const every = (form: FormNode<unknown, unknown>): string[] => {
  const parsed = form.parsed.get();
  return parsed.ok ? [] : parsed.error.map((issue) => `${issue.code} ${JSON.stringify(issue.path)}`);
};

/** `rule` with its checks counted: `calls.check` and `calls.required` grow by one at each call, the values kept. */
function counted(rule: Rule): {
  readonly rule: Rule;
  readonly calls: { check: number; required: number; seen: unknown[] };
} {
  const calls = { check: 0, required: 0, seen: [] as unknown[] };
  const { required } = rule;
  return {
    calls,
    rule: {
      reads: rule.reads,
      targets: rule.targets,
      check: (values) => {
        calls.check++;
        calls.seen.push(values);
        return rule.check(values);
      },
      ...(required
        ? {
            required: (values: unknown) => {
              calls.required++;
              return required(values);
            },
          }
        : {}),
    },
  };
}

const text = (initial = ''): ReturnType<typeof field<string>> => field<string>(initial);

test('a write checks again only the rules that read the field written', () => {
  const contract = counted(
    allOrNone([
      ['contract', 'number'],
      ['contract', 'signedOn'],
    ]),
  );
  const terms = counted(ordered(['terms', 'from'], ['terms', 'to']));
  const form = createForm(
    group(
      {
        contract: group({ number: text(), signedOn: text() }),
        terms: group({ from: text('2026-01-01'), to: text('2026-12-31') }),
        note: text(),
      },
      { rules: [contract.rule, terms.rule] },
    ),
  );
  assert.deepEqual(every(form), []);
  assert.deepEqual([contract.calls.check, terms.calls.check], [1, 1]);
  form.children.note.set('hello');
  assert.deepEqual(every(form), []);
  assert.deepEqual([contract.calls.check, terms.calls.check], [1, 1], 'a field no rule reads');
  form.children.contract.children.number.set('C-1');
  assert.deepEqual(every(form), ['rules.all_or_none ["contract","signedOn"]']);
  assert.deepEqual([contract.calls.check, terms.calls.check], [2, 1]);
  form.children.terms.children.to.set('2025-12-31');
  assert.deepEqual(every(form), ['rules.all_or_none ["contract","signedOn"]', 'rules.ordered ["terms","to"]']);
  assert.deepEqual([contract.calls.check, terms.calls.check], [2, 2]);
  // The same value again, or a value set back within a batch, changes nothing the rule reads.
  form.children.terms.children.to.set('2025-12-31');
  form.graph.batch(() => {
    form.children.contract.children.number.set('C-2');
    form.children.contract.children.number.set('C-1');
  });
  every(form);
  assert.deepEqual([contract.calls.check, terms.calls.check], [2, 2]);
});

test('a rule reads the values of its paths and nothing else, a group it reads whole every field below', () => {
  const whole = counted({
    reads: [['address']],
    targets: [['address']],
    check: (values) => [{ code: 'law.seen', path: [], params: { values } }],
  });
  const one = counted({
    reads: [['address', 'city']],
    targets: [],
    check: () => [],
  });
  const form = createForm(
    group(
      { address: group({ street: text('1 rue'), city: text('Lyon') }), other: text('x') },
      { rules: [whole.rule, one.rule] },
    ),
  );
  every(form);
  assert.deepEqual(whole.calls.seen, [{ address: { street: '1 rue', city: 'Lyon' } }]);
  assert.deepEqual(one.calls.seen, [{ address: { city: 'Lyon' } }]);
  form.children.address.children.street.set('2 rue');
  every(form);
  assert.deepEqual([whole.calls.check, one.calls.check], [2, 1]);
  form.children.address.children.city.set('Paris');
  every(form);
  assert.deepEqual([whole.calls.check, one.calls.check], [3, 2]);
  assert.deepEqual(one.calls.seen.at(-1), { address: { city: 'Paris' } });
});

test('a group a rule reads whole is its raw value, as checkRules reads it: a sub-form left empty is an object', () => {
  const rules = [
    requiredIf({ reads: [['same']], when: (same) => same === false }, [['billing']]),
    mutuallyExclusive([['billing'], ['poBox']]),
  ];
  const seen = counted({ reads: [['billing']], targets: [], check: () => [] });
  const form = createForm(
    group(
      {
        same: field(false),
        billing: group({ street: field<string | undefined>(undefined), rows: array(group({ a: text() })) }),
        poBox: field<string | undefined>('BP 12'),
      },
      { rules: [...rules, seen.rule] },
    ),
  );
  // Not blank, by @yaltaan/rules: the same answer as a server that runs these rules on the raw value.
  assert.deepEqual(every(form), ['rules.mutually_exclusive ["billing"]', 'rules.mutually_exclusive ["poBox"]']);
  assert.deepEqual(seen.calls.seen, [{ billing: { street: undefined, rows: [] } }]);
  assert.deepEqual(
    checkRules(rules, form.raw.get()).map((issue) => `${issue.code} ${JSON.stringify(issue.path)}`),
    every(form),
  );
});

test('issues keep their code and data, on the deepest node their path names, after the schema of the node', () => {
  const form = createForm(
    group(
      {
        company: group(
          { siren: field<string | undefined>(undefined), country: text('FR') },
          {
            rules: [requiredIf({ reads: [['country']], when: (country) => country === 'FR' }, [['siren']])],
          },
        ),
        contacts: array(group({ email: text() }), { initial: [{ email: '' }, { email: '' }] }),
      },
      {
        schema: {
          '~standard': {
            version: 1,
            vendor: 'test',
            validate: () => ({ issues: [{ message: 'from the schema', path: ['company', 'siren'] }] }),
          },
        },
        rules: [
          atLeast(1, { list: ['contacts'], at: ['email'] }),
          {
            reads: [['contacts', anyElement, 'email']],
            targets: [['contacts', anyElement, 'email']],
            check: () => [
              { code: 'app.second', path: ['contacts', 1, 'email'], params: { n: 2 } },
              { code: 'app.ghost', path: ['company', 'nowhere', 'deeper'] },
              { code: 'app.past', path: ['contacts', 9] },
            ],
          },
        ],
      },
    ),
  );
  const { company, contacts } = form.children;
  const [, second] = contacts.items.get();
  assert.deepEqual(issues(company.children.siren), [
    'issue.external ["company","siren"]',
    'rules.required_if ["company","siren"]',
  ]);
  assert.deepEqual(issues(contacts), ['rules.at_least ["contacts"]', 'app.past ["contacts",9]']);
  assert.deepEqual(contacts.issues.get()[0]!.params, { minimum: 1, count: 0 });
  // An index names the item at that place in the values the rule read, replaced by its key.
  assert.deepEqual(second!.children.email.issues.get(), [
    { code: 'app.second', path: ['contacts', { key: second!.key }, 'email'], params: { n: 2 } },
  ]);
  assert.deepEqual(issues(company), ['app.ghost ["company","nowhere","deeper"]']);
});

test('required follows what the rules require, by the node each path names', () => {
  const vat = counted(requiredIf({ reads: [['country']], when: (country) => country === 'FR' }, [['vat']]));
  const form = createForm(
    group(
      {
        country: text('FR'),
        vat: text(),
        products: array(group({ key: text(), taxable: field(false), rate: field<number | undefined>(undefined) }), {
          identity: ['key'],
          initial: [
            { key: 'p1', taxable: true, rate: undefined },
            { key: 'p2', taxable: false, rate: undefined },
          ],
        }),
      },
      {
        rules: [
          vat.rule,
          each(['products'], [requiredIf({ reads: [['taxable']], when: (taxable) => taxable === true }, [['rate']])], {
            identity: ['key'],
          }),
        ],
      },
    ),
  );
  const [p1, p2] = form.children.products.items.get();
  assert.equal(vat.calls.required, 0, 'nothing computed before a state is read');
  assert.equal(form.children.vat.required.get(), true);
  assert.deepEqual([vat.calls.check, vat.calls.required], [0, 1]);
  assert.equal(form.children.country.required.get(), false);
  assert.equal(form.required.get(), false);
  assert.deepEqual(
    [p1!.children.rate.required.get(), p2!.children.rate.required.get(), p1!.required.get()],
    [true, false, false],
  );
  form.children.vat.set('FR32123456782');
  assert.equal(form.children.vat.required.get(), true, 'required once filled: it shows, the rule decides');
  assert.equal(vat.calls.required, 2, 'requiredIf reads the fields it requires, to tell whether they are blank');
  form.children.country.set('DE');
  assert.equal(form.children.vat.required.get(), false);
  p2!.children.taxable.set(true);
  form.children.products.move(p2!, 0);
  assert.deepEqual([p1!.children.rate.required.get(), p2!.children.rate.required.get()], [true, true]);
  // Node by node, what requiredPaths says of the raw value, an index naming the item at that place.
  form.children.country.set('FR');
  const items = form.children.products.items.get();
  const named = requiredPaths(
    [vat.rule, each(['products'], [requiredIf({ reads: [['taxable']], when: (on) => on === true }, [['rate']])])],
    form.raw.get(),
  ).map((path) =>
    JSON.stringify(
      path[0] === 'products' ? ['products', { key: items[path[1] as number]!.key }, ...path.slice(2)] : path,
    ),
  );
  const all = [
    form,
    form.children.country,
    form.children.vat,
    form.children.products,
    ...items.flatMap((item) => [item, ...Object.values(item.children)]),
  ];
  assert.deepEqual(
    all.filter((node) => node.required.get()).map((node) => JSON.stringify(node.path)),
    named,
  );
  // A node no rule above reads holds the form's one false node.
  const plain = createForm(group({ a: text() }));
  assert.equal(plain.children.a.required, plain.required);
});

test('the items of a list: a write into one item checks only what reads its field, a move what reads the list', () => {
  const emails = counted(unique(['contacts'], ['email'], { identity: ['key'] }));
  const primary = counted(exactly(1, { list: ['contacts'], at: ['primary'], where: (flag) => flag === true }));
  const form = createForm(
    group(
      {
        contacts: array(group({ key: text(), email: text(), name: text(), primary: field(false) }), {
          identity: ['key'],
          initial: [
            { key: 'c1', email: 'a@x', name: 'A', primary: true },
            { key: 'c2', email: 'b@x', name: 'B', primary: false },
          ],
        }),
      },
      { rules: [emails.rule, primary.rule] },
    ),
  );
  const { contacts } = form.children;
  const [c1, c2] = contacts.items.get();
  assert.deepEqual(every(form), []);
  c2!.children.name.set('Bee');
  every(form);
  assert.deepEqual([emails.calls.check, primary.calls.check], [1, 1]);
  c2!.children.email.set('A@x'.toLowerCase());
  assert.deepEqual(every(form), [
    `rules.unique ["contacts",{"key":${c1!.key}},"email"]`,
    `rules.unique ["contacts",{"key":${c2!.key}},"email"]`,
  ]);
  assert.deepEqual([emails.calls.check, primary.calls.check], [2, 1]);
  contacts.move(c2!, 0);
  every(form);
  assert.deepEqual([emails.calls.check, primary.calls.check], [3, 2], 'the list moved under both');
  assert.deepEqual(issues(c1!.children.email), [`rules.unique ["contacts",{"key":${c1!.key}},"email"]`]);
  const c3 = contacts.insert(2, { key: 'c3', email: 'c@x', name: 'C', primary: false });
  every(form);
  assert.deepEqual([emails.calls.check, primary.calls.check], [4, 3]);
  c3.children.email.set('d@x');
  every(form);
  assert.deepEqual([emails.calls.check, primary.calls.check], [5, 3], 'a new item is read like the others');
  contacts.remove(c3);
  c3.children.email.set('e@x');
  every(form);
  assert.deepEqual([emails.calls.check, primary.calls.check], [6, 4], 'a removed item is read no more');
});

test('an index in a path reads every item, since which item stands there changes with each move', () => {
  const first = counted({
    reads: [['tiers', 0, 'from']],
    targets: [['tiers', anyElement, 'from']],
    check: (values) => {
      const from = (values as { tiers: { from?: number }[] }).tiers[0]?.from;
      return from !== undefined && from < 10 ? [{ code: 'app.first', path: ['tiers', 0, 'from'] }] : [];
    },
  });
  const form = createForm(
    group(
      { tiers: array(group({ from: field(0) }), { initial: [{ from: 20 }, { from: 5 }] }) },
      { rules: [first.rule] },
    ),
  );
  const [a, b] = form.children.tiers.items.get();
  assert.deepEqual(every(form), []);
  b!.children.from.set(6);
  every(form);
  assert.equal(first.calls.check, 2, 'the second item is read too');
  form.children.tiers.move(b!, 0);
  assert.deepEqual(every(form), [`app.first ["tiers",{"key":${b!.key}},"from"]`]);
  assert.equal(a!.children.from.issues.get().length, 0);
});

test('rules of an item read that item: a write into one item checks no other', () => {
  const made: { calls: { check: number } }[] = [];
  const element = group(
    { from: field(0), to: field(0) },
    {
      rules: [
        {
          reads: [['from'], ['to']],
          targets: [['to']],
          check: (values) => {
            made[0]!.calls.check++;
            const { from, to } = values as { from: number; to: number };
            return to < from ? [{ code: 'app.order', path: ['to'] }] : [];
          },
        },
      ],
    },
  );
  made.push({ calls: { check: 0 } });
  const form = createForm(
    group({
      ranges: array(element, {
        initial: [
          { from: 1, to: 2 },
          { from: 3, to: 4 },
        ],
      }),
    }),
  );
  const [first, second] = form.children.ranges.items.get();
  assert.deepEqual(every(form), []);
  assert.equal(made[0]!.calls.check, 2);
  second!.children.to.set(0);
  assert.deepEqual(every(form), [`app.order ["ranges",{"key":${second!.key}},"to"]`]);
  assert.equal(made[0]!.calls.check, 3);
  form.children.ranges.move(second!, 0);
  every(form);
  assert.equal(made[0]!.calls.check, 3, 'a move reads no value of an item again');
  assert.deepEqual(issues(first!.children.to), []);
});

test('rules of an array read from it, and `each` names items by a business key the array keeps them by', () => {
  const form = createForm(
    group({
      products: array(group({ key: text(), reference: text() }), {
        identity: ['key'],
        initial: [
          { key: 'p1', reference: 'A' },
          { key: 'p2', reference: 'a' },
        ],
        rules: [
          unique([], ['reference'], {
            identity: ['key'],
            by: (reference) => (typeof reference === 'string' ? reference.toLowerCase() : reference),
          }),
          atLeast(3, { list: [] }),
        ],
      }),
    }),
  );
  const { products } = form.children;
  const [p1, p2] = products.items.get();
  assert.deepEqual(issues(p1!.children.reference), [`rules.unique ["products",{"key":${p1!.key}},"reference"]`]);
  assert.deepEqual(issues(p2!.children.reference), [`rules.unique ["products",{"key":${p2!.key}},"reference"]`]);
  assert.deepEqual(issues(products), ['rules.at_least ["products"]']);
  // Without the same identity on the array, a `{ key }` names no item: the issue stays on the list.
  const loose = createForm(
    group(
      {
        products: array(group({ key: text(), reference: text() }), {
          initial: [
            { key: 'p1', reference: 'A' },
            { key: 'p2', reference: 'A' },
          ],
        }),
      },
      { rules: [unique(['products'], ['reference'], { identity: ['key'] })] },
    ),
  );
  assert.deepEqual(issues(loose.children.products), [
    'rules.unique ["products",{"key":"p1"},"reference"]',
    'rules.unique ["products",{"key":"p2"},"reference"]',
  ]);
});

test('the same issues as checkRules gives on the raw value, but for the paths of items', () => {
  const rules = [
    requiredIf({ reads: [['a']], when: (a) => a === 1 }, [['b']]),
    allOrNone([
      ['c', 'x'],
      ['c', 'y'],
    ]),
    unique(['list'], ['v']),
  ];
  const form = createForm(
    group(
      {
        a: field(1),
        b: field<number | undefined>(undefined),
        c: group({ x: field<number | undefined>(1), y: field<number | undefined>(undefined) }),
        list: array(group({ v: field(0) }), { initial: [{ v: 1 }, { v: 1 }] }),
      },
      { rules },
    ),
  );
  const [first, second] = form.children.list.items.get();
  const byIndex = checkRules(rules, form.raw.get()).map((issue) =>
    issue.path[0] === 'list'
      ? { ...issue, path: ['list', { key: [first, second][issue.path[1] as number]!.key }, ...issue.path.slice(2)] }
      : issue,
  );
  const shown = form.parsed.get();
  assert.ok(!shown.ok);
  assert.deepEqual(
    [...shown.error].sort((x, y) => JSON.stringify(x.path).localeCompare(JSON.stringify(y.path))),
    [...byIndex].sort((x, y) => JSON.stringify(x.path).localeCompare(JSON.stringify(y.path))),
  );
});

test('nothing is checked before a state that needs it is read, and a write checks nothing until then', () => {
  const rule = counted(allOrNone([['a'], ['b']]));
  const form = createForm(group({ a: text('x'), b: text() }, { rules: [rule.rule] }));
  form.children.a.set('y');
  assert.deepEqual([rule.calls.check, rule.calls.required], [0, 0]);
  assert.equal(form.children.a.raw.get(), 'y');
  assert.equal(form.children.a.dirty.get(), true);
  assert.equal(form.children.a.pending.get(), false);
  assert.deepEqual([rule.calls.check, rule.calls.required], [0, 0]);
  assert.deepEqual(issues(form.children.b), ['rules.all_or_none ["b"]']);
  assert.deepEqual([rule.calls.check, rule.calls.required], [1, 0]);
  form.children.a.set('z');
  form.children.a.set('w');
  assert.deepEqual(issues(form.children.a), []);
  assert.deepEqual([rule.calls.check, rule.calls.required], [2, 0]);
  assert.equal(form.children.b.required.get(), true);
  assert.deepEqual([rule.calls.check, rule.calls.required], [2, 1]);
});

test('what a rule throws is thrown by the states that depend on it, and by no other', () => {
  const form = createForm(
    group(
      { a: text(), b: text() },
      {
        rules: [
          {
            reads: [['a']],
            targets: [['a']],
            check: (values) => {
              if ((values as { a: string }).a === 'boom') {
                throw new RangeError('boom');
              }
              return [];
            },
          },
        ],
      },
    ),
  );
  form.children.a.set('boom');
  assert.throws(() => form.children.b.issues.get(), RangeError);
  assert.throws(() => form.parsed.get(), RangeError);
  assert.equal(form.children.a.raw.get(), 'boom');
  assert.equal(form.pending.get(), false);
  assert.equal(form.children.a.required.get(), false);
  form.children.a.set('fine');
  assert.deepEqual(every(form), []);
});

test('a warning is shown and blocks nothing: neither the read value nor a validator', async () => {
  const runs: unknown[] = [];
  const form = createForm(
    group(
      {
        name: field('ada', {
          validate: (value) => {
            runs.push(value);
            return [];
          },
        }),
      },
      {
        rules: [
          {
            reads: [['name']],
            targets: [['name']],
            check: () => [{ code: 'app.short', path: ['name'], severity: 'warning' }],
          },
        ],
      },
    ),
  );
  assert.deepEqual(form.children.name.issues.get(), [{ code: 'app.short', path: ['name'], severity: 'warning' }]);
  assert.deepEqual(form.parsed.get(), { ok: true, value: { name: 'ada' } });
  assert.deepEqual(form.submit(), { ok: true, value: { name: 'ada' } });
  await tick();
  assert.deepEqual(runs, ['ada']);
});

test('an issue of a rule on a node or below holds its validator back, and aborts the run in flight', async () => {
  const signals: AbortSignal[] = [];
  const validate = (value: string, { signal }: Validation): Promise<readonly Issue[]> => {
    signals.push(signal);
    return new Promise((answer) =>
      setTimeout(() => answer(value === 'taken' ? [{ code: 'app.taken', path: [] }] : []), 5),
    );
  };
  const form = createForm(
    group(
      { country: text('FR'), siren: field<string>('', { validate, schema: string() }) },
      { rules: [requiredIf({ reads: [['country']], when: (country) => country === 'FR' }, [['siren']])] },
    ),
  );
  const { siren, country } = form.children;
  assert.deepEqual(issues(siren), ['rules.required_if ["siren"]']);
  assert.equal(siren.pending.get(), false);
  assert.equal(signals.length, 0, 'held back by the rule');
  siren.set('taken');
  assert.equal(siren.pending.get(), true);
  assert.equal(signals.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(issues(siren), ['app.taken ["siren"]']);
  siren.set('other');
  assert.equal(siren.pending.get(), true);
  assert.equal(signals.length, 2);
  // The rule marks the node again: the run in flight stops counting, and is aborted.
  form.graph.batch(() => {
    siren.set('');
    country.set('FR');
  });
  assert.equal(siren.pending.get(), false);
  await tick();
  assert.equal(signals[1]!.aborted, true);
  assert.deepEqual(issues(siren), ['rules.required_if ["siren"]']);
});

test('a form refuses a rule that reads a path naming none of its nodes, when it is built', () => {
  const build = (reads: unknown[][]): unknown =>
    createForm(
      group(
        { a: group({ b: text() }), list: array(group({ c: text() })), f: field<number[]>([]) },
        { rules: [{ reads: reads as never, targets: [], check: () => [] }] },
      ),
    );
  for (const reads of [[['zz']], [['a', 'zz']], [['a', 0]], [[anyElement]], [['toString']], [['__proto__']]]) {
    assert.throws(() => build(reads), TypeError, JSON.stringify(reads));
  }
  for (const reads of [[[]], [['a']], [['a', 'b']], [['list', anyElement, 'c']], [['list', 7]], [['f', 0, 'x']]]) {
    build(reads);
  }
  assert.throws(() => build(['a'] as never), TypeError, 'a path is a list');
  // In an item, the path is checked when the form is built, not when an item is.
  assert.throws(
    () =>
      createForm(
        group({ list: array(group({ c: text() }, { rules: [{ reads: [['d']], targets: [], check: () => [] }] })) }),
      ),
    TypeError,
  );
  for (const rules of [
    {},
    [null],
    [{ reads: [], check: 1 }],
    [{ reads: 'a', check: () => [] }],
    [{ reads: [], check: () => [], required: 1 }],
  ]) {
    assert.throws(() => group({}, { rules: rules as never }), TypeError, JSON.stringify(rules));
  }
});

test('a write into one item of a long list checks the rules of that item only, and those through the list once', () => {
  const time = (count: number): { readonly calls: number; readonly ms: number } => {
    let calls = 0;
    const element = group(
      { a: field(0), b: field(0) },
      {
        rules: [
          {
            reads: [['a'], ['b']],
            targets: [['b']],
            check: () => {
              calls++;
              return [];
            },
          },
        ],
      },
    );
    const form = createForm(
      group(
        { rows: array(element, { initial: Array.from({ length: count }, () => ({ a: 0, b: 0 })), maxLength: count }) },
        { rules: [atLeast(1, { list: ['rows'], at: ['a'] })] },
      ),
      { maxItems: count },
    );
    form.parsed.subscribe(() => undefined);
    calls = 0;
    const rows = form.children.rows.items.get();
    const started = performance.now();
    for (let index = 0; index < 200; index++) {
      rows[index % count]!.children.b.set(index + 1);
    }
    return { calls, ms: performance.now() - started };
  };
  const small = time(250);
  const large = time(2000);
  assert.deepEqual([small.calls, large.calls], [200, 200]);
  // Writing `b` reads no field of the list's rule: its view is not computed again, whatever the length.
  assert.ok(large.ms < small.ms * 4 + 50, `${large.ms} ms at 2,000 rows against ${small.ms} ms at 250`);
});

test('a key that names no item of the list a rule read leaves the issue on the list, and the item once there', () => {
  const form = createForm(
    group(
      {
        billing: group({
          lines: array(group({ key: text(), amount: field<number | undefined>(undefined) }), { identity: ['key'] }),
        }),
      },
      {
        rules: [
          {
            reads: [['billing']],
            targets: [],
            check: () => [{ code: 'app.line', path: ['billing', 'lines', { key: 'a' }, 'amount'] }],
          },
        ],
      },
    ),
  );
  const { lines } = form.children.billing.children;
  assert.deepEqual(issues(lines), ['app.line ["billing","lines",{"key":"a"},"amount"]']);
  const line = lines.insert(0, { key: 'a', amount: 1 });
  assert.deepEqual(issues(lines), []);
  assert.deepEqual(issues(line.children.amount), [`app.line ["billing","lines",{"key":${line.key}},"amount"]`]);
});

test('a rule that reads nothing is checked once, and is handed nothing', () => {
  const nothing = counted({ reads: [], targets: [], check: () => [{ code: 'app.always', path: [] }] });
  const form = createForm(
    group({ rows: array(group({ a: text() }, { rules: [nothing.rule] }), { initial: [{ a: 'x' }] }) }),
  );
  const { rows } = form.children;
  assert.deepEqual(every(form), [`app.always ["rows",{"key":${rows.items.get()[0]!.key}}]`]);
  rows.insert(1, { a: 'y' });
  rows.items.get()[0]!.children.a.set('z');
  every(form);
  assert.equal(nothing.calls.check, 2, 'once for each item');
  assert.deepEqual(nothing.calls.seen, [undefined, undefined]);
  const top = counted({ reads: [], targets: [], check: () => [] });
  const list = createForm(array(group({ a: text() }), { initial: [{ a: 'x' }], rules: [top.rule] }));
  list.insert(0, { a: 'y' });
  assert.deepEqual(list.parsed.get(), { ok: true, value: [{ a: 'y' }, { a: 'x' }] });
  assert.equal(top.calls.check, 1);
});

test('placing issues that name items by key costs a pass over the list, not one per issue', () => {
  // The best of five rounds of 20 writes, at 125 rows and at 1,000: linear, it grows eight times, quadratic, 64.
  const time = (count: number): number => {
    const form = createForm(
      group(
        {
          products: array(group({ key: text(), taxable: field(true), rate: field<number | undefined>(undefined) }), {
            identity: ['key'],
            initial: Array.from({ length: count }, (_, index) => ({
              key: `p${index}`,
              taxable: true,
              rate: undefined,
            })),
            maxLength: count,
          }),
        },
        {
          rules: [
            each(['products'], [requiredIf({ reads: [['taxable']], when: (on) => on === true }, [['rate']])], {
              identity: ['key'],
            }),
            unique(['products'], ['taxable'], { identity: ['key'] }),
          ],
        },
      ),
      { maxItems: count },
    );
    form.parsed.subscribe(() => undefined);
    const rows = form.children.products.items.get();
    let best = Infinity;
    for (let round = 0; round < 5; round++) {
      const started = performance.now();
      for (let index = 0; index < 20; index++) {
        rows[(round * 20 + index) % count]!.children.rate.set(round * 20 + index);
        rows[(round * 20 + index) % count]!.children.rate.set(undefined);
      }
      best = Math.min(best, performance.now() - started);
    }
    assert.equal(form.children.products.issues.get().length, 0);
    return best;
  };
  const small = time(125);
  const large = time(1000);
  assert.ok(large < small * 24 + 20, `${large.toFixed(1)} ms at 1,000 rows against ${small.toFixed(1)} ms at 125`);
});

test('a key two items hold, once one was edited to the other, names the first, as for a schema', () => {
  const form = createForm(
    group(
      {
        lines: array(group({ key: text(), amount: field(0) }), {
          identity: ['key'],
          initial: [
            { key: 'a', amount: 1 },
            { key: 'b', amount: 2 },
          ],
        }),
      },
      {
        rules: [
          {
            reads: [['lines', anyElement]],
            targets: [],
            check: () => [{ code: 'app.line', path: ['lines', { key: 'a' }, 'amount'] }],
          },
        ],
      },
    ),
  );
  const [first, second] = form.children.lines.items.get();
  second!.children.key.set('a');
  assert.deepEqual(issues(first!.children.amount), [`app.line ["lines",{"key":${first!.key}},"amount"]`]);
  assert.deepEqual(issues(second!.children.amount), []);
});
