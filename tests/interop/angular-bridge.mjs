// The bridge of angular-bridge.ts, the source of @yaltaan/angular (ADR 0048), in Angular Signal Forms 22.2.4 over
// jsdom, judged by references it does not write: a node of the graph for `fromNode`; every state of @yaltaan/form for
// `signalsOf`, on generated sequences of writes; and for `validateRules`, the same rules read by @yaltaan/form, which
// places their issues and computes what they require on its own, on generated sequences of writes, beside the
// validators of Angular that an application writes by hand (form-rules.mjs), which say what Angular checks again on a
// write. Run by tests/interop/run.sh, from the tarballs an application would install.
import '@angular/compiler';
import assert from 'node:assert/strict';

import {
  Component,
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { applyEach, form, hidden, readonly, required, validate } from '@angular/forms/signals';
import { createGraph } from '@yaltaan/core/reactive';
import { array, createForm, field, group } from '@yaltaan/form';
import { allOrNone, anyElement, checkRules, each, requiredIf, requiredPaths, unique } from '@yaltaan/rules';
import fc from 'fast-check';
import { JSDOM } from 'jsdom';

import { fromNode, signalsOf, validateRules } from './angular-bridge.ts';

const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
Object.assign(globalThis, { window, document: window.document, Node: window.Node });
const { getTestBed, TestBed } = await import('@angular/core/testing');
const { BrowserTestingModule, platformBrowserTesting } = await import('@angular/platform-browser/testing');
getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const environment = TestBed.inject(EnvironmentInjector);
const child = () => createEnvironmentInjector([], environment);
const RUNS = Number(process.env.BRIDGE_RUNS ?? 200);

// 1. fromNode: a signal that follows a node, through a batch, throws what it throws, and lets it go with its injector,
// given or that of the injection context.
{
  assert.throws(() => fromNode(createGraph().source(1)), /NG0203/);
  const graph = createGraph();
  const price = graph.source(10);
  const failure = new Error('negative');
  let computes = 0;
  const total = graph.derived([price], (value) => {
    computes += 1;
    if (value < 0) {
      throw failure;
    }
    return value * 2;
  });
  const given = child();
  const doubled = fromNode(total, { injector: given });
  const context = child();
  const followed = runInInjectionContext(context, () => fromNode(total));
  assert.deepEqual([doubled(), followed()], [20, 20]);
  graph.batch(() => {
    price.set(1);
    price.set(2);
  });
  assert.deepEqual([doubled(), followed()], [4, 4]);
  price.set(-1);
  assert.throws(doubled, (error) => error === failure);
  price.set(3);
  given.destroy();
  assert.deepEqual([doubled(), followed()], [6, 6]);
  context.destroy();
  const before = computes;
  price.set(4);
  assert.equal(computes, before, 'a node no longer followed computes nothing on a write');
  assert.deepEqual([doubled(), followed()], [6, 6], 'a signal keeps its last value');
  assert.throws(() => fromNode(total, { injector: given }), /NG0205/);
}

// 2. signalsOf: each state of every node of a form, as the form gives it, on generated writes; nothing subscribed
// before a state is read, and nothing after the injector is destroyed; dirty on a read-only node, where Angular hides
// it.
const STATES = [
  'raw',
  'parsed',
  'issues',
  'required',
  'dirty',
  'touched',
  'pending',
  'submitted',
  'disabled',
  'hidden',
];
const filled = (value) => (typeof value === 'string' && value !== '' ? [] : [{ code: 'app.blank', path: [] }]);
const statesSpec = () =>
  group(
    {
      locked: field(false),
      note: field('', { validate: filled, disabled: { reads: [['locked']], when: (locked) => locked === true } }),
      total: field('', { readonly: { reads: [], when: () => true } }),
      hasParent: field(false),
      parent: group(
        { name: field('', { validate: filled }) },
        { optional: true, hidden: { reads: [['hasParent']], when: (has) => has !== true } },
      ),
      contacts: array(group({ email: field('') }), { initial: [{ email: 'a@example.org' }] }),
    },
    { rules: [requiredIf({ reads: [['hasParent']], when: (has) => has === true }, [['parent']])] },
  );
// Every node of the form, with the signals the view gives it, an item's view made once, from the item `items` gives.
const nodesOf = (node, view, items, found = []) => {
  found.push([node, view]);
  for (const key of Object.keys(node.children ?? {})) {
    nodesOf(node.children[key], view.children[key], items, found);
  }
  for (const item of node.items?.get() ?? []) {
    assert.ok(view.items().includes(item));
    items.views.set(item, items.views.get(item) ?? signalsOf(item, { injector: items.injector }));
    nodesOf(item, items.views.get(item), items, found);
  }
  return found;
};
let active = 0;
// A node whose states count the subscriptions they hold, its children and items likewise.
const counted = (node) =>
  new Proxy(node, {
    get: (target, key) => {
      const value = Reflect.get(target, key);
      if (STATES.includes(key) || key === 'readonly' || key === 'items') {
        return {
          get: () => (key === 'items' ? value.get().map(counted) : value.get()),
          subscribe: (listener) => {
            active += 1;
            const stop = value.subscribe(listener);
            return () => {
              active -= 1;
              stop();
            };
          },
        };
      }
      return key === 'children'
        ? Object.fromEntries(Object.keys(value).map((name) => [name, counted(value[name])]))
        : value;
    },
  });
{
  const yaltaan = createForm(statesSpec());
  const injector = child();
  const view = signalsOf(counted(yaltaan), { injector });
  assert.equal(active, 0, 'no state subscribed before it is read');
  assert.equal(view.children.total.readonly(), true);
  assert.equal(active, 1);
  injector.destroy();
  assert.equal(active, 0, 'every subscription ends with the injector');
  assert.equal(view.children.total.readonly(), true, 'a state keeps its last value');
}
{
  // A state read for the first time once its component is destroyed: refused, and nothing left subscribed.
  const Host = class {};
  Component({ selector: 'bridge-host', template: '' })(Host);
  const fixture = TestBed.createComponent(Host);
  const { injector } = fixture.componentRef;
  const view = signalsOf(counted(createForm(statesSpec())), { injector });
  fixture.destroy();
  assert.throws(() => view.children.total.readonly(), /NG0911/);
  assert.throws(() => fromNode(counted(createForm(statesSpec())).children.note.dirty, { injector }), /NG0911/);
  assert.equal(active, 0, 'nothing subscribed for a destroyed component');
}
const write = fc.oneof(
  fc.record({ kind: fc.constant('set'), at: fc.constantFrom('locked', 'hasParent'), value: fc.boolean() }),
  fc.record({ kind: fc.constant('set'), at: fc.constantFrom('note', 'total'), value: fc.constantFrom('', 'x', 'y') }),
  fc.record({ kind: fc.constant('parent'), value: fc.constantFrom('', 'Holding') }),
  fc.record({ kind: fc.constant('contacts'), value: fc.array(fc.constantFrom('', 'a@example.org'), { maxLength: 3 }) }),
  fc.record({ kind: fc.constantFrom('touch', 'reset', 'submit') }),
);
fc.assert(
  fc.property(fc.array(write, { maxLength: 12 }), (writes) => {
    const yaltaan = createForm(statesSpec());
    const injector = child();
    const view = signalsOf(yaltaan, { injector });
    const items = { injector, views: new Map() };
    const compare = () => {
      for (const [node, signals] of nodesOf(yaltaan, view, items)) {
        for (const state of [...STATES, 'readonly']) {
          assert.deepEqual(signals[state](), node[state].get(), `${state} of ${JSON.stringify(node.path)}`);
        }
      }
    };
    compare();
    for (const step of writes) {
      if (step.kind === 'set') {
        yaltaan.children[step.at].set(step.value);
      } else if (step.kind === 'parent') {
        yaltaan.children.parent.children.name.set(step.value);
      } else if (step.kind === 'contacts') {
        yaltaan.children.contacts.set(step.value.map((email) => ({ email })));
      } else {
        yaltaan[step.kind]();
      }
      compare();
    }
    injector.destroy();
  }),
  { numRuns: RUNS },
);
{
  // Dirty on a read-only field whose value changed: shown by the form, and so by the bridge; hidden by Angular.
  const model = signal({ total: '' });
  const angular = form(model, (path) => readonly(path.total, { when: () => true }), { injector: environment });
  const yaltaan = createForm(statesSpec());
  const total = signalsOf(yaltaan.children.total, { injector: environment });
  angular.total().controlValue.set('13');
  yaltaan.children.total.set('13');
  assert.deepEqual([angular.total().dirty(), total.dirty(), total.readonly()], [false, true, true]);
}

// The field an issue lands on, by the values alone: the deepest one on the way of its keys, since Signal Forms holds a
// field for each own key of an object or an array whose value is not `undefined`; written apart from the bridge, which
// walks the fields of the form.
const landing = (values, keys) => {
  const path = [];
  let at = values;
  for (const key of keys) {
    if (typeof at !== 'object' || at === null || !Object.hasOwn(at, key) || at[key] === undefined) {
      break;
    }
    path.push(key);
    at = at[key];
  }
  return path.join('.');
};
// Every field of a tree, by the dotted path of its keys, walking the value it holds.
const labels = (tree, value, path = [], found = new Map()) => {
  found.set(tree, path.join('.'));
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      if (tree[key] !== undefined) {
        labels(tree[key], value[key], [...path, key], found);
      }
    }
  }
  return found;
};

