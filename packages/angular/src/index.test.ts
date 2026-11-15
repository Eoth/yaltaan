// @yaltaan/angular under Node without a DOM, in a test application of Angular that renders nothing: the bridge needs no
// renderer, and the browser's reads the document. Judged by references the bridge does not write: a node of the graph
// for `fromNode`; every state of @yaltaan/form for `signalsOf`, on generated sequences of writes; for `validateRules`,
// the same rules read by @yaltaan/form, which places their issues and computes what they require on its own, beside the
// validators of Angular that an application writes by hand, which say what Angular checks again on a write; and
// `checkRules` with `requiredPaths` on generated models whose values on the way are absent, null or primitives. The
// components, under jsdom: components.test.ts.
//
// Angular's packages are partially compiled: an Angular build links them, and Node, which does not, loads them once the
// JIT compiler is loaded, hence the first import.
import '@angular/compiler';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

import {
  createEnvironmentInjector,
  EnvironmentInjector,
  RendererFactory2,
  runInInjectionContext,
  signal,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import {
  applyEach,
  form,
  hidden,
  readonly,
  required,
  validate,
  type FieldState,
  type FieldTree,
} from '@angular/forms/signals';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import type { Issue } from '@yaltaan/core/issue';
import type { KeySegment, Path } from '@yaltaan/core/path';
import { createGraph, type ReadableNode } from '@yaltaan/core/reactive';
import { array, createForm, field, group } from '@yaltaan/form';
import { allOrNone, anyElement, checkRules, each, requiredIf, requiredPaths, unique, type Rule } from '@yaltaan/rules';
import { CallbackError, declareAdversarial, fc, HostileError, type Callback } from '@yaltaan/testing';

import { fromNode, signalsOf, validateRules } from './index.ts';

const SUBPATH = '@yaltaan/angular';
const RUNS = 200;

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
TestBed.configureTestingModule({ providers: [{ provide: RendererFactory2, useValue: null }] });
const environment = TestBed.inject(EnvironmentInjector);
const child = (): EnvironmentInjector => createEnvironmentInjector([], environment);

// A field of Angular's tree, and a node of the form or the view of one, walked by key: the generated models decide
// their shape, which no static type follows.
interface Tree {
  (): FieldState<unknown>;
  readonly [key: PropertyKey]: Tree;
}
const treeOf = (fieldTree: unknown): Tree => fieldTree as Tree;
type Values = Record<PropertyKey, unknown>;
interface Node {
  readonly path: Path;
  readonly children?: Readonly<Record<string, Node>>;
  readonly items?: ReadableNode<readonly Node[]>;
  set(value: unknown): void;
}
const nodeOf = (node: unknown): Node => node as Node;
const stateOf = (node: Node, name: string): ReadableNode<unknown> =>
  (node as unknown as Readonly<Record<string, ReadableNode<unknown>>>)[name]!;
interface View {
  readonly children: Readonly<Record<string, View>>;
  readonly items: Signal<readonly Node[]>;
  readonly [state: string]: unknown;
}
const viewOf = (view: unknown): View => view as View;
const signalOf = (view: View, name: string): Signal<unknown> => view[name] as Signal<unknown>;

test('the test runs without a DOM', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
});

test('fromNode follows a node through a batch, throws what it throws, and lets it go with its injector', () => {
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
});

