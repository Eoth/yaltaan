import assert from 'node:assert/strict';
import { test } from 'node:test';

import { judgeExport, TAG_DEFINITIONS, type PublicExport, type Tag } from '../lib/contract-tags.ts';

const FULL_CONTRACT: readonly Tag[] = [
  { name: 'pure', text: '' },
  { name: 'sharing', text: 'none' },
  { name: 'complexity', text: 'O(n) (n = number of keys)' },
  { name: 'throws', text: 'never' },
  { name: 'since', text: '0.1' },
  { name: 'experimental', text: '' },
];

function callable(tags: readonly Tag[], parameters: readonly string[] = ['source', 'keys']): PublicExport {
  return {
    name: 'omit',
    kind: 'callable',
    kindDetail: 'function',
    value: true,
    tags,
    parameters,
    documentation: '',
    declarations: [],
  };
}

function typeExport(tags: readonly Tag[]): PublicExport {
  return { ...callable(tags, []), name: 'Pair', kind: 'type', kindDetail: 'type', value: false };
}

/** The full contract without the tags named in `removed`, then `added`. */
function contractWith(added: readonly Tag[], removed: readonly string[] = []): readonly Tag[] {
  return [...FULL_CONTRACT.filter((tag) => !removed.includes(tag.name)), ...added];
}

function assertOneProblem(entry: PublicExport, fragment: string): void {
  const problems = judgeExport(entry);
  assert.equal(problems.length, 1, `expected one problem, got: ${JSON.stringify(problems)}`);
  assert.ok(problems[0]?.includes(fragment), `"${problems[0]}" does not mention "${fragment}"`);
}

test('a function with its whole contract passes', () => {
  assert.deepEqual(judgeExport(callable(FULL_CONTRACT)), []);
});

test('documentary tags pass where they mean something', () => {
  const tags = contractWith([
    { name: 'param', text: 'keys the keys to leave out' },
    { name: 'returns', text: 'a copy' },
    { name: 'typeParam', text: 'T the object type' },
    { name: 'example', text: "omit({ a: 1 }, ['a']);" },
    { name: 'see', text: 'pick' },
    { name: 'deprecated', text: 'use without' },
  ]);
  assert.deepEqual(judgeExport(callable(tags)), []);
});

test('an export that never runs carries @since and its stability only', () => {
  const tags = [
    { name: 'since', text: '0.1' },
    { name: 'stable', text: '' },
  ];
  assert.deepEqual(judgeExport(typeExport(tags)), []);
  assert.deepEqual(judgeExport({ ...typeExport(tags), kind: 'constant', value: true }), []);
  assertOneProblem(typeExport([...tags, { name: 'pure', text: '' }]), '@pure, which does not apply to a type');
  assertOneProblem(typeExport([...tags, { name: 'sharing', text: 'none' }]), 'does not apply to a type');
});

test('an export without tags fails on every required tag and group', () => {
  const problems = judgeExport(callable([]));
  assert.deepEqual(problems, [
    'lacks @sharing',
    'lacks @complexity',
    'lacks @throws',
    'lacks @since',
    'lacks @pure or @mutates',
    'lacks @experimental or @stable',
  ]);
  assert.deepEqual(judgeExport(typeExport([])), ['lacks @since', 'lacks @experimental or @stable']);
});

test('each required tag of the list is required', () => {
  const required = TAG_DEFINITIONS.filter((definition) => definition.presence === 'required');
  assert.ok(required.length >= 4);
  for (const definition of required) {
    assertOneProblem(callable(contractWith([], [definition.name])), `lacks @${definition.name}`);
  }
});

test('an unknown tag fails, a misspelt contract tag included', () => {
  assertOneProblem(callable(contractWith([{ name: 'internal', text: '' }])), '@internal, which is not a known tag');
  assertOneProblem(callable(contractWith([{ name: 'mutate', text: 'source' }])), '@mutate, which is not a known tag');
});

