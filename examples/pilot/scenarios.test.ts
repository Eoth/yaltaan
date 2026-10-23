import assert from 'node:assert/strict';
import { test } from 'node:test';

import { derivations, fields, pathPattern, rules, type FieldKind, type PilotPath } from './model.ts';
import { scenarios } from './scenarios.ts';

const known = (pattern: string): boolean => pattern === '' || Object.hasOwn(fields, pattern);

/** Whether every key segment of the path names an element of the list it stands in, in these values. */
function keyedElementsExist(values: unknown, path: PilotPath): boolean {
  let current: unknown = values;
  for (const segment of path) {
    if (typeof segment === 'object') {
      if (!Array.isArray(current)) {
        return false;
      }
      current = current.find((element: { key?: unknown }) => element.key === segment.key);
      if (current === undefined) {
        return false;
      }
    } else if (current !== null && typeof current === 'object') {
      current = (current as Record<string | number, unknown>)[segment];
    } else {
      current = undefined;
    }
  }
  return true;
}

test('scenario names are unique', () => {
  const names = scenarios.map((scenario) => scenario.name);
  assert.deepEqual(names, [...new Set(names)]);
});

test('the form has a field of every kind, lists nested in lists, and derived fields', () => {
  const kinds: readonly FieldKind[] = [
    'text',
    'number',
    'whole-number',
    'boolean',
    'choice',
    'choices',
    'date',
    'object',
    'list',
  ];
  const present = new Set(Object.values(fields).map((field) => field.kind));
  assert.deepEqual(
    kinds.filter((kind) => !present.has(kind)),
    [],
  );
  assert.ok(
    Object.keys(fields).some((pattern) => pattern.split('[*]').length > 2),
    'no list inside a list',
  );
  assert.ok(
    Object.values(fields).some((field) => field.derived === true),
    'no derived field',
  );
});

test('every rule and every derivation reads and writes fields of the catalogue', () => {
  for (const [id, rule] of Object.entries(rules)) {
    for (const pattern of [...rule.reads, ...rule.marks]) {
      assert.ok(known(pattern), `${id}: ${pattern} is not a field`);
    }
  }
  for (const [id, derivation] of Object.entries(derivations)) {
    for (const pattern of [...derivation.reads, derivation.writes]) {
      assert.ok(known(pattern), `${id}: ${pattern} is not a field`);
    }
  }
});

test('every expected issue names a rule that marks this field, on an existing element', () => {
  for (const scenario of scenarios) {
    for (const { rule, path } of scenario.issues) {
      const pattern = pathPattern(path);
      const where = `${scenario.name}: ${rule} at ${pattern || '(form)'}`;
      assert.ok(Object.hasOwn(rules, rule), `${where}: no such rule`);
      assert.ok(rules[rule]?.marks.includes(pattern), `${where}: the rule does not mark this field`);
      assert.ok(keyedElementsExist(scenario.values, path), `${where}: no element with that key`);
    }
  }
});

test('every expected derived value names a derivation that writes this field, on an existing element', () => {
  for (const scenario of scenarios) {
    for (const { derivation, path } of scenario.derived) {
      const pattern = pathPattern(path);
      const where = `${scenario.name}: ${derivation} at ${pattern}`;
      assert.ok(Object.hasOwn(derivations, derivation), `${where}: no such derivation`);
      assert.equal(derivations[derivation]?.writes, pattern, `${where}: the derivation writes another field`);
      assert.ok(keyedElementsExist(scenario.values, path), `${where}: no element with that key`);
    }
  }
});

test('every rule and every derivation is exercised by at least one scenario', () => {
  for (const id of Object.keys(rules)) {
    assert.ok(
      scenarios.some((scenario) => scenario.issues.some((issue) => issue.rule === id)),
      `${id} is in no scenario`,
    );
  }
  for (const id of Object.keys(derivations)) {
    assert.ok(
      scenarios.some((scenario) => scenario.derived.some((value) => value.derivation === id)),
      `${id} is in no scenario`,
    );
  }
});

test('server issues appear only when the server answers, and alone', () => {
  for (const scenario of scenarios) {
    const fromServer = scenario.issues.filter((issue) => rules[issue.rule]?.source === 'server');
    if (scenario.server === 'accepted') {
      assert.equal(fromServer.length, 0, scenario.name);
    } else {
      assert.ok(fromServer.length > 0 && fromServer.length === scenario.issues.length, scenario.name);
    }
  }
});

test('every scenario submits on a real calendar day', () => {
  for (const scenario of scenarios) {
    assert.match(scenario.today, /^\d{4}-\d{2}-\d{2}$/, scenario.name);
    assert.equal(new Date(`${scenario.today}T00:00:00Z`).toISOString().slice(0, 10), scenario.today, scenario.name);
  }
});
