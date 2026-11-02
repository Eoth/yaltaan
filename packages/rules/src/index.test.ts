import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Issue } from '@yaltaan/core/issue';
import type { Path } from '@yaltaan/core/path';
import { number, object, optional, parse, string } from '@yaltaan/schema';
import { assertType, declareAdversarial, fc, HostileError, type Callback, type Equal } from '@yaltaan/testing';
import { readStandard } from '@yaltaan/testing/schema-judge';
import * as v from 'valibot';

import {
  allOrNone,
  anyElement,
  assertDeclaredReads,
  atLeast,
  checkRules,
  each,
  exactly,
  mutuallyExclusive,
  ordered,
  refine,
  requiredIf,
  requiredPaths,
  unique,
  type Rule,
} from './index.ts';

const SUBPATH = '@yaltaan/rules';

const FIELDS: readonly Path[] = [['a'], ['b'], ['c', 'd'], ['c', 'e'], ['toString'], ['f', 0]];
const BLANKS: readonly unknown[] = [undefined, null, '', []];
const FILLED: readonly unknown[] = [0, false, 'x', ' ', 1, ['y'], {}, Number.NaN];

function write(target: Record<PropertyKey, unknown>, path: Path, value: unknown): void {
  let current = target;
  path.forEach((segment, index) => {
    const key = segment as PropertyKey;
    if (index === path.length - 1) {
      current[key] = value;
      return;
    }
    if (!Object.hasOwn(current, key)) {
      current[key] = typeof path[index + 1] === 'number' ? [] : {};
    }
    current = current[key] as Record<PropertyKey, unknown>;
  });
}

function valuesOf(entries: readonly (readonly [Path, unknown])[]): Record<PropertyKey, unknown> {
  const values: Record<PropertyKey, unknown> = {};
  for (const [path, value] of entries) {
    write(values, path, value);
  }
  return values;
}

// Nothing, a blank or a value at each field: an absent key must read as a blank one.
const fieldValues: fc.Arbitrary<Record<PropertyKey, unknown>> = fc
  .tuple(
    ...FIELDS.map((path) =>
      fc.oneof(
        fc.constant(undefined),
        fc.constantFrom(...BLANKS).map((value) => [path, value] as const),
        fc.constantFrom(...FILLED).map((value) => [path, value] as const),
      ),
    ),
  )
  .map((entries) => valuesOf(entries.filter((entry) => entry !== undefined)));

const groups: fc.Arbitrary<Path[]> = fc.shuffledSubarray([...FIELDS], { minLength: 2 });

const element = fc.record(
  {
    id: fc.oneof(fc.constant(undefined), fc.string()),
    name: fc.constantFrom('x', 'X', 'y', '', undefined),
    on: fc.boolean(),
  },
  { requiredKeys: [] },
);

const listValues = fc.record({ list: fc.array(element, { maxLength: 6 }), a: fc.anything() }, { requiredKeys: [] });

// Every built-in rule, on the fields or the list the values below may hold.
const ruleCases: fc.Arbitrary<Rule> = fc.oneof(
  groups.map((paths) => allOrNone(paths)),
  groups.map((paths) => mutuallyExclusive(paths)),
  fc.tuple(groups, fc.nat({ max: 2 })).map(([paths, n]) => atLeast(n, paths)),
  fc.tuple(groups, fc.nat({ max: 2 })).map(([paths, n]) => exactly(n, paths)),
  fc
    .tuple(groups, fc.boolean())
    .map(([paths, holds]) => requiredIf({ reads: paths.slice(0, 1), when: () => holds }, paths.slice(1))),
  fc.tuple(groups, fc.boolean()).map(([[start, end], strict]) => ordered(start!, end!, { strict })),
  fc.nat({ max: 2 }).map((n) => atLeast(n, { list: ['list'], at: ['name'], where: (name) => name === 'x' })),
  fc.nat({ max: 2 }).map((n) => exactly(n, { list: ['list'], at: ['name'], where: (name) => name === 'x' })),
  fc
    .constantFrom<readonly Path[]>([], [['id']])
    .map((identities) => unique(['list'], ['name'], identities[0] === undefined ? {} : { identity: identities[0] })),
  fc
    .constantFrom<readonly Path[]>([], [['id']])
    .map((identities) =>
      each(
        ['list'],
        [
          requiredIf({ reads: [['on']], when: (on) => on === true }, [['name']]),
          allOrNone([['name'], ['id']]),
          ordered(['id'], ['name']),
        ],
        identities[0] === undefined ? {} : { identity: identities[0] },
      ),
    ),
);

const anyValues = fc.oneof(fieldValues, listValues, fc.anything());

function freezeDeep(value: unknown): void {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      freezeDeep((value as Record<PropertyKey, unknown>)[key]);
    }
  }
}

function pathsOf(issues: readonly Issue[]): readonly Path[] {
  return issues.map((issue) => issue.path);
}

// Whether `path` is one a rule declared: `anyElement` stands for an index or a `{ key }`, nothing else.
function matches(pattern: Path, path: Path): boolean {
  return (
    pattern.length === path.length &&
    pattern.every((segment, index) => {
      const actual = path[index];
      return segment === anyElement ? typeof actual === 'number' || typeof actual === 'object' : segment === actual;
    })
  );
}

const subsets = (paths: readonly Path[]): (readonly Path[])[] =>
  paths.reduce<Path[][]>((all, path) => [...all, ...all.map((subset) => [...subset, path])], [[]]);

// The table of ARCHITECTURE.md §7.10, written before the code: for every count of filled fields, which fields a rule
// marks and which it requires. `filled` and `blank` partition the group.
const TABLE = [
  {
    name: 'atLeast',
    build: (n: number, paths: readonly Path[]) => atLeast(n, paths),
    code: 'rules.at_least',
    marked: (n: number, filled: readonly Path[], blank: readonly Path[]) => (filled.length >= n ? [] : blank),
    required: (n: number, filled: readonly Path[], blank: readonly Path[]) =>
      filled.length < n && n - filled.length === blank.length ? blank : [],
    params: (n: number, filled: readonly Path[]) => ({ minimum: n, count: filled.length }),
  },
  {
    name: 'exactly',
    build: (n: number, paths: readonly Path[]) => exactly(n, paths),
    code: 'rules.exactly',
    marked: (n: number, filled: readonly Path[], blank: readonly Path[]) =>
      filled.length === n ? [] : filled.length < n ? blank : filled,
    required: (n: number, filled: readonly Path[], blank: readonly Path[]) =>
      filled.length < n && n - filled.length === blank.length ? blank : [],
    params: (n: number, filled: readonly Path[]) => ({ expected: n, count: filled.length }),
  },
  {
    name: 'allOrNone',
    build: (_: number, paths: readonly Path[]) => allOrNone(paths),
    code: 'rules.all_or_none',
    marked: (_: number, filled: readonly Path[], blank: readonly Path[]) => (filled.length > 0 ? blank : []),
    required: (_: number, filled: readonly Path[], blank: readonly Path[]) => (filled.length > 0 ? blank : []),
    params: () => undefined,
  },
  {
    name: 'mutuallyExclusive',
    build: (_: number, paths: readonly Path[]) => mutuallyExclusive(paths),
    code: 'rules.mutually_exclusive',
    marked: (_: number, filled: readonly Path[]) => (filled.length > 1 ? filled : []),
    required: () => [],
    params: () => undefined,
  },
] as const;

test('every count rule marks and requires what its table says, for every field filled or blank', () => {
  const groupsOfFields = [FIELDS.slice(0, 2), FIELDS.slice(0, 3), FIELDS.slice(2, 6), FIELDS];
  for (const row of TABLE) {
    for (const group of groupsOfFields) {
      for (let n = 0; n <= group.length; n += 1) {
        for (const filled of subsets(group)) {
          const blank = group.filter((path) => !filled.includes(path));
          for (const empty of BLANKS) {
            const rule = row.build(n, group);
            const values = valuesOf([
              ...filled.map((path) => [path, 'x'] as const),
              ...blank.map((path) => [path, empty] as const),
            ]);
            const params = row.params(n, filled);
            assert.deepStrictEqual(
              rule.check(values),
              row
                .marked(n, filled, blank)
                .map((path) => (params === undefined ? { code: row.code, path } : { code: row.code, path, params })),
              `${row.name}(${n}), ${filled.length} of ${group.length} filled`,
            );
            assert.deepStrictEqual(requiredPaths([rule], values), row.required(n, filled, blank), `${row.name}(${n})`);
          }
        }
      }
    }
  }
});

