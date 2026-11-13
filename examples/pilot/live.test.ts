// The scenarios of the pilot, run against the form built with @yaltaan/form (live.ts): the issues the form shows, by
// code and by path, items named by the key their value holds, the values the derivations give from what it holds, and
// what reaches the server, judged as form.test.ts judges the form of the schema and the rules alone. Beside them, what
// only a live form shows: a write checks again only the rules that read the field written, counted on the pilot's own
// rules, and `required` says what the rules require. A scenario that needs what the form does with an empty or a
// disabled sub-form, still to decide, is named below, and must fail until then: once it passes, it leaves the list.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Path } from '@yaltaan/core/path';
import { createForm } from '@yaltaan/form';
import { requiredPaths, type Rule } from '@yaltaan/rules';

import { holding, liveRules, liveSpec, submitLive, type LiveForm, type LiveNode } from './live.ts';
import { rules as catalogue } from './model.ts';
import { frenchSupplier, scenarios, type Scenario } from './scenarios.ts';

/** The scenarios that wait for what the form does with an empty or a disabled sub-form, with the reason. */
const AWAITING_SUB_FORMS: Readonly<Record<string, string>> = {
  'billing address unchecked and left empty':
    'an empty sub-form is an object, never blank: "billing address required" cannot mark it (T2.4 e)',
  'parent company checked and left empty':
    'an empty sub-form is an object, never blank: "parent company required" cannot mark it (T2.4 e)',
  'parent company unchecked after being filled':
    'the parent sub-form, filled then unchecked, still shows its issues: what a disabled node shows (T2.4 e)',
};

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
  const rules = liveRules(today).map((rule, index): Rule => {
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

/** Which rules of the pilot read a path: those that declare a path at or above it, or below it. */
function readersOf(rules: readonly Rule[], path: readonly (string | { readonly key: string })[]): number[] {
  const steps = path.map((segment) => (typeof segment === 'string' ? segment : '*'));
  return rules.flatMap((rule, index) =>
    rule.reads.some((read) => {
      const declared = read.map((segment) =>
        typeof segment === 'object' || typeof segment === 'number' ? '*' : segment,
      );
      return declared.every((segment, at) => at >= steps.length || segment === steps[at]);
    })
      ? [index]
      : [],
  );
}

const WRITES: readonly { readonly path: readonly (string | { readonly key: string })[]; readonly value: unknown }[] = [
  { path: ['company', 'legalName'], value: 'Atelier Martin' },
  { path: ['company', 'siren'], value: '123456789' },
  { path: ['company', 'country'], value: 'BE' },
  { path: ['company', 'headOffice', 'postalCode'], value: '7501' },
  { path: ['company', 'parent', 'address', 'city'], value: 'Lille' },
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
  for (const { path, value } of WRITES) {
    const before: number[] = [...checks];
    (nodeAt(form, ...path) as unknown as { set(raw: unknown): void }).set(value);
    const again: number[] = checks.flatMap((count, index) => (count > before[index]! ? [index] : []));
    assert.deepEqual(again, readersOf(rules, path), `rules checked again by a write at ${JSON.stringify(path)}`);
    assert.ok(
      checks.every((count, index) => count - before[index]! <= 1),
      'each at most once',
    );
  }
  stop();
});

test('on the pilot, required is what requiredPaths says of the raw value, node by node', () => {
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
    // The raw value the form holds, as its rules read it.
    const want = [...new Set(requiredPaths(liveRules(today), form.raw.get()).map(named))].sort();
    const got = nodes
      .filter((node) => node.required.get())
      .map((node) => JSON.stringify(node.path))
      .sort();
    assert.deepEqual(got, want, scenario.name);
  }
});
