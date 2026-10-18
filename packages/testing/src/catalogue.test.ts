import assert from 'node:assert/strict';
import { test } from 'node:test';
import { types } from 'node:util';

import {
  adversarial,
  CallbackError,
  CATEGORY_NAMES,
  DEEP,
  fc,
  GROWTH_LIMIT,
  HostileError,
  LONG_LENGTH,
  WIDE,
  type Category,
} from './index.ts';

const LONE_SURROGATE = /\p{Cs}/u;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

function caseOf<T>(category: Category<T>, label: string): T {
  const found = category.cases.find((candidate) => candidate.label === label);
  assert.ok(found, `adversarial.${category.name} has no case "${label}"`);
  return found.make();
}

function depth(value: unknown, step: (node: unknown) => unknown): number {
  let levels = 0;
  for (let node = value; node !== undefined; node = step(node)) {
    levels += 1;
  }
  return levels;
}

test('the catalogue holds the six categories of the architecture, in order, each under its own name', () => {
  assert.deepEqual(Object.keys(adversarial), [...CATEGORY_NAMES]);
  for (const name of CATEGORY_NAMES) {
    assert.equal(adversarial[name].name, name);
    assert.ok(adversarial[name].cases.length > 0, name);
  }
});

test('boundary values hold the empty values, the special numbers and the extremes', () => {
  const { boundary } = adversarial;
  assert.equal(caseOf(boundary, 'undefined'), undefined);
  assert.equal(caseOf(boundary, 'null'), null);
  assert.equal(caseOf(boundary, 'empty string'), '');
  assert.deepEqual(caseOf(boundary, 'empty array'), []);
  assert.deepEqual(caseOf(boundary, 'empty object'), {});
  assert.ok(Number.isNaN(caseOf(boundary, 'NaN')));
  assert.ok(Object.is(caseOf(boundary, '-0'), -0));
  assert.equal(caseOf(boundary, 'Infinity'), Number.POSITIVE_INFINITY);
  assert.equal(caseOf(boundary, '-Infinity'), Number.NEGATIVE_INFINITY);
  assert.equal(caseOf(boundary, 'smallest positive number'), Number.MIN_VALUE);
  assert.equal(caseOf(boundary, 'very large bigint'), 2n ** 128n);
  assert.equal((caseOf(boundary, 'very long string') as string).length, LONG_LENGTH);
  assert.equal((caseOf(boundary, 'very long array') as unknown[]).length, LONG_LENGTH);
});

test('structures hold depth, width, holes, cycles and aliasing', () => {
  const { structures } = adversarial;
  const child = (node: unknown): unknown => (node as { child?: unknown }).child;
  assert.equal(depth(caseOf(structures, 'very deep object'), child), DEEP);
  assert.equal(
    depth(caseOf(structures, 'very deep array'), (node) => (node as unknown[])[0]),
    DEEP,
  );
  assert.equal(Object.keys(caseOf(structures, 'very wide object')).length, WIDE);
  const sparse = caseOf(structures, 'sparse array') as unknown[];
  assert.equal(sparse.length, 1000);
  assert.ok(!(1 in sparse));
  const self = caseOf(structures, 'self cycle') as { self: unknown };
  assert.equal(self.self, self);
  const array = caseOf(structures, 'array cycle') as unknown[];
  assert.equal(array[1], array);
  const mutual = caseOf(structures, 'mutual cycle') as { b: { a: unknown } };
  assert.equal(mutual.b.a, mutual);
  const map = caseOf(structures, 'Map cycle') as Map<string, unknown>;
  assert.equal(map.get('self'), map);
  const aliased = caseOf(structures, 'aliasing') as { left: unknown; right: unknown };
  assert.equal(aliased.left, aliased.right);
});

