// The arrays of @yaltaan/form beside those of Angular Signal Forms and TanStack Form, the references of its behaviour
// (ADR 0044): the same moves, insertions and removals on the three engines, each state asserted on each, where they
// agree (the state of an item follows it, its issues follow its value) and where the form departs on purpose (a path
// that keeps its key, an item that keeps its state whatever its value is made of, an insertion that is done when it
// returns), so that a reference that changes its behaviour is seen here. Run by tests/interop/run.sh, from the
// tarballs an application would install.
import '@angular/compiler';
import assert from 'node:assert/strict';

import { Injector, signal } from '@angular/core';
import { form, validateStandardSchema } from '@angular/forms/signals';
import { FieldApi, FormApi } from '@tanstack/form-core';
import { array, createForm, field, group } from '@yaltaan/form';
import { array as list, number, object, string } from '@yaltaan/schema';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { getTestBed, TestBed } = await import('@angular/core/testing');
const { BrowserTestingModule, platformBrowserTesting } = await import('@angular/platform-browser/testing');
getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const injector = TestBed.inject(Injector);
const task = () => new Promise((resolve) => setTimeout(resolve, 0));

const schema = object({ lines: list(object({ label: string({ minLength: 1 }), quantity: number() })) });
const initial = () => ({
  lines: [
    { label: 'a', quantity: 1 },
    { label: '', quantity: 2 },
  ],
});

// Angular: a model signal and the schema at the root.
const model = signal(initial());
const angular = form(model, (path) => validateStandardSchema(path, schema), { injector });

// TanStack: the schema as the form's validator on change, a field for the list and one per label.
const tanstack = new FormApi({ defaultValues: initial(), validators: { onChange: schema } });
tanstack.mount();
const linesField = new FieldApi({ form: tanstack, name: 'lines' });
linesField.mount();
const labelFields = [0, 1, 2].map((index) => {
  const api = new FieldApi({ form: tanstack, name: `lines[${index}].label` });
  api.mount();
  return api;
});
const meta = (name) => tanstack.getFieldMeta(name) ?? {};

// Yaltaan: the same description, its items kept by the keys the form gives them.
const yaltaan = createForm(
  group({ lines: array(group({ label: field(''), quantity: field(0) }), { initial: initial().lines }) }, { schema }),
);
const lines = yaltaan.children.lines;
const [a, b] = lines.items.get();

// The first line touched; the second holds the issue of its empty label.
angular.lines[0].label().markAsTouched();
labelFields[0].handleBlur();
a.children.label.touch();
await tanstack.validate('change');
assert.deepEqual(
  angular.lines[1]
    .label()
    .errors()
    .map((error) => error.message),
  ['schema.too_short'],
);
assert.deepEqual(
  meta('lines[1].label').errors.map((error) => error.message ?? error),
  ['schema.too_short'],
);
assert.deepEqual(b.children.label.issues.get()[0].path, ['lines', { key: 1 }, 'label']);

// A move: the state of the line and its issue follow it in all three. Angular follows the very objects of its model,
// TanStack shifts what it keeps by index; Angular names an item by its index, which changes, and so does TanStack's
// field name; here the path of the item and of its issue keep its key.
model.update((value) => ({ lines: [value.lines[1], value.lines[0]] }));
linesField.moveValue(0, 1);
await task();
lines.move(a, 1);
assert.deepEqual([angular.lines[1].label().touched(), angular.lines[0].label().touched()], [true, false]);
assert.deepEqual([meta('lines[1].label').isTouched, meta('lines[0].label').isTouched], [true, false]);
assert.deepEqual([a.children.label.touched.get(), b.children.label.touched.get()], [true, false]);
assert.deepEqual(
  angular.lines[0]
    .label()
    .errors()
    .map((error) => error.message),
  ['schema.too_short'],
);
assert.equal(angular.lines[0]().keyInParent(), '0', 'Angular names the moved item by its new index');
assert.deepEqual(
  meta('lines[0].label').errors.map((error) => error.message ?? error),
  ['schema.too_short'],
);
assert.deepEqual(b.children.label.issues.get()[0].path, ['lines', { key: 1 }, 'label']);
assert.deepEqual(b.path, ['lines', { key: 1 }]);

// A list of new objects in the same order, as a server or a draft gives one back: Angular builds every item again and
// loses its state; TanStack keeps its state by index; the form keeps its items by position, or by the business key
// of `identity`.
model.set({ lines: model().lines.map((line) => ({ label: line.label, quantity: line.quantity })) });
lines.set(lines.raw.get().map((line) => ({ ...line })));
assert.equal(angular.lines[1].label().touched(), false);
assert.equal(meta('lines[1].label').isTouched, true);
assert.deepEqual([lines.items.get()[1], a.children.label.touched.get()], [a, true]);

// An insertion at the front: on return, TanStack's touched state still sits at its index, on the line that moved
// there; it shifts after a validation it awaits, which also marks the new line and every line after it touched. Here
// the items are in place when insert returns, the new one untouched, the others as they were.
const touchedLabels = () => [0, 1, 2].map((index) => meta(`lines[${index}].label`).isTouched);
linesField.insertValue(0, { label: 'n', quantity: 0 });
assert.deepEqual(touchedLabels(), [false, true, false]);
await task();
assert.deepEqual(touchedLabels(), [true, true, true]);
const added = lines.insert(0, { label: 'n', quantity: 0 });
assert.deepEqual([added.touched.get(), a.children.label.touched.get(), added.key], [false, true, 2]);

// A removal, and dirty: the form and TanStack's isDefaultValue compare values, so that a list back to its initial
// value is not dirty; TanStack's isDirty stays true once changed; Angular calls no write to its model dirty.
linesField.removeValue(0);
await task();
lines.remove(added);
lines.move(a, 0);
linesField.moveValue(0, 1);
await task();
assert.deepEqual(tanstack.state.values, initial());
assert.deepEqual([meta('lines').isDefaultValue, meta('lines').isDirty], [true, true]);
assert.deepEqual(lines.raw.get(), initial().lines);
assert.equal(lines.dirty.get(), false);
assert.equal(angular.lines().dirty(), false);

console.log('form-arrays: the form agrees with Angular Signal Forms 22.2.4 and TanStack Form 1.33.5 where it says so');
