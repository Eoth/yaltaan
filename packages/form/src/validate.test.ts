// Examples of the validators of the application (ADR 0045): when one runs, what its signal says, where its issues go,
// what a removed item does, and what the laws of properties.test.ts leave to examples: a schema of @yaltaan/schema in
// front of a validator, laziness, a validator that throws, whose answer throws or that never settles, the delay of a
// debounce, what a listener of the signal may do, and the writes of a user typing elsewhere under a schema that answers
// later.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Issue } from '@yaltaan/core/issue';
import { array as list, object, string, type StandardResult, type StandardSchema } from '@yaltaan/schema';

import { array, createForm, field, group, type FormNode, type Validation } from './index.ts';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const codes = (node: FormNode<unknown, unknown>): string[] => node.issues.get().map((issue) => issue.code);

const issue = (code: string, path: Issue['path'] = []): Issue => ({ code, path });

/** A validator whose runs the test answers: each run's value, its signal, and the functions that settle it. */
function server(): {
  readonly validate: (value: unknown, validation: Validation) => Promise<readonly Issue[]>;
  readonly runs: {
    readonly value: unknown;
    readonly signal: AbortSignal;
    readonly path: Validation['path'];
    readonly answer: (issues: readonly Issue[]) => void;
    readonly fail: (reason: unknown) => void;
  }[];
} {
  const runs: ReturnType<typeof server>['runs'] = [];
  return {
    runs,
    validate: (value, { signal, path }) =>
      new Promise((answer, fail) => {
        runs.push({ value, signal, path, answer, fail });
      }),
  };
}

/** A Standard Schema whose answers the test gives, each by a call of the function it records. */
function deferred(answer: (value: unknown) => StandardResult<unknown>): {
  readonly schema: StandardSchema;
  readonly settle: (() => void)[];
} {
  const settle: (() => void)[] = [];
  return {
    settle,
    schema: {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => new Promise((resolve) => settle.push(() => resolve(answer(value)))),
      },
    },
  };
}

test('a validator runs once its node is read, with the raw value, a signal of its own and its path', async () => {
  const { validate, runs } = server();
  const form = createForm(group({ siren: field('', { validate }) }));
  const { siren } = form.children;
  siren.set('123456789');
  assert.equal(runs.length, 0, 'nothing read yet');
  assert.equal(siren.pending.get(), true);
  assert.equal(form.pending.get(), true);
  assert.deepEqual(form.parsed.get(), { ok: false, error: [] });
  assert.equal(runs.length, 1);
  assert.deepEqual([runs[0]!.value, runs[0]!.path, runs[0]!.signal.aborted], ['123456789', ['siren'], false]);
  runs[0]!.answer([issue('app.siren_taken')]);
  await tick();
  assert.equal(siren.pending.get(), false);
  assert.deepEqual(siren.issues.get(), [issue('app.siren_taken', ['siren'])]);
  assert.deepEqual(form.parsed.get(), { ok: false, error: [issue('app.siren_taken', ['siren'])] });
  assert.equal(runs[0]!.signal.aborted, false, 'a run that answered is never aborted');
  siren.set('987654321');
  assert.equal(siren.pending.get(), true);
  runs[1]!.answer([]);
  await tick();
  assert.deepEqual(form.parsed.get(), { ok: true, value: { siren: '987654321' } });
  assert.equal(runs.length, 2);
});

test('a new value aborts the run in flight, whose answer never counts, even after the new one', async () => {
  const { validate, runs } = server();
  const form = createForm(field('a', { validate }));
  const seen: boolean[] = [];
  form.pending.subscribe(() => seen.push(form.pending.get()));
  form.set('b');
  form.set('c');
  assert.equal(runs[0]!.signal.aborted, false, 'a signal aborts on the next microtask, out of any computation');
  await Promise.resolve();
  assert.deepEqual(
    runs.map((run) => [run.value, run.signal.aborted]),
    [
      ['a', true],
      ['b', true],
      ['c', false],
    ],
  );
  runs[2]!.answer([issue('app.c')]);
  runs[1]!.answer([issue('app.b')]);
  runs[0]!.fail(new Error('aborted'));
  await tick();
  assert.deepEqual(codes(form), ['app.c']);
  assert.deepEqual(seen, [false], 'pending stayed true while the stale runs were replaced, then turned false once');
});

