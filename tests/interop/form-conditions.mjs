// What a disabled, hidden or read-only node and an empty sub-form do in @yaltaan/form, beside Angular Signal Forms,
// the reference that has the three states, and TanStack Form, which has none: the same steps on each, where they agree
// and where the form departs on purpose, so that a reference that changes its behaviour is seen here. Run by
// tests/interop/run.sh, from the tarballs an application would install.
import '@angular/compiler';
import assert from 'node:assert/strict';

import { Injector, signal } from '@angular/core';
import { disabled, form, hidden, readonly, required, submit, validateStandardSchema } from '@angular/forms/signals';
import { FieldApi, FormApi } from '@tanstack/form-core';
import { createForm, field, group } from '@yaltaan/form';
import { refine, requiredIf } from '@yaltaan/rules';
import { string } from '@yaltaan/schema';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { getTestBed, TestBed } = await import('@angular/core/testing');
const { BrowserTestingModule, platformBrowserTesting } = await import('@angular/platform-browser/testing');
getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const injector = TestBed.inject(Injector);

// A supplier with a parent company, shown while its box is checked; a total the user cannot change; a note disabled
// while a box is checked; every field required.
const initial = () => ({ hasParent: false, parent: { name: '', siren: '' }, total: '', locked: true, note: '' });
const parentRequired = requiredIf({ reads: [['hasParent']], when: (has) => has === true }, [['parent']]);
// Angular: each condition on its field, `required` on every leaf, and the rule through `refine`, as a Standard Schema.
const model = signal(initial());
const angular = form(
  model,
  (path) => {
    hidden(path.parent, { when: ({ valueOf }) => valueOf(path.hasParent) !== true });
    readonly(path.total, { when: () => true });
    disabled(path.note, { when: ({ valueOf }) => valueOf(path.locked) === true });
    for (const leaf of [path.parent.name, path.parent.siren, path.total, path.note]) {
      required(leaf);
    }
    validateStandardSchema(
      path,
      refine({ '~standard': { version: 1, vendor: 'x', validate: (value) => ({ value }) } }, [parentRequired]),
    );
  },
  { injector },
);

// TanStack: the rule as the form's validator, a field per leaf; it has no condition of the three.
const tanstack = new FormApi({
  defaultValues: initial(),
  validators: {
    onChange: refine({ '~standard': { version: 1, vendor: 'x', validate: (value) => ({ value }) } }, [parentRequired]),
  },
});
tanstack.mount();
for (const name of ['hasParent', 'parent.name', 'parent.siren', 'total', 'locked', 'note']) {
  new FieldApi({ form: tanstack, name }).mount();
}

// The form: the same conditions, `required` as a schema of each leaf, the parent company an optional sub-form.
const filled = string({ minLength: 1 });
const yaltaan = createForm(
  group(
    {
      hasParent: field(false),
      parent: group(
        { name: field('', { schema: filled }), siren: field('', { schema: filled }) },
        { optional: true, hidden: { reads: [['hasParent']], when: (has) => has !== true } },
      ),
      total: field('', { schema: filled, readonly: { reads: [], when: () => true } }),
      locked: field(true),
      note: field('', { schema: filled, disabled: { reads: [['locked']], when: (locked) => locked === true } }),
    },
    { rules: [parentRequired] },
  ),
);
const { parent, total, note } = yaltaan.children;

// The three states hold on the node and every node below it, in Angular and here; TanStack has none.
assert.deepEqual(
  [angular.parent.name().hidden(), angular.total().readonly(), angular.note().disabled()],
  [true, true, true],
);
assert.deepEqual([parent.children.name.hidden.get(), total.readonly.get(), note.disabled.get()], [true, true, true]);
assert.equal('hidden' in tanstack.getFieldMeta('parent.name'), false);

// A hidden or disabled node checks nothing, in Angular and here: required and empty, it shows no error.
assert.deepEqual([angular.parent.name().errors(), angular.note().errors()], [[], []]);
assert.deepEqual([parent.children.name.issues.get(), note.issues.get()], [[], []]);

// A read-only node: Angular leaves it unchecked, as the platform does; the form submits it, so it checks it.
assert.deepEqual(angular.total().errors(), []);
assert.deepEqual(
  total.issues.get().map((issue) => issue.code),
  ['schema.too_short'],
);

// What is submitted: Angular's value is its model, hidden and disabled values included; the form leaves them out,
// their keys holding `undefined`, and keeps the read-only one.
model.update((value) => ({ ...value, parent: { name: 'Holding', siren: '1' }, note: 'kept', total: '12' }));
yaltaan.set({ hasParent: false, parent: { name: 'Holding', siren: '1' }, total: '12', locked: true, note: 'kept' });
assert.deepEqual(angular().value().parent, { name: 'Holding', siren: '1' });
assert.deepEqual(yaltaan.submit(), {
  ok: true,
  value: { hasParent: false, parent: undefined, total: '12', locked: true, note: undefined },
});

// Touched shows on no node the user cannot act on, in Angular and here; Angular does not mark it on submission either,
// where the form marks it and shows it once the node is enabled again. Dirty: Angular masks it on all three; the form
// on a node left out only, and shows it on a read-only one, whose value is submitted.
await submit(angular, async () => undefined);
assert.deepEqual(
  [angular.parent.name().touched(), angular.total().touched(), angular.note().touched()],
  [false, false, false],
);
assert.deepEqual(
  [parent.children.name.touched.get(), total.touched.get(), note.touched.get(), note.dirty.get()],
  [false, false, false, false],
);
angular.total().controlValue.set('13');
assert.deepEqual([angular.total().dirty(), total.dirty.get()], [false, true]);
model.update((value) => ({ ...value, locked: false }));
yaltaan.children.locked.set(false);
assert.deepEqual([angular.note().touched(), note.touched.get(), note.dirty.get()], [false, true, true]);

// Required: what a rule or a condition requires stays required while the node is hidden or disabled, in Angular, as
// on the platform, and here, where the rule decides on what is submitted.
model.update((value) => ({ ...value, locked: true }));
yaltaan.children.locked.set(true);
assert.deepEqual([angular.note().required(), angular.note().disabled()], [true, true]);

// An empty sub-form, the box checked: Angular and TanStack hold an object of empty strings, which a rule reads as
// filled, so the parent company is not required; the form's optional sub-form is absent, and the rule marks it.
const empty = { hasParent: true, parent: { name: '', siren: '' }, total: '12', locked: true, note: '' };
model.set(empty);
tanstack.reset(empty);
tanstack.setFieldValue('hasParent', true);
yaltaan.set(empty);
assert.deepEqual(
  angular()
    .errorSummary()
    .map((error) => error.kind),
  ['required', 'required'],
);
assert.deepEqual(tanstack.state.errors, []);
assert.deepEqual(
  parent.issues.get().map((issue) => issue.code),
  ['rules.required_if'],
);
assert.deepEqual([parent.required.get(), parent.children.name.issues.get()], [true, []]);

console.log(
  'form-conditions: the form agrees with Angular Signal Forms 22.2.4 and departs from it, and from TanStack Form ' +
    '1.33.5, where it says so',
);