// signalsOf: each state of every node of a form, as the form gives it, on generated writes; nothing subscribed before a
// state is read, and nothing after the injector is destroyed; dirty on a read-only node, where Angular hides it.
const STATES: readonly string[] = [
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
const filled = (value: unknown): Issue[] =>
  typeof value === 'string' && value !== '' ? [] : [{ code: 'app.blank', path: [] }];
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
interface Items {
  readonly injector: EnvironmentInjector;
  readonly views: Map<Node, View>;
}
// Every node of the form, with the signals the view gives it, an item's view made once, from the item `items` gives.
const nodesOf = (node: Node, view: View, items: Items, found: [Node, View][] = []): [Node, View][] => {
  found.push([node, view]);
  for (const key of Object.keys(node.children ?? {})) {
    nodesOf(node.children![key]!, view.children[key]!, items, found);
  }
  for (const item of node.items?.get() ?? []) {
    assert.ok(view.items().includes(item));
    const itemView = items.views.get(item) ?? viewOf(signalsOf(item as never, { injector: items.injector }));
    items.views.set(item, itemView);
    nodesOf(item, itemView, items, found);
  }
  return found;
};
let active = 0;
// A node whose states count the subscriptions they hold, its children and items likewise.
const counted = <N extends object>(node: N): N =>
  new Proxy(node, {
    get: (target, key) => {
      const value: unknown = Reflect.get(target, key);
      if (typeof key === 'string' && (STATES.includes(key) || key === 'readonly' || key === 'items')) {
        const state = value as ReadableNode<unknown>;
        return {
          get: () => (key === 'items' ? (state.get() as object[]).map(counted) : state.get()),
          subscribe: (listener: () => void) => {
            active += 1;
            const stop = state.subscribe(listener);
            return () => {
              active -= 1;
              stop();
            };
          },
        };
      }
      return key === 'children'
        ? Object.fromEntries(Object.entries(value as Record<string, object>).map(([name, at]) => [name, counted(at)]))
        : value;
    },
  });

test('signalsOf subscribes to a state on its first read, and every subscription ends with the injector', () => {
  const injector = child();
  const view = signalsOf(counted(createForm(statesSpec())), { injector });
  assert.equal(active, 0, 'no state subscribed before it is read');
  assert.equal(view.children.total.readonly(), true);
  assert.equal(active, 1);
  injector.destroy();
  assert.equal(active, 0, 'every subscription ends with the injector');
  assert.equal(view.children.total.readonly(), true, 'a state keeps its last value');
});

const write = fc.oneof(
  fc.record({ kind: fc.constant('set' as const), at: fc.constantFrom('locked', 'hasParent'), value: fc.boolean() }),
  fc.record({
    kind: fc.constant('set' as const),
    at: fc.constantFrom('note', 'total'),
    value: fc.constantFrom('', 'x', 'y'),
  }),
  fc.record({ kind: fc.constant('parent' as const), value: fc.constantFrom('', 'Holding') }),
  fc.record({
    kind: fc.constant('contacts' as const),
    value: fc.array(fc.constantFrom('', 'a@example.org'), { maxLength: 3 }),
  }),
  fc.record({ kind: fc.constantFrom('touch' as const, 'reset' as const, 'submit' as const) }),
);

test('signalsOf shows every state of every node as the form gives it, on generated writes', () => {
  fc.assert(
    fc.property(fc.array(write, { maxLength: 12 }), (writes) => {
      const yaltaan = createForm(statesSpec());
      const injector = child();
      const view = viewOf(signalsOf(yaltaan, { injector }));
      const items: Items = { injector, views: new Map() };
      const compare = (): void => {
        for (const [node, signals] of nodesOf(nodeOf(yaltaan), view, items)) {
          for (const state of [...STATES, 'readonly']) {
            const where = `${state} of ${JSON.stringify(node.path)}`;
            assert.deepEqual(signalOf(signals, state)(), stateOf(node, state).get(), where);
          }
        }
      };
      compare();
      for (const step of writes) {
        if (step.kind === 'set') {
          nodeOf(yaltaan.children[step.at]).set(step.value);
        } else if (step.kind === 'parent') {
          yaltaan.children.parent.children.name.set(step.value);
        } else if (step.kind === 'contacts') {
          yaltaan.children.contacts.set(step.value.map((email) => ({ email })));
        } else if (step.kind === 'touch') {
          yaltaan.touch();
        } else if (step.kind === 'reset') {
          yaltaan.reset();
        } else {
          yaltaan.submit();
        }
        TestBed.tick();
        compare();
      }
      injector.destroy();
    }),
    { numRuns: RUNS },
  );
});

test('signalsOf shows dirty on a read-only field whose value changed, where Angular hides it', () => {
  const model = signal({ total: '' });
  const angular = form(model, (at) => readonly(at.total, { when: () => true }), { injector: environment });
  const yaltaan = createForm(statesSpec());
  const total = signalsOf(yaltaan.children.total, { injector: environment });
  angular.total().controlValue.set('13');
  yaltaan.children.total.set('13');
  assert.deepEqual([angular.total().dirty(), total.dirty(), total.readonly()], [false, true, true]);
});

// The field an issue lands on, by the values alone: the deepest one on the way of its keys, since Signal Forms holds a
// field for each own key of an object or an array whose value is not `undefined`; written apart from the bridge, which
// walks the fields of the form.
const landing = (values: unknown, keys: readonly PropertyKey[]): string => {
  const found: PropertyKey[] = [];
  let at = values;
  for (const key of keys) {
    if (typeof at !== 'object' || at === null || !Object.hasOwn(at, key) || (at as Values)[key] === undefined) {
      break;
    }
    found.push(key);
    at = (at as Values)[key];
  }
  return found.join('.');
};
// Every field of a tree, by the dotted path of its keys, walking the value it holds.
const labels = (
  tree: Tree,
  value: unknown,
  keys: readonly string[] = [],
  found: Map<unknown, string> = new Map(),
): Map<unknown, string> => {
  found.set(tree, keys.join('.'));
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      if (tree[key] !== undefined) {
        labels(tree[key], (value as Values)[key], [...keys, key], found);
      }
    }
  }
  return found;
};