test('a value set back before the node is read keeps its run, which nothing aborted', async () => {
  const { validate, runs } = server();
  const form = createForm(field('a', { validate }));
  form.pending.get();
  form.graph.batch(() => {
    form.set('b');
    form.set('a');
  });
  form.pending.get();
  assert.deepEqual(
    runs.map((run) => [run.value, run.signal.aborted]),
    [['a', false]],
  );
  runs[0]!.answer([issue('app.a')]);
  await tick();
  assert.deepEqual(codes(form), ['app.a']);
});

test('a run whose value changed is aborted when its node is next read, and never delivered', async () => {
  const { validate, runs } = server();
  const form = createForm(field('a', { validate }));
  form.pending.get();
  form.set('b');
  assert.equal(runs[0]!.signal.aborted, false, 'nothing read the node since');
  runs[0]!.answer([issue('app.a')]);
  await tick();
  assert.deepEqual(codes(form), []);
  assert.equal(form.pending.get(), true);
  assert.deepEqual(
    runs.map((run) => [run.value, run.signal.aborted]),
    [
      ['a', false],
      ['b', false],
    ],
  );
});

test('a validator waits for its own schema, for one above that places an issue on it, and for one below', async () => {
  const { validate, runs } = server();
  const siren = string({ pattern: /^\d{9}$/, maxLength: 9 });
  const form = createForm(
    group(
      {
        own: field('1', { schema: siren, validate }),
        byStep: field('2', { validate }),
        address: group({ zip: field('x', { schema: string({ minLength: 5 }) }), city: field('') }, { validate }),
      },
      { schema: object({ own: string(), byStep: siren, address: object({ zip: string(), city: string() }) }) },
    ),
  );
  const { own, byStep, address } = form.children;
  assert.deepEqual(
    [codes(own), codes(byStep), codes(address.children.zip)],
    [['schema.invalid_format'], ['schema.invalid_format'], ['schema.too_short']],
  );
  assert.equal(form.pending.get(), false);
  assert.equal(runs.length, 0, 'no validator runs on a value a schema rejects');
  form.set({ own: '123456789', byStep: '123456789', address: { zip: '75001', city: 'Paris' } });
  assert.equal(form.pending.get(), true);
  assert.deepEqual(
    runs.map((run) => run.path),
    [['own'], ['byStep'], ['address']],
    'the gates open together: validators do not wait for each other',
  );
  address.children.zip.set('7500');
  assert.equal(address.pending.get(), false, "the address's run was aborted when the zip turned invalid");
  await Promise.resolve();
  assert.equal(runs[2]!.signal.aborted, true);
  assert.deepEqual(codes(address.children.zip), ['schema.too_short']);
  address.children.zip.set('75001');
  assert.equal(address.pending.get(), true);
  assert.deepEqual(runs[3]!.value, { zip: '75001', city: 'Paris' }, 'the gate open again asks again');
});

test('a schema that has not answered, at the node, below it or above it, holds its validator back', async () => {
  const { validate, runs } = server();
  const later = deferred(() => ({ value: 'ok' }));
  const form = createForm(group({ name: field('ada', { validate }) }, { schema: later.schema }));
  assert.equal(form.children.name.pending.get(), true);
  assert.equal(runs.length, 0);
  later.settle[0]!();
  await tick();
  assert.equal(form.children.name.pending.get(), true);
  assert.equal(runs.length, 1, 'asked once the schema above answered without an issue on the node');
  runs[0]!.answer([]);
  await tick();
  assert.equal(form.pending.get(), false);
});

test('a write elsewhere that leaves the gate open does not ask the validator again', () => {
  const { validate, runs } = server();
  const form = createForm(
    group(
      { siren: field('123456789', { validate }), name: field('') },
      { schema: object({ siren: string(), name: string() }) },
    ),
  );
  form.pending.get();
  form.children.name.set('Ada');
  form.children.name.set('Grace');
  form.pending.get();
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.signal.aborted, false);
});