// 3. validateRules beside the form and the validators of form-rules.mjs, on generated writes: each field shows the
// issues the form places on it, by code, and is required where the form says; a rule is checked again exactly when a
// value it declares, read down to its first `anyElement`, changes.
const counts = {};
const counter = (engine, name, run) => {
  counts[engine] ??= {};
  counts[engine][name] = 0;
  return (...values) => {
    counts[engine][name] += 1;
    return run(...values);
  };
};
const rulesOf = (engine) => {
  const wrap = (name, rule) => ({
    ...rule,
    check: counter(engine, name, rule.check),
    ...(rule.required ? { required: counter(engine, `${name}.required`, rule.required) } : {}),
  });
  return [
    wrap('siren', requiredIf({ reads: [['country']], when: (country) => country === 'FR' }, [['siren']])),
    wrap(
      'contract',
      allOrNone([
        ['contract', 'number'],
        ['contract', 'signedOn'],
      ]),
    ),
    wrap('emails', unique(['contacts'], ['email'])),
    // Reads the country, and marks the first contact: a contact added or removed places it again, and checks nothing.
    wrap('placed', {
      reads: [['country']],
      targets: [['contacts', 0, 'email']],
      check: (values) => (values.country === 'DE' ? [{ code: 'app.placed', path: ['contacts', 0, 'email'] }] : []),
    }),
  ];
};
// What each rule reads, down to its first `anyElement`: a write at or under one of these checks it again.
const POINTS = {
  siren: [['country'], ['siren']],
  contract: [
    ['contract', 'number'],
    ['contract', 'signedOn'],
  ],
  emails: [['contacts']],
  placed: [['country']],
};
const initial = () => ({
  country: 'FR',
  siren: '',
  contract: { number: '', signedOn: '' },
  contacts: [
    { name: 'Claire', email: 'claire@example.org' },
    { name: 'Karim', email: 'karim@example.org' },
  ],
});
const isEmpty = (value) => value === '' || value === undefined || value === null;
const threeForms = () => {
  const handModel = signal(initial());
  const hand = form(
    handModel,
    (path) => {
      required(path.siren, { when: counter('hand', 'siren', ({ valueOf }) => valueOf(path.country) === 'FR') });
      validate(
        path.contract.signedOn,
        counter('hand', 'contract', ({ value, valueOf }) =>
          !isEmpty(valueOf(path.contract.number)) && isEmpty(value()) ? { kind: 'rules.all_or_none' } : undefined,
        ),
      );
      applyEach(path.contacts, (contact) =>
        validate(
          contact.email,
          counter('hand', 'emails', ({ value, valueOf }) =>
            valueOf(path.contacts).filter((other) => other.email === value()).length > 1
              ? { kind: 'rules.unique' }
              : undefined,
          ),
        ),
      );
    },
    { injector: environment },
  );
  const bridgeModel = signal(initial());
  const bridge = form(bridgeModel, (path) => validateRules(path, rulesOf('bridge')), { injector: environment });
  const yaltaan = createForm(
    group(
      {
        country: field('FR'),
        siren: field(''),
        contract: group({ number: field(''), signedOn: field('') }),
        contacts: array(group({ name: field(''), email: field('') }), { initial: initial().contacts }),
      },
      // The form resolves an index of an issue in what the rule read, and the rule that marks the first contact reads
      // no contact: it is judged apart, by where its issue lands in Angular's model.
      { rules: rulesOf('yaltaan').slice(0, 3) },
    ),
  );
  return { hand, handModel, bridge, bridgeModel, yaltaan };
};
// The model with `value` at `path`, every object on the way copied, as an application writes it.
const written = (model, [key, ...rest], value) =>
  rest.length === 0
    ? Array.isArray(model)
      ? model.map((item, index) => (index === key ? value : item))
      : { ...model, [key]: value }
    : Array.isArray(model)
      ? model.map((item, index) => (index === key ? written(item, rest, value) : item))
      : { ...model, [key]: written(model[key], rest, value) };