test('hostile objects refuse writes, lack a prototype, carry dangerous keys, throw, or are Proxies', () => {
  const { hostile } = adversarial;
  assert.ok(Object.isFrozen(caseOf(hostile, 'frozen object')));
  assert.ok(Object.isFrozen(caseOf(hostile, 'frozen array')));
  assert.ok(Object.isSealed(caseOf(hostile, 'sealed object')));
  assert.ok(!Object.isExtensible(caseOf(hostile, 'non-extensible object')));
  assert.equal(Object.getPrototypeOf(caseOf(hostile, 'null prototype')), null);
  const parsed = caseOf(hostile, '__proto__ key');
  assert.ok(Object.hasOwn(parsed, '__proto__'));
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.ok(Object.hasOwn(caseOf(hostile, 'constructor key'), 'constructor'));
  assert.ok(Object.hasOwn(caseOf(hostile, 'prototype key'), 'prototype'));
  assert.throws(() => ({ ...caseOf(hostile, 'throwing getter') }), HostileError);
  assert.ok(types.isProxy(caseOf(hostile, 'transparent Proxy')));
  assert.throws(() => Object.keys(caseOf(hostile, 'throwing Proxy')), HostileError);
  assert.throws(() => Object.keys(caseOf(hostile, 'revoked Proxy')), TypeError);
  assert.equal(Object.getOwnPropertySymbols(caseOf(hostile, 'symbol key')).length, 1);
  assert.deepEqual(Object.keys(caseOf(hostile, 'non-enumerable property')), ['visible']);
});

test('Unicode strings disagree in code units, code points and graphemes, or are not well formed', () => {
  const { unicode } = adversarial;
  const count = (text: string): number => [...graphemes.segment(text)].length;
  const zwj = caseOf(unicode, 'ZWJ sequence');
  assert.ok(zwj.includes('‍'));
  assert.equal(count(zwj), 1);
  assert.equal(zwj.length, 11);
  assert.equal(count(caseOf(unicode, 'combining characters')), 1);
  assert.equal(count(caseOf(unicode, 'regional indicator flag')), 1);
  const forms = caseOf(unicode, 'precomposed and decomposed forms').split(' ');
  assert.notEqual(forms[0], forms[1]);
  assert.equal(forms[0]?.normalize('NFC'), forms[1]?.normalize('NFC'));
  for (const label of ['lone high surrogate', 'lone low surrogate', 'reversed surrogate pair']) {
    assert.match(caseOf(unicode, label), LONE_SURROGATE, label);
  }
  assert.match(caseOf(unicode, 'bidirectional override'), /‮/u);
  assert.match(caseOf(unicode, 'bidirectional isolates'), /⁧/u);
  assert.match(caseOf(unicode, 'right-to-left text'), /^\p{Script=Arabic}+$/u);
  assert.match(caseOf(unicode, 'invisible characters'), /​/u);
});

test('callbacks throw, mutate their value and the collection, or answer with a promise', async () => {
  const { callbacks } = adversarial;
  assert.throws(() => caseOf(callbacks, 'throws an Error')(), CallbackError);
  assert.throws(
    () => caseOf(callbacks, 'throws a value that is not an Error')(),
    (thrown) => thrown === 'callback failure',
  );
  const second = caseOf(callbacks, 'throws on its second call');
  assert.equal(second(), 1);
  assert.throws(() => second(), CallbackError);
  assert.equal(await caseOf(callbacks, 'returns a promise')(), true);
  const value = { a: 1 };
  caseOf(callbacks, 'mutates its value')(value);
  assert.deepEqual(value, { a: 1, addedByTheCallback: true });
  // A walk that rereads the length sees the collection grow, then stop growing.
  const list = [1, 2];
  const grow = caseOf(callbacks, 'grows the collection during iteration');
  let visited = 0;
  for (let index = 0; index < list.length; index += 1) {
    grow(list[index], index, list);
    visited += 1;
  }
  assert.equal(visited, 2 + GROWTH_LIMIT);
  const shrinking = [1, 2, 3];
  caseOf(callbacks, 'shrinks the collection during iteration')(1, 0, shrinking);
  assert.deepEqual(shrinking, [1, 2]);
  // A frozen value refuses the write without the callback throwing.
  assert.doesNotThrow(() => caseOf(callbacks, 'mutates its value')(Object.freeze({ a: 1 })));
});