// validateRules beside the form and the validators an application writes by hand, on generated writes: each field
// shows the issues the form places on it, by code, and is required where the form says; a rule is checked again exactly
// when a value it declares, read down to its first `anyElement`, changes.
type Engine = 'hand' | 'bridge' | 'yaltaan';
const counts: Record<Engine, Record<string, number>> = { hand: {}, bridge: {}, yaltaan: {} };
const counter = <A extends unknown[], R>(engine: Engine, name: string, run: (...values: A) => R) => {
  counts[engine][name] = 0;
  return (...values: A): R => {
    counts[engine][name]! += 1;
    return run(...values);
  };
};
interface Contact {
  readonly name: string;
  readonly email: string;
}
interface Company {
  readonly country: string;
  readonly siren: string;
  readonly contract: { readonly number: string; readonly signedOn: string };
  readonly contacts: readonly Contact[];
}
const rulesOf = (engine: Engine): Rule[] => {
  const wrap = (name: string, rule: Rule): Rule => ({
    ...rule,
    check: counter(engine, name, rule.check),
    ...(rule.required === undefined ? {} : { required: counter(engine, `${name}.required`, rule.required) }),
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
      check: (values) =>
        (values as Values)['country'] === 'DE' ? [{ code: 'app.placed', path: ['contacts', 0, 'email'] }] : [],
    }),
  ];
};
// What each rule reads, down to its first `anyElement`: a write at or under one of these checks it again.
const POINTS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  siren: [['country'], ['siren']],
  contract: [
    ['contract', 'number'],
    ['contract', 'signedOn'],
  ],
  emails: [['contacts']],
  placed: [['country']],
};
const initial = (): Company => ({
  country: 'FR',
  siren: '',
  contract: { number: '', signedOn: '' },
  contacts: [
    { name: 'Claire', email: 'claire@example.org' },
    { name: 'Karim', email: 'karim@example.org' },
  ],
});
const isEmpty = (value: unknown): boolean => value === '' || value === undefined || value === null;
const threeForms = () => {
  const handModel = signal(initial());
  const hand = form(
    handModel,
    (at) => {
      required(at.siren, { when: counter('hand', 'siren', ({ valueOf }) => valueOf(at.country) === 'FR') });
      validate(
        at.contract.signedOn,
        counter('hand', 'contract', ({ value, valueOf }) =>
          !isEmpty(valueOf(at.contract.number)) && isEmpty(value()) ? { kind: 'rules.all_or_none' } : undefined,
        ),
      );
      applyEach(at.contacts, (contact) =>
        validate(
          contact.email,
          counter('hand', 'emails', ({ value, valueOf }) =>
            valueOf(at.contacts).filter((other) => other.email === value()).length > 1
              ? { kind: 'rules.unique' }
              : undefined,
          ),
        ),
      );
    },
    { injector: environment },
  );
  const bridgeModel = signal(initial());
  const bridge = form(bridgeModel, (at) => validateRules(at, rulesOf('bridge')), { injector: environment });
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
// The model with `value` at `keys`, every object on the way copied, as an application writes it.
const written = <T>(model: T, [key, ...rest]: readonly PropertyKey[], value: unknown): T =>
  (rest.length === 0
    ? Array.isArray(model)
      ? model.map((item, index) => (index === key ? value : item))
      : { ...model, [key!]: value }
    : Array.isArray(model)
      ? model.map((item, index) => (index === key ? written(item, rest, value) : item))
      : { ...model, [key!]: written((model as Values)[key!], rest, value) }) as T;
const valueAt = (model: unknown, keys: readonly PropertyKey[]): unknown =>
  keys.reduce<unknown>((at, key) => (at as Values | undefined)?.[key], model);
const kinds = (state: FieldState<unknown>): string[] => state.errors().map((error) => error.kind);
const codes = (node: Node): string[] => (stateOf(node, 'issues').get() as readonly Issue[]).map((issue) => issue.code);
// Every node of the form and the field of Angular at the same path.
const pairs = (node: Node, tree: Tree, found: [Node, Tree][] = []): [Node, Tree][] => {
  found.push([node, tree]);
  for (const key of Object.keys(node.children ?? {})) {
    pairs(node.children![key]!, tree[key]!, found);
  }
  node.items?.get().forEach((item, index) => pairs(item, tree[index]!, found));
  return found;
};
const ruleWrite = fc.oneof(
  fc.record({ keys: fc.constant(['country']), value: fc.constantFrom('FR', 'DE', '') }),
  fc.record({ keys: fc.constant(['siren']), value: fc.constantFrom('', '732829320') }),
  fc.record({
    keys: fc.constantFrom(['contract', 'number'], ['contract', 'signedOn']),
    value: fc.constantFrom('', 'C-1'),
  }),
  fc.record({
    keys: fc.tuple(fc.constant('contacts'), fc.nat(2), fc.constantFrom('name', 'email')),
    value: fc.constantFrom('', 'a@example.org', 'b@example.org'),
  }),
  fc.record({
    keys: fc.constant(['contacts']),
    value: fc.array(
      fc.record({ name: fc.constantFrom('', 'Ada'), email: fc.constantFrom('', 'a@example.org', 'b@example.org') }),
      { maxLength: 3 },
    ),
  }),
);
const readAll = ({ hand, bridge, yaltaan }: ReturnType<typeof threeForms>): void => {
  for (const [node, tree] of pairs(nodeOf(yaltaan), treeOf(bridge))) {
    kinds(tree());
    tree().required();
    stateOf(node, 'issues').get();
  }
  kinds(hand.siren());
  hand.siren().required();
  kinds(hand.contract.signedOn());
  hand
    .contacts()
    .value()
    .forEach((_, index) => kinds(hand.contacts[index]!.email()));
};

test('validateRules places what the form places, and checks a rule again only when a value it reads changes', () => {
  fc.assert(
    fc.property(fc.array(ruleWrite, { maxLength: 15 }), (writes) => {
      const forms = threeForms();
      const { hand, handModel, bridge, bridgeModel, yaltaan } = forms;
      readAll(forms);
      for (const { keys, value } of writes) {
        const before = valueAt(bridgeModel(), keys);
        if (keys.length === 3 && (keys[1] as number) >= bridgeModel().contacts.length) {
          continue;
        }
        const bridgeBefore = { ...counts.bridge };
        if (!Object.is(before, value)) {
          bridgeModel.update((model) => written(model, keys, value));
          handModel.update((model) => written(model, keys, value));
          keys
            .reduce<Node>(
              (node, key) => (typeof key === 'number' ? node.items!.get()[key]! : node.children![key]!),
              nodeOf(yaltaan),
            )
            .set(value);
        }
        TestBed.tick();
        readAll(forms);
        for (const [node, tree] of pairs(nodeOf(yaltaan), treeOf(bridge))) {
          const where = JSON.stringify(node.path);
          const shown = kinds(tree()).filter((kind) => kind !== 'app.placed');
          assert.deepEqual(shown.sort(), codes(node).sort(), `errors of ${where}`);
          assert.equal(tree().required(), stateOf(node, 'required').get(), `required of ${where}`);
        }
        const named = labels(treeOf(bridge), bridgeModel());
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
          const reads = changed && points.some((point) => point.every((key, index) => keys[index] === key));
          assert.equal(counts.bridge[name]! > bridgeBefore[name]!, reads, `${name} checked again on ${keys.join('.')}`);
          if (`${name}.required` in counts.bridge) {
            const again = counts.bridge[`${name}.required`]! > bridgeBefore[`${name}.required`]!;
            assert.equal(again, reads, `${name} required again on ${keys.join('.')}`);
          }
        }
      }
    }),
    { numRuns: RUNS },
  );
});

