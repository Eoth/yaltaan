// @yaltaan/angular in components rendered by TestBed over jsdom, without zone.js, OnPush: the pilot form of
// examples/pilot/ in two of them. One on Angular Signal Forms, the schema of the pilot through validateStandardSchema
// and its rules through validateRules; one on the pilot built with @yaltaan/form (live.ts), every state it shows read
// through signalsOf, a row component per contact. Every scenario of scenarios.ts is entered into both. The first holds,
// on every field, the errors that the schema and checkRules give for the same values, and is required where
// requiredPaths says; the second shows what the form says; both render it, and both change as a user types.
//
// Not judged here: the issues a scenario lists. Its values are entered as the form holds them, every input of a
// sub-form whether entered or not; the Angular model holds '' in an empty input and an empty sub-form as an object,
// which the schema of the pilot, written for values that leave it out, refuses: the reference is what the schema and
// the rules say of the values Angular holds. A pilot written for Angular would apply a sub-form's schema only while its
// box says so.
//
// Components are declared without decorators, `Component({...})(Class)`, and their inputs in the metadata, read in
// `ngOnInit`: the JIT compiler reads them so, with no transform of the compiler for signal inputs.
import '@angular/compiler';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { ChangeDetectionStrategy, Component, inject, Injector, signal } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { form, FormField, validateStandardSchema, type FieldState } from '@angular/forms/signals';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import type { KeySegment, Path } from '@yaltaan/core/path';
import type { ReadableNode } from '@yaltaan/core/reactive';
import { createForm, field, group, type FormNode } from '@yaltaan/form';
import { checkRules, requiredPaths } from '@yaltaan/rules';
import { stop, transform } from 'esbuild-wasm';
import { JSDOM } from 'jsdom';

import { applicationSchema, pilotRules } from '../../../examples/pilot/form.ts';
import { holding, liveSpec, type LiveForm, type LiveNode } from '../../../examples/pilot/live.ts';
import { scenarios } from '../../../examples/pilot/scenarios.ts';
import { fromNode, signalsOf, validateRules } from './index.ts';

const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
Object.assign(globalThis, { window, document: window.document, Node: window.Node });
getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

type Values = Record<PropertyKey, unknown>;
// A field of Angular's tree, walked by key: the pilot's values decide its shape.
interface Tree {
  (): FieldState<unknown>;
  readonly [key: PropertyKey]: Tree;
}
const treeOf = (fieldTree: unknown): Tree => fieldTree as Tree;

/** The index of the element a `{ key }` names, by the `key` field every list element of the pilot holds. */
const resolveKey = (segment: KeySegment, parent: Path, values: unknown): number | undefined => {
  const list = parent.reduce<unknown>((at, key) => (at as Values | undefined)?.[key as PropertyKey], values);
  return Array.isArray(list) ? list.findIndex((element) => (element as Values)?.['key'] === segment.key) : undefined;
};
/** The keys of a path of the pilot, each `{ key }` resolved in `values`; stops before one that names no element. */
const keysIn = (path: Path, values: unknown): PropertyKey[] => {
  const keys: PropertyKey[] = [];
  for (const segment of path) {
    const key =
      typeof segment === 'object' ? resolveKey(segment as KeySegment, path.slice(0, keys.length), values) : segment;
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
const landing = (values: unknown, keys: readonly PropertyKey[]): string => {
  const found: PropertyKey[] = [];
  let at = values;
  for (const key of keys) {
    if (typeof at !== 'object' || at === null || !Object.hasOwn(at, key) || (at as Values)[key] === undefined) {
      break;
    }
    found.push(key);
    at = (at as Values)[key];
  }
  return found.join('.');
};
/** Every field of the tree, by the dotted path of its keys, walking the value it holds. */
const labels = (
  tree: Tree,
  value: unknown,
  keys: readonly string[] = [],
  found: Map<unknown, string> = new Map(),
): Map<unknown, string> => {
  found.set(tree, keys.join('.'));
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      if (tree[key] !== undefined) {
        labels(tree[key], (value as Values)[key], [...keys, key], found);
      }
    }
  }
  return found;
};

/**
 * `value` as an Angular model holds it: '' in each input left empty, where the form holds `undefined`, since Signal
 * Forms makes no field of a key whose value is `undefined`.
 */
const defined = (value: unknown): unknown =>
  value === undefined
    ? ''
    : Array.isArray(value)
      ? value.map(defined)
      : typeof value === 'object' && value !== null
        ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, defined(entry)]))
        : value;

// The rendered fields: the identity of the company and the bank, and each contact's email.
const RENDERED: readonly (readonly string[])[] = [
  ['company', 'legalName'],
  ['company', 'country'],
  ['company', 'siren'],
  ['company', 'foreignRegistration'],
  ['company', 'vatNumber'],
  ['bank', 'iban'],
  ['bank', 'bic'],
];
const idOf = (path: readonly string[]): string => path.join('-');