test('async cases abort before, just after or later than the call, and push concurrency past its bounds', async () => {
  const { async } = adversarial;
  const before = caseOf(async, 'already aborted signal');
  assert.ok(before.signal.aborted);
  assert.ok(before.signal.reason instanceof Error);
  assert.equal(caseOf(async, 'signal aborted with a reason that is not an Error').signal.reason, 'aborted');
  const micro = caseOf(async, 'signal that aborts on the next microtask');
  const macro = caseOf(async, 'signal that aborts on the next macrotask');
  assert.ok(!micro.signal.aborted && !macro.signal.aborted);
  await Promise.resolve();
  assert.ok(micro.signal.aborted && !macro.signal.aborted);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(macro.signal.aborted);
  assert.equal(caseOf(async, 'concurrency 0').concurrency, 0);
  assert.equal(caseOf(async, 'infinite concurrency').concurrency, Number.POSITIVE_INFINITY);
  assert.equal(caseOf(async, 'negative concurrency').concurrency, -1);
  assert.ok(!caseOf(async, 'concurrency 1').signal.aborted);
});

test('every named case builds a new value on each call', () => {
  for (const name of CATEGORY_NAMES) {
    const category: Category<unknown> = adversarial[name];
    for (const { label, make } of category.cases) {
      const first = make();
      if ((typeof first === 'object' && first !== null) || typeof first === 'function') {
        assert.notEqual(make(), first, `adversarial.${name}: "${label}"`);
      }
    }
  }
});

test('the arbitraries yield values of their category, named and random, the same for a seed', () => {
  const kinds: Readonly<Record<string, (value: unknown) => boolean>> = {
    boundary: () => true,
    structures: (value) => typeof value === 'object' && value !== null,
    hostile: (value) => typeof value === 'object' && value !== null,
    unicode: (value) => typeof value === 'string',
    callbacks: (value) => typeof value === 'function',
    async: (value) => (value as { signal?: unknown }).signal instanceof AbortSignal,
  };
  for (const name of CATEGORY_NAMES) {
    const category: Category<unknown> = adversarial[name];
    const drawn = fc.sample(category.arbitrary, { seed: 7, numRuns: 200 });
    assert.ok(
      drawn.every(({ value }) => (kinds[name] ?? (() => false))(value)),
      name,
    );
    const labels = new Set(drawn.map(({ label }) => label));
    assert.ok(labels.has('random') && labels.size > 1, `${name}: ${[...labels].join(', ')}`);
    const again = fc.sample(category.random, { seed: 7, numRuns: 20 }).map((value) => fc.stringify(value));
    assert.deepEqual(
      fc.sample(category.random, { seed: 7, numRuns: 20 }).map((value) => fc.stringify(value)),
      again,
    );
  }
});

test('a counterexample prints the label of its case, even for a value fast-check cannot inspect', () => {
  const property = fc.property(
    adversarial.hostile.arbitrary.filter(({ label }) => label === 'revoked Proxy'),
    ({ value }) => Object.keys(value).length >= 0,
  );
  assert.throws(() => fc.assert(property, { seed: 1, numRuns: 5 }), /Counterexample: \[hostile: revoked Proxy\]/);
});

test('random Unicode strings reach lone surrogates, joiners and directional controls', () => {
  const strings = fc.sample(adversarial.unicode.random, { seed: 1, numRuns: 500 }).join('');
  assert.match(strings, LONE_SURROGATE);
  assert.match(strings, /‍/u);
  assert.match(strings, /[‮⁦⁩]/u);
});

test('random hostile objects reach frozen, prototype-less and dangerous-key objects', () => {
  const objects = fc.sample(adversarial.hostile.random, { seed: 1, numRuns: 500 });
  assert.ok(objects.some((value) => !types.isProxy(value) && Object.isFrozen(value)));
  assert.ok(objects.some((value) => !types.isProxy(value) && Object.getPrototypeOf(value) === null));
  assert.ok(objects.some((value) => types.isProxy(value)));
  assert.ok(objects.some((value) => !types.isProxy(value) && Object.hasOwn(value, '__proto__')));
});