test('a write no rule reads checks again, by hand as through the bridge, the rule that reads the whole list', () => {
  const forms = threeForms();
  readAll(forms);
  const before = { hand: { ...counts.hand }, bridge: { ...counts.bridge } };
  forms.handModel.update((model) => written(model, ['contacts', 1, 'name'], 'Kim'));
  forms.bridgeModel.update((model) => written(model, ['contacts', 1, 'name'], 'Kim'));
  readAll(forms);
  const again = (engine: 'hand' | 'bridge'): string[] =>
    ['siren', 'contract', 'emails'].filter((name) => counts[engine][name]! > before[engine][name]!);
  assert.deepEqual([again('hand'), again('bridge')], [['emails'], ['emails']]);
});

// Values on the way of a read or of an issue that are absent, null or no object, then objects again, on generated
// models: each field holds the errors checkRules gives for the model, where they land, and is required where
// requiredPaths says, whatever came before.
const nullableRules: readonly Rule[] = [
  requiredIf({ reads: [['billing', 'country']], when: (country) => country === 'FR' }, [['siren']]),
  allOrNone([
    ['billing', 'country'],
    ['billing', 'zip'],
  ]),
  {
    reads: [['items', 'length']],
    targets: [['items']],
    check: (values) =>
      ((values as Values)['items'] as { length?: unknown } | undefined)?.length === 1
        ? [{ code: 'app.few', path: ['items'] }]
        : [],
  },
];
const nullable = fc.record({
  billing: fc.oneof(
    fc.constantFrom<unknown>(null, '', 'x'),
    fc.record({ country: fc.constantFrom('', 'FR', 'DE'), zip: fc.constantFrom('', '75011') }),
  ),
  siren: fc.constantFrom('', '732829320'),
  items: fc.oneof(fc.constant(null), fc.array(fc.constantFrom('a', 'b'), { maxLength: 2 })),
});
// Alone, so that no other rule stands logic under the field one reads or marks: Angular builds a field below a value
// that becomes an object only where logic stands, or once the field is asked for.
const readUnderBilling: readonly Rule[] = [
  requiredIf({ reads: [['billing', 'country']], when: (country) => country === 'FR' }, [['siren']]),
];
const placedUnderBilling: readonly Rule[] = [
  {
    reads: [['siren']],
    targets: [['billing', 'zip']],
    check: (values) => ((values as Values)['siren'] === '' ? [{ code: 'app.zip', path: ['billing', 'zip'] }] : []),
  },
];
const errorsWhereTheyLand = (rules: readonly Rule[], bridge: Tree, value: unknown): void => {
  // The errors first: listing the fields asks Angular for each of them, which would build what the bridge must.
  const errors = bridge().errorSummary();
  const named = labels(bridge, value);
  const shown = errors.map((error) => `${named.get(error.fieldTree)} ${error.kind}`);
  const expected = checkRules(rules, value).map(
    (issue) => `${landing(value, issue.path as PropertyKey[])} ${issue.code}`,
  );
  assert.deepEqual(shown.sort(), expected.sort(), JSON.stringify(value));
  const marked = new Set(requiredPaths(rules, value).map((at) => at.join('.')));
  for (const [fieldTree, label] of named) {
    const where = `required of ${label} in ${JSON.stringify(value)}`;
    assert.equal(treeOf(fieldTree)().required(), marked.has(label), where);
  }
};

