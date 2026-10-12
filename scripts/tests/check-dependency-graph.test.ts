import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { checkDependencyGraph, parseAllowedGraph } from '../check-dependency-graph.ts';
import { repositoryRoot } from '../lib/workspace.ts';

type Manifest = Record<string, unknown>;

const ARCHITECTURE = fs.readFileSync(path.join(repositoryRoot, 'ARCHITECTURE.md'), 'utf8');

const temporaryRoots: string[] = [];
after(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function manifest(folder: string, dependencies: readonly string[] = [], extra: Manifest = {}): string {
  const entry = (file: string): Manifest => ({ types: `./dist/${file}.d.ts`, default: `./dist/${file}.js` });
  const fields: Manifest = {
    name: `@yaltaan/${folder}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    sideEffects: false,
    exports: { '.': entry('index'), './extra': entry('extra'), './package.json': './package.json' },
  };
  if (dependencies.length > 0) {
    fields['dependencies'] = Object.fromEntries(dependencies.map((name) => [`@yaltaan/${name}`, '0.0.0']));
  }
  return JSON.stringify({ ...fields, ...extra });
}

/**
 * A workspace that follows every rule: the packages of the graph, each importing the one below it through an exported
 * subpath, the adapters with their framework as a peer. Maps each file, from the root, to its content.
 */
function validWorkspace(): Map<string, string> {
  return new Map([
    ['package.json', JSON.stringify({ name: 'fixture', private: true, type: 'module', workspaces: ['packages/*'] })],
    ['ARCHITECTURE.md', ARCHITECTURE],
    ['packages/core/package.json', manifest('core')],
    ['packages/core/dist/index.js', 'export function ok(value) {\n  return { ok: true, value };\n}\n'],
    ['packages/core/dist/index.d.ts', 'export declare function ok<T>(value: T): { ok: true; value: T };\n'],
    ['packages/core/dist/extra.js', "export { ok as success } from './index.js';\n"],
    ['packages/temporal/package.json', manifest('temporal', ['core'])],
    ['packages/temporal/dist/index.js', "import { ok } from '@yaltaan/core';\nexport const instant = (v) => ok(v);\n"],
    ['packages/schema/package.json', manifest('schema', ['core'])],
    [
      'packages/schema/dist/index.js',
      "import { success } from '@yaltaan/core/extra';\nexport const string = (v) => success(v);\n",
    ],
    ['packages/schema/dist/index.d.ts', 'export type Rule = { readonly n: number };\n'],
    ['packages/rules/package.json', manifest('rules', ['schema', 'core'])],
    [
      'packages/rules/dist/index.js',
      lines(
        "import { ok } from '@yaltaan/core';",
        "import { string } from '@yaltaan/schema';",
        'export const rule = { ok, string };',
      ),
    ],
    ['packages/form/package.json', manifest('form', ['rules'])],
    [
      'packages/form/dist/index.js',
      lines(
        "import { rule } from '@yaltaan/rules';",
        "import { initial } from './internal/state.js';",
        'export const form = { rule, initial };',
      ),
    ],
    ['packages/form/dist/internal/state.js', 'export const initial = null;\n'],
    ['packages/react/package.json', manifest('react', ['form'], { peerDependencies: { react: '>=19' } })],
    [
      'packages/react/dist/index.js',
      lines(
        "import { useSyncExternalStore } from 'react';",
        "import { form } from '@yaltaan/form';",
        'export const use = () => useSyncExternalStore(form);',
      ),
    ],
    ['packages/angular/package.json', manifest('angular', ['form'], { peerDependencies: { '@angular/core': '>=22' } })],
    ['packages/angular/dist/index.js', "import { form } from '@yaltaan/form';\nexport const bridge = () => form;\n"],
  ]);
}

/** The content of a module: one line per argument. */
function lines(...source: readonly string[]): string {
  return `${source.join('\n')}\n`;
}

function writeWorkspace(files: ReadonlyMap<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-graph-'));
  temporaryRoots.push(root);
  for (const [relative, content] of files) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

function problemsOf(changes: Readonly<Record<string, string | null>>): readonly string[] {
  const files = validWorkspace();
  for (const [relative, content] of Object.entries(changes)) {
    if (content === null) {
      files.delete(relative);
    } else {
      files.set(relative, content);
    }
  }
  return checkDependencyGraph(writeWorkspace(files)).problems;
}

function assertOneProblem(problems: readonly string[], fragment: string): void {
  assert.equal(problems.length, 1, `expected one problem, got: ${JSON.stringify(problems)}`);
  assert.ok(problems[0]?.includes(fragment), `"${problems[0]}" does not contain "${fragment}"`);
}

// A build configuration that only lists files: the fixture has no compiler of its own, the check runs this
// repository's.
const BUILD_CONFIG = JSON.stringify({
  compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', target: 'es2023', types: [], noEmit: true },
  include: ['src/**/*.ts'],
});

// npm links each workspace package into node_modules; a junction does the same without the rights a symbolic link
// needs on Windows.
function linkPackages(root: string, folders: readonly string[]): void {
  for (const folder of folders) {
    const link = path.join(root, 'node_modules', '@yaltaan', folder);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.join(root, 'packages', folder), link, 'junction');
  }
}

test('a workspace that follows the graph and the publishing rules has no problem', () => {
  const verdict = checkDependencyGraph(writeWorkspace(validWorkspace()));
  assert.deepEqual(verdict.problems, []);
  assert.deepEqual(
    { packages: verdict.packages, modules: verdict.modules, builds: verdict.builds },
    {
      packages: 7,
      modules: 9,
      builds: 0,
    },
  );
});

test('an import from core to schema fails, whether the manifest declares it or not', () => {
  const imports = {
    'packages/core/dist/index.js': "import { string } from '@yaltaan/schema';\nexport const s = () => string;\n",
  };
  assertOneProblem(
    problemsOf(imports),
    'packages/core/dist/index.js: line 1: import of @yaltaan/schema: packages/core/package.json does not declare',
  );
  assertOneProblem(
    problemsOf({ ...imports, 'packages/core/package.json': manifest('core', ['schema']) }),
    'packages/core/package.json: declares @yaltaan/schema, but the graph of ARCHITECTURE.md §6 lets core depend on ' +
      'no package only',
  );
});

test('an adapter that imports another adapter fails', () => {
  const imports = {
    'packages/react/dist/index.js': "import { bridge } from '@yaltaan/angular';\nexport const use = () => bridge;\n",
  };
  assertOneProblem(problemsOf(imports), 'import of @yaltaan/angular: packages/react/package.json does not declare');
  const declared = { ...imports, 'packages/react/package.json': manifest('react', ['form', 'angular']) };
  assertOneProblem(
    problemsOf(declared),
    'declares @yaltaan/angular, but the graph of ARCHITECTURE.md §6 lets react depend on core, form, rules, ' +
      'schema only',
  );
});

test('a call at module level fails', () => {
  assertOneProblem(
    problemsOf({ 'packages/core/dist/extra.js': "export { ok as success } from './index.js';\nregister();\n" }),
    'packages/core/dist/extra.js: line 2: runs code when the module loads: a call',
  );
  assertOneProblem(
    problemsOf({ 'packages/form/dist/internal/state.js': 'export const initial = new Map();\n' }),
    'packages/form/dist/internal/state.js: line 1: runs code when the module loads: a "new"',
  );
});

test('a barrel that re-exports another package fails', () => {
  assertOneProblem(
    problemsOf({ 'packages/schema/dist/index.js': "export * from '@yaltaan/core';\n" }),
    'packages/schema/dist/index.js: line 1: re-exports @yaltaan/core: no barrel of another package',
  );
  assertOneProblem(
    problemsOf({
      'packages/schema/dist/index.js': "import { success } from '@yaltaan/core/extra';\nexport { success };\n",
    }),
    're-exports success, imported from @yaltaan/core/extra',
  );
});

test('another package is reached through a subpath it exports, never through its files', () => {
  const deep = "import { ok } from '@yaltaan/core/dist/index.js';\nexport const string = (v) => ok(v);\n";
  assertOneProblem(
    problemsOf({ 'packages/schema/dist/index.js': deep }),
    '@yaltaan/core does not export ./dist/index.js: import a subpath listed in its "exports"',
  );
  const escape = "import { ok } from '../../core/dist/index.js';\nexport const string = (v) => ok(v);\n";
  assertOneProblem(
    problemsOf({ 'packages/schema/dist/index.js': escape }),
    'import of ../../core/dist/index.js: leaves the package',
  );
  const itself = "import { ok } from '@yaltaan/core';\nexport const success = (v) => ok(v);\n";
  assertOneProblem(problemsOf({ 'packages/core/dist/extra.js': itself }), 'the package imports itself by name');
});

test('built-in modules, URLs and undeclared packages are never imported', () => {
  for (const specifier of ['node:fs', 'https://example.org/x.js', '#internal']) {
    const code = `import x from '${specifier}';\nexport const y = () => x;\n`;
    assertOneProblem(problemsOf({ 'packages/core/dist/extra.js': code }), 'neither a relative path nor a package name');
  }
  for (const specifier of ['fs', 'valibot', 'react']) {
    const code = `import x from '${specifier}';\nexport const y = () => x;\n`;
    assertOneProblem(
      problemsOf({ 'packages/schema/dist/index.js': code }),
      `packages/schema/package.json does not declare ${specifier}`,
    );
  }
  const lazy = "export const load = () => import('@yaltaan/react');\n";
  assertOneProblem(
    problemsOf({ 'packages/form/dist/internal/state.js': lazy }),
    'line 1: dynamic import of @yaltaan/react: packages/form/package.json does not declare',
  );
});

test('a package outside the graph, or one never built, fails', () => {
  assertOneProblem(
    problemsOf({ 'packages/extra/package.json': manifest('extra') }),
    'packages/extra: the package is not in the graph of ARCHITECTURE.md §6',
  );
  assertOneProblem(
    problemsOf({ 'packages/core/package.json': manifest('core', ['kernel']) }),
    'declares @yaltaan/kernel, which is not a package of the workspace',
  );
  assertOneProblem(
    problemsOf({ 'packages/core/package.json': manifest('core', ['core']) }),
    'packages/core/package.json: declares a dependency on itself',
  );
  const unbuilt = {
    'packages/temporal/dist/index.js': null,
    'packages/temporal/src/index.ts': 'export const instant = 1;\n',
  };
  assertOneProblem(problemsOf(unbuilt), 'packages/temporal: has src/ but no dist/');
});

test('a type-only import is an edge: the compiler lists what each build reads', () => {
  const files = validWorkspace();
  files.set('packages/schema/tsconfig.build.json', BUILD_CONFIG);
  files.set('packages/schema/src/index.ts', "import type { ok } from '@yaltaan/core';\nexport type Ok = typeof ok;\n");
  files.set('packages/core/tsconfig.build.json', BUILD_CONFIG);
  files.set('packages/core/src/index.ts', 'export const one: number = 1;\n');
  const root = writeWorkspace(files);
  linkPackages(root, ['core', 'schema']);
  const verdict = checkDependencyGraph(root);
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.builds, 2);

  fs.writeFileSync(
    path.join(root, 'packages/core/src/index.ts'),
    "import type { Rule } from '@yaltaan/schema';\nexport type Checked = Rule;\n",
  );
  assertOneProblem(
    checkDependencyGraph(root).problems,
    'packages/core/tsconfig.build.json: the build reads packages/schema/dist/index.d.ts, from @yaltaan/schema, which ' +
      'packages/core/package.json does not declare',
  );

  fs.writeFileSync(path.join(root, 'packages/core/tsconfig.build.json'), '{ "include": ');
  assertOneProblem(
    checkDependencyGraph(root).problems,
    'packages/core/tsconfig.build.json: the compiler cannot list the files of the build',
  );
});

test('the graph is read from the architecture document, transitively', () => {
  const read = parseAllowedGraph(ARCHITECTURE);
  assert.ok(read.ok);
  const graph = Object.fromEntries([...read.graph].map(([name, below]) => [name, [...below].sort()]));
  assert.deepEqual(graph, {
    core: [],
    temporal: ['core'],
    schema: ['core'],
    rules: ['core', 'schema'],
    form: ['core', 'rules', 'schema'],
    angular: ['core', 'form', 'rules', 'schema'],
    react: ['core', 'form', 'rules', 'schema'],
    vue: ['core', 'form', 'rules', 'schema'],
  });
});

test('a graph that cannot be read fails the check', () => {
  const block = (body: string): string => `Allowed dependency graph:\n\n\`\`\`text\n${body}\n\`\`\`\n`;
  const cases: readonly (readonly [string, string])[] = [
    ['# no graph here\n', 'no `text` block after the line "Allowed dependency graph…"'],
    ['Allowed dependency graph:\n\n```js\ncore ← schema\n```\n', 'no `text` block'],
    [block('core ← Schema'), 'names "Schema", not a package folder'],
    [block('core ← schema ←'), 'names "", not a package folder'],
    [block('core ← schema\nschema ← core'), 'the graph has a cycle through'],
  ];
  for (const [markdown, fragment] of cases) {
    const read = parseAllowedGraph(markdown);
    assert.ok(!read.ok && read.problem.includes(fragment), `${JSON.stringify(read)} lacks "${fragment}"`);
  }
  assertOneProblem(problemsOf({ 'ARCHITECTURE.md': '# no graph here\n' }), 'ARCHITECTURE.md: no `text` block');
});

test('the packages of this repository follow the graph', () => {
  const verdict = checkDependencyGraph(repositoryRoot);
  assert.deepEqual(verdict.problems, []);
  assert.ok(verdict.packages >= 1);
});

test('run as a program, the check reads this repository and prints its verdict', () => {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, 'scripts', 'check-dependency-graph.ts')], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /^ok: \d+ package\(s\) follow the graph of ARCHITECTURE\.md §6; \d+ built module\(s\) and \d+ build\(s\) read\.\n$/,
  );
});