test("a node shows its schema's issues while it has any, its validator's otherwise, placed from the node", async () => {
  const form = createForm(
    group(
      {
        name: field(''),
        lines: array(group({ sku: field(''), qty: field(1) }), {
          initial: [
            { sku: 'A', qty: 1 },
            { sku: 'B', qty: 0 },
          ],
          validate: (lines) => lines.flatMap((line, index) => (line.qty ? [] : [issue('app.qty', [index, 'qty'])])),
        }),
      },
      {
        validate: async (value) => (value.name === 'taken' ? [issue('app.name', ['name']), issue('app.form')] : []),
      },
    ),
  );
  const [, second] = form.children.lines.items.get();
  assert.deepEqual(second!.children.qty.issues.get(), [issue('app.qty', ['lines', { key: 1 }, 'qty'])]);
  form.children.lines.move(second!, 0);
  assert.deepEqual(second!.children.qty.issues.get(), [issue('app.qty', ['lines', { key: 1 }, 'qty'])]);
  form.children.name.set('taken');
  form.pending.get();
  await tick();
  assert.deepEqual(codes(form.children.name), ['app.name']);
  assert.deepEqual(codes(form), ['app.form']);
  const parsed = form.parsed.get();
  assert.deepEqual(parsed.ok ? [] : parsed.error.map((found) => found.code), ['app.form', 'app.name', 'app.qty']);
});

test('a rejection or an answer that is not a list is form.validation_failed; a throw stays thrown', async () => {
  const reason = new Error('server unreachable');
  const rejected = createForm(field('x', { validate: () => Promise.reject(reason) }));
  rejected.pending.get();
  await tick();
  assert.deepEqual(rejected.issues.get(), [{ code: 'form.validation_failed', path: [], cause: reason }]);
  const answers: unknown[] = [undefined, 'no', { code: 'x', path: [] }, [{ code: 1, path: [] }], [{ code: 'x' }]];
  for (const answer of answers) {
    const form = createForm(group({ a: field('x', { validate: () => answer as never }) }));
    assert.deepEqual(
      form.children.a.issues.get(),
      [
        answer === undefined
          ? { code: 'form.validation_failed', path: ['a'] }
          : { code: 'form.validation_failed', path: ['a'], cause: answer },
      ],
      String(answer),
    );
  }
  const bug = new Error('bug');
  const thrown = createForm(
    field('x', {
      validate: () => {
        throw bug;
      },
    }),
  );
  assert.throws(() => thrown.pending.get(), bug);
  assert.throws(() => thrown.parsed.get(), bug);
  assert.equal(thrown.raw.get(), 'x');
});

test('the same failure from one run to the next tells no listener', () => {
  const form = createForm(field(1, { validate: () => 'not a list' as never }));
  let calls = 0;
  form.issues.subscribe(() => calls++);
  form.set(2);
  form.set(3);
  assert.equal(calls, 0);
});

test('a thenable that calls back twice counts once, its first answer', async () => {
  const form = createForm(
    field('x', {
      validate: () =>
        ({
          then: (resolve: (issues: readonly Issue[]) => void, reject: (reason: unknown) => void) => {
            resolve([issue('app.first')]);
            resolve([issue('app.second')]);
            reject(new Error('late'));
          },
        }) as PromiseLike<readonly Issue[]>,
    }),
  );
  assert.equal(form.pending.get(), true, 'a thenable is read after the computation that asked');
  await tick();
  assert.deepEqual(codes(form), ['app.first']);
});

test('a removed item aborts its validators and those of its items, which stay idle; reset() asks again', async () => {
  const { validate, runs } = server();
  const form = createForm(
    array(group({ name: field('', { validate }), tags: array(field('', { validate }), { initial: ['t'] }) }), {
      initial: [{ name: 'a', tags: ['t'] }],
    }),
  );
  form.reset([{ name: 'a', tags: ['t'] }]);
  const [item] = form.items.get();
  assert.equal(form.pending.get(), true);
  assert.deepEqual(
    runs.map((run) => run.value),
    ['a', 't'],
  );
  form.remove(item!);
  await Promise.resolve();
  assert.deepEqual(
    runs.map((run) => run.signal.aborted),
    [true, true],
    'aborted on the microtask after the write that removed the item',
  );
  assert.equal(form.pending.get(), false);
  assert.equal(item!.pending.get(), false, 'a removed item asks nothing, even when read');
  assert.equal(runs.length, 2);
  runs[0]!.answer([issue('app.late')]);
  await tick();
  assert.deepEqual(codes(item!.children.name), []);
  form.reset();
  assert.equal(form.items.get()[0], item);
  assert.equal(form.pending.get(), true);
  assert.deepEqual(
    runs.slice(2).map((run) => [run.value, run.signal.aborted]),
    [
      ['a', false],
      ['t', false],
    ],
    'given back, it asks again',
  );
});