const valueAt = (model, path) => path.reduce((at, key) => at?.[key], model);
const kinds = (state) => state.errors().map((error) => error.kind);
const codes = (node) => node.issues.get().map((issue) => issue.code);
// Every node of the form and the field of Angular at the same path.
const pairs = (node, tree, found = []) => {
  found.push([node, tree]);
  for (const key of Object.keys(node.children ?? {})) {
    pairs(node.children[key], tree[key], found);
  }
  node.items?.get().forEach((item, index) => pairs(item, tree[index], found));
  return found;
};
const ruleWrite = fc.oneof(
  fc.record({ path: fc.constant(['country']), value: fc.constantFrom('FR', 'DE', '') }),
  fc.record({ path: fc.constant(['siren']), value: fc.constantFrom('', '732829320') }),
  fc.record({
    path: fc.constantFrom(['contract', 'number'], ['contract', 'signedOn']),
    value: fc.constantFrom('', 'C-1'),
  }),
  fc.record({
    path: fc.tuple(fc.constant('contacts'), fc.nat(2), fc.constantFrom('name', 'email')),
    value: fc.constantFrom('', 'a@example.org', 'b@example.org'),
  }),
  fc.record({
    path: fc.constant(['contacts']),
    value: fc.array(
      fc.record({ name: fc.constantFrom('', 'Ada'), email: fc.constantFrom('', 'a@example.org', 'b@example.org') }),
      { maxLength: 3 },
    ),
  }),
);
const readAll = ({ hand, bridge, yaltaan }) => {
  for (const [node, tree] of pairs(yaltaan, bridge)) {
    kinds(tree());
    tree().required();
    node.issues.get();
  }
  kinds(hand.siren());
  hand.siren().required();
  kinds(hand.contract.signedOn());
  hand
    .contacts()
    .value()
    .forEach((_, index) => kinds(hand.contacts[index].email()));
};
fc.assert(
  fc.property(fc.array(ruleWrite, { maxLength: 15 }), (writes) => {
    const forms = threeForms();
    const { hand, handModel, bridge, bridgeModel, yaltaan } = forms;
    readAll(forms);
    for (const { path, value } of writes) {
      const before = valueAt(bridgeModel(), path);
      if (path.length === 3 && path[1] >= bridgeModel().contacts.length) {
        continue;
      }
      const bridgeBefore = { ...counts.bridge };
      if (!Object.is(before, value)) {
        bridgeModel.update((model) => written(model, path, value));
        handModel.update((model) => written(model, path, value));
        path
          .reduce((node, key) => (typeof key === 'number' ? node.items.get()[key] : node.children[key]), yaltaan)
          .set(value);
      }
      readAll(forms);
      for (const [node, tree] of pairs(yaltaan, bridge)) {
        const where = JSON.stringify(node.path);
        const shown = kinds(tree()).filter((kind) => kind !== 'app.placed');
        assert.deepEqual(shown.sort(), codes(node).sort(), `errors of ${where}`);
        assert.equal(tree().required(), node.required.get(), `required of ${where}`);
      }
      const named = labels(bridge, bridgeModel());
      assert.deepEqual(
        bridge()
          .errorSummary()
          .filter((error) => error.kind === 'app.placed')
          .map((error) => named.get(error.fieldTree)),
        bridgeModel().country === 'DE' ? [landing(bridgeModel(), ['contacts', 0, 'email'])] : [],
      );
      assert.equal(hand.siren().required(), bridge.siren().required());
      const changed = !Object.is(before, value);
      for (const [name, points] of Object.entries(POINTS)) {
        const reads = changed && points.some((point) => point.every((key, index) => path[index] === key));
        assert.equal(counts.bridge[name] > bridgeBefore[name], reads, `${name} checked again on ${path.join('.')}`);
        if (`${name}.required` in counts.bridge) {
          const again = counts.bridge[`${name}.required`] > bridgeBefore[`${name}.required`];
          assert.equal(again, reads, `${name} required again on ${path.join('.')}`);
        }
      }
    }
  }),
  { numRuns: RUNS },
);
{
  // The writes of form-rules.mjs: a write no rule reads checks again, by hand as through the bridge, the rule that
  // reads the whole list of contacts to compare their emails.
  const forms = threeForms();
  readAll(forms);
  const before = { hand: { ...counts.hand }, bridge: { ...counts.bridge } };
  forms.handModel.update((model) => written(model, ['contacts', 1, 'name'], 'Kim'));
  forms.bridgeModel.update((model) => written(model, ['contacts', 1, 'name'], 'Kim'));
  readAll(forms);
  const again = (engine) =>
    ['siren', 'contract', 'emails'].filter((name) => counts[engine][name] > before[engine][name]);
  assert.deepEqual([again('hand'), again('bridge')], [['emails'], ['emails']]);
}

