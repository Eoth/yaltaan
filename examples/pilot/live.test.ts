// The scenarios of the pilot, run against the form built with @yaltaan/form (live.ts): the issues the form shows, by
// code and by path, items named by the key their value holds, the values the derivations give from what it holds, and
// what reaches the server, judged as form.test.ts judges the form of the schema and the rules alone. Beside them, what
// only a live form shows: a write checks again only the rules whose values it changes, counted on the pilot's own
// rules, and `required` says what the rules require, both judged on what the form submits, written here from what its
// nodes show: a hidden or disabled node is left out, and so is an optional sub-form none of whose fields holds a
// value. A scenario that would wait for a decision on the form is named below, and must fail until then: once it
// passes, it leaves the list.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Path } from '@yaltaan/core/path';
import { createForm, type Spec } from '@yaltaan/form';
import { requiredPaths, type Rule } from '@yaltaan/rules';

import { pilotRules } from './form.ts';
import { holding, liveSpec, submitLive, type LiveForm, type LiveNode } from './live.ts';
import { rules as catalogue } from './model.ts';
import { frenchSupplier, scenarios, type Scenario } from './scenarios.ts';

/** The scenarios that wait for a decision on the form, with the reason: none since sub-forms may be optional. */
const AWAITING_SUB_FORMS: Readonly<Record<string, string>> = {};

const keyOf = (code: string, path: readonly unknown[]): string => `${code} ${JSON.stringify(path)}`;

const absent = Symbol('absent');
function valueAt(values: unknown, path: readonly unknown[]): unknown {
  let current = values;
  for (const segment of path) {
    if (typeof segment === 'object' && segment !== null) {
      const { key } = segment as { key: unknown };
      current = Array.isArray(current) ? current.find((element: { key?: unknown }) => element?.key === key) : undefined;
      if (current === undefined) {
        return absent;
      }
    } else if (typeof current === 'object' && current !== null && Object.hasOwn(current, segment as string)) {
      current = (current as Record<string, unknown>)[segment as string];
    } else {
      return absent;
    }
  }
  return current;
}

