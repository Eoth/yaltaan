import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fields, pathPattern, rules, type PilotPath } from './model.ts';
import { scenarios } from './scenarios.ts';

const known = (pattern: string): boolean => pattern === '' || Object.hasOwn(fields, pattern);

/** The list a path walks through before each key segment, so that the key can be looked up in the values. */
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

test('every rule reads and marks fields of the catalogue, under a unique id', () => {
  const ids = rules.map((rule) => rule.id);
  assert.deepEqual(ids, [...new Set(ids)]);
  for (const rule of rules) {
    for (const pattern of [...rule.reads, ...rule.marks]) {
      assert.ok(known(pattern), `${rule.id}: ${pattern} is not a field`);
    }
  }
});

test('every expected issue names a field, an existing element, and a rule that marks that field with that code', () => {
  for (const scenario of scenarios) {
    for (const issue of scenario.issues) {
      const pattern = pathPattern(issue.path);
      const where = `${scenario.name}: ${issue.code} at ${pattern || '(form)'}`;
      assert.ok(known(pattern), `${where}: not a field`);
      assert.ok(keyedElementsExist(scenario.values, issue.path), `${where}: no element with that key`);
      assert.ok(
        rules.some((rule) => rule.code === issue.code && rule.marks.includes(pattern)),
        `${where}: no rule marks this field with this code`,
      );
    }
  }
});

test('every rule is exercised by at least one scenario', () => {
  for (const rule of rules) {
    const exercised = scenarios.some((scenario) =>
      scenario.issues.some((issue) => issue.code === rule.code && rule.marks.includes(pathPattern(issue.path))),
    );
    assert.ok(exercised, `${rule.id} (${rule.code}) is in no scenario`);
  }
});

test('server issues appear only when the server answers, and alone', () => {
  const serverCodes = new Set(rules.filter((rule) => rule.source === 'server').map((rule) => rule.code));
  for (const scenario of scenarios) {
    const fromServer = scenario.issues.filter((issue) => serverCodes.has(issue.code));
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
