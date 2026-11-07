// The scenarios of the pilot, run against the form written with the library. A scenario passes when the form shows
// exactly the issues it expects (code of the catalogue, path by key), holds the derived values it lists, and sends the
// server nothing it was not meant to receive. Two judges keep the scenarios honest: a form that does nothing fails
// every one of them, and taking any rule or derivation out of the form fails at least one.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fc } from '@yaltaan/testing';
import { assertDeclaredReads, checkRules, requiredPaths } from '@yaltaan/rules';

import { derivations as derivationNames, rules as catalogue } from './model.ts';
import { scenarios, type Scenario } from './scenarios.ts';
import {
  dayNumber,
  derivations,
  isIban,
  isSiren,
  pilotParts,
  submitApplication,
  type PilotParts,
  type Submission,
} from './form.ts';

const keyOf = (code: string, path: readonly unknown[]): string => `${code} ${JSON.stringify(path)}`;

/** The value at a path whose list elements are named by key; `absent` when a step is missing. */
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

const HOSTILE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function hostileKeyIn(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Object.keys(value).some(
    (name) => HOSTILE_KEYS.has(name) || hostileKeyIn((value as Record<string, unknown>)[name]),
  );
}

/** What a submission gets wrong against a scenario: nothing when the scenario passes. */
function mismatches(scenario: Scenario, submission: Submission): string[] {
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
      wrong.push(
        `${derivation}: ${held === absent ? 'absent' : JSON.stringify(held)}, expected ${JSON.stringify(value)}`,
      );
    }
  }
  if (scenario.issues.length === 0 && (submission.sent === undefined || hostileKeyIn(submission.sent))) {
    wrong.push(submission.sent === undefined ? 'nothing sent' : 'a hostile key reached the server');
  }
  return wrong;
}

function run(scenario: Scenario, parts: PilotParts = pilotParts(scenario.today)): string[] {
  const asked: unknown[] = [];
  const submission = submitApplication(
    scenario.values,
    (values) => {
      asked.push(values);
      return scenario.server;
    },
    parts,
  );
  return asked.length > 1 ? ['the server asked twice'] : mismatches(scenario, submission);
}

for (const scenario of scenarios) {
  test(`scenario: ${scenario.name}`, () => {
    assert.deepEqual(run(scenario), []);
    assert.equal(({} as { polluted?: unknown }).polluted, undefined, 'a prototype was changed');
  });
}

test('a form that checks, derives and sends nothing fails every scenario', () => {
  const nothing = (scenario: Scenario): Submission => ({ values: scenario.values, issues: [] });
  const passing = scenarios.filter((scenario) => mismatches(scenario, nothing(scenario)).length === 0);
  assert.deepEqual(
    passing.map(({ name }) => name),
    [],
  );
});

test('taking any rule or derivation out of the form fails at least one scenario', () => {
  const today = scenarios[0]!.today;
  assert.ok(
    scenarios.every((scenario) => scenario.today === today),
    'one day for every scenario',
  );
  const whole = pilotParts(today);
  const unpinned: string[] = [];
  whole.rules.forEach((_, index) => {
    const parts = { ...whole, rules: whole.rules.filter((__, other) => other !== index) };
    if (scenarios.every((scenario) => run(scenario, parts).length === 0)) {
      unpinned.push(`rule ${index}`);
    }
  });
  for (const name of Object.keys(derivations)) {
    const parts = {
      ...whole,
      derivations: Object.entries(derivations)
        .filter(([other]) => other !== name)
        .map(([, d]) => d),
    };
    if (scenarios.every((scenario) => run(scenario, parts).length === 0)) {
      unpinned.push(`derivation ${name}`);
    }
  }
  assert.deepEqual(unpinned, []);
});

test('the form derives what the catalogue lists, by the same names', () => {
  assert.deepEqual(Object.keys(derivations).sort(), Object.keys(derivationNames).sort());
});

test('the rules of the form read only what they declare, on every scenario', () => {
  const { rules } = pilotParts(scenarios[0]!.today);
  for (const scenario of scenarios) {
    for (const rule of rules) {
      assertDeclaredReads(rule, scenario.values);
    }
  }
});

// Every path of a value, to change one at a time.
function pathsWithin(value: unknown, at: readonly (string | number)[] = []): (readonly (string | number)[])[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.keys(value).flatMap((name) => {
    const segment = Array.isArray(value) ? Number(name) : name;
    return [[...at, segment], ...pathsWithin((value as Record<string, unknown>)[name], [...at, segment])];
  });
}

function changed(value: unknown, path: readonly (string | number)[], next: unknown): unknown {
  const copy = structuredClone(value) as Record<string | number, unknown>;
  let current = copy;
  for (const segment of path.slice(0, -1)) {
    current = current[segment] as Record<string | number, unknown>;
  }
  const last = path.at(-1)!;
  if (next === undefined && !Array.isArray(current)) {
    delete current[last];
  } else {
    current[last] = next;
  }
  return copy;
}

// What a form half filled in, or a request built to break it, can hold at a field.
const STRANGE = [
  undefined,
  null,
  '',
  [],
  {},
  0,
  -1,
  1e308,
  'text',
  JSON.parse('{"toString":1,"valueOf":1}'),
  [null],
  [[]],
];

test('on a form half filled in, or built to break it, field by field, nothing throws and nothing is sent', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...scenarios),
      fc.nat(),
      fc.nat(),
      fc.constantFrom(...STRANGE),
      fc.constantFrom(...STRANGE),
      (scenario, first, second, one, other) => {
        const parts = pilotParts(scenario.today);
        const paths = pathsWithin(scenario.values);
        const once = changed(scenario.values, paths[first % paths.length]!, one);
        const again = pathsWithin(once);
        const twice = again.length === 0 ? once : changed(once, again[second % again.length]!, other);
        for (const values of [once, twice]) {
          const submission = submitApplication(values, () => 'accepted', parts);
          assert.ok(submission.sent === undefined || submission.issues.length === 0);
          checkRules(parts.rules, values);
          requiredPaths(parts.rules, values);
        }
      },
    ),
    { numRuns: 500 },
  );
  for (const values of [undefined, null, {}, [], 'text', 0]) {
    assert.ok(submitApplication(values, () => 'accepted', pilotParts('2026-10-23')).issues.length > 0, String(values));
  }
});

test('a SIREN, an IBAN and a day are read as their standards say', () => {
  assert.ok(isSiren('123456782') && isSiren('222222226') && isSiren('732829320'));
  assert.ok(!isSiren('123456789') && !isSiren('12345678') && !isSiren('1234567820') && !isSiren('12345678a'));
  for (const iban of ['FR7630006000011234567890189', 'DE89370400440532013000', 'BR1800360305000010009795493C1']) {
    assert.ok(isIban(iban), iban);
    assert.ok(isIban(iban.toLowerCase().replace(/(.{4})/g, '$1 ')), `${iban} written in groups`);
  }
  assert.ok(!isIban('FR7630006000011234567890188') && !isIban('FR76') && !isIban('7630006000011234567890189'));
  assert.equal(dayNumber('1970-01-02'), 1);
  assert.equal(dayNumber('2024-02-29'), 19_782);
  for (const text of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '26-01-01', '2026-1-1', 1, undefined]) {
    assert.equal(dayNumber(text), undefined, String(text));
  }
});