// 3 b. Values on the way of a read or of an issue that are absent, null or no object, then objects again, on
// generated models: each field holds the errors checkRules gives for the model, where they land, and is required where
// requiredPaths says, whatever came before.
const nullableRules = [
  requiredIf({ reads: [['billing', 'country']], when: (country) => country === 'FR' }, [['siren']]),
  allOrNone([
    ['billing', 'country'],
    ['billing', 'zip'],
  ]),
  {
    reads: [['items', 'length']],
    targets: [['items']],
    check: (values) => (values.items?.length === 1 ? [{ code: 'app.few', path: ['items'] }] : []),
  },
];
const nullable = fc.record({
  billing: fc.oneof(
    fc.constantFrom(null, '', 'x'),
    fc.record({ country: fc.constantFrom('', 'FR', 'DE'), zip: fc.constantFrom('', '75011') }),
  ),
  siren: fc.constantFrom('', '732829320'),
  items: fc.oneof(fc.constant(null), fc.array(fc.constantFrom('a', 'b'), { maxLength: 2 })),
});
// Alone, so that no other rule stands logic under the field one reads or marks: Angular builds a field below a value
// that becomes an object only where logic stands, or once the field is asked for.
const readUnderBilling = [
  requiredIf({ reads: [['billing', 'country']], when: (country) => country === 'FR' }, [['siren']]),
];
const placedUnderBilling = [
  {
    reads: [['siren']],
    targets: [['billing', 'zip']],
    check: (values) => (values.siren === '' ? [{ code: 'app.zip', path: ['billing', 'zip'] }] : []),
  },
];
fc.assert(
  fc.property(fc.array(nullable, { minLength: 1, maxLength: 6 }), (models) => {
    for (const rules of [nullableRules, readUnderBilling, placedUnderBilling]) {
      const model = signal(models[0]);
      const bridge = form(model, (path) => validateRules(path, rules), { injector: environment });
      for (const value of models) {
        model.set(value);
        // The errors first: listing the fields asks Angular for each of them, which would build what the bridge must.
        const errors = bridge().errorSummary();
        const named = labels(bridge, value);
        const shown = errors.map((error) => `${named.get(error.fieldTree)} ${error.kind}`);
        const expected = checkRules(rules, value).map((issue) => `${landing(value, issue.path)} ${issue.code}`);
        assert.deepEqual(shown.sort(), expected.sort(), JSON.stringify(value));
        const required = new Set(requiredPaths(rules, value).map((path) => path.join('.')));
        for (const [field, label] of named) {
          assert.equal(field().required(), required.has(label), `required of ${label} in ${JSON.stringify(value)}`);
        }
      }
    }
  }),
  { numRuns: RUNS },
);

