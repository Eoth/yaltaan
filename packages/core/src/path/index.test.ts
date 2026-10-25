import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertType, CallbackError, declareAdversarial, fc, HostileError, type Equal } from '@yaltaan/testing';

import { liveCodes } from '../../../../scripts/check-issue-codes.ts';

import {
  checkWritablePath,
  formatPath,
  parsePath,
  type ParsePathOptions,
  type Path,
  type PathIssue,
  type PathSegment,
} from './index.ts';

const SUBPATH = '@yaltaan/core/path';
const CODES: readonly PathIssue['code'][] = [
  'path.syntax',
  'path.too_long',
  'path.too_deep',
  'path.not_textual',
  'path.forbidden_segment',
];

function parsed(text: string, options?: ParsePathOptions): Path {
  const result = parsePath(text, options);
  assert.ok(result.ok, `${JSON.stringify(text)}: ${JSON.stringify(result)}`);
  return result.value;
}

function issueOf(result: { readonly ok: boolean; readonly error?: PathIssue }): PathIssue {
  assert.ok(!result.ok && result.error !== undefined, JSON.stringify(result));
  return result.error;
}

function formatted(path: Path): string {
  const result = formatPath(path);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

test('parsePath reads names, indexes and quoted keys', () => {
  assert.deepEqual(parsed(''), []);
  assert.deepEqual(parsed('items[3].name'), ['items', 3, 'name']);
  assert.deepEqual(parsed('[0][1]'), [0, 1]);
  assert.deepEqual(parsed('$a._b.c1'), ['$a', '_b', 'c1']);
  assert.deepEqual(parsed('["prénom"]["名前"]'), ['prénom', '名前']);
  assert.deepEqual(parsed('["a.b"]["[]"]["\\\\"][""]'), ['a.b', '[]', '\\', '']);
  assert.deepEqual(parsed('["\\u00e9\\n\\"\\/\\b\\f\\r\\t"]'), ['é\n"/\b\f\r\t']);
  assert.deepEqual(parsed('a["3"][3]'), ['a', '3', 3]);
  assert.deepEqual(parsed('[9007199254740991]'), [Number.MAX_SAFE_INTEGER]);
  assert.deepEqual(parsed('["\\ud800"]'), ['\ud800']);
});

test('parsePath names where the text breaks the grammar', () => {
  const cases: readonly [string, number][] = [
    ['.a', 0],
    ['a.', 2],
    ['a..b', 2],
    ['a b', 1],
    ['a]', 1],
    ['items.3', 6],
    ['a.[0]', 2],
    ['a[]', 1],
    ['a[-1]', 1],
    ['a[01]', 1],
    ['a[1.5]', 1],
    ['a[0', 1],
    ['[9007199254740992]', 0],
    ['["a', 0],
    ['["a"', 0],
    ['["a"x]', 0],
    ['["\\x"]', 0],
    ['["\\u00g0"]', 0],
    ['["\n"]', 0],
    ["['a']", 0],
    ['3', 0],
    // Each segment is read where the previous one ends, never searched for further on.
    ['[x]["a"]', 0],
    ['a[x][0]', 1],
    ['a.!b', 2],
    ['prénom', 2],
    ['a.名前', 2],
  ];
  for (const [text, index] of cases) {
    assert.deepEqual(issueOf(parsePath(text)), { code: 'path.syntax', path: [], params: { index } }, text);
  }
});

test('parsePath bounds the length before reading, and the number of segments', () => {
  const long = 'a'.repeat(4097);
  assert.deepEqual(issueOf(parsePath(long)), {
    code: 'path.too_long',
    path: [],
    params: { length: 4097, maximum: 4096 },
  });
  assert.equal(parsed('a'.repeat(4096)).length, 1);
  assert.deepEqual(issueOf(parsePath('abc', { maxLength: 2 })).code, 'path.too_long');
  assert.deepEqual(parsed('', { maxLength: 0 }), []);

  const deep = Array.from({ length: 65 }, () => '[0]').join('');
  assert.deepEqual(issueOf(parsePath(deep)), { code: 'path.too_deep', path: [], params: { maximum: 64 } });
  assert.equal(parsed(deep.slice(3)).length, 64);
  assert.deepEqual(issueOf(parsePath('a.b', { maxDepth: 1 })).code, 'path.too_deep');
  assert.equal(parsed(deep, { maxDepth: Number.POSITIVE_INFINITY }).length, 65);
  assert.equal(parsed('x'.repeat(5000), { maxLength: Number.POSITIVE_INFINITY }).length, 1);
});

test('parsePath refuses limits that are no count, and a text that is no string', () => {
  for (const maxLength of [-1, 1.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => parsePath('a', { maxLength }), RangeError);
    assert.throws(() => parsePath('a', { maxDepth: maxLength }), RangeError);
  }
  for (const text of [undefined, null, 42, ['a'], { toString: () => 'a' }]) {
    // @ts-expect-error parsePath reads a string only
    assert.throws(() => parsePath(text), TypeError);
  }
});

test('formatPath writes one text per path', () => {
  assert.equal(formatted([]), '');
  assert.equal(formatted(['items', 3, 'name']), 'items[3].name');
  assert.equal(formatted([0, 'a']), '[0].a');
  assert.equal(formatted(['a', '3', 'first name', '', 'a.b']), 'a["3"]["first name"][""]["a.b"]');
  assert.equal(formatted(['"', '\\', '\n', '\ud800']), '["\\""]["\\\\"]["\\n"]["\\ud800"]');
  assert.equal(formatted(['prénom', 'ab\u200Dc']), '["prénom"]["ab\u200Dc"]');
  assert.equal(formatted([-0]), '[0]');
});

test('formatPath refuses the segments that have no text form', () => {
  const cases: readonly PathSegment[] = [Symbol('s'), { key: 1 }, -1, 1.5, Number.NaN, 2 ** 53, Infinity];
  for (const segment of cases) {
    const path = ['a', segment];
    const issue = issueOf(formatPath(path));
    assert.deepEqual(issue, { code: 'path.not_textual', path, params: { index: 1 } });
    assert.equal(issue.path, path);
  }
});

test('checkWritablePath refuses the keys that reach a prototype, and returns the path itself otherwise', () => {
  const safe: Path = ['user', 0, Symbol('s'), { key: '__proto__' }, 'Constructor', 'proto'];
  const checked = checkWritablePath(safe);
  assert.ok(checked.ok);
  assert.equal(checked.value, safe);
  for (const segment of ['__proto__', 'constructor', 'prototype']) {
    const path = ['user', segment, 'isAdmin'];
    assert.deepEqual(issueOf(checkWritablePath(path)), {
      code: 'path.forbidden_segment',
      path,
      params: { index: 1, segment },
    });
  }
});

// Any string, lone surrogates included, and any index.
const textualSegment: fc.Arbitrary<string | number> = fc.oneof(
  fc.string({ unit: 'binary' }),
  fc.string({ unit: fc.constantFrom('.', '[', ']', '"', '\\', '0', 'a', ' ', '\n') }),
  fc.nat(),
  fc.constantFrom(0, Number.MAX_SAFE_INTEGER, '', '0', 'constructor'),
);

test('formatPath then parsePath gives back the same segments', () => {
  fc.assert(
    fc.property(fc.array(textualSegment, { maxLength: 64 }), (path) => {
      const text = formatted(path);
      assert.deepEqual(parsed(text, { maxLength: Number.POSITIVE_INFINITY }), path);
    }),
  );
});

// Texts drawn from the grammar's own characters reach its every branch, far more often than random Unicode.
const grammarText: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: fc.constantFrom('.', '[', ']', '"', '\\', 'u', '0', '1', '9', 'a', 'é', '$', '\n', ' ') }),
  fc.string({ unit: 'binary' }),
  fc.array(textualSegment).map((path) => formatted(path)),
);