test('requiredIf requires its fields exactly while its condition holds, and marks the blank ones', () => {
  fc.assert(
    fc.property(fieldValues, groups, fc.boolean(), (values, [from, ...targets], holds) => {
      const seen: unknown[][] = [];
      const rule = requiredIf(
        {
          reads: [from!],
          when: (...read) => {
            seen.push([...read]);
            return holds;
          },
        },
        targets,
      );
      const isBlank = (path: Path): boolean => {
        let current: unknown = values;
        for (const segment of path) {
          const key = segment as PropertyKey;
          current =
            typeof current === 'object' && current !== null && Object.hasOwn(current, key)
              ? (current as Record<PropertyKey, unknown>)[key]
              : undefined;
        }
        return BLANKS.some(
          (blank) =>
            assert.ok !== undefined &&
            (Array.isArray(blank) ? Array.isArray(current) && current.length === 0 : blank === current),
        );
      };
      assert.deepStrictEqual(
        rule.check(values),
        (holds ? targets.filter(isBlank) : []).map((path) => ({ code: 'rules.required_if', path })),
      );
      assert.deepStrictEqual(rule.required?.(values), holds ? targets : []);
      assert.ok(seen.every((read) => read.length === 1));
    }),
    { numRuns: 300 },
  );
});

test('a blank is undefined, null, an empty string or an empty array, and nothing else', () => {
  const rule = requiredIf({ reads: [['on']], when: () => true }, [['a']]);
  for (const blank of BLANKS) {
    assert.equal(rule.check({ a: blank }).length, 1, String(blank));
  }
  fc.assert(
    fc.property(fc.anything(), (value) => {
      const empty =
        value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
      assert.equal(rule.check({ a: value }).length, empty ? 1 : 0);
    }),
  );
});

test('a name Object.prototype holds is absent, an own key is read, and what is no object has no key', () => {
  const rule = atLeast(1, [['toString'], ['constructor'], ['__proto__']]);
  assert.equal(rule.check({}).length, 3);
  assert.equal(rule.check({ toString: 'x' }).length, 0);
  assert.equal(rule.check(JSON.parse('{"__proto__":"x"}')).length, 0);
  assert.equal(rule.check(Object.create({ toString: 'inherited' })).length, 3);
  for (const values of [null, undefined, 1, 'text', true, Symbol.iterator]) {
    assert.equal(rule.check(values).length, 3, String(values));
  }
});

test('atLeast is monotonic: filling a field or adding an element that counts creates no issue', () => {
  fc.assert(
    fc.property(fieldValues, groups, fc.nat({ max: 3 }), fc.constantFrom(...FILLED), (values, paths, n, value) => {
      const rule = atLeast(Math.min(n, paths.length), paths);
      const before = pathsOf(rule.check(values));
      for (const path of paths) {
        const copy = structuredClone(values);
        write(copy, path, value);
        for (const after of pathsOf(rule.check(copy))) {
          assert.ok(before.includes(after), 'an issue appeared');
        }
      }
    }),
    { numRuns: 300 },
  );
  fc.assert(
    fc.property(fc.array(fc.boolean(), { maxLength: 6 }), fc.nat({ max: 7 }), fc.nat({ max: 6 }), (flags, n, place) => {
      const rule = atLeast(n, { list: ['list'], where: (item) => item === true });
      const more = flags.toSpliced(place, 0, true);
      if (rule.check({ list: flags }).length === 0) {
        assert.deepStrictEqual(rule.check({ list: more }), []);
      }
    }),
    { numRuns: 300 },
  );
});

test('a count over a list reads each element once, and marks the list with what it found', () => {
  const list = [{ on: true }, { on: false }, { on: true }];
  const seen: unknown[] = [];
  const rule = exactly(1, {
    list: ['list'],
    where: (item) => {
      seen.push(item);
      return (item as { on: boolean }).on;
    },
  });
  assert.deepStrictEqual(rule.check({ list }), [
    { code: 'rules.exactly', path: ['list'], params: { expected: 1, count: 2 } },
  ]);
  assert.deepStrictEqual(seen, list);
  assert.deepStrictEqual(rule.required, undefined);
  for (const absent of [{}, { list: 'not a list' }, { list: null }]) {
    assert.deepStrictEqual(rule.check(absent), [
      { code: 'rules.exactly', path: ['list'], params: { expected: 1, count: 0 } },
    ]);
  }
  assert.deepStrictEqual(exactly(0, { list: ['list'], where: () => true }).check({}), []);
  // Only an array has elements: a string or an object with a length has none, in every rule that walks a list.
  const anything = (): boolean => true;
  for (const list of ['text', { length: 3, 0: 'a', 1: 'a' }, 3, new Set([1])]) {
    assert.deepStrictEqual(atLeast(1, { list: ['list'], where: anything }).check({ list }), [
      { code: 'rules.at_least', path: ['list'], params: { minimum: 1, count: 0 } },
    ]);
    assert.deepStrictEqual(unique(['list'], [], { by: () => 'same' }).check({ list }), []);
    assert.deepStrictEqual(each(['list'], [atLeast(1, [['a']])]).check({ list }), []);
  }
});

test('a check is deterministic, and a rule writes nothing', () => {
  fc.assert(
    fc.property(ruleCases, anyValues, (rule, values) => {
      // Frozen: in a module, which is strict, a write throws.
      freezeDeep(values);
      const first = checkRules([rule], values);
      assert.deepStrictEqual(checkRules([rule], values), first);
      assert.deepStrictEqual(requiredPaths([rule], values), requiredPaths([rule], values));
    }),
    { numRuns: 500 },
  );
});

test('a built-in rule reads only what it declares, on any values', () => {
  fc.assert(
    fc.property(ruleCases, anyValues, (rule, values) => assertDeclaredReads(rule, values)),
    { numRuns: 1000 },
  );
});

test('an issue and a required path stand on a declared target, and a required blank has its issue', () => {
  fc.assert(
    fc.property(ruleCases, anyValues, (rule, values) => {
      const issues = rule.check(values);
      for (const { path } of issues) {
        assert.ok(
          rule.targets.some((target) => matches(target, path)),
          `no target for ${String(path)}`,
        );
      }
      for (const path of rule.required?.(values) ?? []) {
        assert.ok(
          rule.targets.some((target) => matches(target, path)),
          `no target for ${String(path)}`,
        );
      }
    }),
    { numRuns: 1000 },
  );
  fc.assert(
    fc.property(fieldValues, groups, fc.nat({ max: 2 }), (values, paths, n) => {
      for (const rule of [
        atLeast(Math.min(n, paths.length), paths),
        exactly(Math.min(n, paths.length), paths),
        allOrNone(paths),
      ]) {
        const marked = pathsOf(rule.check(values));
        for (const path of rule.required?.(values) ?? []) {
          assert.ok(marked.includes(path), 'a required field left blank has no issue');
        }
      }
    }),
    { numRuns: 500 },
  );
});

test('each gives the issues of its rules on every element, with the path of the element in front', () => {
  const inner: readonly Rule[] = [
    requiredIf({ reads: [['on']], when: (on) => on === true }, [['name']]),
    allOrNone([['name'], ['id']]),
  ];
  fc.assert(
    fc.property(fc.array(element, { maxLength: 6 }), (list) => {
      const expected = list.flatMap((item, index) =>
        checkRules(inner, item).map((issue) => ({ ...issue, path: ['list', index, ...issue.path] })),
      );
      assert.deepStrictEqual(each(['list'], inner).check({ list }), expected);
      assert.deepStrictEqual(
        requiredPaths([each(['list'], inner)], { list }),
        list.flatMap((item, index) => requiredPaths(inner, item).map((path) => ['list', index, ...path])),
      );
    }),
    { numRuns: 300 },
  );
  assert.deepStrictEqual(each(['list'], inner).check({}), []);
  assert.deepStrictEqual(each(['list'], inner).check({ list: 'not a list' }), []);
  assert.deepStrictEqual(each(['list'], []).check({ list: [1, 2] }), []);
  // An issue keeps all it holds, its path aside, and the list of rules is taken when the rule is built.
  const counting = [atLeast(1, [['a']])];
  const walking = each(['list'], counting);
  counting.pop();
  assert.deepStrictEqual(walking.check({ list: [{}] }), [
    { code: 'rules.at_least', path: ['list', 0, 'a'], params: { minimum: 1, count: 0 } },
  ]);
  // Walking the list is a read, even for rules that declare none.
  assertDeclaredReads(each(['list'], []), { list: [1, 2] });
  assertDeclaredReads(each(['list'], [{ reads: [], targets: [], check: () => [] }]), { list: [{ a: 1 }] });
});

