import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertType, CallbackError, declareAdversarial, fc, HostileError, type Equal } from '@yaltaan/testing';
import * as v from 'valibot';

import { liveCodes } from '../../../../scripts/check-issue-codes.ts';
import type { KeySegment, Path, PathIssue } from '../path/index.ts';
import {
  fromStandardIssue,
  toStandardIssue,
  type ExternalIssue,
  type Issue,
  type IssueFormatter,
  type StandardIssue,
} from './index.ts';

const SUBPATH = '@yaltaan/core/issue';
const byCode: IssueFormatter = (issue) => issue.code;
// The formatter of an application that shows a foreign message as it came.
const passThrough: IssueFormatter = (issue) =>
  issue.code === 'issue.external' ? String(issue.params?.['message']) : '';

test('an issue with a path becomes a message and the same path', () => {
  const path = ['lines', 2, 'unit price'];
  const issue: Issue = { code: 'schema.too_small', path, params: { minimum: 1 } };
  const standard = toStandardIssue(issue, { format: (held) => `${held.code}:${String(held.params?.['minimum'])}` });
  assert.deepEqual(standard, { message: 'schema.too_small:1', path: ['lines', 2, 'unit price'] });
  // No `{ key }` segment: the path is shared, nothing is copied.
  assert.equal(standard.path, path);
});

test('an issue on the value itself has no Standard Schema path', () => {
  const standard = toStandardIssue({ code: 'rules.at_least', path: [] }, { format: byCode });
  assert.deepEqual(standard, { message: 'rules.at_least' });
  assert.ok(!('path' in standard));
});

test('format receives the issue itself and must return a string', () => {
  const issue: Issue = { code: 'a.b', path: ['x'], severity: 'warning', cause: new Error('server') };
  let seen: Issue | undefined;
  toStandardIssue(issue, {
    format: (held) => {
      seen = held;
      return '';
    },
  });
  assert.equal(seen, issue);
  assert.throws(() => toStandardIssue(issue, { format: () => 3 as unknown as string }), TypeError);
  assert.throws(() => toStandardIssue(issue, { format: undefined as unknown as IssueFormatter }), TypeError);
});

const lines = [
  { id: 'a7', quantity: 1 },
  { id: 'b2', quantity: 0 },
];
const byId = (segment: KeySegment, parent: Path): number => {
  assert.deepEqual(parent, ['lines']);
  return lines.findIndex((line) => line.id === segment.key);
};

test('a { key } segment becomes the current index of its element', () => {
  const issue: Issue = { code: 'schema.too_small', path: ['lines', { key: 'b2' }, 'quantity'] };
  assert.deepEqual(toStandardIssue(issue, { format: byCode, resolveKey: byId }).path, ['lines', 1, 'quantity']);
});

test('a { key } segment that cannot be resolved cuts the path before it, on the array', () => {
  const gone: Issue = { code: 'schema.too_small', path: ['lines', { key: 'zz' }, 'quantity'] };
  assert.deepEqual(toStandardIssue(gone, { format: byCode, resolveKey: byId }).path, ['lines']);
  assert.deepEqual(toStandardIssue(gone, { format: byCode, resolveKey: () => undefined }).path, ['lines']);
  // Without resolveKey, an identity never crosses the boundary as a property name.
  assert.deepEqual(toStandardIssue(gone, { format: byCode }).path, ['lines']);
  // A path that starts with a { key } segment ends on the value itself.
  assert.deepEqual(toStandardIssue({ code: 'a.b', path: [{ key: 1 }, 'x'] }, { format: byCode }), { message: 'a.b' });
});

test('resolveKey must answer an index, -1 or undefined', () => {
  const issue: Issue = { code: 'a.b', path: ['lines', { key: 'a7' }] };
  for (const answer of [1.5, -2, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '0', null]) {
    assert.throws(
      () => toStandardIssue(issue, { format: byCode, resolveKey: () => answer as number }),
      TypeError,
      String(answer),
    );
  }
});

test('symbols and numbers pass the boundary as property keys', () => {
  const symbol = Symbol('field');
  assert.deepEqual(toStandardIssue({ code: 'a.b', path: [symbol, 0] }, { format: byCode }).path, [symbol, 0]);
});

test('a Standard Schema issue becomes issue.external, its message kept as data', () => {
  const foreign: StandardIssue = { message: 'Too short', path: ['user', { key: 'name' }] };
  const issue = fromStandardIssue(foreign);
  assert.deepEqual(issue, {
    code: 'issue.external',
    path: ['user', 'name'],
    params: { message: 'Too short' },
    cause: foreign,
  });
  assert.equal(issue.cause, foreign);
  assert.deepEqual(fromStandardIssue({ message: 'Required' }).path, []);
  assert.deepEqual(fromStandardIssue({ message: 'Required', path: undefined }).path, []);
});

test('a Standard Schema path of property keys is shared, nothing is copied', () => {
  const path = ['user', 0, Symbol.iterator];
  assert.equal(fromStandardIssue({ message: '', path }).path, path);
});

test('a Standard Schema issue that breaks the interface is a bug of its validator', () => {
  for (const issue of [
    { message: 3 },
    { message: 'm', path: 'user.name' },
    { message: 'm', path: [null] },
    { message: 'm', path: [true] },
    { message: 'm', path: [{ key: {} }] },
    { message: 'm', path: [{ key: undefined }] },
  ]) {
    assert.throws(() => fromStandardIssue(issue as unknown as StandardIssue), TypeError, JSON.stringify(issue));
  }
});