test('validateRules reads through values absent, null or no object, then objects again', () => {
  fc.assert(
    fc.property(fc.array(nullable, { minLength: 1, maxLength: 6 }), (models) => {
      for (const rules of [nullableRules, readUnderBilling, placedUnderBilling]) {
        const model: WritableSignal<unknown> = signal(models[0]);
        const bridge = form(model, (at) => validateRules(at, rules), { injector: environment });
        for (const value of models) {
          model.set(value);
          TestBed.tick();
          errorsWhereTheyLand(rules, treeOf(bridge), value);
        }
      }
    }),
    { numRuns: RUNS },
  );
});

test('a declared key absent from the model is checked again only once a value it reads changes', () => {
  const rule = requiredIf({ reads: [['billing', 'country']], when: (country) => country === 'FR' }, [['siren']]);
  for (const start of [
    { billing: { zip: '' }, siren: '', note: '' },
    { billing: { zip: '' }, note: '' },
    { siren: '', note: '' },
  ]) {
    let checks = 0;
    const counting: Rule = {
      ...rule,
      check: (values) => {
        checks += 1;
        return rule.check(values);
      },
    };
    const model = signal<Values>(start);
    const bridge = form(model, (at) => validateRules(at, [counting]), { injector: environment });
    bridge().errorSummary();
    const before = checks;
    for (let index = 0; index < 5; index += 1) {
      model.update((value) => ({
        ...value,
        note: `note ${index}`,
        ...(value['billing'] === undefined ? {} : { billing: { ...(value['billing'] as Values), zip: String(index) } }),
      }));
      TestBed.tick();
      bridge().errorSummary();
    }
    assert.equal(checks, before, `checked again on writes it does not read, from ${JSON.stringify(start)}`);
    model.update((value) => ({ ...value, billing: { ...(value['billing'] as Values), country: 'FR' } }));
    const errors = bridge().errorSummary();
    const named = labels(treeOf(bridge), model());
    assert.deepEqual(
      errors.map((error) => `${named.get(error.fieldTree)} ${error.kind}`),
      checkRules([rule], model()).map((issue) => `${landing(model(), issue.path as PropertyKey[])} ${issue.code}`),
    );
  }
});

// Rules over keyed list elements, the index of each key resolved by the application: the errors and what is required
// follow an element when the list is reordered, as in the form, which keys its items by the same field.
const keyed = { identity: ['key'] };
const productRules: readonly Rule[] = [
  unique(['products'], ['reference'], keyed),
  each(['products'], [requiredIf({ reads: [['taxable']], when: (taxable) => taxable === true }, [['vatRate']])], keyed),
  // An index in a declared path: the list read whole, an array.
  {
    reads: [['products', 0, 'reference']],
    targets: [['products', 0, 'reference']],
    check: (values) => {
      const products = (values as Values)['products'];
      return Array.isArray(products) && (products[0] as Values | undefined)?.['reference'] === ''
        ? [{ code: 'app.first', path: ['products', 0, 'reference'] }]
        : [];
    },
  },
];
const resolveKey = (segment: KeySegment, parent: Path, values: unknown): number | undefined => {
  const list = valueAt(values, parent as PropertyKey[]);
  return Array.isArray(list) ? list.findIndex((element) => (element as Values)?.['key'] === segment.key) : undefined;
};
const product = fc.record({
  reference: fc.constantFrom('', 'P-1', 'P-2'),
  taxable: fc.boolean(),
  vatRate: fc.constantFrom('', '20'),
});
const productNode = () => group({ key: field(''), reference: field(''), taxable: field(false), vatRate: field('') });
const sameAsTheForm = (yaltaan: unknown, bridge: unknown): void => {
  for (const [node, tree] of pairs(nodeOf(yaltaan), treeOf(bridge))) {
    const where = JSON.stringify(node.path);
    assert.deepEqual(kinds(tree()).sort(), codes(node).sort(), `errors of ${where}`);
    assert.equal(tree().required(), stateOf(node, 'required').get(), `required of ${where}`);
  }
};

test('validateRules follows keyed elements that move, through resolveKey', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 4 }),
      fc.array(product, { minLength: 4, maxLength: 4 }),
      fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 4 }),
      (keys, values, order) => {
        const list = keys.map((key, index) => ({ key, ...values[index]! }));
        const model = signal({ products: list });
        const bridge = form(model, (at) => validateRules(at, productRules, { resolveKey }), {
          injector: environment,
        });
        const yaltaan = createForm(
          group({ products: array(productNode(), { ...keyed, initial: list }) }, { rules: productRules }),
        );
        sameAsTheForm(yaltaan, bridge);
        const moved = [...new Set([...order.filter((key) => keys.includes(key)), ...keys])].map((key) =>
          list.find((element) => element.key === key)!,
        );
        model.set({ products: moved });
        yaltaan.children.products.set(moved);
        TestBed.tick();
        sameAsTheForm(yaltaan, bridge);
      },
    ),
    { numRuns: RUNS },
  );
});