// 3 c. A declared key absent from the model, or beside keys that change: the rule is checked again only once a value it
// reads changes, and once the key appears, the errors are those of checkRules.
{
  const rule = requiredIf({ reads: [['billing', 'country']], when: (country) => country === 'FR' }, [['siren']]);
  for (const start of [
    { billing: { zip: '' }, siren: '', note: '' },
    { billing: { zip: '' }, note: '' },
    { siren: '', note: '' },
  ]) {
    let checks = 0;
    const counting = {
      ...rule,
      check: (values) => {
        checks += 1;
        return rule.check(values);
      },
    };
    const model = signal(start);
    const bridge = form(model, (path) => validateRules(path, [counting]), { injector: environment });
    bridge().errorSummary();
    const before = checks;
    for (let index = 0; index < 5; index += 1) {
      model.update((value) => ({
        ...value,
        note: `note ${index}`,
        ...(value.billing === undefined ? {} : { billing: { ...value.billing, zip: String(index) } }),
      }));
      bridge().errorSummary();
    }
    assert.equal(checks, before, `checked again on writes it does not read, from ${JSON.stringify(start)}`);
    model.update((value) => ({ ...value, billing: { ...value.billing, country: 'FR' } }));
    const errors = bridge().errorSummary();
    const named = labels(bridge, model());
    assert.deepEqual(
      errors.map((error) => `${named.get(error.fieldTree)} ${error.kind}`),
      checkRules([rule], model()).map((issue) => `${landing(model(), issue.path)} ${issue.code}`),
    );
  }
}