test('@mutates names a parameter of the export, once', () => {
  const mutating = contractWith([{ name: 'mutates', text: 'source' }], ['pure']);
  assert.deepEqual(judgeExport(callable(mutating)), []);
  assertOneProblem(
    callable(contractWith([{ name: 'mutates', text: 'target' }], ['pure'])),
    '@mutates: names "target", which is not a parameter (its parameters are source, keys)',
  );
  assertOneProblem(
    callable(contractWith([{ name: 'mutates', text: 'x' }], ['pure']), []),
    'which is not a parameter (it has none)',
  );
  assertOneProblem(callable(contractWith([{ name: 'mutates', text: '' }], ['pure'])), '@mutates: names no parameter');
  assertOneProblem(
    callable(contractWith([{ name: 'mutates', text: 'source and keys' }], ['pure'])),
    'names "source and keys", which is not a parameter',
  );
  assertOneProblem(callable([...mutating, { name: 'mutates', text: 'source' }]), '@mutates names "source" more than');
  const both = [...mutating, { name: 'mutates', text: 'keys' }];
  assert.deepEqual(judgeExport(callable(both)), []);
});

test('@param names a parameter first', () => {
  assertOneProblem(callable(contractWith([{ name: 'param', text: 'target the object' }])), 'not a parameter');
});

test('exclusive tags exclude each other', () => {
  assertOneProblem(
    callable(contractWith([{ name: 'mutates', text: 'source' }])),
    'carries @pure and @mutates, which exclude each other',
  );
  assertOneProblem(callable(contractWith([{ name: 'stable', text: '' }])), '@experimental and @stable, which exclude');
  assertOneProblem(
    callable(contractWith([{ name: 'throws', text: 'when keys is not an array' }])),
    '@throws never excludes every other @throws',
  );
  const conditions = contractWith(
    [
      { name: 'throws', text: 'when keys is not an array' },
      { name: 'throws', text: 'when source is frozen' },
    ],
    ['throws'],
  );
  assert.deepEqual(judgeExport(callable(conditions)), []);
});

test('a tag written once cannot repeat', () => {
  assertOneProblem(callable(contractWith([{ name: 'since', text: '0.2' }])), 'carries @since 2 times');
  assertOneProblem(
    callable(
      contractWith([
        { name: 'returns', text: 'a' },
        { name: 'returns', text: 'b' },
      ]),
    ),
    '2 times',
  );
});

test('values follow the grammar of their tag', () => {
  const replaced = (name: string, text: string): PublicExport => callable(contractWith([{ name, text }], [name]));
  assertOneProblem(replaced('pure', 'mostly'), '@pure: takes no value, found "mostly"');
  assertOneProblem(replaced('experimental', 'yes'), '@experimental: takes no value');
  assertOneProblem(replaced('sharing', 'shallow'), '@sharing: is "shallow", not none, structural, identity-preserving');
  assertOneProblem(replaced('complexity', 'linear'), '@complexity: is "linear", which is not starts with `O(`');
  assertOneProblem(replaced('throws', ''), '@throws: has no text');
  for (const version of ['1', '0.1.0', 'v0.1', '01.2', '0.01', '']) {
    assertOneProblem(replaced('since', version), 'which is not MAJOR.MINOR');
  }
  for (const version of ['0.0', '0.12', '10.3']) {
    assert.deepEqual(judgeExport(replaced('since', version)), []);
  }
});

test('a kind no tag covers fails, whatever its tags', () => {
  const namespace = { ...callable(FULL_CONTRACT), kind: 'other', kindDetail: 'namespace or namespace re-export' };
  assert.deepEqual(judgeExport(namespace as PublicExport), [
    'is a namespace or namespace re-export, which no contract tag covers: export functions, classes, constants and ' +
      'types',
  ]);
});

test('a class carries the whole contract, naming its constructor parameters', () => {
  const box = { ...callable(contractWith([{ name: 'mutates', text: 'value' }], ['pure']), ['value']), kind: 'class' };
  assert.deepEqual(judgeExport(box as PublicExport), []);
  assertOneProblem({ ...box, tags: contractWith([], ['complexity']) } as PublicExport, 'lacks @complexity');
});