test('rules on each item of a list, and on a group below the root, compare the paths of their own fields', () => {
  fc.assert(
    fc.property(fc.array(product, { maxLength: 4 }), fc.constantFrom('', 'C-1'), (values, number) => {
      const list = values.map((value, index) => ({ key: String(index), ...value }));
      const itemRules = [requiredIf({ reads: [['taxable']], when: (taxable) => taxable === true }, [['vatRate']])];
      const contractRules = [allOrNone([['number'], ['signedOn']])];
      const model = signal({ products: list, contract: { number, signedOn: '' } });
      const bridge = form(
        model,
        (at) => {
          applyEach(at.products, (item) => validateRules(item, itemRules));
          validateRules(at.contract, contractRules);
        },
        { injector: environment },
      );
      const yaltaan = createForm(
        group({
          products: array(group(productNode().children, { rules: itemRules }), { initial: list }),
          contract: group({ number: field(number), signedOn: field('') }, { rules: contractRules }),
        }),
      );
      sameAsTheForm(yaltaan, bridge);
    }),
    { numRuns: RUNS },
  );
});

test('without resolveKey, or when it finds nothing, an error stops at the list; an answer no index is refused', () => {
  const model = signal({ products: [{ key: 'a', reference: 'P-1', taxable: true, vatRate: '' }] });
  const listToo = productRules.map((rule) => ({ ...rule, targets: [['products'], ...rule.targets] }));
  for (const options of [{}, { resolveKey: () => -1 }]) {
    const bridge = form(model, (at) => validateRules(at, listToo, options), { injector: environment });
    assert.deepEqual([kinds(bridge.products()), kinds(bridge.products[0]!.vatRate())], [['rules.required_if'], []]);
    assert.deepEqual([bridge.products().required(), bridge.products[0]!.vatRate().required()], [false, false]);
  }
  // An index is a safe integer from 0: a fraction, a negative other than -1, an unsafe integer, a text are refused.
  for (const answer of [0.5, -2, 2 ** 53, '0']) {
    const resolveBadly = () => answer as number;
    const bad = form(model, (at) => validateRules(at, productRules, { resolveKey: resolveBadly }), {
      injector: environment,
    });
    assert.throws(() => bad().errorSummary(), TypeError, String(answer));
  }
});

test('a warning is no error, format builds the message, a hidden field shows no error and stays required', () => {
  const warns: Rule = {
    reads: [['a']],
    targets: [['a'], ['b']],
    check: () => [
      { code: 'app.soft', path: ['a'], severity: 'warning' },
      { code: 'app.hard', path: ['b'], params: { at: 2 } },
    ],
    required: () => [['b']],
  };
  const model = signal({ a: '', b: '' });
  const plain = form(model, (at) => validateRules(at, [warns]), { injector: environment });
  const messages = (fieldTree: FieldTree<string>): string[] =>
    fieldTree()
      .errors()
      .map((error) => error.message ?? '');
  assert.deepEqual([kinds(plain.a()), messages(plain.b)], [[], ['app.hard']]);
  const formatted = form(
    model,
    (at) => validateRules(at, [warns], { format: (issue) => `${issue.code} at ${String(issue.params?.['at'])}` }),
    { injector: environment },
  );
  assert.deepEqual(messages(formatted.b), ['app.hard at 2']);
  const hiddenB = form(
    model,
    (at) => {
      hidden(at.b, { when: () => true });
      validateRules(at, [warns]);
    },
    { injector: environment },
  );
  assert.deepEqual([kinds(hiddenB.b()), hiddenB.b().required()], [[], true]);
});

test('a rule that declares a path and one below it receives the object at the first, never written into', () => {
  const contract = Object.freeze({ number: 'C-1', signedOn: '' });
  const frozen = signal(Object.freeze({ contract }));
  for (const reads of [
    [['contract', 'number'], ['contract']],
    [['contract'], ['contract', 'number']],
  ]) {
    let received: unknown;
    const whole: Rule = {
      reads,
      targets: [],
      check: (values) => {
        received = (values as Values)['contract'];
        return [];
      },
    };
    form(frozen, (at) => validateRules(at, [whole]), { injector: environment })().errors();
    assert.equal(received, contract);
  }
});

test('a rule on a list reads its whole value; an issue on a field the model lacks lands on the deepest one', () => {
  const tags = signal({ tags: ['a', 'a', 'b'] });
  const onTags = form(tags, (at) => validateRules(at.tags, [unique([], [])]), { injector: environment });
  assert.deepEqual(
    [0, 1, 2].map((index) => kinds(onTags.tags[index]!())),
    [['rules.unique'], ['rules.unique'], []],
  );
  const missing: Rule = {
    reads: [],
    targets: [['contract', 'missing']],
    check: () => [{ code: 'x', path: ['contract', 'missing'] }],
  };
  const lacking = form(signal({ contract: { number: '' } }), (at) => validateRules(at, [missing]), {
    injector: environment,
  });
  assert.deepEqual([kinds(lacking()), kinds(lacking.contract())], [[], ['x']]);
});