test('with an identity, an issue names its element by key and follows it when the list is reordered', () => {
  const inner = [requiredIf({ reads: [['on']], when: (on) => on === true }, [['name']])];
  const sorted = (issues: readonly Issue[]): string[] => issues.map((issue) => JSON.stringify(issue)).sort();
  fc.assert(
    fc.property(
      fc
        .uniqueArray(fc.string({ minLength: 1 }), { maxLength: 6 })
        .chain((keys) =>
          fc.tuple(
            fc.constant(keys.map((id, index) => ({ id, on: index % 2 === 0 }))),
            fc.shuffledSubarray(keys, { minLength: keys.length }),
          ),
        ),
      ([list, order]) => {
        const moved = order.map((id) => list.find((item) => item.id === id));
        const rule = each(['list'], inner, { identity: ['id'] });
        assert.deepStrictEqual(sorted(rule.check({ list: moved })), sorted(rule.check({ list })));
        const twice = unique(['list'], ['on'], { by: () => 'same', identity: ['id'] });
        assert.deepStrictEqual(sorted(twice.check({ list: moved })), sorted(twice.check({ list })));
        for (const { path } of rule.check({ list })) {
          assert.deepStrictEqual(path.slice(0, 1), ['list']);
          assert.ok(typeof path[1] === 'object' && list.some((item) => item.id === (path[1] as { key: unknown }).key));
        }
      },
    ),
    { numRuns: 200 },
  );
  // An element whose field is absent or blank is named by its index, since a blank names nothing.
  for (const blank of [{}, ...BLANKS.map((id) => ({ id }))]) {
    assert.deepStrictEqual(
      pathsOf(each(['list'], inner, { identity: ['id'] }).check({ list: [{ on: true, ...blank }] })),
      [['list', 0, 'name']],
    );
  }
  // A number or false is a key.
  for (const id of [0, false]) {
    assert.deepStrictEqual(pathsOf(each(['list'], inner, { identity: ['id'] }).check({ list: [{ on: true, id }] })), [
      ['list', { key: id }, 'name'],
    ]);
  }
});

test('lists nest: a rule of an inner list comes back with both elements in its path', () => {
  const rule = each(
    ['products'],
    [each(['tiers'], [requiredIf({ reads: [['on']], when: (on) => on === true }, [['rate']])], { identity: ['id'] })],
    { identity: ['id'] },
  );
  assert.deepStrictEqual(rule.check({ products: [{ id: 'p', tiers: [{ on: false }, { id: 't', on: true }] }] }), [
    { code: 'rules.required_if', path: ['products', { key: 'p' }, 'tiers', { key: 't' }, 'rate'] },
  ]);
  assert.deepStrictEqual(rule.reads, [
    ['products', anyElement, 'id'],
    ['products', anyElement, 'tiers', anyElement, 'id'],
    ['products', anyElement, 'tiers', anyElement, 'on'],
    ['products', anyElement, 'tiers', anyElement, 'rate'],
  ]);
  assertDeclaredReads(rule, { products: [{ id: 'p', tiers: [{ on: false }, { id: 't', on: true }] }] });
});

test('unique marks every element that shares a key, once, and what an oracle of all pairs marks', () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom('a', 'A', 'b', 'c', '', undefined, null, 0, -0, Number.NaN, 1), { maxLength: 12 }),
      (keys) => {
        const list = keys.map((key) => ({ key }));
        const blank = (key: unknown): boolean => key === undefined || key === null || key === '';
        const same = (x: unknown, y: unknown): boolean => x === y || (x !== x && y !== y);
        const expected = keys.flatMap((key, index) =>
          !blank(key) && keys.some((other, at) => at !== index && same(other, key)) ? [index] : [],
        );
        const marked = pathsOf(unique(['list'], ['key']).check({ list }))
          .map((path) => path[1] as number)
          .sort((x, y) => x - y);
        assert.deepStrictEqual(marked, expected);
      },
    ),
    { numRuns: 500 },
  );
  assert.deepStrictEqual(unique(['list'], ['name']).check({}), []);
  assert.deepStrictEqual(unique(['list'], ['name']).check({ list: 'a string' }), []);
  // Compared by identity: two equal objects are two keys, and the same one twice is one.
  assert.deepStrictEqual(unique(['list'], []).check({ list: [{}, {}] }), []);
  const shared = {};
  assert.equal(unique(['list'], []).check({ list: [shared, shared] }).length, 2);
  // A blank value is not compared, even the same empty array twice.
  const empty: unknown[] = [];
  assert.deepStrictEqual(unique(['list'], []).check({ list: [empty, empty] }), []);
  // A blank answer of `by` is not compared either.
  for (const blank of BLANKS) {
    assert.deepStrictEqual(unique(['list'], [], { by: () => blank }).check({ list: ['a', 'b'] }), []);
  }
  // What is compared is what `by` gives, and the issue stands at `at`.
  const lower = unique(['list'], ['mail'], { by: (mail) => String(mail).toLowerCase() });
  assert.deepStrictEqual(lower.check({ list: [{ mail: 'A' }, { mail: 'a' }, { mail: 'b' }] }), [
    { code: 'rules.unique', path: ['list', 0, 'mail'] },
    { code: 'rules.unique', path: ['list', 1, 'mail'] },
  ]);
  assert.deepStrictEqual(lower.reads, [['list', anyElement, 'mail']]);
  assert.deepStrictEqual(lower.targets, [['list'], ['list', anyElement, 'mail']]);
});

test(
  'a key over 16,000 code units is compared on them: same-length keys, which V8 hashes alike, stay linear',
  { timeout: 10_000 },
  () => {
    const long = 'x'.repeat(16_000);
    // Same-length keys that differ past the limit are one key; before it, two.
    assert.equal(unique(['list'], []).check({ list: [`${long}a`, `${long}b`] }).length, 2);
    assert.deepStrictEqual(unique(['list'], []).check({ list: [`a${long}`, `b${long}`] }), []);
    const last = long.slice(1);
    assert.deepStrictEqual(unique(['list'], []).check({ list: [`${last}a`, `${last}b`] }), []);
    // 68 MB of keys of one length, distinct and the same alike: 16.6 s when they all collide in a Map.
    const tail = 'y'.repeat(17_000 - 8);
    const distinct = Array.from({ length: 4000 }, (_, index) => `${String(index).padStart(8, '0')}${tail}`);
    assert.deepStrictEqual(unique(['list'], []).check({ list: distinct }), []);
    const late = Array.from({ length: 4000 }, (_, index) => `${tail}${String(index).padStart(8, '0')}`);
    assert.equal(unique(['list'], []).check({ list: late }).length, 1001);
    assert.deepStrictEqual(unique(['list'], [], { by: (key) => [key] }).check({ list: late.slice(0, 2) }), []);
  },
);