test('parsePath never throws, and what it reads is written back to the same segments', () => {
  fc.assert(
    fc.property(grammarText, (text) => {
      const result = parsePath(text, { maxLength: Number.POSITIVE_INFINITY, maxDepth: Number.POSITIVE_INFINITY });
      if (!result.ok) {
        assert.ok(CODES.includes(result.error.code));
        return;
      }
      const again = parsed(formatted(result.value), {
        maxLength: Number.POSITIVE_INFINITY,
        maxDepth: Number.POSITIVE_INFINITY,
      });
      assert.deepEqual(again, result.value);
    }),
    { numRuns: 2000 },
  );
});

test('parsePath reads a hostile text of the maximal length in bounded time', () => {
  const texts = [
    'a'.repeat(4095) + '!',
    '['.repeat(4096),
    '["' + 'a'.repeat(4094),
    '["' + '\\\\'.repeat(2046) + '"',
    '["' + '\\u0041'.repeat(682),
    '[' + '9'.repeat(4095),
    'a.'.repeat(2048),
    '$_'.repeat(2047) + '.',
  ];
  for (const text of texts) {
    const start = process.hrtime.bigint();
    parsePath(text, { maxDepth: Number.POSITIVE_INFINITY });
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    // A linear scan of 4,096 code units takes microseconds; backtracking would take seconds.
    assert.ok(elapsed < 50, `${JSON.stringify(text.slice(0, 12))}…: ${elapsed} ms`);
  }
});

test('no key, however hostile, reaches a prototype', () => {
  const texts = ['__proto__.polluted', '["__proto__"].polluted', 'constructor.prototype.polluted', '["prototype"]'];
  for (const text of texts) {
    const path = parsed(text);
    formatPath(path);
    checkWritablePath(path);
  }
  assert.deepEqual(Object.keys(Object.prototype), []);
  assert.equal(({} as { polluted?: unknown }).polluted, undefined);
});

