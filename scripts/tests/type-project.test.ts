import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateProject, splitUsage } from '../lib/type-project.ts';

const MODEL = 'export interface Model {\n  readonly id: string;\n}\n';

test('the same request gives the same project, byte for byte', () => {
  const usage = { name: 'u', source: "import type { Model } from '../model.ts';\nexport type Id = Model['id'];\n" };
  assert.deepEqual([...generateProject(25, MODEL, [usage])], [...generateProject(25, MODEL, [usage])]);
});

test('a project holds the shared model, then one file per application file importing the one ten times lower', () => {
  const project = generateProject(25, MODEL, []);
  assert.deepEqual([...project.keys()], ['base.ts', ...Array.from({ length: 25 }, (_, file) => `m${file}.ts`)]);
  assert.equal(project.get('base.ts'), MODEL);
  assert.ok(!project.get('m0.ts')?.includes("from './m"));
  assert.ok(project.get('m0.ts')?.includes('readonly parent?: undefined;'));
  assert.ok(project.get('m9.ts')?.includes("import type { Model as Parent } from './m0.ts';"));
  assert.ok(project.get('m24.ts')?.includes("import type { Model as Parent } from './m2.ts';"));
  assert.ok(project.get('m24.ts')?.includes("readonly kind: 'm24';"));
  assert.throws(() => generateProject(0, MODEL, []), /at least one file/);
});

test('usages lose their import of the shared model, merge their other imports and follow in order', () => {
  const first = {
    name: 'first',
    source:
      "// A comment before the imports.\nimport type { Model } from '../model.ts';\nimport type { A } from 'lib';\n\n" +
      'export type First = A<Model>;\n',
  };
  const second = {
    name: 'second',
    source: "import type { A } from 'lib';\nimport {\n  b,\n  c,\n} from 'other';\n\nexport const second = b(c);\n",
  };
  assert.deepEqual(splitUsage(second), {
    imports: ["import type { A } from 'lib';", "import { b, c, } from 'other';"],
    body: 'export const second = b(c);',
  });
  const file = generateProject(1, MODEL, [first, second]).get('m0.ts') ?? '';
  assert.ok(!file.includes('../model.ts'));
  assert.equal(file.split("import type { A } from 'lib';").length, 2, 'the shared import appears once');
  assert.ok(file.indexOf('export type First') < file.indexOf('export const second'));
  assert.ok(file.endsWith('export const second = b(c);\n'));
});

test('a usage may import only the type Model from the shared model', () => {
  const usage = { name: 'bad', source: "import type { Model, Other } from '../model.ts';\nexport type X = Other;\n" };
  assert.throws(() => splitUsage(usage), /usage bad: import only the type Model/);
});