test('an item removed and given back in one batch asks again: its run was aborted', async () => {
  const { validate, runs } = server();
  const form = createForm(array(field('', { validate }), { initial: ['a'] }));
  form.pending.get();
  const [item] = form.items.get();
  form.graph.batch(() => {
    form.remove(item!);
    form.reset();
  });
  assert.equal(form.pending.get(), true);
  await Promise.resolve();
  assert.deepEqual(
    runs.map((run) => [run.value, run.signal.aborted]),
    [
      ['a', true],
      ['a', false],
    ],
  );
});

test('a move keeps the run of an item, which nothing aborts', () => {
  const { validate, runs } = server();
  const form = createForm(array(field('', { validate }), { initial: ['a', 'b'] }));
  form.pending.get();
  const [first] = form.items.get();
  form.move(first!, 1);
  form.pending.get();
  assert.deepEqual(
    runs.map((run) => [run.value, run.signal.aborted]),
    [
      ['a', false],
      ['b', false],
    ],
  );
});

test('a validator that awaits a delay honouring its signal is debounced, and its node pending meanwhile', async () => {
  const timers: { readonly run: () => void; cleared: boolean }[] = [];
  const delay = (signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = { run: resolve, cleared: false };
      timers.push(timer);
      signal.addEventListener('abort', () => ((timer.cleared = true), reject(signal.reason)), { once: true });
    });
  const asked: unknown[] = [];
  const form = createForm(
    field('', {
      validate: async (value, { signal }) => {
        await delay(signal);
        asked.push(value);
        return value === 'ada' ? [issue('app.taken')] : [];
      },
    }),
  );
  form.pending.subscribe(() => undefined);
  for (const value of ['a', 'ad', 'ada']) {
    form.set(value);
  }
  assert.equal(form.pending.get(), true);
  await Promise.resolve();
  assert.deepEqual(
    timers.map((timer) => timer.cleared),
    [true, true, true, false],
  );
  timers.forEach((timer) => timer.run());
  await tick();
  assert.deepEqual(asked, ['ada'], 'only the last value reached the server');
  assert.deepEqual(codes(form), ['app.taken']);
});

test('a validator that never settles holds its node pending, as a schema would', async () => {
  const form = createForm(group({ a: field('x', { validate: () => new Promise(() => undefined) }) }));
  await tick();
  assert.equal(form.pending.get(), true);
  assert.deepEqual(form.submit(), { ok: false, error: [] });
});

test('nothing is validated before a state that needs it is read, and a schema of ours stands in front', () => {
  let calls = 0;
  const form = createForm(
    group({
      tags: field<string[]>([], {
        schema: list(string({ minLength: 1 })),
        validate: () => (calls++, []),
      }),
    }),
  );
  form.children.tags.set(['']);
  form.children.tags.set(['a']);
  assert.equal(calls, 0);
  assert.deepEqual(form.parsed.get(), { ok: true, value: { tags: ['a'] } });
  assert.equal(calls, 1);
  form.children.tags.touch();
  form.children.tags.dirty.get();
  assert.equal(calls, 1, 'touched and dirty need no answer');
});

test('validate is checked when the spec is built', () => {
  assert.throws(() => field('', { validate: 'no' as never }), { name: 'TypeError', message: 'validate is a function' });
  assert.throws(() => group({}, { validate: 1 as never }), TypeError);
  assert.throws(() => array(field(''), { validate: {} as never }), TypeError);
});

test('a rejected validator, or one whose answer throws, leaves no unhandled rejection', () => {
  // In a process of its own: the test runner takes an unhandled rejection for a failure of the test that runs.
  const script = `
    import { createForm, field } from '@yaltaan/form';
    const unhandled = [];
    process.on('unhandledRejection', (error) => unhandled.push(String(error)));
    const form = createForm(field('a', {
      validate: (value, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
        setTimeout(() => reject(new Error('refused ' + value)), 5);
      }),
    }));
    form.pending.subscribe(() => undefined);
    form.set('b');
    const answer = [{ get code() { throw new Error('getter'); }, path: [] }];
    const hostile = createForm(field('a', { validate: async () => answer }));
    hostile.pending.get();
    const codes = () => form.issues.get().map((issue) => issue.code);
    setTimeout(() => console.log(JSON.stringify([unhandled, codes(), hostile.pending.get()])), 50);
  `;
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' });
  assert.equal(run.stdout.trim(), '[[],["form.validation_failed"],false]', run.stderr);
});