test('types: an issue narrows by its code, and the segments are typed', () => {
  const result = parsePath('a[');
  if (!result.ok) {
    const issue = result.error;
    if (issue.code === 'path.syntax') {
      assertType<Equal<typeof issue.params, { readonly index: number }>>();
      // @ts-expect-error a syntax issue carries no maximum
      void issue.params.maximum;
    }
    assertType<Equal<typeof issue.path, Path>>();
  }
  assertType<Equal<PathSegment, string | number | symbol | { readonly key: unknown }>>();
  // @ts-expect-error a path is read-only
  parsed('a').push('b');
  // @ts-expect-error a boolean is no segment
  formatPath([true]);
  // @ts-expect-error the limits are named options
  parsePath('a', 10);
});

test('the example of the README runs', () => {
  const fromServer = parsePath('lines[2]["unit price"]');
  assert.deepEqual(fromServer, { ok: true, value: ['lines', 2, 'unit price'] });
  assert.deepEqual(formatPath(['lines', 2, 'unit price']), { ok: true, value: 'lines[2]["unit price"]' });
  const write = checkWritablePath(['__proto__', 'isAdmin']);
  assert.equal(write.ok ? undefined : write.error.code, 'path.forbidden_segment');
});

test('the codes this module produces are the path codes of the registry of the package', () => {
  const registered = [...liveCodes('core')].filter((code) => code.startsWith('path.'));
  assert.deepEqual(registered.toSorted(), CODES.toSorted());
});

// A check that may only fail by the hostile object's own error: reading the options can hit a throwing getter.
function survivesHostile(run: () => void): void {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof HostileError || error instanceof TypeError, String(error));
  }
}

declareAdversarial(SUBPATH, 'parsePath', {
  boundary: (value) => {
    if (typeof value !== 'string') {
      assert.throws(() => parsePath(value as string), TypeError);
      return;
    }
    const result = parsePath(value);
    assert.ok(result.ok || CODES.includes(result.error.code));
  },
  // Structures and hostile objects reach parsePath as its options object.
  structures: (value) => {
    assert.ok(parsePath('a.b[0]', value as ParsePathOptions).ok);
  },
  hostile: (value) => {
    survivesHostile(() => {
      parsePath('a.b[0]', value as ParsePathOptions);
    });
  },
  unicode: (value) => {
    assert.deepEqual(parsed(formatted([value, 0, value]), { maxLength: Number.POSITIVE_INFINITY }), [value, 0, value]);
    const result = parsePath(value);
    assert.ok(result.ok || CODES.includes(result.error.code));
  },
  callbacks: { na: 'parsePath takes no callback' },
  async: { na: 'parsePath is synchronous and takes no signal' },
});

// A value of any category as a segment: written only when it is a string or an index, never read or called.
function formatsOnlyText(value: unknown): void {
  const path = ['a', value as PathSegment];
  const result = formatPath(path);
  const textual = typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
  assert.equal(result.ok, textual);
  if (result.ok) {
    assert.deepEqual(parsed(result.value, { maxLength: Number.POSITIVE_INFINITY }), [
      'a',
      Object.is(value, -0) ? 0 : value,
    ]);
  } else {
    assert.deepEqual(result.error, { code: 'path.not_textual', path, params: { index: 1 } });
  }
  assert.equal(formatPath([{ key: value }]).ok, false);
}

declareAdversarial(SUBPATH, 'formatPath', {
  boundary: formatsOnlyText,
  structures: formatsOnlyText,
  hostile: formatsOnlyText,
  unicode: formatsOnlyText,
  callbacks: (callback) => {
    formatsOnlyText(callback);
  },
  async: { na: 'formatPath is synchronous and takes no signal' },
});

// A value of any category as a segment: refused only when it is one of the three keys, never read or called.
function checksOnlyKeys(value: unknown): void {
  const path = ['a', value as PathSegment, { key: value }];
  const result = checkWritablePath(path);
  const forbidden = value === '__proto__' || value === 'constructor' || value === 'prototype';
  assert.equal(result.ok, !forbidden);
  if (result.ok) {
    assert.equal(result.value, path);
  }
}

declareAdversarial(SUBPATH, 'checkWritablePath', {
  boundary: checksOnlyKeys,
  structures: checksOnlyKeys,
  hostile: checksOnlyKeys,
  unicode: checksOnlyKeys,
  callbacks: (callback) => {
    try {
      checksOnlyKeys(callback);
    } catch (error) {
      assert.ok(!(error instanceof CallbackError), 'the callback was called');
      throw error;
    }
  },
  async: { na: 'checkWritablePath is synchronous and takes no signal' },
});
