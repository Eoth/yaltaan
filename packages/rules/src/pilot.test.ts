// The rules of the pilot form, written with this package, judged by its scenarios: 42 cases fixed as data before this
// package had a line (examples/pilot/). What three of its rules need that no built-in gives is written as an
// application writes it, a `Rule`, and tested as one. The whole form, with the rules whose code is the pilot's own and
// the schema, is examples/pilot/form.ts, run against the built packages; this file judges the sources.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fc } from '@yaltaan/testing';

import { rules as catalogue, pathPattern } from '../../../examples/pilot/model.ts';
import { scenarios } from '../../../examples/pilot/scenarios.ts';
import {
  allOrNone,
  anyElement,
  assertDeclaredReads,
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
} from './index.ts';

const EUROPEAN_UNION = new Set(
  'AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK'.split(' '),
);
const SEPA = new Set([...EUROPEAN_UNION, ...'AD CH GB IS LI MC NO SM VA'.split(' ')]);

const isValue =
  (expected: unknown) =>
  (value: unknown): boolean =>
    value === expected;

const keyed = { identity: ['key'] };

const lowerCase = (text: unknown): unknown => (typeof text === 'string' ? text.toLowerCase() : text);

function listAt(values: unknown, name: string): readonly Record<string, unknown>[] {
  const elements = (values as Record<string, unknown> | null | undefined)?.[name];
  return Array.isArray(elements) ? (elements as readonly Record<string, unknown>[]) : [];
}

// A built-in of the lists: each element against the one before it, the later one marked.
function increasing(field: string, strict: boolean): Rule {
  const list = 'volumeDiscounts';
  return {
    reads: [
      [list, anyElement, field],
      [list, anyElement, 'key'],
    ],
    targets: [[list, anyElement, field]],
    check: (values) =>
      listAt(values, list).flatMap((item, index, all) => {
        const before = index === 0 ? undefined : all[index - 1]?.[field];
        const value = item?.[field];
        return typeof before === 'number' && typeof value === 'number' && (strict ? value <= before : value < before)
          ? [{ code: 'rules.ordered', path: [list, { key: item['key'] }, field] }]
          : [];
      }),
  };
}

const firstTierAboveMinimum: Rule = {
  reads: [['minimumQuantity'], ['volumeDiscounts', 0, 'fromQuantity'], ['volumeDiscounts', 0, 'key']],
  targets: [['volumeDiscounts', anyElement, 'fromQuantity']],
  check: (values) => {
    const minimum = (values as { minimumQuantity?: unknown } | null | undefined)?.minimumQuantity;
    const first = listAt(values, 'volumeDiscounts')[0];
    const from = first?.['fromQuantity'];
    return typeof from === 'number' && typeof minimum === 'number' && from < minimum
      ? [{ code: 'rules.ordered', path: ['volumeDiscounts', { key: first?.['key'] }, 'fromQuantity'] }]
      : [];
  },
};

// `when` of a later version: a rule of the French case only.
const kbisForFrance: Rule = (() => {
  const inner = atLeast(1, { list: ['documents'], at: ['kind'], where: isValue('kbis') });
  return {
    reads: [['company', 'country'], ...inner.reads],
    targets: inner.targets,
    check: (values) =>
      (values as { company?: { country?: unknown } } | null | undefined)?.company?.country === 'FR'
        ? inner.check(values)
        : [],
  };
})();