test('what listens to the signal runs out of any computation, and may read the form', async () => {
  const read: unknown[] = [];
  const form = createForm(
    field('a', {
      validate: (_value, { signal }) => {
        signal.addEventListener('abort', () => read.push(form.raw.get()));
        return new Promise(() => undefined);
      },
    }),
  );
  form.pending.subscribe(() => undefined);
  form.set('b');
  await Promise.resolve();
  assert.deepEqual(read, ['b']);
});

test('a write elsewhere under a schema that answers later neither aborts nor asks again the run', async () => {
  const { validate, runs } = server();
  const later = deferred((value) => ({ value }));
  const form = createForm(
    group({ siren: field('123456789', { validate }), name: field('') }, { schema: later.schema }),
  );
  const { siren, name } = form.children;
  const shown: string[][] = [];
  siren.issues.subscribe(() => shown.push(codes(siren)));
  later.settle[0]!();
  await tick();
  assert.equal(runs.length, 1, 'asked once the schema above answered');
  for (const typed of ['A', 'Ad', 'Ada']) {
    name.set(typed);
    await tick();
  }
  assert.equal(runs.length, 1, 'the user typing elsewhere asks nothing again');
  assert.equal(runs[0]!.signal.aborted, false);
  runs[0]!.answer([issue('app.siren_taken')]);
  await tick();
  assert.deepEqual(codes(siren), ['app.siren_taken'], 'shown while the schema above has not answered');
  name.set('Grace');
  await tick();
  assert.deepEqual(codes(siren), ['app.siren_taken']);
  later.settle.forEach((settle) => settle());
  await tick();
  assert.deepEqual(codes(siren), ['app.siren_taken']);
  assert.equal(runs.length, 1);
  assert.deepEqual(shown, [['app.siren_taken']], 'the issue never went away while the user typed elsewhere');
  assert.equal(form.pending.get(), false);
});

test("a change of the node's own value under a schema that answers later waits for it before asking", async () => {
  const { validate, runs } = server();
  const later = deferred((value) => ({ value }));
  const form = createForm(group({ siren: field('1', { validate }) }, { schema: later.schema }));
  const { siren } = form.children;
  siren.pending.subscribe(() => undefined);
  later.settle[0]!();
  await tick();
  siren.set('2');
  await tick();
  assert.deepEqual(
    runs.map((run) => [run.value, run.signal.aborted]),
    [['1', true]],
    'the run for the old value is aborted, and none asked before the schema answers for the new one',
  );
  later.settle[1]!();
  await tick();
  assert.deepEqual(
    runs.map((run) => run.value),
    ['1', '2'],
  );
});

test('an answer that throws when read is form.validation_failed, and leaves no node pending', async () => {
  const bug = new Error('getter');
  const hostile = [
    {
      get code(): string {
        throw bug;
      },
      path: [],
    },
  ];
  const form = createForm(field('x', { validate: async () => hostile as never }));
  form.pending.get();
  await tick();
  assert.equal(form.pending.get(), false);
  assert.deepEqual(form.issues.get(), [{ code: 'form.validation_failed', path: [], cause: bug }]);
});

test('a validator built below a removed item does not run', () => {
  const { validate, runs } = server();
  const form = createForm(array(group({ tags: array(field('', { validate })) }), { initial: [{ tags: [] }] }));
  const [outer] = form.items.get();
  form.remove(outer!);
  outer!.children.tags.insert(0, 'x');
  assert.equal(outer!.pending.get(), false);
  assert.equal(runs.length, 0);
  form.reset();
  assert.equal(form.items.get()[0], outer, 'given back, with its initial list of tags');
  outer!.children.tags.insert(0, 'y');
  assert.equal(form.pending.get(), true);
  assert.deepEqual(
    runs.map((run) => run.value),
    ['y'],
  );
});

test('the types of a validator follow the raw value of its node', () => {
  const never = (): void => {
    field(0, { validate: (raw: number) => (raw > 0 ? [] : [issue('app.positive')]) });
    group({ a: field(''), b: field(0) }, { validate: (raw: { a: string; b: number }) => (raw.a ? [] : []) });
    array(field(''), { validate: async (raw: string[]) => raw.map((_, index) => issue('app.row', [index])) });
    // @ts-expect-error the raw value of a field of numbers is a number
    field(0, { validate: (raw: string) => (raw ? [] : []) });
    // @ts-expect-error a validator answers with issues
    field(0, { validate: () => ['no'] });
    // @ts-expect-error the raw value of a group is the object of its children's, which a validator does not change
    group({ a: field('') }, { validate: (raw: { a: number }) => (raw.a ? [] : []) });
  };
  void never;
});
