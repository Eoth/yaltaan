// The states of @yaltaan/form beside those of Angular Signal Forms and TanStack Form, the references of its behaviour
// (ADR 0043): the same steps on the three engines, each state asserted on each, where they agree and where the form
// departs from a reference on purpose, so that a reference that changes its behaviour is seen here. Run by
// tests/interop/run.sh, from the tarballs an application would install.
import '@angular/compiler';
import assert from 'node:assert/strict';

import { Injector, signal } from '@angular/core';
import { disabled, form, submit, validateStandardSchema } from '@angular/forms/signals';
import { FieldApi, FormApi } from '@tanstack/form-core';
import { createForm, field, group } from '@yaltaan/form';
import { object, string } from '@yaltaan/schema';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { getTestBed, TestBed } = await import('@angular/core/testing');
const { BrowserTestingModule, platformBrowserTesting } = await import('@angular/platform-browser/testing');
getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const injector = TestBed.inject(Injector);

const initial = () => ({ name: 'Ada', address: { city: 'Paris', zip: '' } });
const schema = object({
  name: string({ minLength: 2 }),
  address: object({ city: string({ minLength: 1 }), zip: string() }),
});

// Angular: a model signal, the schema at the root, and the zip disabled while the city is empty.
const model = signal(initial());
const angular = form(
  model,
  (path) => {
    validateStandardSchema(path, schema);
    disabled(path.address.zip, ({ valueOf }) => valueOf(path.address.city) === '');
  },
  { injector },
);

// TanStack: the schema as the form's validator on change, a field per leaf.
const tanstack = new FormApi({ defaultValues: initial(), validators: { onChange: schema } });
tanstack.mount();
const fields = Object.fromEntries(
  ['name', 'address.city', 'address.zip'].map((name) => {
    const api = new FieldApi({ form: tanstack, name });
    api.mount();
    return [name, api];
  }),
);
const meta = (name) => tanstack.getFieldMeta(name);

// Yaltaan: the same description.
const yaltaan = createForm(
  group(
    {
      name: field('Ada'),
      address: group({
        city: field('Paris'),
        zip: field('', { disabled: { reads: [['address', 'city']], when: (city) => city === '' } }),
      }),
    },
    { schema },
  ),
);
const { name, address } = yaltaan.children;

// Touched: a touched leaf touches its groups, never its siblings, in Angular and here; TanStack touches on a change.
angular.address.city().markAsTouched();
address.children.city.touch();
assert.deepEqual([angular().touched(), angular.address().touched(), angular.name().touched()], [true, true, false]);
assert.deepEqual([yaltaan.touched.get(), address.touched.get(), name.touched.get()], [true, true, false]);
fields['address.city'].handleBlur();
assert.equal(meta('address.city').isTouched, true);

// Dirty: here, the raw value differs from the initial one, as TanStack's isDefaultValue says; Angular and TanStack's
// isDirty stay true once the user changed a value, even back to the initial one.
angular.name().controlValue.set('Grace');
fields.name.handleChange('Grace');
name.set('Grace');
assert.deepEqual(
  [angular.name().dirty(), meta('name').isDirty, meta('name').isDefaultValue, name.dirty.get()],
  [true, true, false, true],
);
assert.deepEqual([angular().dirty(), yaltaan.dirty.get()], [true, true]);
angular.name().controlValue.set('Ada');
fields.name.handleChange('Ada');
name.set('Ada');
assert.deepEqual(
  [angular.name().dirty(), meta('name').isDirty, meta('name').isDefaultValue, name.dirty.get()],
  [true, true, true, false],
);

// A programmatic write: Angular does not call it dirty, TanStack does, the form compares values.
model.update((value) => ({ ...value, address: { ...value.address, zip: '75001' } }));
fields['address.zip'].setValue('75001');
address.children.zip.set('75001');
assert.deepEqual(
  [angular.address.zip().dirty(), meta('address.zip').isDirty, address.children.zip.dirty.get()],
  [false, true, true],
);

// Issues: an issue of the root schema goes to the field its path names, in all three, and a node's own issues hold
// none of its descendants'; a group's read value (here) and errorSummary (Angular) hold them.
model.update((value) => ({ ...value, address: { ...value.address, city: '' } }));
fields['address.city'].handleChange('');
address.children.city.set('');
assert.deepEqual(
  angular.address
    .city()
    .errors()
    .map((error) => error.message),
  ['schema.too_short'],
);
assert.deepEqual(angular.address().errors(), []);
assert.equal(angular.address().errorSummary().length, 1);
assert.deepEqual(
  meta('address.city').errors.map((error) => error.message ?? error),
  ['schema.too_short'],
);
assert.deepEqual(
  address.children.city.issues.get().map((issue) => issue.code),
  ['schema.too_short'],
);
assert.deepEqual(address.issues.get(), []);
assert.equal(address.parsed.get().ok, false);

// Disabled: the condition holds on the zip once the city is empty, in Angular and here; TanStack has no such state.
// Angular also leaves out the issues of a disabled node; here they stay (the pilot decides).
assert.deepEqual([angular.address.zip().disabled(), address.children.zip.disabled.get()], [true, true]);
assert.equal('disabled' in meta('address.zip'), false);

// Submission: Angular and TanStack touch every field, and so does the form; TanStack counts the attempts, the form
// keeps whether one was made since the last reset; Angular keeps neither.
await submit(angular, async () => undefined);
await tanstack.handleSubmit();
assert.equal(yaltaan.submit().ok, false);
assert.deepEqual([angular.name().touched(), meta('name').isTouched, name.touched.get()], [true, true, true]);
assert.deepEqual([tanstack.state.submissionAttempts, yaltaan.submitted.get()], [1, true]);
assert.equal('submitted' in angular(), false);

// Reset with a value: TanStack and the form make it the new initial value and clear the submission; Angular sets the
// model and clears touched and dirty, with no initial value to compare with.
const next = { name: 'Lin', address: { city: 'Lyon', zip: '69001' } };
angular().reset(next);
tanstack.reset(next);
yaltaan.reset(next);
assert.deepEqual(model(), next);
assert.deepEqual([angular().touched(), angular().dirty()], [false, false]);
assert.deepEqual(
  [tanstack.state.values, tanstack.state.submissionAttempts, meta('name').isDefaultValue],
  [next, 0, true],
);
assert.deepEqual(
  [yaltaan.raw.get(), yaltaan.submitted.get(), yaltaan.dirty.get(), yaltaan.touched.get()],
  [next, false, false, false],
);

console.log('form-states: the form agrees with Angular Signal Forms 22.2.4 and TanStack Form 1.33.5 where it says so');
