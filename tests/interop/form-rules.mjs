// The rules of @yaltaan/rules read by @yaltaan/form beside the same rules in Angular Signal Forms, written with its own
// validators, and in TanStack Form, read through `refine` as its form's validator, the references of their behaviour
// (ADR 0046): the same writes on the three engines, every check counted. They agree on the issues each field shows and
// on what is required; they depart on what a write checks again: Angular, whose validators are computed signals, checks
// what read a signal the write changed, so that a rule across the items of a list, which reads the whole list, runs
// again when any field of an item changes; TanStack runs its form's validator, every rule in it, on every change; the
// form checks only the rules that declare the field written. Run by tests/interop/run.sh, from the tarballs an
// application would install.
import '@angular/compiler';
import assert from 'node:assert/strict';

import { Injector, signal } from '@angular/core';
import { applyEach, form, required, validate } from '@angular/forms/signals';
import { FieldApi, FormApi } from '@tanstack/form-core';
import { array, createForm, field, group } from '@yaltaan/form';
import { allOrNone, refine, requiredIf, unique } from '@yaltaan/rules';
import { array as list, object, string } from '@yaltaan/schema';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { getTestBed, TestBed } = await import('@angular/core/testing');
const { BrowserTestingModule, platformBrowserTesting } = await import('@angular/platform-browser/testing');
getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const injector = TestBed.inject(Injector);

const initial = () => ({
  country: 'FR',
  siren: '',
  contract: { number: '', signedOn: '' },
  contacts: [
    { name: 'Claire', email: 'claire@example.org' },
    { name: 'Karim', email: 'karim@example.org' },
  ],
});

/** Every check of each engine, by rule. */
const counts = { angular: {}, tanstack: {}, yaltaan: {} };
const counted = (engine, name, run) => {
  counts[engine][name] = 0;
  return (...values) => {
    counts[engine][name]++;
    return run(...values);
  };
};
const snapshot = (engine) => ({ ...counts[engine] });
const again = (engine, before) =>
  Object.keys(counts[engine])
    .filter((name) => counts[engine][name] > before[name])
    .sort();

// The three rules, as @yaltaan/rules writes them, each with its checks counted.
const rulesOf = (engine) => {
  const wrap = (name, rule) => ({ ...rule, check: counted(engine, name, rule.check) });
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
  ];
};

// Angular: its own validators, each reading the fields it needs through `valueOf`.
const model = signal(initial());
const isEmpty = (value) => value === '' || value === undefined || value === null;
const angular = form(
  model,
  (path) => {
    required(path.siren, { when: counted('angular', 'siren', ({ valueOf }) => valueOf(path.country) === 'FR') });
    validate(
      path.contract.signedOn,
      counted('angular', 'contract', ({ value, valueOf }) =>
        !isEmpty(valueOf(path.contract.number)) && isEmpty(value()) ? { kind: 'rules.all_or_none' } : undefined,
      ),
    );
    applyEach(path.contacts, (contact) =>
      validate(
        contact.email,
        counted('angular', 'emails', ({ value, valueOf }) =>
          valueOf(path.contacts).filter((other) => other.email === value()).length > 1
            ? { kind: 'rules.unique' }
            : undefined,
        ),
      ),
    );
  },
  { injector },
);
const angularErrors = (state) =>
  state()
    .errors()
    .map((error) => error.kind)
    .sort();

// TanStack: the schema and the rules through `refine`, the form's validator on change, a field per leaf.
const schema = object({
  country: string(),
  siren: string(),
  contract: object({ number: string(), signedOn: string() }),
  contacts: list(object({ name: string(), email: string() })),
});
const tanstack = new FormApi({
  defaultValues: initial(),
  validators: { onChange: refine(schema, rulesOf('tanstack')) },
});
tanstack.mount();
for (const name of [
  'country',
  'siren',
  'contract.number',
  'contract.signedOn',
  'contacts[0].name',
  'contacts[0].email',
  'contacts[1].name',
  'contacts[1].email',
]) {
  new FieldApi({ form: tanstack, name }).mount();
}
const tanstackErrors = (name) =>
  (tanstack.getFieldMeta(name)?.errors ?? []).map((error) => error.message ?? error).sort();