// 4. Rules over keyed list elements, the index of each key resolved by the application: the errors and what is
// required follow an element when the list is reordered, as in the form, which keys its items by the same field.
const keyed = { identity: ['key'] };
const productRules = [
  unique(['products'], ['reference'], keyed),
  each(['products'], [requiredIf({ reads: [['taxable']], when: (taxable) => taxable === true }, [['vatRate']])], keyed),
  // An index in a declared path: the list read whole, an array.
  {
    reads: [['products', 0, 'reference']],
    targets: [['products', 0, 'reference']],
    check: (values) =>
      Array.isArray(values.products) && values.products[0]?.reference === ''
        ? [{ code: 'app.first', path: ['products', 0, 'reference'] }]
        : [],
  },
];
const resolveKey = (segment, parent, values) => {
  const list = parent.reduce((at, key) => at?.[key], values);
  return Array.isArray(list) ? list.findIndex((element) => element?.key === segment.key) : undefined;
};
const product = fc.record({
  reference: fc.constantFrom('', 'P-1', 'P-2'),
  taxable: fc.boolean(),
  vatRate: fc.constantFrom('', '20'),
});
fc.assert(
  fc.property(
    fc.uniqueArray(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 4 }),
    fc.array(product, { minLength: 4, maxLength: 4 }),
    fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 4 }),
    (keys, values, order) => {
      const list = keys.map((key, index) => ({ key, ...values[index] }));
      const model = signal({ products: list });
      const bridge = form(model, (path) => validateRules(path, productRules, { resolveKey }), {
        injector: environment,
      });
      const yaltaan = createForm(
        group(
          {
            products: array(
              group({ key: field(''), reference: field(''), taxable: field(false), vatRate: field('') }),
              { ...keyed, initial: list },
            ),
          },
          { rules: productRules },
        ),
      );
      const compare = () => {
        for (const [node, tree] of pairs(yaltaan, bridge)) {
          const where = JSON.stringify(node.path);
          assert.deepEqual(kinds(tree()).sort(), codes(node).sort(), `errors of ${where}`);
          assert.equal(tree().required(), node.required.get(), `required of ${where}`);
        }
      };
      compare();
      const moved = [...new Set([...order.filter((key) => keys.includes(key)), ...keys])].map((key) =>
        list.find((element) => element.key === key),
      );
      model.set({ products: moved });
      yaltaan.children.products.set(moved);
      compare();
    },
  ),
  { numRuns: RUNS },
);
// Rules standing on each item of a list, and on a group below the root: each item, and the group, compares the path of
// its own fields.
fc.assert(
  fc.property(fc.array(product, { maxLength: 4 }), fc.constantFrom('', 'C-1'), (values, number) => {
    const list = values.map((value, index) => ({ key: String(index), ...value }));
    const itemRules = [requiredIf({ reads: [['taxable']], when: (taxable) => taxable === true }, [['vatRate']])];
    const contractRules = [allOrNone([['number'], ['signedOn']])];
    const model = signal({ products: list, contract: { number, signedOn: '' } });
    const bridge = form(
      model,
      (path) => {
        applyEach(path.products, (item) => validateRules(item, itemRules));
        validateRules(path.contract, contractRules);
      },
      { injector: environment },
    );
    const yaltaan = createForm(
      group({
        products: array(
          group(
            { key: field(''), reference: field(''), taxable: field(false), vatRate: field('') },
            { rules: itemRules },
          ),
          { initial: list },
        ),
        contract: group({ number: field(number), signedOn: field('') }, { rules: contractRules }),
      }),
    );
    for (const [node, tree] of pairs(yaltaan, bridge)) {
      const where = JSON.stringify(node.path);
      assert.deepEqual(kinds(tree()).sort(), codes(node).sort(), `errors of ${where}`);
      assert.equal(tree().required(), node.required.get(), `required of ${where}`);
    }
  }),
  { numRuns: RUNS },
);
{
  // Without `resolveKey`, or when it finds no element, an error stops at the list that holds the element, and neither
  // the field nor the list is marked as required; an answer that is no index is refused when Angular reads the errors.
  const model = signal({ products: [{ key: 'a', reference: 'P-1', taxable: true, vatRate: '' }] });
  const listToo = productRules.map((rule) => ({ ...rule, targets: [['products'], ...rule.targets] }));
  for (const options of [{}, { resolveKey: () => -1 }]) {
    const bridge = form(model, (path) => validateRules(path, listToo, options), { injector: environment });
    assert.deepEqual([kinds(bridge.products()), kinds(bridge.products[0].vatRate())], [['rules.required_if'], []]);
    assert.deepEqual([bridge.products().required(), bridge.products[0].vatRate().required()], [false, false]);
  }
  const bad = form(model, (path) => validateRules(path, productRules, { resolveKey: () => 0.5 }), {
    injector: environment,
  });
  assert.throws(() => bad().errorSummary(), TypeError);
}

