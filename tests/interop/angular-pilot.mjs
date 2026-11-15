// The pilot form of examples/pilot/ in an Angular application, rendered by TestBed over jsdom without zone.js, its
// components OnPush: one on Angular Signal Forms, the schema of the pilot through validateStandardSchema and its rules
// through validateRules of the bridge (angular-bridge.ts, ADR 0048); one on the pilot built with @yaltaan/form
// (live.ts), every state it shows read through signalsOf, a row component per contact. Every scenario of scenarios.ts
// is entered into both. The first holds, on every field, the errors that the schema and checkRules give for the same
// values, and is required where requiredPaths says; the second shows what the form says; both render it, and both
// change as a user types. Run by tests/interop/run.sh, which copies the pilot beside this file.
//
// Not judged here: the issues a scenario lists. Its values are entered as the form holds them, every input of a
// sub-form whether entered or not; the Angular model holds '' in an empty input and an empty sub-form as an object,
// which the schema of the pilot, written for values that leave it out, refuses: the reference is what the schema and
// the rules say of the values Angular holds. A pilot written for Angular would apply a sub-form's schema only while its
// box says so.
import '@angular/compiler';
import assert from 'node:assert/strict';

import { ChangeDetectionStrategy, Component, inject, Injector, signal } from '@angular/core';
import { FormField, form, validateStandardSchema } from '@angular/forms/signals';
import { createForm } from '@yaltaan/form';
import { checkRules, requiredPaths } from '@yaltaan/rules';
import { JSDOM } from 'jsdom';

import { signalsOf, validateRules } from './angular-bridge.ts';
import { applicationSchema, pilotRules } from './form.ts';
import { holding, liveSpec } from './live.ts';
import { scenarios } from './scenarios.ts';

const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
Object.assign(globalThis, { window, document: window.document, Node: window.Node });
const { getTestBed, TestBed } = await import('@angular/core/testing');
const { BrowserTestingModule, platformBrowserTesting } = await import('@angular/platform-browser/testing');
getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

/** The index of the element a `{ key }` names, by the `key` field every list element of the pilot holds. */
const resolveKey = (segment, parent, values) => {
  const list = parent.reduce((at, key) => at?.[key], values);
  return Array.isArray(list) ? list.findIndex((element) => element?.key === segment.key) : undefined;
};
/** The keys of a path of the pilot, each `{ key }` resolved in `values`; stops before one that names no element. */
const keysIn = (path, values) => {
  const keys = [];
  for (const segment of path) {
    const key = typeof segment === 'object' ? resolveKey(segment, path.slice(0, keys.length), values) : segment;
    if (key === undefined || key === -1) {
      break;
    }
    keys.push(key);
  }
  return keys;
};
/**
 * Where an issue lands, by the values alone, apart from the bridge's walk through the fields: the deepest key on the
 * way of `keys`, since Signal Forms holds a field for each own key whose value is not `undefined`.
 */
const landing = (values, keys) => {
  const path = [];
  let at = values;
  for (const key of keys) {
    if (typeof at !== 'object' || at === null || !Object.hasOwn(at, key) || at[key] === undefined) {
      break;
    }
    path.push(key);
    at = at[key];
  }
  return path.join('.');
};
/** Every field of the tree, by the dotted path of its keys, walking the value it holds. */
const labels = (tree, value, path = [], found = new Map()) => {
  found.set(tree, path.join('.'));
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      if (tree[key] !== undefined) {
        labels(tree[key], value[key], [...path, key], found);
      }
    }
  }
  return found;
};

/**
 * `value` as an Angular model holds it: '' in each input left empty, where the form holds `undefined`, since Signal
 * Forms makes no field of a key whose value is `undefined`.
 */
const defined = (value) =>
  value === undefined
    ? ''
    : Array.isArray(value)
      ? value.map(defined)
      : typeof value === 'object' && value !== null
        ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, defined(entry)]))
        : value;

// The rendered fields: the identity of the company and the bank, and each contact's email.
const RENDERED = [
  ['company', 'legalName'],
  ['company', 'country'],
  ['company', 'siren'],
  ['company', 'foreignRegistration'],
  ['company', 'vatNumber'],
  ['bank', 'iban'],
  ['bank', 'bic'],
];
const idOf = (path) => path.join('-');