/** What the form gets wrong against a scenario: nothing when the scenario passes. */
function mismatches(scenario: Scenario): string[] {
  const asked: unknown[] = [];
  let submission: ReturnType<typeof submitLive>;
  try {
    submission = submitLive(
      scenario.values as Readonly<Record<string, unknown>>,
      (values) => {
        asked.push(values);
        return scenario.server;
      },
      scenario.today,
    );
  } catch (error) {
    return [(error as Error).message];
  }
  const wrong: string[] = [];
  const expected = scenario.issues.map((issue) => keyOf(catalogue[issue.rule]!.code, issue.path)).sort();
  const actual = submission.issues.map((issue) => keyOf(issue.code, issue.path)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    wrong.push(`issues ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
  for (const { derivation, path, value } of scenario.derived) {
    const held = valueAt(submission.values, path);
    const same =
      value === undefined ? held === absent : held !== absent && JSON.stringify(held) === JSON.stringify(value);
    if (!same) {
      wrong.push(`${derivation}: ${held === absent ? 'absent' : JSON.stringify(held)}`);
    }
  }
  if (scenario.issues.length === 0 && submission.sent === undefined) {
    wrong.push('nothing sent');
  }
  if (asked.length > 1) {
    wrong.push('the server asked twice');
  }
  return wrong;
}

for (const scenario of scenarios) {
  const waiting = AWAITING_SUB_FORMS[scenario.name];
  test(`scenario through the form: ${scenario.name}`, () => {
    const wrong = mismatches(scenario);
    if (waiting) {
      assert.notDeepEqual(wrong, [], `passes now: take it out of the scenarios awaiting a decision (${waiting})`);
    } else {
      assert.deepEqual(wrong, []);
    }
    assert.equal(({} as { polluted?: unknown }).polluted, undefined, 'a prototype was changed');
  });
}

test('the scenarios awaiting a decision on sub-forms are scenarios of the pilot', () => {
  const names = new Set(scenarios.map((scenario) => scenario.name));
  assert.deepEqual(
    Object.keys(AWAITING_SUB_FORMS).filter((name) => !names.has(name)),
    [],
  );
});

/** The pilot form whose rules count their checks, by the index of each rule in `pilotRules`. */
function countedForm(today: string): { readonly form: LiveForm; readonly checks: number[]; readonly rules: Rule[] } {
  const checks: number[] = [];
  const rules = pilotRules(today).map((rule, index): Rule => {
    checks[index] = 0;
    return {
      ...rule,
      check: (values) => {
        checks[index]!++;
        return rule.check(values);
      },
    };
  });
  const spec = liveSpec(today) as unknown as { options: { rules: readonly Rule[] } };
  const form = createForm({ ...spec, options: { ...spec.options, rules } } as never) as unknown as LiveForm;
  form.set(holding(liveSpec(today), frenchSupplier));
  return { form, checks, rules };
}

/** The node `path` names, through children and items by the key their value holds. */
function nodeAt(form: LiveNode, ...path: readonly (string | { readonly key: string })[]): LiveNode {
  let node = form;
  for (const segment of path) {
    node =
      typeof segment === 'string'
        ? node.children![segment]!
        : node.items!.get().find((item) => (item.raw.get() as { key: unknown }).key === segment.key)!;
  }
  return node;
}

const OUT = Symbol('left out');

const holdsNothing = (value: unknown): boolean =>
  value === OUT ||
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(holdsNothing));

/**
 * What the form submits, from what its nodes show: `OUT` for a node hidden or disabled, or for an optional group none
 * of whose fields holds a value nor arrays an item; a group holds its children, `OUT` among them, an array the items
 * that are not.
 */
function submittedOf(spec: Spec, node: LiveNode): unknown {
  if (node.hidden.get() || node.disabled.get()) {
    return OUT;
  }
  if (spec.kind === 'field') {
    return node.raw.get();
  }
  if (spec.kind === 'array') {
    return node
      .items!.get()
      .map((item) => submittedOf(spec.element, item))
      .filter((value) => value !== OUT);
  }
  const value = Object.fromEntries(
    Object.entries(spec.children).map(([key, child]) => [key, submittedOf(child, node.children![key]!)]),
  );
  return (spec.options as { optional?: boolean }).optional && holdsNothing(value) ? OUT : value;
}

/** What the server reads of a value `submittedOf` gives: a node left out is `undefined`. */
const plain = (value: unknown): unknown =>
  value === OUT
    ? undefined
    : Array.isArray(value)
      ? value.map(plain)
      : typeof value === 'object' && value !== null
        ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]))
        : value;

/** What a rule reads of `values`, at each path it declares, every item for an index or `anyElement`: `OUT` kept. */
function readOf(rule: Rule, values: unknown): string {
  const at = (value: unknown, path: readonly unknown[]): unknown[] => {
    if (!path.length || value === OUT) {
      return [value];
    }
    const [segment, ...rest] = path;
    if (typeof segment === 'string') {
      return at(
        typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[segment] : undefined,
        rest,
      );
    }
    return Array.isArray(value) ? value.flatMap((item) => at(item, rest)) : [];
  };
  return JSON.stringify(
    rule.reads.map((path) => at(values, path)),
    (_, value: unknown) => (value === OUT ? '<out>' : value === undefined ? '<undefined>' : value),
  );
}

const WRITES: readonly { readonly path: readonly (string | { readonly key: string })[]; readonly value: unknown }[] = [
  { path: ['company', 'legalName'], value: 'Atelier Martin' },
  { path: ['company', 'siren'], value: '123456789' },
  { path: ['company', 'country'], value: 'BE' },
  { path: ['company', 'headOffice', 'postalCode'], value: '7501' },
  // The parent company is hidden: a write into it changes nothing a rule reads, until its box is checked.
  { path: ['company', 'parent', 'address', 'city'], value: 'Lille' },
  { path: ['company', 'hasParentCompany'], value: true },
  { path: ['company', 'parent', 'address', 'city'], value: 'Roubaix' },
  // The billing address, shown once its box is unchecked, stays absent until something is entered in it.
  { path: ['company', 'billingSameAsHeadOffice'], value: false },
  { path: ['company', 'billingAddress', 'street'], value: '3 quai Est' },
  { path: ['contacts', { key: 'c2' }, 'firstName'], value: 'Karima' },
  { path: ['contacts', { key: 'c2' }, 'email'], value: 'claire.durand@atelier-durand.example' },
  { path: ['bank', 'iban'], value: 'BR1800360305000010009795493C1' },
  { path: ['terms', 'paymentTerm'], value: 'DEPOSIT' },
  { path: ['catalogue', 'currency'], value: 'USD' },
  { path: ['catalogue', 'products', { key: 'p1' }, 'label'], value: 'Chair' },
  { path: ['catalogue', 'products', { key: 'p1' }, 'volumeDiscounts', { key: 't2' }, 'discountPercent'], value: 4 },
  { path: ['documents', { key: 'd2' }, 'fileName'], value: 'assurance.pdf' },
  { path: ['declarations', 'accuracy'], value: false },
];

test('on the pilot, a write checks again exactly the rules that read the field written', () => {
  const today = scenarios[0]!.today;
  const { form, checks, rules } = countedForm(today);
  const watched = form as unknown as { parsed: { subscribe(listener: () => void): () => void } };
  const stop = watched.parsed.subscribe(() => undefined);
  assert.ok(
    checks.every((count) => count === 1),
    `each rule checked once at first: ${JSON.stringify(checks)}`,
  );
  const spec = liveSpec(today);
  for (const { path, value } of WRITES) {
    const before: number[] = [...checks];
    const read = rules.map((rule) => readOf(rule, submittedOf(spec, form)));
    (nodeAt(form, ...path) as unknown as { set(raw: unknown): void }).set(value);
    const again: number[] = checks.flatMap((count, index) => (count > before[index]! ? [index] : []));
    const changed = rules.flatMap((rule, index) =>
      readOf(rule, submittedOf(spec, form)) !== read[index] ? [index] : [],
    );
    assert.deepEqual(again, changed, `rules checked again by a write at ${JSON.stringify(path)}`);
    assert.ok(
      checks.every((count, index) => count - before[index]! <= 1),
      'each at most once',
    );
  }
  stop();
});

test('on the pilot, required is what requiredPaths says of what the form submits, node by node', () => {
  const today = scenarios[0]!.today;
  for (const scenario of scenarios) {
    const spec = liveSpec(today);
    const form = createForm(spec) as unknown as LiveForm;
    form.set(holding(spec, scenario.values));
    const nodes: LiveNode[] = [];
    const walk = (node: LiveNode): void => {
      nodes.push(node);
      (node.items?.get() ?? Object.values(node.children ?? {})).forEach(walk);
    };
    walk(form);
    const named = (path: Path): string => {
      let node: LiveNode = form;
      for (const segment of path) {
        const next: LiveNode | undefined =
          typeof segment === 'string'
            ? node.children?.[segment]
            : node.items
                ?.get()
                .find((item) =>
                  typeof segment === 'number'
                    ? node.items!.get().indexOf(item) === segment
                    : (item.raw.get() as { key: unknown }).key === (segment as { key: unknown }).key,
                );
        if (!next) {
          break;
        }
        node = next;
      }
      return JSON.stringify(node.path);
    };
    // What the form submits, as its rules read it.
    const want = [...new Set(requiredPaths(pilotRules(today), plain(submittedOf(spec, form))).map(named))].sort();
    const got = nodes
      .filter((node) => node.required.get())
      .map((node) => JSON.stringify(node.path))
      .sort();
    assert.deepEqual(got, want, scenario.name);
  }
});
