// A schema of @yaltaan/schema read by Angular Signal Forms through its own validateStandardSchema, with no bridge, in
// Angular's test environment over jsdom. Run by tests/interop/run.sh, from the tarballs an application would install.
import '@angular/compiler';
import assert from 'node:assert/strict';

import { Injector, signal } from '@angular/core';
import { form, validateStandardSchema } from '@angular/forms/signals';
import { allOrNone, atLeast, each, refine, requiredIf } from '@yaltaan/rules';
import { array, number, object, optional, string, withMessages } from '@yaltaan/schema';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { getTestBed, TestBed } = await import('@angular/core/testing');
const { BrowserTestingModule, platformBrowserTesting } = await import('@angular/platform-browser/testing');
getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const injector = TestBed.inject(Injector);

const messages = (field) =>
  field()
    .errors()
    .map((error) => error.message);

const login = object({
  email: string({ pattern: /^[^@]+@[^@]+$/, maxLength: 254 }),
  password: string({ minLength: 8 }),
  age: optional(number({ min: 0 })),
});

const model = signal({ email: 'nope', password: 'short', age: -1 });
const read = form(model, (path) => validateStandardSchema(path, login), { injector });
assert.equal(read().valid(), false);
assert.deepEqual(messages(read), []);
assert.deepEqual(messages(read.email), ['schema.invalid_format']);
assert.deepEqual(messages(read.password), ['schema.too_short']);
assert.deepEqual(messages(read.age), ['schema.too_small']);
model.set({ email: 'a@b.cd', password: 'analytical', age: 3 });
assert.equal(read().valid(), true);
assert.deepEqual(messages(read.email), []);

const worded = withMessages(login, (issue) => `Fix ${issue.path.join('.')}: ${issue.code}`);
const words = form(
  signal({ email: 'nope', password: 'analytical', age: 1 }),
  (path) => validateStandardSchema(path, worded),
  { injector },
);
assert.deepEqual(messages(words.email), ['Fix email: schema.invalid_format']);

const team = object({ members: array(object({ name: string({ minLength: 1 }) }), { minLength: 3, maxLength: 4 }) });
const list = form(signal({ members: [{ name: 'a' }, { name: '' }] }), (path) => validateStandardSchema(path, team), {
  injector,
});
assert.deepEqual(messages(list.members[1].name), ['schema.too_short']);
assert.deepEqual(messages(list.members), ['schema.too_small']);
const contract = refine(
  object({
    country: string(),
    siren: optional(string()),
    number: optional(string()),
    signedOn: optional(string()),
    phone: optional(string()),
    email: optional(string()),
    lines: array(object({ taxable: optional(string()), rate: optional(string()) })),
  }),
  [
    requiredIf({ reads: [['country']], when: (country) => country === 'FR' }, [['siren']]),
    allOrNone([['number'], ['signedOn']]),
    atLeast(1, [['phone'], ['email']]),
    each(['lines'], [allOrNone([['taxable'], ['rate']])]),
  ],
);
// A field the model leaves out has no node here, so an application holds an empty string, which a rule reads as blank.
const entered = signal({
  country: 'FR',
  siren: '',
  number: 'C-1',
  signedOn: '',
  phone: '',
  email: '',
  lines: [{ taxable: 'yes', rate: '' }],
});
const signed = form(entered, (path) => validateStandardSchema(path, contract), { injector });
assert.equal(signed().valid(), false);
assert.deepEqual(messages(signed.siren), ['rules.required_if']);
assert.deepEqual(messages(signed.signedOn), ['rules.all_or_none']);
assert.deepEqual(messages(signed.phone), ['rules.at_least']);
assert.deepEqual(messages(signed.email), ['rules.at_least']);
assert.deepEqual(messages(signed.lines[0].rate), ['rules.all_or_none']);
assert.deepEqual(messages(signed.number), []);
entered.set({ country: 'DE', siren: '', number: '', signedOn: '', phone: '01', email: '', lines: [] });
assert.equal(signed().valid(), true);
console.log('ok: Angular Signal Forms reads the schemas and the rules, each issue on its field');