test('a Standard Schema issue survives the way in and back out unchanged', () => {
  const segment = fc.oneof(
    fc.string(),
    fc.nat(),
    fc.string().map((key) => ({ key })),
  );
  const property = fc.property(fc.string(), fc.option(fc.array(segment), { nil: undefined }), (message, path) => {
    const foreign: StandardIssue = path === undefined ? { message } : { message, path };
    const back = toStandardIssue(fromStandardIssue(foreign), { format: passThrough });
    const unwrapped = (path ?? []).map((held) => (typeof held === 'object' ? held.key : held));
    assert.deepEqual(back, unwrapped.length === 0 ? { message } : { message, path: unwrapped });
  });
  fc.assert(property, { seed: 19, numRuns: 200 });
});

test('a path of property keys survives the way out and back in unchanged', () => {
  const key = fc.oneof(fc.string(), fc.nat());
  fc.assert(
    fc.property(fc.array(key), (path) => {
      const standard = toStandardIssue({ code: 'a.b', path }, { format: byCode });
      assert.deepEqual(fromStandardIssue(standard).path, path);
    }),
    { seed: 19, numRuns: 200 },
  );
  // { key } segments come back as the indexes they resolved to.
  const out = toStandardIssue({ code: 'a.b', path: ['lines', { key: 'b2' }] }, { format: byCode, resolveKey: byId });
  assert.deepEqual(fromStandardIssue(out).path, ['lines', 1]);
});

test('the issues of a real Standard Schema validator are read with their paths', async () => {
  const schema = v.object({ name: v.pipe(v.string(), v.minLength(2)), lines: v.array(v.object({ qty: v.number() })) });
  const result = await schema['~standard'].validate({ name: 'a', lines: [{ qty: 1 }, { qty: 'x' }] });
  assert.ok(result.issues !== undefined);
  const issues = result.issues.map(fromStandardIssue);
  assert.deepEqual(
    issues.map((issue) => [issue.code, issue.path]),
    [
      ['issue.external', ['name']],
      ['issue.external', ['lines', 1, 'qty']],
    ],
  );
  assert.equal(issues[0]?.params.message, result.issues[0]?.message);
});

test('every issue of the library is an Issue', () => {
  assertType<Equal<PathIssue extends Issue ? true : false, true>>();
  assertType<Equal<ExternalIssue extends Issue ? true : false, true>>();
  assertType<Equal<ReturnType<typeof fromStandardIssue>, ExternalIssue>>();
  // @ts-expect-error a code is required
  const noCode: Issue = { path: [] };
  // @ts-expect-error a severity is error or warning
  const loud: Issue = { code: 'a.b', path: [], severity: 'fatal' };
  assert.ok(noCode !== loud);
});

test('the code this module produces is in the registry of the package', () => {
  assert.ok(liveCodes('core').has(fromStandardIssue({ message: '' }).code));
});

// A value of any category as the cause, the params or a path segment of an issue: carried, never read.
function convertsAnything(value: unknown): void {
  const issue: Issue = { code: 'a.b', path: ['x'], params: { value }, cause: value };
  assert.deepEqual(toStandardIssue(issue, { format: byCode }), { message: 'a.b', path: ['x'] });
  const keyed = toStandardIssue({ code: 'a.b', path: ['x', { key: value }] }, { format: byCode });
  // Compared segment by segment: a failing deepEqual would print a structure 10,000 levels deep, for minutes.
  assert.ok(keyed.path?.length === 1 && keyed.path[0] === 'x', 'the { key } segment crossed the boundary');
}

declareAdversarial(SUBPATH, 'toStandardIssue', {
  boundary: convertsAnything,
  structures: convertsAnything,
  hostile: convertsAnything,
  unicode: (text) => {
    assert.deepEqual(toStandardIssue({ code: 'a.b', path: [text] }, { format: () => text }), {
      message: text,
      path: [text],
    });
  },
  // As format and as resolveKey: what it returns is checked, what it throws comes out as it is.
  callbacks: (callback) => {
    for (const options of [
      { format: callback as IssueFormatter },
      { format: byCode, resolveKey: callback as (segment: KeySegment, parent: Path) => number },
    ]) {
      try {
        const standard = toStandardIssue({ code: 'a.b', path: ['x', { key: 'k' }, 'y'] }, options);
        assert.equal(typeof standard.message, 'string');
      } catch (error) {
        assert.ok(error instanceof CallbackError || error instanceof TypeError || typeof error === 'string');
      }
    }
  },
  async: { na: 'toStandardIssue is synchronous and takes no signal; a format that returns a promise is refused' },
});

// A value of any category as a foreign issue or one of its segments: read only as the interface says.
function readsOnlyTheInterface(value: unknown): void {
  for (const issue of [value, { message: 'm', path: [value] }, { message: 'm', path: [{ key: value }] }]) {
    try {
      const read = fromStandardIssue(issue as StandardIssue);
      assert.equal(read.code, 'issue.external');
      assert.equal(read.cause, issue);
    } catch (error) {
      assert.ok(error instanceof TypeError || error instanceof HostileError, String(error));
    }
  }
}

declareAdversarial(SUBPATH, 'fromStandardIssue', {
  boundary: readsOnlyTheInterface,
  structures: readsOnlyTheInterface,
  hostile: readsOnlyTheInterface,
  unicode: (text) => {
    assert.deepEqual(fromStandardIssue({ message: text, path: [text, { key: text }] }).path, [text, text]);
  },
  callbacks: (callback) => {
    readsOnlyTheInterface(callback);
  },
  async: { na: 'fromStandardIssue is synchronous and takes no signal' },
});