test('past 1,000 errors of one rule: the first 1,000, then rules.too_many_issues, as checkRules gives', () => {
  const many = signal({ list: Array.from({ length: 1500 }, () => '') });
  const blanks: Rule = {
    reads: [['list']],
    targets: [['list', anyElement]],
    check: (values) =>
      ((values as Values)['list'] as unknown[]).map((_, index) => ({ code: 'app.blank', path: ['list', index] })),
  };
  const capped = form(many, (at) => validateRules(at, [blanks]), { injector: environment });
  const summary = capped().errorSummary();
  assert.deepEqual(
    [summary.length, summary.filter((error) => error.kind === 'rules.too_many_issues').length],
    [checkRules([blanks], many()).length, 1],
  );
  assert.equal(summary.length, 1001);
});

test('an inherited name is no own key, and a key naming the prototype pollutes nothing', () => {
  const inherited: Rule = {
    reads: [
      ['tags', 'constructor'],
      ['vehicle', 'constructor'],
    ],
    targets: [['tags']],
    check: (values) => {
      const { tags, vehicle } = values as Record<string, Values>;
      return tags!['constructor'] === undefined && vehicle!['constructor'] === undefined
        ? []
        : [{ code: 'app.inherited', path: ['tags'] }];
    },
  };
  const own = form(signal({ tags: ['a'], vehicle: {} }), (at) => validateRules(at, [inherited]), {
    injector: environment,
  });
  assert.deepEqual(kinds(own.tags()), []);
  const proto: Rule = {
    reads: [
      ['__proto__', 'polluted'],
      ['a', '__proto__', 'polluted'],
    ],
    targets: [],
    check: () => [],
  };
  form(signal({}), (at) => validateRules(at, [proto]), { injector: environment })().errors();
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});

test('a field a rule requires under a target, not at one, is not marked; a bad argument is refused at once', () => {
  const under: Rule = {
    reads: [['contract']],
    targets: [['contract']],
    check: () => [],
    required: () => [['contract', 'number']],
  };
  const marked = form(signal({ contract: { number: '' } }), (at) => validateRules(at, [under]), {
    injector: environment,
  });
  assert.deepEqual([marked.contract().required(), marked.contract.number().required()], [false, false]);
  const model = signal({ a: '' });
  const unchecked = { reads: [], targets: [] } as unknown as Rule;
  assert.throws(() => form(model, (at) => validateRules(at, [unchecked]), { injector: environment }), TypeError);
  const mixed = [allOrNone([['a'], ['b']]), unchecked];
  assert.throws(() => form(model, (at) => validateRules(at, mixed), { injector: environment }), TypeError);
  assert.throws(
    () => form(model, (at) => validateRules(at, 'rules' as unknown as Rule[]), { injector: environment }),
    TypeError,
  );
  assert.throws(() => validateRules(undefined as never, []), Error);
});

test('the bridge compiles under TypeScript 6.0 against the declarations of Angular, as under TypeScript 7', () => {
  const require = createRequire(import.meta.url);
  const wrapper = path.dirname(require.resolve('@typescript/typescript6/package.json'));
  const config = path.join(import.meta.dirname, '..', 'tsconfig.build.json');
  const run = spawnSync(process.execPath, [path.join(wrapper, 'bin', 'tsc6'), '-p', config, '--noEmit'], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});

/** Only the hostile value's own error comes out, or a `TypeError` of the bridge or of Angular. */
function ownErrorOnly(run: () => void): void {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof HostileError || error instanceof TypeError, String(error));
  }
}

declareAdversarial(SUBPATH, 'fromNode', {
  boundary: (value) => {
    const graph = createGraph();
    const injector = child();
    assert.ok(Object.is(fromNode(graph.source(value), { injector })(), value));
    injector.destroy();
  },
  structures: (value) => {
    const graph = createGraph();
    const injector = child();
    assert.equal(fromNode(graph.source(value), { injector })(), value);
    injector.destroy();
  },
  hostile: (value) =>
    ownErrorOnly(() => {
      const injector = child();
      try {
        fromNode(value as never, { injector })();
      } finally {
        injector.destroy();
      }
    }),
  unicode: (text) => {
    const graph = createGraph();
    const injector = child();
    assert.equal(
      fromNode(
        graph.derived([graph.source(text)], (value) => value),
        { injector },
      )(),
      text,
    );
    injector.destroy();
  },
  callbacks: (callback: Callback) => {
    const graph = createGraph();
    const source = graph.source(1);
    const injector = child();
    const followed = fromNode(
      graph.derived([source], (value) => callback(value)),
      { injector },
    );
    for (const run of [() => followed(), () => source.set(2), () => followed()]) {
      try {
        run();
      } catch (error) {
        assert.ok(error instanceof CallbackError || error === 'callback failure', String(error));
      }
    }
    injector.destroy();
  },
  async: { na: 'fromNode is synchronous and takes no signal: the end of a subscription is the injector destroyed' },
});