// 5. A warning is no error of Angular's; the message is the code unless `format` builds it; a field Angular hides
// shows no error, and stays required, as Angular's own `required` does; the limits of a check and of what is marked
// required; a bad argument is refused when the schema is defined.
{
  const warns = {
    reads: [['a']],
    targets: [['a'], ['b']],
    check: () => [
      { code: 'app.soft', path: ['a'], severity: 'warning' },
      { code: 'app.hard', path: ['b'], params: { at: 2 } },
    ],
    required: () => [['b']],
  };
  const model = signal({ a: '', b: '' });
  const plain = form(model, (path) => validateRules(path, [warns]), { injector: environment });
  assert.deepEqual(
    [
      kinds(plain.a()),
      plain
        .b()
        .errors()
        .map((error) => error.message),
    ],
    [[], ['app.hard']],
  );
  const formatted = form(
    model,
    (path) => validateRules(path, [warns], { format: (issue) => `${issue.code} at ${issue.params.at}` }),
    { injector: environment },
  );
  assert.deepEqual(
    formatted
      .b()
      .errors()
      .map((error) => error.message),
    ['app.hard at 2'],
  );
  const hiddenB = form(
    model,
    (path) => {
      hidden(path.b, { when: () => true });
      validateRules(path, [warns]);
    },
    { injector: environment },
  );
  assert.deepEqual([kinds(hiddenB.b()), hiddenB.b().required()], [[], true]);
  // A rule that declares a path and one below it receives the object at the first, never written into: the model is
  // frozen, and a write into it would throw.
  const contract = Object.freeze({ number: 'C-1', signedOn: '' });
  const frozen = signal(Object.freeze({ contract }));
  for (const reads of [
    [['contract', 'number'], ['contract']],
    [['contract'], ['contract', 'number']],
  ]) {
    let received;
    const whole = {
      reads,
      targets: [],
      check: (values) => {
        received = values.contract;
        return [];
      },
    };
    form(frozen, (path) => validateRules(path, [whole]), { injector: environment })().errors();
    assert.equal(received, contract);
  }
  // A rule on a list, reading its whole value; an issue on a field the model lacks, on the deepest one on the way.
  const tags = signal({ tags: ['a', 'a', 'b'] });
  const onTags = form(tags, (path) => validateRules(path.tags, [unique([], [])]), { injector: environment });
  assert.deepEqual(
    [0, 1, 2].map((index) => kinds(onTags.tags[index]())),
    [['rules.unique'], ['rules.unique'], []],
  );
  const missing = {
    reads: [],
    targets: [['contract', 'missing']],
    check: () => [{ code: 'x', path: ['contract', 'missing'] }],
  };
  const lacking = form(signal({ contract: { number: '' } }), (path) => validateRules(path, [missing]), {
    injector: environment,
  });
  assert.deepEqual([kinds(lacking()), kinds(lacking.contract())], [[], ['x']]);
  // A rule of the application past 1,000 errors: the first 1,000, then rules.too_many_issues, as checkRules gives.
  const many = signal({ list: Array.from({ length: 1500 }, () => '') });
  const blanks = {
    reads: [['list']],
    targets: [['list', anyElement]],
    check: (values) => values.list.map((_, index) => ({ code: 'app.blank', path: ['list', index] })),
  };
  const capped = form(many, (path) => validateRules(path, [blanks]), { injector: environment });
  const summary = capped().errorSummary();
  assert.deepEqual(
    [summary.length, summary.filter((error) => error.kind === 'rules.too_many_issues').length],
    [checkRules([blanks], many()).length, 1],
  );
  assert.equal(summary.length, 1001);
  // A name that the prototype of a list or an object holds is no own key of it: read as absent.
  const inherited = {
    reads: [
      ['tags', 'constructor'],
      ['vehicle', 'constructor'],
    ],
    targets: [['tags']],
    check: (values) =>
      values.tags.constructor === undefined && values.vehicle.constructor === undefined
        ? []
        : [{ code: 'app.inherited', path: ['tags'] }],
  };
  const own = form(signal({ tags: ['a'], vehicle: {} }), (path) => validateRules(path, [inherited]), {
    injector: environment,
  });
  assert.deepEqual(kinds(own.tags()), []);
  // A declared key that names the prototype of a plain object is an own key of the values: nothing polluted.
  const proto = {
    reads: [
      ['__proto__', 'polluted'],
      ['a', '__proto__', 'polluted'],
    ],
    targets: [],
    check: () => [],
  };
  form(signal({}), (path) => validateRules(path, [proto]), { injector: environment })().errors();
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
  // A field a rule requires under a target, not at one, is not marked: Angular marks only a field it was told of.
  const under = {
    reads: [['contract']],
    targets: [['contract']],
    check: () => [],
    required: () => [['contract', 'number']],
  };
  const marked = form(signal({ contract: { number: '' } }), (path) => validateRules(path, [under]), {
    injector: environment,
  });
  assert.deepEqual([marked.contract().required(), marked.contract.number().required()], [false, false]);
  const unchecked = { reads: [], targets: [] };
  assert.throws(() => form(model, (path) => validateRules(path, [unchecked]), { injector: environment }), TypeError);
  assert.throws(() => form(model, (path) => validateRules(path, 'rules'), { injector: environment }), TypeError);
}

console.log(
  `angular-bridge: fromNode, signalsOf and validateRules agree with the form and Angular Signal Forms 22.2.4 on ` +
    `${RUNS} generated runs each`,
);
