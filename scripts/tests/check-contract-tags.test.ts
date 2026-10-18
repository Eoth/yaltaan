import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { checkContractTags } from '../check-contract-tags.ts';
import { withRepo } from './run-script.ts';

const temporaryRoots: string[] = [];
after(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const COMPILER = path.join(
  path.dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
  'bin',
  'tsc',
);

const PACKAGE = 'packages/demo';

/** A workspace of one package whose every export carries its contract, as sources to build. */
function validSources(): Map<string, string> {
  const entry = (file: string): Record<string, string> => ({
    types: `./dist/${file}.d.ts`,
    default: `./dist/${file}.js`,
  });
  return new Map([
    ['package.json', JSON.stringify({ name: 'fixture', private: true, type: 'module', workspaces: ['packages/*'] })],
    [
      `${PACKAGE}/package.json`,
      JSON.stringify({
        name: '@yaltaan/demo',
        version: '0.0.0',
        private: true,
        type: 'module',
        sideEffects: false,
        exports: { '.': entry('index'), './extra': entry('extra'), './package.json': './package.json' },
      }),
    ],
    [
      `${PACKAGE}/tsconfig.build.json`,
      JSON.stringify({
        compilerOptions: {
          target: 'es2023',
          lib: ['es2023'],
          module: 'nodenext',
          types: [],
          strict: true,
          isolatedDeclarations: true,
          declaration: true,
          rewriteRelativeImportExtensions: true,
          rootDir: 'src',
          outDir: 'dist',
        },
        include: ['src'],
      }),
    ],
    [
      `${PACKAGE}/src/index.ts`,
      lines(
        "export { omit } from './omit.ts';",
        "export * from './box.ts';",
        '',
        '/**',
        ' * Doubles a number.',
        ' *',
        ' * Works on every finite number; a second paragraph',
        ' * wrapped over two lines.',
        ' * @pure',
        ' * @sharing none',
        ' * @complexity O(1)',
        ' * @throws never',
        ' * @since 0.1',
        ' * @experimental',
        ' * @example',
        ' * double(2); // 4',
        ' */',
        'export function double(value: number): number {',
        '  return value * 2;',
        '}',
        '',
        '/**',
        ' * Two numbers.',
        ' * @since 0.1',
        ' * @stable',
        ' */',
        'export interface Pair {',
        '  readonly a: number;',
        '  readonly b: number;',
        '}',
        '',
        '/**',
        ' * The largest count.',
        ' * @since 0.2',
        ' * @experimental',
        ' */',
        'export const LIMIT = 1000;',
      ),
    ],
    [
      `${PACKAGE}/src/omit.ts`,
      lines(
        '/**',
        ' * Removes `keys` from `target`.',
        ' * @mutates target',
        ' * @sharing identity-preserving',
        ' * @complexity O(k) (k = number of keys)',
        ' * @throws when `target` is frozen',
        ' * @since 0.1',
        ' * @experimental',
        ' * @param keys the keys to remove',
        ' */',
        'export function omit(target: Record<string, unknown>, keys: readonly string[]): void;',
        'export function omit(target: Record<string, unknown>, keys: readonly string[], log: string[]): void;',
        'export function omit(target: Record<string, unknown>, keys: readonly string[], log?: string[]): void {',
        '  for (const key of keys) {',
        '    log?.push(key);',
        '    Reflect.deleteProperty(target, key);',
        '  }',
        '}',
      ),
    ],
    [
      `${PACKAGE}/src/box.ts`,
      lines(
        '/**',
        ' * Holds a scaled value.',
        ' * @pure',
        ' * @sharing none',
        ' * @complexity O(1)',
        ' * @throws never',
        ' * @since 0.1',
        ' * @experimental',
        ' */',
        'export class Box {',
        '  readonly value: number;',
        '  constructor(value: number, scale: number) {',
        '    this.value = value * scale;',
        '  }',
        '}',
        '',
        '/**',
        ' * Doubles twice.',
        ' * @pure',
        ' * @sharing none',
        ' * @complexity O(1)',
        ' * @throws never',
        ' * @since 0.1',
        ' * @experimental',
        ' */',
        'export const twice = (x: number): number => x * 4;',
      ),
    ],
    [
      `${PACKAGE}/src/extra.ts`,
      lines(
        '/**',
        ' * Halves a number.',
        ' * @pure',
        ' * @sharing none',
        ' * @complexity O(1)',
        ' * @throws never',
        ' * @since 0.2',
        ' * @stable',
        ' */',
        'export function half(value: number): number {',
        '  return value / 2;',
        '}',
      ),
    ],
  ]);
}

function lines(...source: readonly string[]): string {
  return `${source.join('\n')}\n`;
}

function writeTree(files: ReadonlyMap<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-tags-'));
  temporaryRoots.push(root);
  for (const [relative, content] of files) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

function build(root: string): void {
  const result = spawnSync(process.execPath, [COMPILER, '-p', `${PACKAGE}/tsconfig.build.json`], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `the fixture does not build: ${result.stdout}${result.stderr}`);
}

/** The valid workspace with `changes` applied to its sources (`null` deletes a file), built. */
function builtWorkspace(changes: Readonly<Record<string, string | null>> = {}): string {
  const files = validSources();
  for (const [relative, content] of Object.entries(changes)) {
    if (content === null) {
      files.delete(relative);
    } else {
      files.set(relative, content);
    }
  }
  const root = writeTree(files);
  build(root);
  return root;
}

let valid = '';
before(() => {
  valid = builtWorkspace();
});

/** A copy of the built valid workspace, its reference written, then `edit` applied to its files. */
async function editedCopy(edit: (root: string) => void): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-tags-'));
  temporaryRoots.push(root);
  fs.cpSync(valid, root, { recursive: true });
  const written = await checkContractTags(root, { update: true });
  assert.deepEqual(written.problems, []);
  edit(root);
  return root;
}

function readReference(root: string): Map<string, string> {
  const dir = path.join(root, 'docs/reference');
  return new Map(fs.readdirSync(dir).map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf8')]));
}

function assertOneProblem(problems: readonly string[], fragment: string): void {
  assert.equal(problems.length, 1, `expected one problem, got: ${JSON.stringify(problems)}`);
  assert.ok(problems[0]?.includes(fragment), `"${problems[0]}" does not mention "${fragment}"`);
}

test('a package whose exports carry their contract passes, and its reference is written', async () => {
  const root = await editedCopy(() => {});
  const verdict = await checkContractTags(root);
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.subpaths, 2);
  // index: double, LIMIT, Pair, omit (renamed re-export), Box and twice (export *); extra: half.
  assert.equal(verdict.exports, 7);
  const reference = readReference(root);
  assert.deepEqual([...reference.keys()].sort(), ['README.md', 'demo.md']);
  assert.ok(reference.get('README.md')?.includes('- [`@yaltaan/demo`](demo.md): 7 public export(s).'));
  const page = reference.get('demo.md') ?? '';
  for (const fragment of [
    '## `@yaltaan/demo`\n',
    '## `@yaltaan/demo/extra`\n',
    '### `omit`\n\nA function.\n\nRemoves `keys` from `target`.\n',
    'Works on every finite number; a second paragraph wrapped over two lines.\n',
    '```ts\nexport declare function double(value: number): number;\n```',
    '| `@mutates` | target |\n',
    '| `@throws` | when `target` is frozen |\n',
    '**@param** keys the keys to remove\n',
    '**Example**\n\n```ts\ndouble(2); // 4\n```',
    '### `LIMIT`\n\nA constant.\n',
    '### `Pair`\n\nA type.\n',
    '### `Box`\n\nA class.\n',
  ]) {
    assert.ok(page.includes(fragment), `the page lacks ${JSON.stringify(fragment)}`);
  }
  // Both overloads are shown; exports follow code-unit order (upper case first).
  assert.match(page, /omit\(target[^\n]*keys: readonly string\[\]\): void;\nexport declare function omit\(/);
  const order = [...page.matchAll(/^### `([^`]+)`$/gm)].map((match) => match[1]);
  assert.deepEqual(order, ['Box', 'LIMIT', 'Pair', 'double', 'omit', 'twice', 'half']);
});

test('an internal package, which publishes nothing, is skipped', async () => {
  const root = await editedCopy((copy) => {
    fs.writeFileSync(path.join(copy, 'ARCHITECTURE.md'), 'Internal packages:\n\n```text\ntesting\n```\n');
    fs.mkdirSync(path.join(copy, 'packages/testing/src'), { recursive: true });
    fs.writeFileSync(path.join(copy, 'packages/testing/package.json'), '{ "name": "@yaltaan/testing" }\n');
    fs.writeFileSync(path.join(copy, 'packages/testing/src/index.ts'), 'export const cases = [];\n');
  });
  const verdict = await checkContractTags(root);
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.packages, 1);
  // Without the list, the package is read as a published one, which fails instead of passing unread.
  fs.rmSync(path.join(root, 'ARCHITECTURE.md'));
  const unlisted = (await checkContractTags(root)).problems;
  assert.ok(unlisted.includes('packages/testing: has src/ but no dist/: build it before this check'), String(unlisted));
});

test('the reference is the same, byte for byte, on two runs and on two machines', async () => {
  const first = await editedCopy(() => {});
  const once = readReference(first);
  assert.deepEqual((await checkContractTags(first, { update: true })).problems, []);
  assert.deepEqual(readReference(first), once);
  const elsewhere = builtWorkspace();
  assert.deepEqual((await checkContractTags(elsewhere, { update: true })).problems, []);
  assert.deepEqual(readReference(elsewhere), once);
});

test('the generated reference passes the text format guard', async () => {
  const root = await editedCopy(() => {});
  const files = Object.fromEntries(
    [...readReference(root)].map(([name, content]) => [`docs/reference/${name}`, content] as const),
  );
  withRepo(files, (repo) => {
    const result = repo.run('scripts/check-text-format.sh');
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});

test('an export without tags fails the check', async () => {
  const source = validSources().get(`${PACKAGE}/src/extra.ts`) ?? '';
  const root = builtWorkspace({ [`${PACKAGE}/src/extra.ts`]: source.replace(/\/\*\*[\s\S]*?\*\/\n/, '') });
  const problems = (await checkContractTags(root)).problems.filter((problem) => !problem.startsWith('docs/'));
  assert.deepEqual(problems, [
    'packages/demo/dist/extra.d.ts: half lacks @sharing',
    'packages/demo/dist/extra.d.ts: half lacks @complexity',
    'packages/demo/dist/extra.d.ts: half lacks @throws',
    'packages/demo/dist/extra.d.ts: half lacks @since',
    'packages/demo/dist/extra.d.ts: half lacks @pure or @mutates',
    'packages/demo/dist/extra.d.ts: half lacks @experimental or @stable',
  ]);
});

test('an unknown tag fails the check', async () => {
  const source = validSources().get(`${PACKAGE}/src/extra.ts`) ?? '';
  const root = builtWorkspace({
    [`${PACKAGE}/src/extra.ts`]: source.replace(' * @stable\n', ' * @stable\n * @internal\n'),
  });
  const problems = (await checkContractTags(root)).problems.filter((problem) => !problem.startsWith('docs/'));
  assertOneProblem(problems, 'extra.d.ts: half carries @internal, which is not a known tag');
});

test('@mutates of a parameter that does not exist fails the check', async () => {
  const source = validSources().get(`${PACKAGE}/src/omit.ts`) ?? '';
  const root = builtWorkspace({ [`${PACKAGE}/src/omit.ts`]: source.replace('@mutates target', '@mutates source') });
  const problems = (await checkContractTags(root)).problems.filter((problem) => !problem.startsWith('docs/'));
  assertOneProblem(problems, 'omit @mutates: names "source", which is not a parameter (its parameters are target');
});

test('@mutates may name a parameter of any overload', async () => {
  const source = validSources().get(`${PACKAGE}/src/omit.ts`) ?? '';
  const root = builtWorkspace({ [`${PACKAGE}/src/omit.ts`]: source.replace('@mutates target', '@mutates log') });
  const problems = (await checkContractTags(root)).problems.filter((problem) => !problem.startsWith('docs/'));
  assert.deepEqual(problems, []);
});

test('a reference that differs from the tags fails, and --update rewrites it', async () => {
  const stale = await editedCopy((root) => {
    const page = path.join(root, 'docs/reference/demo.md');
    fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('O(1)', 'O(n)'));
  });
  assertOneProblem((await checkContractTags(stale)).problems, 'docs/reference/demo.md: differs from what the contract');
  assert.equal((await checkContractTags(stale, { update: true })).written, true);
  assert.deepEqual((await checkContractTags(stale)).problems, []);

  const missing = await editedCopy((root) => fs.rmSync(path.join(root, 'docs/reference/README.md')));
  assertOneProblem((await checkContractTags(missing)).problems, 'docs/reference/README.md: missing');

  const extra = await editedCopy((root) => fs.writeFileSync(path.join(root, 'docs/reference/old.md'), '# Old\n'));
  assertOneProblem((await checkContractTags(extra)).problems, 'docs/reference/old.md: is not generated from any');
  await checkContractTags(extra, { update: true });
  assert.equal(fs.existsSync(path.join(extra, 'docs/reference/old.md')), false);
});

test('--update writes nothing while a tag fails', async () => {
  const root = await editedCopy((copy) => {
    const declarations = path.join(copy, `${PACKAGE}/dist/extra.d.ts`);
    fs.writeFileSync(declarations, fs.readFileSync(declarations, 'utf8').replace('@since 0.2', '@since 2'));
  });
  const before = readReference(root);
  const verdict = await checkContractTags(root, { update: true });
  assertOneProblem(verdict.problems, 'half @since: is "2", which is not MAJOR.MINOR');
  assert.equal(verdict.written, false);
  assert.deepEqual(readReference(root), before);
});

test('the module and its declarations must export the same values', async () => {
  const extra = `${PACKAGE}/dist/extra`;
  const loadedOnly = await editedCopy((root) => {
    fs.appendFileSync(path.join(root, `${extra}.js`), 'export const hidden = 1;\n');
  });
  assertOneProblem(
    (await checkContractTags(loadedOnly)).problems,
    'packages/demo/dist/extra.js: the module and its declarations disagree: loaded but not declared: hidden',
  );
  const declaredOnly = await editedCopy((root) => {
    const tags = '/**\n * @since 0.2\n * @stable\n */\n';
    fs.appendFileSync(path.join(root, `${extra}.d.ts`), `${tags}export declare const ghost: number;\n`);
  });
  const problems = (await checkContractTags(declaredOnly)).problems.filter((problem) => !problem.startsWith('docs/'));
  assertOneProblem(problems, 'disagree: declared but not loaded: ghost');
});

test('a subpath must publish code the check can read', async () => {
  const empty = await editedCopy((root) => {
    fs.writeFileSync(path.join(root, `${PACKAGE}/dist/extra.d.ts`), 'export {};\n');
    fs.writeFileSync(path.join(root, `${PACKAGE}/dist/extra.js`), 'export {};\n');
  });
  const emptyProblems = (await checkContractTags(empty)).problems.filter((problem) => !problem.startsWith('docs/'));
  assertOneProblem(emptyProblems, 'dist/extra.d.ts: @yaltaan/demo/extra exports nothing');

  const notModule = await editedCopy((root) => {
    fs.writeFileSync(path.join(root, `${PACKAGE}/dist/extra.d.ts`), 'declare const half: number;\n');
  });
  assertOneProblem((await checkContractTags(notModule)).problems, 'extra.d.ts: is not a module');

  const unbuilt = await editedCopy((root) => fs.rmSync(path.join(root, `${PACKAGE}/dist`), { recursive: true }));
  const unbuiltProblems = (await checkContractTags(unbuilt)).problems.filter((problem) => !problem.startsWith('docs/'));
  assertOneProblem(unbuiltProblems, 'packages/demo: has src/ but no dist/');

  const unwritten = await editedCopy((root) => fs.rmSync(path.join(root, `${PACKAGE}/dist/extra.js`)));
  const unwrittenProblems = (await checkContractTags(unwritten)).problems.filter((p) => !p.startsWith('docs/'));
  assertOneProblem(unwrittenProblems, '"./extra" maps to packages/demo/dist/extra.js, which the build did not write');

  const nested = await editedCopy((root) => {
    const file = path.join(root, `${PACKAGE}/package.json`);
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Record<string, unknown>>;
    manifest['exports'] = { ...manifest['exports'], './extra': { import: { types: './dist/extra.d.ts' } } };
    fs.writeFileSync(file, JSON.stringify(manifest));
  });
  const nestedProblems = (await checkContractTags(nested)).problems.filter((problem) => !problem.startsWith('docs/'));
  assertOneProblem(nestedProblems, '"./extra" is neither a file nor flat conditions');
});

test('a namespace re-export is a kind no tag covers', async () => {
  const root = await editedCopy((copy) => {
    fs.appendFileSync(path.join(copy, `${PACKAGE}/dist/extra.d.ts`), "export * as shapes from './box.js';\n");
    fs.appendFileSync(path.join(copy, `${PACKAGE}/dist/extra.js`), "export * as shapes from './box.js';\n");
  });
  const problems = (await checkContractTags(root)).problems.filter((problem) => !problem.startsWith('docs/'));
  assertOneProblem(problems, 'extra.d.ts: shapes is a namespace or namespace re-export, which no contract tag covers');
});

test('a class names the parameters of its constructor in @mutates', async () => {
  const mutating = (name: string) => async (): Promise<readonly string[]> => {
    const root = await editedCopy((copy) => {
      const declarations = path.join(copy, `${PACKAGE}/dist/box.d.ts`);
      const text = fs.readFileSync(declarations, 'utf8');
      fs.writeFileSync(declarations, text.replace(' * @pure\n', ` * @mutates ${name}\n`));
    });
    return (await checkContractTags(root)).problems.filter((problem) => !problem.startsWith('docs/'));
  };
  assert.deepEqual(await mutating('scale')(), []);
  assertOneProblem(
    await mutating('size')(),
    'index.d.ts: Box @mutates: names "size", which is not a parameter (its parameters are value, scale)',
  );
});
