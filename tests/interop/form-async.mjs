// The validators of the application in @yaltaan/form beside the asynchronous validators of Angular Signal Forms and
// TanStack Form, the references of its behaviour (ADR 0045): the same runs on the three engines, each asserted on each,
// where they agree (a new value aborts the run in flight, whose answer never counts; no run on a value a synchronous
// rule or a schema above rejects; pending while a run is in flight; a removed item aborts its run; a delay that only
// the last value outlives) and where the form departs on purpose (nothing runs before a state is read; a rejection is
// `form.validation_failed`, its reason as cause), so that a reference that changes its behaviour is seen here. Run by
// tests/interop/run.sh, from the tarballs an application would install.
import '@angular/compiler';
import assert from 'node:assert/strict';

import { Injector, resource, signal } from '@angular/core';
import { applyEach, form, validateAsync, validateStandardSchema } from '@angular/forms/signals';
import { FieldApi, FormApi } from '@tanstack/form-core';
import { array, createForm, field, group } from '@yaltaan/form';
import { array as list, object, string } from '@yaltaan/schema';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
Object.assign(globalThis, { window, document: window.document });
const { getTestBed, TestBed } = await import('@angular/core/testing');
const { BrowserTestingModule, platformBrowserTesting } = await import('@angular/platform-browser/testing');
getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const injector = TestBed.inject(Injector);
const task = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => {
  for (let round = 0; round < 3; round++) {
    TestBed.tick();
    await task();
  }
};