class SignalFormsPilot {
  static today = '';
  static values: unknown = {};
  model = signal<unknown>(SignalFormsPilot.values);
  pilot = form(this.model, (path) => {
    validateStandardSchema(path, applicationSchema as never);
    validateRules(path, pilotRules(SignalFormsPilot.today), { resolveKey });
  });
}
const fieldTemplate = (path: readonly string[], read: string): string =>
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

// An input declared in the metadata: the row reads its item's states once the input is set, and keeps them for its
// life, the item kept by its key.
class ContactRow {
  item: FormNode<unknown, unknown> | undefined = undefined;
  injector = inject(Injector);
  view: unknown = undefined;
  ngOnInit(): void {
    this.view = signalsOf(this.item!, { injector: this.injector });
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
const liveTemplate = (path: readonly string[]): string => {
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

const texts = (root: ParentNode, selector: string): (string | null)[] =>
  [...root.querySelectorAll(selector)].map((element) => element.textContent);
const type = async (fixture: ComponentFixture<unknown>, element: Element | null, value: string): Promise<void> => {
  (element as HTMLInputElement).value = value;
  element!.dispatchEvent(new window.Event('input'));
  await fixture.whenStable();
};
const sorted = (list: readonly unknown[]): unknown[] => [...list].sort();
const liveOf = (fixture: ComponentFixture<LivePilot>): LiveForm =>
  fixture.componentInstance.live as unknown as LiveForm;
const nodeAt = (form: LiveNode, path: readonly string[]): LiveNode =>
  path.reduce((at, key) => at.children![key]!, form);

test('a state read once its component is destroyed: refused, and nothing left subscribed', () => {
  const Host = class {};
  Component({ selector: 'bridge-host', template: '' })(Host);
  const fixture = TestBed.createComponent(Host);
  const { injector } = fixture.componentRef;
  let active = 0;
  // A node whose states count the subscriptions they hold, its children likewise.
  const counted = <N extends object>(node: N): N =>
    new Proxy(node, {
      get: (target, key) => {
        const value: unknown = Reflect.get(target, key);
        if (key === 'children') {
          const children = Object.entries(value as Record<string, object>);
          return Object.fromEntries(children.map(([name, at]) => [name, counted(at)]));
        }
        if (typeof value !== 'object' || value === null || !('subscribe' in value)) {
          return value;
        }
        const state = value as ReadableNode<unknown>;
        return {
          get: () => state.get(),
          subscribe: (listener: () => void) => {
            active += 1;
            const stop = state.subscribe(listener);
            return () => {
              active -= 1;
              stop();
            };
          },
        };
      },
    });
  const yaltaan = () =>
    createForm(group({ note: field(''), total: field('', { readonly: { reads: [], when: () => true } }) }));
  const view = signalsOf(counted(yaltaan()), { injector });
  fixture.destroy();
  assert.throws(() => view.children.total.readonly(), /NG0911/);
  assert.throws(() => fromNode(counted(yaltaan()).children.note.dirty, { injector }), /NG0911/);
  assert.equal(active, 0, 'nothing subscribed for a destroyed component');
});

test('the pilot runs in Angular, on Signal Forms through validateRules and on the form through signalsOf', async () => {
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
    const pilot = treeOf(fixture.componentInstance.pilot);
    const named = labels(pilot, values);
    const read = applicationSchema['~standard'].validate(values) as {
      readonly issues?: readonly { readonly message: string; readonly path?: readonly PropertyKey[] }[];
    };
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
        .map((path) => [path, keysIn(path, values)] as const)
        .filter(([path, keys]) => keys.length === path.length)
        .map(([, keys]) => keys.join('.')),
    );
    for (const [fieldTree, label] of named) {
      assert.equal(treeOf(fieldTree)().required(), required.has(label), `${scenario.name}: required of ${label}`);
    }
    const page = fixture.nativeElement as HTMLElement;
    for (const path of RENDERED) {
      const state = path.reduce((tree, key) => tree[key]!, pilot)();
      assert.deepEqual(
        texts(page, `#${idOf(path)}-errors li`),
        state.errors().map((error) => error.message),
        `${scenario.name}: ${idOf(path)} in the page`,
      );
      assert.equal(page.querySelector(`#${idOf(path)}`)!.hasAttribute('required'), state.required());
    }
    (((values as Values)['contacts'] as unknown[] | undefined) ?? []).forEach((_, index) =>
      assert.deepEqual(
        texts(page, `#contact-${index}-errors li`),
        pilot['contacts']![index]!['email']!()
          .errors()
          .map((error) => error.message),
      ),
    );
    fixture.destroy();

    // The form, through signalsOf: what each rendered node shows, before and after a submission.
    LivePilot.today = scenario.today;
    const live = TestBed.createComponent(LivePilot);
    await live.whenStable();
    const liveForm = liveOf(live);
    liveForm.set(held);
    liveForm.submit();
    await live.whenStable();
    const livePage = live.nativeElement as HTMLElement;
    for (const path of RENDERED) {
      const node = nodeAt(liveForm, path);
      assert.deepEqual(
        texts(livePage, `#${idOf(path)}-errors li`),
        node.issues.get().map((issue) => issue.code),
        `${scenario.name}: ${idOf(path)} of the form in the page`,
      );
      assert.equal(
        livePage.querySelector(`#${idOf(path)}`)!.getAttribute('aria-required'),
        String(node.required.get()),
      );
    }
    assert.deepEqual(
      [...livePage.querySelectorAll('contact-row')].map((row) => texts(row, '.email-errors li')),
      nodeAt(liveForm, ['contacts'])
        .items!.get()
        .map((item) => item.children!['email']!.issues.get().map((issue) => issue.code)),
    );
    assert.equal(livePage.querySelector('#submitted')?.textContent, 'submitted');
    live.destroy();
    compared += 1;
  }
  assert.equal(compared, scenarios.length);
  assert.ok(compared >= 46, `${compared} scenarios`);
});

test('a SIREN typed clears what the rules said of it, in both; an email typed in a row reaches its node', async () => {
  const french = scenarios.find(
    (scenario) => (scenario.values as Values & { company?: Values }).company?.['country'] === 'FR',
  )!;
  const company = (french.values as { readonly company: Values }).company;
  const held = holding(liveSpec(french.today), { ...french.values, company: { ...company, siren: '' } });
  SignalFormsPilot.today = french.today;
  SignalFormsPilot.values = defined(held);
  const fixture = TestBed.createComponent(SignalFormsPilot);
  await fixture.whenStable();
  const page = fixture.nativeElement as HTMLElement;
  assert.ok(texts(page, '#company-siren-errors li').includes('rules.required_if'));
  assert.equal(page.querySelector('#company-siren')!.hasAttribute('required'), true);
  await type(fixture, page.querySelector('#company-siren'), '732829320');
  assert.deepEqual(texts(page, '#company-siren-errors li'), []);
  assert.equal(((fixture.componentInstance.model() as Values)['company'] as Values)['siren'], '732829320');
  fixture.destroy();

  LivePilot.today = french.today;
  const live = TestBed.createComponent(LivePilot);
  const liveForm = liveOf(live);
  liveForm.set(held);
  await live.whenStable();
  const livePage = live.nativeElement as HTMLElement;
  assert.ok(texts(livePage, '#company-siren-errors li').includes('rules.required_if'));
  await type(live, livePage.querySelector('#company-siren'), '732829320');
  assert.deepEqual(texts(livePage, '#company-siren-errors li'), []);
  const [first] = nodeAt(liveForm, ['contacts']).items!.get();
  await type(live, livePage.querySelector('contact-row .email'), 'not an email');
  assert.equal(first!.children!['email']!.raw.get(), 'not an email');
  live.destroy();
});

// The example of the README, as an application writes it, with a decorator: compiled by esbuild with the decorators
// Angular reads, into a folder of the workspace, where Node finds Angular and the packages, then rendered.
const readme = path.join(import.meta.dirname, '..', 'README.md');
const cache = path.join(import.meta.dirname, '..', '..', '..', 'node_modules', '.cache');
const written: string[] = [];
after(async () => {
  for (const folder of written) {
    rmSync(folder, { recursive: true, force: true });
  }
  await stop();
});

test('the example of the README renders what the README says, and a SIREN typed clears its error', async () => {
  const lines = readFileSync(readme, 'utf8').split('\n');
  const start = lines.indexOf('```ts angular');
  const end = lines.indexOf('```', start + 1);
  assert.ok(start !== -1 && end !== -1, 'the README holds an example fenced ```ts angular');
  const { code } = await transform(lines.slice(start + 1, end).join('\n'), {
    loader: 'ts',
    format: 'esm',
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
  });
  mkdirSync(cache, { recursive: true });
  const folder = mkdtempSync(path.join(cache, 'yaltaan-angular-readme-'));
  written.push(folder);
  const file = path.join(folder, 'supplier.mjs');
  writeFileSync(file, code);
  const { Supplier } = (await import(pathToFileURL(file).href)) as { Supplier: new () => unknown };
  const fixture = TestBed.createComponent(Supplier);
  await fixture.whenStable();
  const page = fixture.nativeElement as HTMLElement;
  const instance = fixture.componentInstance as { readonly supplier: unknown; readonly model: () => Values };
  const supplier = treeOf(instance.supplier);
  assert.deepEqual(texts(page, '#siren-errors li'), ['rules.required_if']);
  assert.equal(page.querySelector('#siren')!.hasAttribute('required'), true);
  assert.equal(page.querySelector('#siren')!.getAttribute('aria-invalid'), 'true');
  assert.equal(page.querySelector('#siren-errors')!.getAttribute('aria-live'), 'polite');
  assert.deepEqual(
    supplier['contract']!['signedOn']!()
      .errors()
      .map((error) => error.kind),
    ['rules.all_or_none'],
  );
  await type(fixture, page.querySelector('#siren'), '732829320');
  assert.deepEqual(texts(page, '#siren-errors li'), []);
  assert.equal(page.querySelector('#siren')!.getAttribute('aria-invalid'), 'false');
  assert.equal(instance.model()['siren'], '732829320');
  fixture.destroy();
});