declareAdversarial(SUBPATH, 'signalsOf', {
  boundary: (value) => {
    const injector = child();
    const view = signalsOf(createForm(field(value)), { injector });
    assert.ok(Object.is(view.raw(), value));
    injector.destroy();
  },
  structures: (value) => {
    const injector = child();
    const view = signalsOf(createForm(field(value)), { injector });
    assert.equal(view.raw(), value);
    assert.equal(view.dirty(), false);
    injector.destroy();
  },
  hostile: (value) =>
    ownErrorOnly(() => {
      const injector = child();
      try {
        const view = viewOf(signalsOf(value as never, { injector }));
        for (const state of [...STATES, 'readonly']) {
          (view[state] as (() => unknown) | undefined)?.();
        }
      } finally {
        injector.destroy();
      }
    }),
  unicode: (text) => {
    const key = ['__proto__', 'constructor', 'prototype'].includes(text) ? 'x' : text || 'x';
    const injector = child();
    const view = viewOf(signalsOf(createForm(group({ [key]: field(text) })), { injector }));
    assert.equal(signalOf(view.children[key]!, 'raw')(), text);
    injector.destroy();
  },
  callbacks: (callback: Callback) => {
    const injector = child();
    const yaltaan = createForm(
      group({
        a: field(1, { validate: (raw) => callback(raw) as never }),
        b: field(2, { disabled: { reads: [['a']], when: (a) => callback(a) === true } }),
      }),
    );
    const view = signalsOf(yaltaan, { injector });
    const reads = [() => view.children.a.issues(), () => view.children.b.disabled(), () => view.dirty()];
    for (const run of [...reads, () => yaltaan.children.a.set(3), ...reads]) {
      try {
        run();
      } catch (error) {
        assert.ok(error instanceof CallbackError || error === 'callback failure', String(error));
      }
    }
    injector.destroy();
  },
  async: { na: 'signalsOf is synchronous: what a validator answers late, pending, is judged by the generated writes' },
});

// Each case in an injector of its own, destroyed once it ends: a form left on the root would run its effects after the
// test, on a model the next case no longer holds.
function within(run: (injector: EnvironmentInjector) => void): void {
  const injector = child();
  try {
    run(injector);
  } finally {
    injector.destroy();
  }
}

declareAdversarial(SUBPATH, 'validateRules', {
  boundary: (value) =>
    within((injector) => {
      const model: WritableSignal<unknown> = signal({ a: value, b: value });
      const bridge = form(model, (at) => validateRules(at, [allOrNone([['a'], ['b']])]), { injector });
      const expected = checkRules([allOrNone([['a'], ['b']])], model()).length;
      assert.equal(bridge().errorSummary().length, expected);
    }),
  structures: (value) =>
    within((injector) =>
      ownErrorOnly(() => {
        const model: WritableSignal<unknown> = signal({ a: value, list: value });
        const rules = [allOrNone([['a'], ['b']]), unique(['list'], [])];
        form(model, (at) => validateRules(at, rules), { injector })().errorSummary();
      }),
    ),
  hostile: (value) =>
    within((injector) =>
      ownErrorOnly(() => {
        const model: WritableSignal<unknown> = signal({ a: value });
        form(model, (at) => validateRules(at, [allOrNone([['a'], ['b']])]), { injector })().errorSummary();
        form(model, (at) => validateRules(at, value as never), { injector })().errorSummary();
      }),
    ),
  unicode: (text) =>
    within((injector) => {
      const key = ['__proto__', 'constructor', 'prototype'].includes(text) ? 'x' : text || 'x';
      const model = signal<Values>({ [key]: '', other: 'filled' });
      const rule = allOrNone([[key], ['other']]);
      const bridge = form(model, (at) => validateRules(at, [rule]), { injector });
      const kindsShown = bridge()
        .errorSummary()
        .map((error) => error.kind);
      assert.deepEqual(kindsShown, ['rules.all_or_none']);
    }),
  callbacks: (callback: Callback) =>
    within((injector) => {
      const rule = requiredIf({ reads: [['a']], when: (a) => callback(a) === true }, [['b']]);
      const options = {
        format: (issue: Issue) => String(callback(issue)),
        resolveKey: () => callback() as number,
      };
      const model = signal({ a: 'x', b: '' });
      const bridge = form(model, (at) => validateRules(at, [rule], options), { injector });
      const steps = [() => bridge().errorSummary(), () => bridge.b().required(), () => model.set({ a: 'y', b: '' })];
      for (const run of steps) {
        try {
          run();
        } catch (error) {
          const expected = error instanceof CallbackError || error === 'callback failure' || error instanceof TypeError;
          assert.ok(expected, String(error));
        }
      }
    }),
  async: { na: 'validateRules is synchronous: the rules of @yaltaan/rules check without waiting, and take no signal' },
});