/** A server whose answers the script gives: each call's engine, value and signal, and the function that answers it. */
function server() {
  const calls = [];
  const call = (engine) => (value, signal) =>
    new Promise((resolve, reject) => {
      const entry = { engine, value, signal, resolve, reject };
      calls.push(entry);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  const of = (engine) => calls.filter((entry) => entry.engine === engine);
  return { call, of };
}

const name = string({ minLength: 3 });

// 1. A new value aborts the run in flight, whose answer never counts, even when it comes last; pending meanwhile.
{
  const { call, of } = server();
  const model = signal({ login: 'ada' });
  const angular = form(
    model,
    (path) =>
      validateAsync(path.login, {
        params: ({ value }) => value(),
        factory: (params) =>
          resource({ params, loader: ({ params: value, abortSignal }) => call('angular')(value, abortSignal) }),
        onSuccess: (taken) => (taken ? { kind: taken } : undefined),
        onError: () => ({ kind: 'failed' }),
      }),
    { injector },
  );
  const tanstack = new FormApi({ defaultValues: { login: 'ada' } });
  tanstack.mount();
  const login = new FieldApi({
    form: tanstack,
    name: 'login',
    validators: { onChangeAsync: ({ value, signal }) => call('tanstack')(value, signal) },
  });
  login.mount();
  const yaltaan = createForm(
    group({ login: field('ada', { validate: (value, { signal }) => call('yaltaan')(value, signal) }) }),
  );

  await settle();
  // The initial value: Angular asks at once, TanStack only on a change, the form once a state needs the answer.
  assert.deepEqual([of('angular').length, of('tanstack').length, of('yaltaan').length], [1, 0, 0]);
  yaltaan.children.login.pending.subscribe(() => undefined);
  assert.equal(of('yaltaan').length, 1);

  for (const value of ['grace', 'linus']) {
    angular.login().value.set(value);
    login.handleChange(value);
    yaltaan.children.login.set(value);
    await settle();
  }
  for (const engine of ['angular', 'tanstack', 'yaltaan']) {
    const runs = of(engine);
    const last = runs.at(-1);
    assert.equal(last.value, 'linus', engine);
    assert.ok(
      runs.slice(0, -1).every((run) => run.signal.aborted),
      `${engine}: every run before the last is aborted`,
    );
    assert.equal(last.signal.aborted, false, engine);
  }
  // TanStack counts its runs down when an aborted one rejects, as `fetch` does: it says it is not validating while
  // its last run is in flight. Angular and the form are pending.
  assert.deepEqual(
    [angular.login().pending(), login.state.meta.isValidating, yaltaan.children.login.pending.get()],
    [true, false, true],
  );
  // The last run answers, then a stale one, which none of them shows.
  for (const engine of ['angular', 'tanstack', 'yaltaan']) {
    of(engine)
      .at(-1)
      .resolve(engine === 'yaltaan' ? [{ code: 'app.taken', path: [] }] : 'taken');
    of(engine)
      .at(-2)
      .resolve(engine === 'yaltaan' ? [{ code: 'app.stale', path: [] }] : 'stale');
  }
  await settle();
  assert.deepEqual(
    angular
      .login()
      .errors()
      .map((error) => error.kind),
    ['taken'],
  );
  assert.deepEqual(login.state.meta.errors, ['taken']);
  assert.deepEqual(
    yaltaan.children.login.issues.get().map((issue) => issue.code),
    ['app.taken'],
  );
  assert.deepEqual(
    [angular.login().pending(), login.state.meta.isValidating, yaltaan.children.login.pending.get()],
    [false, false, false],
  );
}

// 2. No run on a value that a synchronous rule of the field, or a schema of the whole form, rejects.
{
  const { call, of } = server();
  const model = signal({ login: 'x', other: '' });
  const schema = object({ login: name, other: string() });
  const angular = form(
    model,
    (path) => {
      validateStandardSchema(path, schema);
      validateAsync(path.login, {
        params: ({ value }) => value(),
        factory: (params) =>
          resource({ params, loader: ({ params: value, abortSignal }) => call('angular')(value, abortSignal) }),
        onSuccess: () => undefined,
        onError: () => undefined,
      });
    },
    { injector },
  );
  const tanstack = new FormApi({ defaultValues: { login: 'x', other: '' }, validators: { onChange: schema } });
  tanstack.mount();
  const login = new FieldApi({
    form: tanstack,
    name: 'login',
    validators: { onChangeAsync: ({ value, signal }) => call('tanstack')(value, signal) },
  });
  login.mount();
  const yaltaan = createForm(
    group(
      { login: field('x', { validate: (value, { signal }) => call('yaltaan')(value, signal) }), other: field('') },
      { schema },
    ),
  );
  yaltaan.pending.subscribe(() => undefined);
  for (const value of ['y', 'ok']) {
    angular.login().value.set(value);
    login.handleChange(value);
    yaltaan.children.login.set(value);
    await settle();
  }
  assert.deepEqual([of('angular').length, of('tanstack').length, of('yaltaan').length], [0, 0, 0]);
  assert.deepEqual(
    [angular.login().pending(), login.state.meta.isValidating, yaltaan.children.login.pending.get()],
    [false, false, false],
  );
  // Valid at last: each asks once.
  angular.login().value.set('grace');
  login.handleChange('grace');
  yaltaan.children.login.set('grace');
  await settle();
  assert.deepEqual(
    [of('angular'), of('tanstack'), of('yaltaan')].map((runs) => runs.map((run) => run.value)),
    [['grace'], ['grace'], ['grace']],
  );
  // Invalid again: TanStack and the form abort the run in flight; Angular's resource goes idle and only discards what
  // the load in flight answers, which keeps the server busy.
  angular.login().value.set('g');
  login.handleChange('g');
  yaltaan.children.login.set('g');
  await settle();
  assert.deepEqual(
    [of('angular'), of('tanstack'), of('yaltaan')].map((runs) => runs[0].signal.aborted),
    [false, true, true],
  );
  assert.deepEqual(
    [angular.login().pending(), login.state.meta.isValidating, yaltaan.children.login.pending.get()],
    [false, false, false],
  );
}

// 3. A removed item aborts its run: Angular's orphaned field, TanStack's unmounted one, the form's removed item.
{
  const { call, of } = server();
  const model = signal({ lines: [{ sku: 'A1' }, { sku: 'B2' }] });
  const angular = form(
    model,
    (path) =>
      applyEach(path.lines, (line) =>
        validateAsync(line.sku, {
          params: ({ value }) => value(),
          factory: (params) =>
            resource({ params, loader: ({ params: value, abortSignal }) => call('angular')(value, abortSignal) }),
          onSuccess: () => undefined,
          onError: () => undefined,
        }),
      ),
    { injector },
  );
  const tanstack = new FormApi({ defaultValues: { lines: [{ sku: 'A1' }, { sku: 'B2' }] } });
  tanstack.mount();
  const sku = new FieldApi({
    form: tanstack,
    name: 'lines[0].sku',
    validators: { onChangeAsync: ({ value, signal }) => call('tanstack')(value, signal) },
  });
  const unmount = sku.mount();
  const yaltaan = createForm(
    array(group({ sku: field('', { validate: (value, { signal }) => call('yaltaan')(value, signal) }) }), {
      initial: [{ sku: 'A1' }, { sku: 'B2' }],
    }),
  );
  await settle();
  sku.handleChange('A1');
  yaltaan.pending.subscribe(() => undefined);
  await settle();
  const first = (engine) => of(engine).find((run) => run.value === 'A1');
  assert.ok(first('angular') && first('tanstack') && first('yaltaan'));
  model.set({ lines: [{ sku: 'B2' }] });
  unmount();
  yaltaan.remove(yaltaan.items.get()[0]);
  await settle();
  assert.deepEqual(
    ['angular', 'tanstack', 'yaltaan'].map((engine) => first(engine).signal.aborted),
    [true, true, true],
  );
}

// 4. A rejection: Angular's onError and TanStack's error are what the application makes of it; the form places
// form.validation_failed, the reason as cause.
{
  const reason = new Error('server unreachable');
  const tanstack = new FormApi({ defaultValues: { login: '' } });
  tanstack.mount();
  const login = new FieldApi({
    form: tanstack,
    name: 'login',
    validators: { onChangeAsync: () => Promise.reject(reason) },
  });
  login.mount();
  const yaltaan = createForm(field('', { validate: () => Promise.reject(reason) }));
  login.handleChange('ada');
  yaltaan.set('ada');
  yaltaan.pending.get();
  await settle();
  assert.deepEqual(login.state.meta.errors, [reason]);
  assert.deepEqual(yaltaan.issues.get(), [{ code: 'form.validation_failed', path: [], cause: reason }]);
}

// 5. A delay: TanStack's onChangeAsyncDebounceMs and Angular's debounce, a delay honouring the signal in the form's
// validator; each is validating during the delay, and only the last value reaches the server.
{
  const { call, of } = server();
  const model = signal({ login: '' });
  const angular = form(
    model,
    (path) =>
      validateAsync(path.login, {
        params: ({ value }) => value() || undefined,
        debounce: 30,
        factory: (params) =>
          resource({ params, loader: ({ params: value, abortSignal }) => call('angular')(value, abortSignal) }),
        onSuccess: () => undefined,
        onError: () => undefined,
      }),
    { injector },
  );
  const tanstack = new FormApi({ defaultValues: { login: '' } });
  tanstack.mount();
  const login = new FieldApi({
    form: tanstack,
    name: 'login',
    validators: { onChangeAsyncDebounceMs: 30, onChangeAsync: ({ value, signal }) => call('tanstack')(value, signal) },
  });
  login.mount();
  const delay = (ms, signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
    });
  const yaltaan = createForm(
    field('', {
      validate: async (value, { signal }) => {
        if (!value) {
          return [];
        }
        await delay(30, signal);
        return call('yaltaan')(value, signal);
      },
    }),
  );
  yaltaan.pending.subscribe(() => undefined);
  for (const value of ['a', 'ad', 'ada']) {
    angular.login().value.set(value);
    login.handleChange(value);
    yaltaan.set(value);
    TestBed.tick();
    await task(5);
  }
  assert.deepEqual([login.state.meta.isValidating, yaltaan.pending.get()], [true, true]);
  await task(60);
  await settle();
  // Angular's debounce lets the first value through at once, then waits: its server sees two values.
  assert.deepEqual(
    [of('angular'), of('tanstack'), of('yaltaan')].map((runs) => runs.map((run) => run.value)),
    [['a', 'ada'], ['ada'], ['ada']],
  );
  assert.equal(of('angular')[0].signal.aborted, true);
}

console.log('form async: Angular Signal Forms, TanStack Form and @yaltaan/form agree where the record says');