// The form: the same rules, read at its root.
const yaltaan = createForm(
  group(
    {
      country: field('FR'),
      siren: field(''),
      contract: group({ number: field(''), signedOn: field('') }),
      contacts: array(group({ name: field(''), email: field('') }), { initial: initial().contacts }),
    },
    { rules: rulesOf('yaltaan') },
  ),
);
const yaltaanErrors = (node) =>
  node.issues
    .get()
    .map((issue) => issue.code)
    .sort();
const contactsOf = () => yaltaan.children.contacts.items.get();

const look = () => {
  TestBed.tick();
  angularErrors(angular.siren);
  angularErrors(angular.contract.signedOn);
  angularErrors(angular.contacts[0].email);
  angularErrors(angular.contacts[1].email);
  yaltaan.parsed.get();
};

// 1. What each field shows, and what is required, at first.
await tanstack.validate('change');
look();
assert.deepEqual(angularErrors(angular.siren), ['required']);
assert.deepEqual(yaltaanErrors(yaltaan.children.siren), ['rules.required_if']);
assert.deepEqual(tanstackErrors('siren'), ['rules.required_if']);
assert.equal(angular.siren().required(), true);
assert.equal(yaltaan.children.siren.required.get(), true);

// 2. A write no rule reads: the form checks nothing again; Angular the rule that reads the whole list of contacts to
// compare their emails; TanStack every rule.
{
  const before = { angular: snapshot('angular'), tanstack: snapshot('tanstack'), yaltaan: snapshot('yaltaan') };
  angular.contacts[1].name().value.set('Kim');
  tanstack.setFieldValue('contacts[1].name', 'Kim');
  contactsOf()[1].children.name.set('Kim');
  look();
  assert.deepEqual(again('angular', before.angular), ['emails']);
  assert.deepEqual(again('yaltaan', before.yaltaan), []);
  assert.deepEqual(again('tanstack', before.tanstack), ['contract', 'emails', 'siren']);
}

// 3. A write one rule reads: that rule only, but in TanStack; the same issues on both contacts.
{
  const before = { angular: snapshot('angular'), tanstack: snapshot('tanstack'), yaltaan: snapshot('yaltaan') };
  angular.contacts[1].email().value.set('claire@example.org');
  tanstack.setFieldValue('contacts[1].email', 'claire@example.org');
  contactsOf()[1].children.email.set('claire@example.org');
  look();
  assert.deepEqual(again('angular', before.angular), ['emails']);
  assert.deepEqual(again('yaltaan', before.yaltaan), ['emails']);
  assert.deepEqual(again('tanstack', before.tanstack), ['contract', 'emails', 'siren']);
  for (const index of [0, 1]) {
    assert.deepEqual(angularErrors(angular.contacts[index].email), ['rules.unique']);
    assert.deepEqual(yaltaanErrors(contactsOf()[index].children.email), ['rules.unique']);
    assert.deepEqual(tanstackErrors(`contacts[${index}].email`), ['rules.unique']);
  }
}

// 4. A rule across two fields of a group, and a condition that stops requiring a field.
{
  angular.contract.number().value.set('C-1');
  tanstack.setFieldValue('contract.number', 'C-1');
  yaltaan.children.contract.children.number.set('C-1');
  look();
  assert.deepEqual(angularErrors(angular.contract.signedOn), ['rules.all_or_none']);
  assert.deepEqual(yaltaanErrors(yaltaan.children.contract.children.signedOn), ['rules.all_or_none']);
  assert.deepEqual(tanstackErrors('contract.signedOn'), ['rules.all_or_none']);
  const before = { angular: snapshot('angular'), yaltaan: snapshot('yaltaan') };
  angular.country().value.set('DE');
  tanstack.setFieldValue('country', 'DE');
  yaltaan.children.country.set('DE');
  look();
  assert.deepEqual(again('angular', before.angular), ['siren']);
  assert.deepEqual(again('yaltaan', before.yaltaan), ['siren']);
  assert.equal(angular.siren().required(), false);
  assert.equal(yaltaan.children.siren.required.get(), false);
  assert.deepEqual(angularErrors(angular.siren), []);
  assert.deepEqual(yaltaanErrors(yaltaan.children.siren), []);
  assert.deepEqual(tanstackErrors('siren'), []);
}

console.log('form-rules: the rules read by the form agree with Angular Signal Forms and TanStack Form', counts);