class SignalFormsPilot {
  static today = '';
  static values = {};
  model = signal(SignalFormsPilot.values);
  pilot = form(this.model, (path) => {
    validateStandardSchema(path, applicationSchema);
    validateRules(path, pilotRules(SignalFormsPilot.today), { resolveKey });
  });
}
const fieldTemplate = (path, read) =>
  `<label for="${idOf(path)}">${path.at(-1)}</label>
  <input id="${idOf(path)}" [formField]="${read}" [attr.aria-invalid]="${read}().invalid()"
    aria-describedby="${idOf(path)}-errors" />
  <ul id="${idOf(path)}-errors">@for (error of ${read}().errors(); track $index) {<li>{{ error.message }}</li>}</ul>`;
Component({
  selector: 'signal-forms-pilot',
  imports: [FormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<form novalidate>
  ${RENDERED.map((path) => fieldTemplate(path, `pilot.${path.join('.')}`)).join('\n  ')}
  @for (contact of pilot.contacts; track $index) {
    <input [id]="'contact-' + $index" [formField]="contact.email"
      [attr.aria-describedby]="'contact-' + $index + '-errors'" />
    <ul [id]="'contact-' + $index + '-errors'">
      @for (error of contact.email().errors(); track $index) {<li>{{ error.message }}</li>}
    </ul>
  }
</form>`,
})(SignalFormsPilot);

// An input declared in the metadata, as JIT reads it without the compiler's transform of signal inputs: the row reads
// its item's states once the input is set, and keeps them for its life, the item kept by its key.
class ContactRow {
  item = undefined;
  injector = inject(Injector);
  view = undefined;
  ngOnInit() {
    this.view = signalsOf(this.item, { injector: this.injector });
  }
}
Component({
  selector: 'contact-row',
  inputs: ['item'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<input class="email" [value]="view.children.email.raw() ?? ''"
    (input)="item.children.email.set($any($event.target).value)"
    [attr.aria-required]="view.children.email.required()" />
  <ul class="email-errors">
    @for (issue of view.children.email.issues(); track $index) {<li>{{ issue.code }}</li>}
  </ul>`,
})(ContactRow);

class LivePilot {
  static today = '';
  live = createForm(liveSpec(LivePilot.today));
  fields = signalsOf(this.live);
}
const liveTemplate = (path) => {
  const read = `fields.${path.map((key) => `children.${key}`).join('.')}`;
  const node = `live.${path.map((key) => `children.${key}`).join('.')}`;
  return `<input id="${idOf(path)}" [value]="${read}.raw() ?? ''" (input)="${node}.set($any($event.target).value)"
    [attr.aria-required]="${read}.required()" aria-describedby="${idOf(path)}-errors" />
  <ul id="${idOf(path)}-errors">@for (issue of ${read}.issues(); track $index) {<li>{{ issue.code }}</li>}</ul>`;
};
Component({
  selector: 'live-pilot',
  imports: [ContactRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<form novalidate>
  ${RENDERED.map(liveTemplate).join('\n  ')}
  @for (item of fields.children.contacts.items(); track item.key) {<contact-row [item]="item" />}
  @if (fields.submitted()) {<p id="submitted">submitted</p>}
</form>`,
})(LivePilot);

const texts = (root, selector) => [...root.querySelectorAll(selector)].map((element) => element.textContent);
const type = async (fixture, element, value) => {
  element.value = value;
  element.dispatchEvent(new window.Event('input'));
  await fixture.whenStable();
};
const sorted = (list) => [...list].sort();
let compared = 0;

for (const scenario of scenarios) {
  const spec = liveSpec(scenario.today);
  const held = holding(spec, scenario.values);
  const values = defined(held);
  const rules = pilotRules(scenario.today);

  // Signal Forms: every error, schema and rules, on the field it names; the rendered ones in the page.
  SignalFormsPilot.today = scenario.today;
  SignalFormsPilot.values = values;
  const fixture = TestBed.createComponent(SignalFormsPilot);
  await fixture.whenStable();
  const { pilot } = fixture.componentInstance;
  const named = labels(pilot, values);
  const read = applicationSchema['~standard'].validate(values);
  const expected = [
    ...(read.issues ?? []).map((issue) => `${landing(values, issue.path ?? [])} ${issue.message}`),
    ...checkRules(rules, values)
      .filter((issue) => issue.severity !== 'warning')
      .map((issue) => `${landing(values, keysIn(issue.path, values))} ${issue.code}`),
  ];
  const shown = pilot()
    .errorSummary()
    .map((error) => `${named.get(error.fieldTree)} ${error.message}`);
  assert.deepEqual(sorted(shown), sorted(expected), scenario.name);
  const required = new Set(
    requiredPaths(rules, values)
      .map((path) => [path, keysIn(path, values)])
      .filter(([path, keys]) => keys.length === path.length)
      .map(([, keys]) => keys.join('.')),
  );
  for (const [field, label] of named) {
    assert.equal(field().required(), required.has(label), `${scenario.name}: required of ${label}`);
  }
  const page = fixture.nativeElement;
  for (const path of RENDERED) {
    const state = path.reduce((tree, key) => tree[key], pilot)();
    assert.deepEqual(
      texts(page, `#${idOf(path)}-errors li`),
      state.errors().map((error) => error.message),
      `${scenario.name}: ${idOf(path)} in the page`,
    );
    assert.equal(page.querySelector(`#${idOf(path)}`).hasAttribute('required'), state.required());
  }
  (values.contacts ?? []).forEach((_, index) =>
    assert.deepEqual(
      texts(page, `#contact-${index}-errors li`),
      pilot.contacts[index]
        .email()
        .errors()
        .map((error) => error.message),
    ),
  );
  fixture.destroy();

  // The form, through signalsOf: what each rendered node shows, before and after a submission.
  LivePilot.today = scenario.today;
  const live = TestBed.createComponent(LivePilot);
  await live.whenStable();
  const { live: liveForm } = live.componentInstance;
  liveForm.set(held);
  liveForm.submit();
  await live.whenStable();
  const livePage = live.nativeElement;
  for (const path of RENDERED) {
    const node = path.reduce((at, key) => at.children[key], liveForm);
    assert.deepEqual(
      texts(livePage, `#${idOf(path)}-errors li`),
      node.issues.get().map((issue) => issue.code),
      `${scenario.name}: ${idOf(path)} of the form in the page`,
    );
    assert.equal(livePage.querySelector(`#${idOf(path)}`).getAttribute('aria-required'), String(node.required.get()));
  }
  assert.deepEqual(
    [...livePage.querySelectorAll('contact-row')].map((row) => texts(row, '.email-errors li')),
    liveForm.children.contacts.items.get().map((item) => item.children.email.issues.get().map((issue) => issue.code)),
  );
  assert.equal(livePage.querySelector('#submitted')?.textContent, 'submitted');
  live.destroy();
  compared += 1;
}

{
  // Typing: a SIREN entered for a French company clears what the rules said of the field, in both; an email typed
  // into a contact's row reaches its node, and what the form says of it.
  const french = scenarios.find((scenario) => scenario.values.company?.country === 'FR');
  const held = holding(liveSpec(french.today), {
    ...french.values,
    company: { ...french.values.company, siren: '' },
  });
  SignalFormsPilot.today = french.today;
  SignalFormsPilot.values = defined(held);
  const fixture = TestBed.createComponent(SignalFormsPilot);
  await fixture.whenStable();
  const page = fixture.nativeElement;
  assert.ok(texts(page, '#company-siren-errors li').includes('rules.required_if'));
  assert.equal(page.querySelector('#company-siren').hasAttribute('required'), true);
  await type(fixture, page.querySelector('#company-siren'), '732829320');
  assert.deepEqual(texts(page, '#company-siren-errors li'), []);
  assert.equal(fixture.componentInstance.model().company.siren, '732829320');
  fixture.destroy();

  LivePilot.today = french.today;
  const live = TestBed.createComponent(LivePilot);
  const { live: liveForm } = live.componentInstance;
  liveForm.set(held);
  await live.whenStable();
  const livePage = live.nativeElement;
  assert.ok(texts(livePage, '#company-siren-errors li').includes('rules.required_if'));
  await type(live, livePage.querySelector('#company-siren'), '732829320');
  assert.deepEqual(texts(livePage, '#company-siren-errors li'), []);
  const [first] = liveForm.children.contacts.items.get();
  const email = livePage.querySelector('contact-row .email');
  await type(live, email, 'not an email');
  assert.equal(first.children.email.raw.get(), 'not an email');
  live.destroy();
}

console.log(
  `angular-pilot: the pilot runs in Angular 22.2.4, on Signal Forms through validateRules and on the form through ` +
    `signalsOf, for its ${compared} scenarios`,
);