const rules: readonly Rule[] = [
  requiredIf({ reads: [['company', 'country']], when: isValue('FR') }, [['company', 'siren']]),
  requiredIf({ reads: [['company', 'country']], when: (country) => country !== 'FR' }, [
    ['company', 'foreignRegistration'],
  ]),
  mutuallyExclusive([
    ['company', 'siren'],
    ['company', 'foreignRegistration'],
  ]),
  requiredIf({ reads: [['company', 'country']], when: (country) => EUROPEAN_UNION.has(country as string) }, [
    ['company', 'vatNumber'],
  ]),
  requiredIf({ reads: [['company', 'legalForm']], when: isValue('OTHER') }, [['company', 'legalFormOther']]),
  requiredIf({ reads: [['company', 'billingSameAsHeadOffice']], when: isValue(false) }, [
    ['company', 'billingAddress'],
  ]),
  requiredIf({ reads: [['company', 'hasParentCompany']], when: isValue(true) }, [['company', 'parent']]),
  requiredIf(
    {
      reads: [
        ['company', 'hasParentCompany'],
        ['company', 'parent', 'country'],
      ],
      when: (has, country) => has === true && country === 'FR',
    },
    [['company', 'parent', 'siren']],
  ),
  unique(['contacts'], ['email'], { by: lowerCase, ...keyed }),
  exactly(1, { list: ['contacts'], at: ['primary'], where: isValue(true) }),
  atLeast(1, {
    list: ['contacts'],
    at: ['roles'],
    where: (roles) => Array.isArray(roles) && roles.includes('billing'),
  }),
  requiredIf({ reads: [['bank', 'iban']], when: (iban) => typeof iban === 'string' && !SEPA.has(iban.slice(0, 2)) }, [
    ['bank', 'bic'],
  ]),
  requiredIf({ reads: [['terms', 'paymentTerm']], when: isValue('DEPOSIT') }, [['terms', 'depositPercent']]),
  allOrNone([
    ['terms', 'contractNumber'],
    ['terms', 'contractSignedOn'],
  ]),
  ordered(['terms', 'validFrom'], ['terms', 'validTo']),
  unique(['catalogue', 'products'], ['reference'], { by: lowerCase, ...keyed }),
  each(
    ['catalogue', 'products'],
    [
      requiredIf({ reads: [['taxable']], when: isValue(true) }, [['vatRate']]),
      firstTierAboveMinimum,
      increasing('fromQuantity', true),
      increasing('discountPercent', false),
    ],
    keyed,
  ),
  each(
    ['documents'],
    [
      requiredIf({ reads: [['kind']], when: isValue('insurance') }, [['expiresOn']]),
      ordered(['issuedOn'], ['expiresOn'], { strict: true }),
    ],
    keyed,
  ),
  kbisForFrance,
];

const judged = Object.entries(catalogue).filter(([, rule]) => rule.source === 'rule' && rule.code.startsWith('rules.'));

function key(code: string, path: readonly unknown[]): string {
  return `${code} ${JSON.stringify(path)}`;
}

test('the rules of the pilot give every issue its scenarios expect, and no other', () => {
  assert.equal(judged.length, 23);
  const names = new Set(judged.map(([id]) => id));
  let compared = 0;
  for (const scenario of scenarios) {
    const expected = scenario.issues
      .filter((issue) => names.has(issue.rule))
      .map((issue) => key(catalogue[issue.rule]!.code, issue.path))
      .sort();
    const issues = checkRules(rules, scenario.values);
    assert.deepStrictEqual(issues.map((issue) => key(issue.code, issue.path)).sort(), expected, scenario.name);
    compared += expected.length;
  }
  assert.ok(compared >= judged.length, `${compared} issues compared`);
});

test('every rule of the pilot is reached by a scenario, and reads only what it declares', () => {
  for (const scenario of scenarios) {
    for (const rule of rules) {
      assertDeclaredReads(rule, scenario.values);
    }
  }
  for (const [id, rule] of judged) {
    assert.ok(
      scenarios.some((scenario) =>
        scenario.issues.some((issue) => issue.rule === id && rule.marks.includes(pathPattern(issue.path))),
      ),
      id,
    );
  }
});

// Every path of a value, to take away one at a time.
function pathsWithin(value: unknown, at: readonly (string | number)[] = []): (readonly (string | number)[])[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.keys(value).flatMap((key) => {
    const segment = Array.isArray(value) ? Number(key) : key;
    return [[...at, segment], ...pathsWithin((value as Record<string, unknown>)[key], [...at, segment])];
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
const STRANGE = [undefined, null, '', [], {}, 0, 'text', JSON.parse('{"toString":1,"valueOf":1}'), [null], [[]]];

test('on a form half filled in, or built to break it, field by field or row by row, no rule throws', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...scenarios),
      fc.nat(),
      fc.nat(),
      fc.constantFrom(...STRANGE),
      fc.constantFrom(...STRANGE),
      (scenario, first, second, one, other) => {
        const paths = pathsWithin(scenario.values);
        const once = changed(scenario.values, paths[first % paths.length]!, one);
        const again = pathsWithin(once);
        const twice = again.length === 0 ? once : changed(once, again[second % again.length]!, other);
        for (const values of [once, twice]) {
          checkRules(rules, values);
          requiredPaths(rules, values);
        }
      },
    ),
    { numRuns: 500 },
  );
  for (const values of [undefined, null, {}, [], 'text', 0]) {
    checkRules(rules, values);
    requiredPaths(rules, values);
  }
});