test('a callback only meets what is not blank, so that a row just added cannot make a validator throw', () => {
  const noBlank = (value: unknown): unknown => {
    assert.ok(value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0));
    return value;
  };
  const rows = fc.array(
    fc.oneof(
      fc.constantFrom(...BLANKS),
      fc.constantFrom(...BLANKS).map((key) => ({ key })),
      fc.constantFrom(...FILLED).map((key) => ({ key })),
      fc.constant({}),
    ),
    { maxLength: 6 },
  );
  fc.assert(
    fc.property(
      rows,
      fc.constantFrom(...BLANKS, ...FILLED),
      fc.constantFrom(...BLANKS, ...FILLED),
      (list, from, to) => {
        unique(['list'], ['key'], { by: noBlank }).check({ list });
        atLeast(1, { list: ['list'], at: ['key'], where: (value) => noBlank(value) === value }).check({ list });
        exactly(1, { list: ['list'], at: ['key'], where: (value) => noBlank(value) === value }).check({ list });
        ordered(['from'], ['to'], {
          compare: (start, end) => {
            noBlank(start);
            noBlank(end);
            return -1;
          },
        }).check({ from, to });
      },
    ),
    { numRuns: 500 },
  );
  // A count with no `where` counts what is not blank, at `at` or the element itself.
  const list = [{ mail: 'a' }, { mail: '' }, {}, null, 'text', 0];
  assert.deepStrictEqual(atLeast(9, { list: ['list'], at: ['mail'] }).check({ list })[0]?.params, {
    minimum: 9,
    count: 1,
  });
  assert.deepStrictEqual(atLeast(9, { list: ['list'] }).check({ list })[0]?.params, { minimum: 9, count: 5 });
  assert.deepStrictEqual(atLeast(1, { list: ['list'], at: ['mail'] }).reads, [['list', anyElement, 'mail']]);
});

test('a path does not read through a string, nor what the values hand out twice over', () => {
  // A string has own keys, but holds no field: the rule sees a blank.
  assert.equal(atLeast(1, [['a', 0]]).check({ a: 'xyz' }).length, 1);
  assert.equal(atLeast(1, [['a', 'length']]).check({ a: 'xyz' }).length, 1);
  // What one check returns is its own: changing it changes no later check.
  const quiet = ordered(['a'], ['b']);
  (quiet.check({}) as unknown[]).push('planted');
  assert.deepStrictEqual(quiet.check({}), []);
  assert.deepStrictEqual(unique(['list'], []).check({}), []);
  assert.deepStrictEqual(allOrNone([['a'], ['b']]).required?.({}), []);
  (allOrNone([['a'], ['b']]).required?.({}) as unknown[]).push('planted');
  assert.deepStrictEqual(mutuallyExclusive([['a'], ['b']]).required?.({}), []);
});

test('a list is read once and its length once, whatever it answers the second time', () => {
  let lists = 0;
  const values = {
    get list(): unknown[] {
      lists += 1;
      return lists === 1 ? [1] : new Array(2_000_000).fill(1);
    },
  };
  let walked = 0;
  const counting: Rule = {
    reads: [],
    targets: [],
    check: () => {
      walked += 1;
      return [];
    },
  };
  each(['list'], [counting]).check(values);
  assert.equal(lists, 1);
  assert.equal(walked, 1);
  let lengths = 0;
  const growing = new Proxy([1, 2, 3], {
    get: (target, key, receiver) => {
      if (key === 'length') {
        lengths += 1;
      }
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  for (const rule of [
    unique(['list'], []),
    atLeast(0, { list: ['list'] }),
    exactly(3, { list: ['list'] }),
    each(['list'], []),
  ]) {
    lengths = 0;
    assert.deepStrictEqual(rule.check({ list: growing }), []);
    assert.equal(lengths, 1, 'one read of the length');
  }
  // In `required` too.
  lists = 0;
  each(['list'], [counting]).required?.(values);
  assert.equal(lists, 1);
  lengths = 0;
  each(['list'], []).required?.({ list: growing });
  assert.equal(lengths, 1, 'one read of the length');
});

test('ordered compares what < can order, refuses the later one only, and leaves a blank to another rule', () => {
  const rule = ordered(['from'], ['to']);
  const strict = ordered(['from'], ['to'], { strict: true });
  const mark = [{ code: 'rules.ordered', path: ['to'] }];
  fc.assert(
    fc.property(fc.double({ noNaN: true }), fc.double({ noNaN: true }), (from, to) => {
      assert.deepStrictEqual(rule.check({ from, to }), from > to ? mark : []);
      assert.deepStrictEqual(strict.check({ from, to }), from >= to ? mark : []);
    }),
  );
  fc.assert(
    fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (from, to) => {
      assert.deepStrictEqual(rule.check({ from, to }), from > to ? mark : []);
      assert.deepStrictEqual(strict.check({ from, to }), from >= to ? mark : []);
    }),
  );
  assert.deepStrictEqual(rule.check({ from: '2026-10-31', to: '2026-02-01' }), mark);
  // Equal values, which the two laws above rarely draw.
  for (const same of [0, 1.5, 'a', '2026-11-02']) {
    assert.deepStrictEqual(rule.check({ from: same, to: same }), []);
    assert.deepStrictEqual(strict.check({ from: same, to: same }), mark);
  }
  assert.deepStrictEqual(strict.check({ from: 0, to: -0 }), mark);
  // A blank is compared to nothing, even where an empty string would come first.
  const never = ordered(['from'], ['to'], { strict: true, compare: () => assert.fail('a blank was compared') });
  for (const blank of BLANKS) {
    for (const value of [1, 'a', blank]) {
      assert.deepStrictEqual(strict.check({ from: blank, to: value }), []);
      assert.deepStrictEqual(strict.check({ from: value, to: blank }), []);
      assert.deepStrictEqual(never.check({ from: blank, to: value }), []);
      assert.deepStrictEqual(never.check({ from: value, to: blank }), []);
    }
  }
  // A rule that cannot tell does not pass.
  for (const [from, to] of [
    [1, '0'],
    ['1', 0],
    [Number.NaN, 1],
    [1, Number.NaN],
    [Number.NaN, Number.NaN],
    [true, false],
    [{}, {}],
    [1n, 2],
    [new Date(Number.NaN), new Date(0)],
    [new Date(0), 1],
  ]) {
    assert.deepStrictEqual(rule.check({ from, to }), mark, `${String(from)} and ${String(to)} cannot be ordered`);
  }
  // Dates by their time, bigints by value.
  assert.deepStrictEqual(rule.check({ from: new Date(1), to: new Date(0) }), mark);
  assert.deepStrictEqual(rule.check({ from: new Date(0), to: new Date(1) }), []);
  assert.deepStrictEqual(rule.check({ from: new Date(0), to: new Date(0) }), []);
  assert.deepStrictEqual(strict.check({ from: new Date(0), to: new Date(0) }), mark);
  assert.deepStrictEqual(rule.check({ from: 2n, to: 1n }), mark);
  assert.deepStrictEqual(rule.check({ from: 1n, to: 2n }), []);
  assert.deepStrictEqual(strict.check({ from: 1n, to: 1n }), mark);
  // `compare` decides, for what else there is, and an answer that says nothing does not pass either.
  const bySize = ordered(['from'], ['to'], {
    compare: (start, end) => (start as readonly unknown[]).length - (end as readonly unknown[]).length,
  });
  assert.deepStrictEqual(bySize.check({ from: [1, 2], to: [1] }), mark);
  assert.deepStrictEqual(bySize.check({ from: [1], to: [2] }), []);
  assert.deepStrictEqual(ordered(['from'], ['to'], { compare: () => Number.NaN }).check({ from: 1, to: 2 }), mark);
  assert.deepStrictEqual(ordered(['from'], ['to'], { strict: true, compare: () => 0 }).check({ from: 1, to: 1 }), mark);
  assert.deepStrictEqual(rule.required, undefined);
  assert.deepStrictEqual(rule.reads, [['from'], ['to']]);
  assert.deepStrictEqual(rule.targets, [['to']]);
});

test('a list over the limit gets one issue, and no element is read', () => {
  const huge = { list: new Array(1_000_001).fill(1) };
  const boom = (): never => assert.fail('an element was read');
  const issue = [{ code: 'rules.too_large', path: ['list'], params: { maximum: 1_000_000 } }];
  assert.deepStrictEqual(atLeast(1, { list: ['list'], where: boom }).check(huge), issue);
  assert.deepStrictEqual(exactly(1, { list: ['list'], where: boom }).check(huge), issue);
  assert.deepStrictEqual(unique(['list'], [], { by: boom }).check(huge), issue);
  const walked = each(['list'], [{ reads: [], targets: [], check: boom, required: boom }]);
  assert.deepStrictEqual(walked.check(huge), issue);
  assert.deepStrictEqual(requiredPaths([walked], huge), []);
  // On a target the rule declares, like any other issue.
  for (const rule of [atLeast(1, { list: ['list'], where: boom }), unique(['list'], [], { by: boom }), walked]) {
    assert.ok(rule.targets.some((target) => matches(target, ['list'])));
  }
  // The largest length an array can have answers at once.
  assert.deepStrictEqual(unique(['list'], [], { by: boom }).check({ list: new Array(2 ** 32 - 1) }), issue);
  // At the limit, a list is read: a million holes are a million undefined.
  const full = { list: new Array(1_000_000).fill(1) };
  assert.deepStrictEqual(unique(['list'], []).check({ list: new Array(1_000_000) }), []);
  let seen = 0;
  const counted = (): boolean => {
    seen += 1;
    return false;
  };
  assert.deepStrictEqual(atLeast(0, { list: ['list'], where: counted }).check(full), []);
  assert.equal(seen, 1_000_000);
  seen = 0;
  assert.deepStrictEqual(exactly(0, { list: ['list'], where: counted }).check(full), []);
  assert.equal(seen, 1_000_000);
  assert.deepStrictEqual(each(['list'], []).check(full), []);
});

test(
  'a check holds at most 1,000 issues and says so, at the root, in every rule that can pile them up',
  { timeout: 60_000 },
  () => {
    const many = Array.from({ length: 1_000_000 }, () => ({ name: 'same' }));
    const last = { code: 'rules.too_many_issues', path: [], params: { maximum: 1000 } };
    const mark = requiredIf({ reads: [['name']], when: () => true }, [['absent']]);
    for (const rule of [
      unique(['list'], ['name']),
      each(['list'], [mark]),
      each(['list'], [each(['none'], []), mark, mark]),
    ]) {
      const issues = rule.check({ list: many });
      assert.equal(issues.length, 1001);
      assert.deepStrictEqual(issues.at(-1), last);
      assert.equal(issues.filter((issue) => issue.code === last.code).length, 1);
      assert.equal(checkRules([rule, rule], { list: many }).length, 1001);
    }
    assert.equal(requiredPaths([each(['list'], [mark])], { list: many }).length, 1000);
    assert.equal(requiredPaths([each(['list'], [mark]), mark], { list: many }).length, 1000);
    assert.equal(each(['list'], [mark]).required?.({ list: many }).length, 1000, 'each stops by itself');
    // Once full, the walk stops: the rest of a list built to fail is not read.
    let read = 0;
    const walkedOnce: Rule = {
      reads: [],
      targets: [],
      check: () => {
        read += 1;
        return [{ code: 'x', path: [] }];
      },
      required: () => {
        read += 1;
        return [[]];
      },
    };
    each(['list'], [walkedOnce]).check({ list: many });
    assert.equal(read, 1001);
    read = 0;
    each(['list'], [walkedOnce]).required?.({ list: many });
    assert.equal(read, 1000);
    // A million distinct keys are walked in linear time, and hold no issue.
    const distinct = Array.from({ length: 1_000_000 }, (_, index) => ({ name: `${index}` }));
    assert.deepStrictEqual(unique(['list'], ['name']).check({ list: distinct }), []);
  },
);

test('assertDeclaredReads refuses every way of reading what a rule did not declare', () => {
  const rule = (read: (values: Record<string, unknown>) => unknown, reads: readonly Path[] = [['a']]): Rule => ({
    reads,
    targets: [],
    check: (values) => {
      read(values as Record<string, unknown>);
      return [];
    },
  });
  const values = { a: { b: 1, c: [{ d: 1 }, { d: 2 }] }, secret: { deep: 1 }, list: [1, 2] };
  const refused: readonly [string, (read: Record<string, unknown>) => unknown][] = [
    ['a property', (read) => read['secret']],
    ['under a property', (read) => (read['secret'] as Record<string, unknown>)['deep']],
    ['in', (read) => 'secret' in read],
    ['hasOwn', (read) => Object.hasOwn(read, 'secret')],
    ['keys', (read) => Object.keys(read)],
    ['own keys alone', (read) => Reflect.ownKeys(read)],
    ['JSON', (read) => JSON.stringify(read)],
    ['spread', (read) => ({ ...read })],
    ['an element', (read) => (read['list'] as unknown[])[0]],
    ['iteration', (read) => [...(read['list'] as unknown[])]],
    ['a method', (read) => (read['list'] as unknown[]).map((item) => item)],
    ['an absent name', (read) => read['never']],
    ['an inherited name', (read) => read['toString']],
    ['a name with a digit under an element', (read) => (read['list'] as unknown as Record<string, unknown>)['a1']],
  ];
  for (const [name, read] of refused) {
    assert.throws(() => assertDeclaredReads(rule(read), values), /reads what it does not declare/, name);
  }
  // In `required` too.
  assert.throws(
    () =>
      assertDeclaredReads(
        {
          reads: [],
          targets: [],
          check: () => [],
          required: (read) => [[String((read as { secret: unknown }).secret)]],
        },
        values,
      ),
    /secret/,
  );
  const allowed: readonly [string, (read: Record<string, unknown>) => unknown, readonly Path[]][] = [
    ['the declared one', (read) => read['a'], [['a']]],
    ['what it goes through', (read) => read['a'], [['a', 'b']]],
    ['under it', (read) => (read['a'] as Record<string, unknown>)['b'], [['a']]],
    ['keys under it', (read) => Object.keys(read['a'] as object), [['a']]],
    ['a list whole', (read) => (read['list'] as unknown[]).map((item) => item), [['list']]],
    ['an element', (read) => (read['list'] as unknown[])[1], [['list', anyElement]]],
    ['the length', (read) => (read['list'] as unknown[]).length, [['list', anyElement]]],
    ['an index', (read) => (read['list'] as unknown[])[1], [['list', 1]]],
    ['the length as a key', (read) => Object.hasOwn(read['list'] as object, 'length'), [['list']]],
  ];
  for (const [name, read, reads] of allowed) {
    assertDeclaredReads(rule(read, reads), values);
    assert.ok(true, name);
  }
  assert.throws(
    () =>
      assertDeclaredReads(
        rule((read) => Object.keys(read), [['a', 'b']]),
        values,
      ),
    /reads what/,
  );
  assert.throws(
    () =>
      assertDeclaredReads(
        rule((read) => Reflect.ownKeys(read), [['a', 'b']]),
        values,
      ),
    /reads what/,
  );
  // `anyElement` stands for an element: not for a name, nor a `length` that goes on.
  assert.throws(
    () =>
      assertDeclaredReads(
        rule((read) => (read['list'] as unknown as Record<string, unknown>)['name'], [['list', anyElement]]),
        values,
      ),
    /list\.name/,
  );
  assert.throws(
    () =>
      assertDeclaredReads(
        rule((read) => (read['list'] as { length: { x: unknown } }).length.x, [['list', anyElement, 'x']]),
        { list: { length: { x: 1 } } },
      ),
    /list\.length/,
  );
  assert.throws(
    () =>
      assertDeclaredReads(
        rule((read) => (read['a'] as Record<string, unknown>)['c'], [['a', 'b']]),
        values,
      ),
    /a\.c/,
  );
  // A frozen value is read through a view all the same; a Date or a Map keeps its real `this`, and is not traced.
  const frozen = { a: { b: [1] }, at: new Date(0), map: new Map([[1, 2]]) };
  freezeDeep(frozen.a);
  Object.freeze(frozen);
  assertDeclaredReads(
    rule(
      (read) => [
        (read['a'] as { b: number[] }).b[0],
        (read['at'] as Date).getTime(),
        (read['map'] as Map<number, number>).get(1),
      ],
      [['a'], ['at'], ['map']],
    ),
    frozen,
  );
});

test('assertDeclaredReads sees a value as the rule would, frozen or not, with no prototype or not', () => {
  const view = (read: (values: Record<string, unknown>) => void, reads: readonly Path[], values: unknown): void =>
    assertDeclaredReads(
      {
        reads,
        targets: [],
        check: (given) => {
          read(given as Record<string, unknown>);
          return [];
        },
      },
      values,
    );
  // The same read gives the same view: a rule that compares takes the branch it takes on the real values.
  const same = { a: { b: 1 } };
  view((read) => assert.equal(read['a'], read['a']), [['a']], same);
  const shared = {};
  assert.equal(unique(['list'], []).check({ list: [shared, shared] }).length, 2);
  // A frozen list reads like another, by keys, by spread, by a built-in rule.
  const frozen = { list: [1, 2] };
  freezeDeep(frozen);
  view((read) => assert.deepStrictEqual(Object.keys(read['list'] as object), ['0', '1']), [['list']], frozen);
  view((read) => assert.deepStrictEqual([...(read['list'] as number[])], [1, 2]), [['list']], frozen);
  view((read) => assert.deepStrictEqual({ ...(read['list'] as object) }, { 0: 1, 1: 2 }), [['list']], frozen);
  assertDeclaredReads(atLeast(1, [['list', 'length']]), frozen);
  assertDeclaredReads(each(['list'], []), frozen);
  // A descriptor gives a view too: no write and no read gets past it.
  const held = { a: { b: 1 }, secret: { c: 2 } };
  assert.throws(
    () =>
      view(
        (read) => {
          (Object.getOwnPropertyDescriptor(read, 'a')?.value as { b: number }).b = 999;
        },
        [['a']],
        held,
      ),
    /wrote to the values/,
  );
  assert.equal(held.a.b, 1);
  assert.throws(
    () => view((read) => (Object.getOwnPropertyDescriptor(read, 'a')?.value as { x?: unknown }).x, [['a', 'b']], held),
    /a\.x/,
  );
  // A getter of the values answers through the view.
  const withGetter = {
    get a(): { b: number } {
      return { b: 1 };
    },
  };
  view(
    (read) => assert.equal((Object.getOwnPropertyDescriptor(read, 'a')?.value as { b: number }).b, 1),
    [['a']],
    withGetter,
  );
  // An object with no prototype is traced like another.
  const bare = Object.create(null) as Record<string, unknown>;
  bare['secret'] = 1;
  assert.throws(() => view((read) => read['secret'], [['a']], bare), /secret/);
  // A number that passes `anyElement` is an index, and only one.
  assert.throws(
    () =>
      view((read) => (read['list'] as unknown as Record<string, unknown>)['1a'], [['list', anyElement]], { list: [] }),
    /list\.1a/,
  );
});

test('assertDeclaredReads refuses a rule that writes, however it writes', () => {
  const writes: readonly ((values: Record<string, unknown>) => unknown)[] = [
    (values) => (values['a'] = 1),
    (values) => delete values['a'],
    (values) => Object.defineProperty(values, 'a', { value: 1 }),
    (values) => Object.setPrototypeOf(values, null),
    (values) => Object.freeze(values),
    (values) => (values['list'] as unknown[]).push(1),
    (values) => (values['list'] as unknown[]).sort(),
  ];
  for (const write of writes) {
    const rule: Rule = {
      reads: [['a'], ['list']],
      targets: [],
      check: (values) => {
        write(values as Record<string, unknown>);
        return [];
      },
    };
    assert.throws(() => assertDeclaredReads(rule, { a: 0, list: [2, 1] }), /wrote to the values/);
  }
});

test('a bad argument is a TypeError when the rule is built', () => {
  const yes = { reads: [['a']], when: () => true };
  const builders: readonly (() => unknown)[] = [
    () => atLeast(-1, [['a']]),
    () => atLeast(1.5, [['a']]),
    () => atLeast(Number.NaN, [['a']]),
    () => atLeast(2, [['a']]),
    () => atLeast(0, []),
    () => exactly(2, [['a']]),
    () => atLeast(1, 'a' as never),
    () => atLeast(1, { list: 'a', where: () => true } as never),
    () => allOrNone([['a']]),
    () => mutuallyExclusive([['a']]),
    () => allOrNone('ab' as never),
    () => allOrNone(['a', 'b'] as never),
    () => allOrNone([['a'], [{ key: 1 }]]),
    () => requiredIf(yes, []),
    () => requiredIf({ reads: [], when: () => true }, [['a']]),
    () => requiredIf({ reads: [['a']] } as never, [['a']]),
    () => atLeast(1, null as never),
    () => requiredIf(undefined as never, [['a']]),
    () => unique('a' as never, []),
    () => unique(['a'], undefined as never),
    () => unique(['a'], [], { by: 1 as never }),
    () => unique(['a'], [], { identity: 'b' as never }),
    () => atLeast(1, { list: ['a'], at: 'b' as never }),
    () => atLeast(1, { list: ['a'], where: 1 as never }),
    () => allOrNone([['a'], [undefined as never]]),
    () => allOrNone([['a'], [true as never]]),
    () => allOrNone([['a'], [null as never]]),
    () => each(['a'], [{ reads: [], targets: [], check: () => [], required: 1 as never }]),
    () => refine(string(), [], { format: 1 as never }),
    () => refine(string(), [], { resolveKey: 1 as never }),
    () => ordered('a' as never, ['b']),
    () => ordered(['a'], ['b'], { compare: 1 as never }),
    () => each(['a'], {} as never),
    () => each(['a'], [{}] as never),
    () => each(['a'], [null] as never),
    () => each([anyElement], []),
    () => refine({} as never, []),
    () => refine({ '~standard': {} } as never, []),
    () => refine(null as never, []),
    () => refine(string(), {} as never),
    () => refine(string(), [{}] as never),
  ];
  for (const [index, build] of builders.entries()) {
    assert.throws(build, TypeError, `case ${index}`);
  }
});

test('a rule keeps the paths it was given: a later write to them changes nothing', () => {
  const start: (string | number)[] = ['a'];
  const group = [start, ['b']];
  const rule = allOrNone(group);
  start[0] = 'z';
  group.pop();
  assert.deepStrictEqual(rule.reads, [['a'], ['b']]);
  assert.deepStrictEqual(rule.check({ a: 1 }), [{ code: 'rules.all_or_none', path: ['b'] }]);
  const [issue] = rule.check({ a: 1 });
  assert.throws(() => (issue!.path as unknown[]).push('x'), TypeError);
  assert.throws(() => (rule.reads as Path[]).push(['x']), TypeError);
  // What `required` hands out is the rule's own list: nobody can change the rule through it.
  const conditional = requiredIf({ reads: [['a']], when: () => true }, [['b']]);
  assert.throws(() => (conditional.required?.({}) as Path[]).push(['x']), TypeError);
});

const contact = object({ phone: optional(string()), email: optional(string()) });
const oneContact = atLeast(1, [['phone'], ['email']]);

test('refine reads a schema, then its rules on the value it gives, as Standard Schema', () => {
  const read = refine(contact, [oneContact]);
  assert.deepStrictEqual(readStandard(read, { phone: '1', other: 'dropped' }), { valid: true, value: { phone: '1' } });
  assert.deepStrictEqual(readStandard(read, {}), { valid: false, paths: [['phone'], ['email']] });
  assert.deepStrictEqual(read['~standard'].validate({}), {
    issues: [
      { message: 'rules.at_least', path: ['phone'] },
      { message: 'rules.at_least', path: ['email'] },
    ],
  });
  assert.equal(read['~standard'].version, 1);
  assert.equal(read['~standard'].vendor, 'yaltaan');
});

test('refine gives its rules the value the schema gave, not the input', () => {
  const read = refine(contact, [atLeast(1, [['other']])]);
  // `other` is in the input, and the schema drops it.
  assert.deepStrictEqual(readStandard(read, { other: 'x' }), { valid: false, paths: [['other']] });
});

test('a warning blocks nothing, in refine, and stays out of what an engine reads', () => {
  const warning: Rule = {
    reads: [],
    targets: [['phone']],
    check: () => [{ code: 'app.unusual', path: ['phone'], severity: 'warning' }],
  };
  const alone = refine(contact, [warning]);
  assert.deepStrictEqual(alone['~standard'].validate({}), { value: {} });
  const both = refine(contact, [warning, oneContact]);
  assert.deepStrictEqual(both['~standard'].validate({}), {
    issues: [
      { message: 'rules.at_least', path: ['phone'] },
      { message: 'rules.at_least', path: ['email'] },
    ],
  });
  // A warning does not count toward the limit, nor end a walk, nor hide an error behind it.
  const rows = Array.from({ length: 1500 }, () => ({}));
  const noted: Rule = { reads: [], targets: [], check: () => [{ code: 'app.note', path: [], severity: 'warning' }] };
  const noisy = refine({ '~standard': { version: 1, vendor: 'x', validate: (value: unknown) => ({ value }) } }, [
    each(['rows'], [noted]),
  ]);
  assert.deepStrictEqual(noisy['~standard'].validate({ rows }), { value: { rows } });
  const walked = checkRules([each(['rows'], [noted])], { rows });
  assert.equal(walked.length, 1000, 'the first 1,000 warnings are kept');
  assert.ok(!walked.some((issue) => issue.code === 'rules.too_many_issues'));
  const lastRow = [...rows, { failing: true }];
  const failing: Rule = {
    reads: [],
    targets: [],
    check: (row) => ((row as { failing?: boolean }).failing === true ? [{ code: 'app.bad', path: [] }] : []),
  };
  assert.deepStrictEqual(
    checkRules([each(['rows'], [noted, failing])], { rows: lastRow }).filter((issue) => issue.severity !== 'warning'),
    [{ code: 'app.bad', path: ['rows', 1500] }],
  );
  // The limit of errors, with warnings among them: 1,000 errors, then the issue that says so.
  const twoKinds: Rule = {
    reads: [],
    targets: [],
    check: () => [
      { code: 'app.note', path: [], severity: 'warning' },
      { code: 'app.bad', path: [] },
    ],
  };
  const mixed = checkRules([each(['rows'], [twoKinds])], { rows });
  assert.equal(mixed.filter((issue) => issue.code === 'app.bad').length, 1000);
  assert.equal(mixed.filter((issue) => issue.code === 'app.note').length, 1000);
  assert.deepStrictEqual(mixed.at(-1), { code: 'rules.too_many_issues', path: [], params: { maximum: 1000 } });
  // checkRules shows it, with all it holds, and each keeps all of it.
  const cause = new Error('why');
  const rich: Rule = {
    reads: [],
    targets: [['a']],
    check: () => [{ code: 'app.unusual', path: ['a'], severity: 'warning', cause, params: { b: 1 } }],
  };
  assert.deepStrictEqual(each(['list'], [rich]).check({ list: [{}] }), [
    { code: 'app.unusual', path: ['list', 0, 'a'], severity: 'warning', cause, params: { b: 1 } },
  ]);
});

test('refine runs no rule on a value the schema refused, and gives the issues of the schema', () => {
  let ran = 0;
  const counting: Rule = {
    reads: [],
    targets: [],
    check: () => {
      ran += 1;
      return [];
    },
  };
  const read = refine(contact, [counting]);
  assert.deepStrictEqual(readStandard(read, { phone: 1 }), { valid: false, paths: [['phone']] });
  assert.equal(ran, 0);
  assert.deepStrictEqual(read['~standard'].validate({}), { value: {} });
  assert.equal(ran, 1);
});

test('refine takes any Standard Schema, synchronous or not, and stays what it was', async () => {
  const foreign = v.object({ phone: v.optional(v.string()), email: v.optional(v.string()) });
  assert.deepStrictEqual(readStandard(refine(foreign, [oneContact]), {}), {
    valid: false,
    paths: [['phone'], ['email']],
  });
  assert.deepStrictEqual(readStandard(refine(foreign, [oneContact]), { email: 'a' }), {
    valid: true,
    value: { email: 'a' },
  });
  const slow = v.objectAsync({
    phone: v.optional(v.string()),
    email: v.pipeAsync(
      v.optional(v.string()),
      v.checkAsync(async () => true),
    ),
  });
  const pending = refine(slow, [oneContact])['~standard'].validate({});
  assert.ok(pending instanceof Promise);
  assert.deepStrictEqual(await pending, {
    issues: [
      { message: 'rules.at_least', path: ['phone'] },
      { message: 'rules.at_least', path: ['email'] },
    ],
  });
  const refused = await refine(slow, [oneContact])['~standard'].validate({ phone: 1 });
  assert.equal(refused.issues?.length, 1);
  const types = { input: 'i', output: 'o' } as never;
  const withTypes = {
    '~standard': { version: 1, vendor: 'x', validate: (value: unknown) => ({ value }), types },
  } as const;
  assert.equal(refine(withTypes, [])['~standard'].types, types);
  // A thenable is awaited like a promise, even one whose `then` answers nothing.
  const thenable = {
    '~standard': {
      version: 1,
      vendor: 'x',
      validate: (value: unknown) =>
        ({
          then: (done: (result: unknown) => void): void => {
            done({ value });
          },
        }) as unknown as Promise<{ value: unknown }>,
    },
  } as const;
  assert.deepStrictEqual(await refine(thenable, [])['~standard'].validate(1), { value: 1 });
  assert.deepStrictEqual(await refine(thenable, [atLeast(1, [['a']])])['~standard'].validate({ a: 1 }), {
    value: { a: 1 },
  });
  assert.deepStrictEqual(await refine(thenable, [atLeast(1, [['a']])])['~standard'].validate({}), {
    issues: [{ message: 'rules.at_least', path: ['a'] }],
  });
  // The options of a read reach the schema it wraps.
  const options = { libraryOptions: { a: 1 } };
  let given: unknown;
  const reading = {
    '~standard': {
      version: 1,
      vendor: 'x',
      validate: (value: unknown, passed: unknown) => {
        given = passed;
        return { value };
      },
    },
  } as const;
  refine(reading, [])['~standard'].validate(1, options);
  assert.equal(given, options);
});

test('refine gives messages by the format, and an element by its index or the list that holds it', () => {
  const passthrough = { '~standard': { version: 1, vendor: 'x', validate: (value: unknown) => ({ value }) } } as const;
  const keyed = [each(['items'], [atLeast(1, [['name']])], { identity: ['id'] })];
  const input = { items: [{ id: 'x' }, { id: 'y', name: 'n' }, { id: 'z' }] };
  assert.deepStrictEqual(
    refine(passthrough, keyed, { format: (issue) => `say ${issue.code}` })['~standard'].validate(input),
    {
      issues: [
        { message: 'say rules.at_least', path: ['items'] },
        { message: 'say rules.at_least', path: ['items'] },
      ],
    },
  );
  assert.deepStrictEqual(
    refine(passthrough, keyed, {
      resolveKey: (segment, parent, value) => {
        assert.deepStrictEqual(parent, ['items']);
        return (value as typeof input).items.findIndex((item) => item.id === segment.key);
      },
    })['~standard'].validate(input),
    {
      issues: [
        { message: 'rules.at_least', path: ['items', 0, 'name'] },
        { message: 'rules.at_least', path: ['items', 2, 'name'] },
      ],
    },
  );
  assert.deepStrictEqual(
    refine(passthrough, [each(['items'], [atLeast(1, [['name']])])])['~standard'].validate(input),
    {
      issues: [
        { message: 'rules.at_least', path: ['items', 0, 'name'] },
        { message: 'rules.at_least', path: ['items', 2, 'name'] },
      ],
    },
  );
});

test('two reads under way at once each resolve a key from their own value', async () => {
  const release: ((value: unknown) => void)[] = [];
  const slow = {
    '~standard': {
      version: 1,
      vendor: 'x',
      validate: (value: unknown) =>
        new Promise<{ value: unknown }>((resolve) => {
          release.push(() => {
            resolve({ value });
          });
        }),
    },
  } as const;
  const read = refine(slow, [each(['items'], [atLeast(1, [['name']])], { identity: ['id'] })], {
    resolveKey: (segment, _, value) =>
      (value as { items: readonly { id: string }[] }).items.findIndex((item) => item.id === segment.key),
  });
  const first = read['~standard'].validate({ items: [{ id: 'a' }, { id: 'b', name: 'n' }] });
  const second = read['~standard'].validate({ items: [{ id: 'b', name: 'n' }, { id: 'a' }] });
  release[1]?.(undefined);
  release[0]?.(undefined);
  assert.deepStrictEqual(await first, { issues: [{ message: 'rules.at_least', path: ['items', 0, 'name'] }] });
  assert.deepStrictEqual(await second, { issues: [{ message: 'rules.at_least', path: ['items', 1, 'name'] }] });
});

test('required paths name an element as issues do', () => {
  const rule = each(['list'], [allOrNone([['a'], ['b']])], { identity: ['id'] });
  assert.deepStrictEqual(rule.required?.({ list: [{ id: 'x', a: 1 }, { a: 1 }] }), [
    ['list', { key: 'x' }, 'b'],
    ['list', 1, 'b'],
  ]);
});

test('the types of what refine returns are those of the schema, and a rule takes what its callbacks say', () => {
  const read = refine(object({ age: number(), name: optional(string()) }), []);
  assertType<
    Equal<NonNullable<(typeof read)['~standard']['types']>['output'], { age: number; name?: string | undefined }>
  >();
  // A callback says nothing it cannot know: a value of a form may be anything, and an annotation is refused.
  const refused = (): readonly Rule[] => [
    // @ts-expect-error what a condition reads may be absent
    requiredIf({ reads: [['iban']], when: (iban: string) => iban === 'x' }, [['bic']]),
    // @ts-expect-error what a value holds is not known
    atLeast(1, { list: ['contacts'], where: (item: { primary: boolean }) => item.primary }),
    // @ts-expect-error what a value holds is not known
    unique(['contacts'], ['email'], { by: (email: string) => email.toLowerCase() }),
    // @ts-expect-error what a value holds is not known
    ordered(['from'], ['to'], { compare: (a: Date, b: Date) => a.getTime() - b.getTime() }),
    // @ts-expect-error a positional boolean is not an option
    ordered(['a'], ['b'], true),
  ];
  assert.equal(typeof refused, 'function');
  assert.equal(parse(string(), 'x').ok, true);
});

// The adversarial catalogue of ARCHITECTURE.md §10.1, for every export that runs.

function ownErrorOnly(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    assert.ok(
      error instanceof HostileError || error instanceof TypeError || error instanceof RangeError,
      String(error),
    );
  }
}

function checksAnyValues(name: string, rule: Rule): void {
  declareAdversarial(SUBPATH, name, {
    boundary: (value) => {
      assert.deepStrictEqual(rule.check({ a: value, b: value }), rule.check({ a: value, b: value }));
      assert.ok(Array.isArray(rule.check(value)));
    },
    structures: (value) => assert.ok(Array.isArray(rule.check({ a: value, b: value, list: value }))),
    hostile: (value) =>
      ownErrorOnly(() => {
        rule.check(value);
        rule.check({ a: value, b: value, list: value });
      }),
    unicode: (text) => {
      assert.ok(Array.isArray(rule.check({ a: text, b: text })));
      assert.ok(rule.check({ [text]: 1 }) !== undefined);
    },
    callbacks: { na: `${name} takes no callback here: what it is given is exercised by its own laws` },
    async: { na: `${name} is synchronous and takes no signal` },
  });
}

checksAnyValues('allOrNone', allOrNone([['a'], ['b']]));
checksAnyValues('mutuallyExclusive', mutuallyExclusive([['a'], ['b']]));

function callsBack(name: string, make: (callback: Callback) => Rule, values: unknown): void {
  declareAdversarial(SUBPATH, name, {
    boundary: (value) => assert.ok(Array.isArray(make(() => true).check(value))),
    structures: (value) => assert.ok(Array.isArray(make(() => true).check({ a: value, b: value, list: value }))),
    hostile: (value) =>
      ownErrorOnly(() => {
        const rule = make(() => true);
        rule.check(value);
        rule.check({ a: value, b: value, list: value });
      }),
    unicode: (text) => assert.ok(Array.isArray(make(() => true).check({ a: text, b: text, list: [text, text] }))),
    callbacks: (callback) => {
      // What the callback throws comes out as it is, and what it answers decides nothing but this check.
      let thrown: unknown;
      const rule = make((...args) => {
        try {
          return callback(...args);
        } catch (error) {
          thrown = error;
          throw error;
        }
      });
      try {
        assert.ok(Array.isArray(rule.check(structuredClone(values))));
      } catch (error) {
        assert.equal(error, thrown);
      }
    },
    async: { na: `${name} is synchronous and takes no signal` },
  });
}

callsBack(
  'requiredIf',
  (callback) => requiredIf({ reads: [['a']], when: (...read) => callback(...read) === true }, [['b']]),
  { a: [1, 2, 3], b: '' },
);
callsBack('atLeast', (callback) => atLeast(1, { list: ['list'], where: (item) => callback(item) === true }), {
  list: [1, 2, 3],
});
callsBack('exactly', (callback) => exactly(1, { list: ['list'], where: (item) => callback(item) === true }), {
  list: [1, 2, 3],
});
callsBack('unique', (callback) => unique(['list'], [], { by: (item) => callback(item) }), { list: [1, 2, 3] });
callsBack('ordered', (callback) => ordered(['a'], ['b'], { compare: (x, y) => Number(callback(x, y)) }), {
  a: 1,
  b: 2,
});
callsBack(
  'each',
  (callback) =>
    each(
      ['list'],
      [
        {
          reads: [],
          targets: [],
          check: (item) => {
            callback(item);
            return [];
          },
        },
      ],
    ),
  { list: [1, 2, 3] },
);

declareAdversarial(SUBPATH, 'checkRules', {
  boundary: (value) => assert.ok(Array.isArray(checkRules([oneContact], value))),
  structures: (value) => assert.ok(Array.isArray(checkRules([oneContact, each(['a'], [])], value))),
  hostile: (value) => ownErrorOnly(() => checkRules([oneContact, each(['list'], [oneContact])], value)),
  unicode: (text) => assert.deepStrictEqual(checkRules([oneContact], { phone: `${text}x`, email: text }), []),
  callbacks: { na: 'checkRules takes no callback of its own: each rule does' },
  async: { na: 'checkRules is synchronous and takes no signal' },
});

declareAdversarial(SUBPATH, 'requiredPaths', {
  boundary: (value) => assert.ok(Array.isArray(requiredPaths([allOrNone([['a'], ['b']])], value))),
  structures: (value) => assert.ok(Array.isArray(requiredPaths([allOrNone([['a'], ['b']])], value))),
  hostile: (value) =>
    ownErrorOnly(() => requiredPaths([allOrNone([['a'], ['b']]), each(['list'], [oneContact])], value)),
  unicode: (text) => assert.deepStrictEqual(requiredPaths([allOrNone([['a'], ['b']])], { a: text, b: text }), []),
  callbacks: { na: 'requiredPaths takes no callback of its own: each rule does' },
  async: { na: 'requiredPaths is synchronous and takes no signal' },
});

declareAdversarial(SUBPATH, 'refine', {
  boundary: (value) => assert.equal(typeof refine(contact, [oneContact])['~standard'].validate(value), 'object'),
  structures: (value) => assert.equal(typeof refine(contact, [oneContact])['~standard'].validate(value), 'object'),
  hostile: (value) => ownErrorOnly(() => refine(contact, [oneContact])['~standard'].validate(value)),
  unicode: (text) => assert.deepStrictEqual(refine(string(), [])['~standard'].validate(text), { value: text }),
  callbacks: (callback) => {
    let thrown: unknown;
    const format = (issue: Issue): string => {
      try {
        return String(callback(issue));
      } catch (error) {
        thrown = error;
        throw error;
      }
    };
    try {
      assert.ok('issues' in refine(contact, [oneContact], { format })['~standard'].validate({}));
    } catch (error) {
      assert.equal(error, thrown);
    }
  },
  async: async (drawn) => {
    const base = { '~standard': { version: 1, vendor: 'x', validate: async (value: unknown) => ({ value }) } } as const;
    const signal = drawn;
    assert.ok(signal !== undefined);
    assert.deepStrictEqual(await refine(base, [])['~standard'].validate(1), { value: 1 });
  },
});

declareAdversarial(SUBPATH, 'assertDeclaredReads', {
  boundary: (value) => assertDeclaredReads(allOrNone([['a'], ['b']]), value),
  structures: (value) => assertDeclaredReads(allOrNone([['a'], ['b']]), value),
  hostile: (value) => ownErrorOnly(() => assertDeclaredReads(allOrNone([['a'], ['b']]), value)),
  unicode: (text) => assertDeclaredReads(allOrNone([['a'], ['b']]), { a: text, b: text }),
  callbacks: (callback) => {
    // Handed a view: whatever the callback does to it, a write is refused, and what it throws comes out as it is.
    let thrown: unknown;
    const check = (values: unknown): readonly Issue[] => {
      try {
        callback(values);
        return [];
      } catch (error) {
        thrown = error;
        throw error;
      }
    };
    try {
      assertDeclaredReads({ reads: [[]], targets: [], check }, {});
    } catch (error) {
      assert.equal(error, thrown);
    }
  },
  async: { na: 'assertDeclaredReads is synchronous and takes no signal' },
});
