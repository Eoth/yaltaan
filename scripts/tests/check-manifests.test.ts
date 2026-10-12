import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  ADAPTER_PACKAGES,
  LIFECYCLE_INSTALL_SCRIPTS,
  checkPackageManifest,
  checkRepositoryManifests,
  checkRootManifest,
} from '../check-manifests.ts';
import { listWorkspacePackages, parseWorkspaceGlobs, repositoryRoot } from '../lib/workspace.ts';

type Manifest = Record<string, unknown>;

const temporaryRoots: string[] = [];
after(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pien-test-'));
  temporaryRoots.push(root);
  return root;
}

function writeFile(root: string, relative: string, content: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function validRoot(): Manifest {
  return {
    name: 'pien-workspace',
    private: true,
    type: 'module',
    workspaces: ['packages/*'],
    devEngines: { runtime: { name: 'node', version: '>=22.18.0', onFail: 'error' } },
    scripts: { test: 'node --test', verify: 'bash scripts/verify.sh' },
    devDependencies: { prettier: '3.9.9', typescript: '7.0.2', '@types/node': '22.20.5' },
  };
}

function validPackage(name = 'core'): Manifest {
  return {
    name: `@pienjs/${name}`,
    version: '0.0.0',
    private: true,
    license: 'MIT',
    type: 'module',
    sideEffects: false,
    exports: { '.': './dist/index.js', './result': './dist/result.js', './package.json': './package.json' },
    files: ['dist/', '!dist/**/*.test.*'],
    engines: { node: '>=22' },
  };
}

function without(manifest: Manifest, field: string): Manifest {
  const copy = { ...manifest };
  delete copy[field];
  return copy;
}

/** Asserts that `problems` holds exactly one problem, and that it contains `fragment`. */
function assertOneProblem(problems: readonly string[], fragment: string): void {
  assert.equal(problems.length, 1, `expected one problem, got: ${JSON.stringify(problems)}`);
  assert.ok(problems[0]?.includes(fragment), `"${problems[0]}" does not contain "${fragment}"`);
}

test('a root manifest that follows every rule has no problem', () => {
  assert.deepEqual(checkRootManifest(validRoot()), []);
  const alternatives = {
    runtime: [
      { name: 'deno', version: '>=2' },
      { name: 'node', version: '>=22.18.0' },
    ],
  };
  assert.deepEqual(checkRootManifest({ ...validRoot(), devEngines: alternatives }), []);
  assert.deepEqual(checkRootManifest(without(validRoot(), 'devDependencies')), []);
});

test('the root manifest must be an object', () => {
  assertOneProblem(checkRootManifest([]), 'not a JSON object');
  assertOneProblem(checkRootManifest(null), 'not a JSON object');
});

test('the root must be private and an ES module', () => {
  assertOneProblem(checkRootManifest(without(validRoot(), 'private')), '"private" must be true');
  assertOneProblem(checkRootManifest({ ...validRoot(), private: 'true' }), '"private" must be true');
  assertOneProblem(checkRootManifest(without(validRoot(), 'type')), '"type" must be "module"');
  assertOneProblem(checkRootManifest({ ...validRoot(), type: 'commonjs' }), '"type" must be "module"');
});

test('the root has no dependencies, peer or optional dependencies, even empty ones', () => {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    assertOneProblem(
      checkRootManifest({ ...validRoot(), [field]: { lodash: '4.17.21' } }),
      `"${field}" must be absent`,
    );
    assertOneProblem(checkRootManifest({ ...validRoot(), [field]: {} }), `"${field}" must be absent`);
  }
});

test('every root devDependency is pinned to an exact version', () => {
  const specs = ['^3.9.9', '~3.9.9', '*', '', 'latest', '3.9', '3.9.x', '>=3.9.9', '3.9.9 - 4.0.0', '03.9.9'];
  const sources = [
    'https://example.org/prettier.tgz',
    'github:prettier/prettier',
    'git+https://x.org/p.git',
    'file:../p',
  ];
  for (const spec of [...specs, ...sources, 3, null]) {
    const devDependencies = { typescript: '7.0.2', prettier: spec };
    assertOneProblem(checkRootManifest({ ...validRoot(), devDependencies }), 'devDependencies["prettier"]');
  }
  assertOneProblem(checkRootManifest({ ...validRoot(), devDependencies: ['prettier'] }), '"devDependencies" must be');
});

test('the root declares the Node runtime in devEngines', () => {
  const runtimes: unknown[] = [
    undefined,
    { name: 'bun', version: '>=1' },
    { name: 'node' },
    { name: 'node', version: '' },
  ];
  for (const runtime of runtimes) {
    assertOneProblem(checkRootManifest({ ...validRoot(), devEngines: { runtime } }), '"devEngines.runtime"');
  }
  assertOneProblem(checkRootManifest(without(validRoot(), 'devEngines')), '"devEngines.runtime"');
});

test('the root runs no lifecycle install script', () => {
  assert.equal(LIFECYCLE_INSTALL_SCRIPTS.length, 7);
  for (const name of LIFECYCLE_INSTALL_SCRIPTS) {
    const scripts = { test: 'node --test', [name]: 'node setup.js' };
    assertOneProblem(checkRootManifest({ ...validRoot(), scripts }), `scripts["${name}"] must be absent`);
  }
  assertOneProblem(checkRootManifest({ ...validRoot(), scripts: 'node --test' }), '"scripts" must be an object');
});

test('every violation of a root manifest is reported, each with the file name', () => {
  const problems = checkRootManifest({
    ...validRoot(),
    private: false,
    dependencies: {},
    scripts: { postinstall: 'node x.js' },
  });
  assert.equal(problems.length, 3, JSON.stringify(problems));
  assert.ok(problems.every((problem) => problem.startsWith('package.json: ')));
});

test('a package manifest that follows every rule has no problem', () => {
  assert.deepEqual(checkPackageManifest(validPackage(), 'packages/core'), []);
  const published = { ...without(validPackage(), 'private'), version: '1.2.3' };
  assert.deepEqual(checkPackageManifest(published, 'packages/core'), []);
  const privateRelease = { ...validPackage(), version: '1.2.3' };
  assert.deepEqual(checkPackageManifest(privateRelease, 'packages/core'), []);
});

test('the package name is the scope and the folder name', () => {
  for (const name of ['@pienjs/schema', 'core', '@pien/core', '@pienjs/Core', undefined]) {
    assertOneProblem(checkPackageManifest({ ...validPackage(), name }, 'packages/core'), '"name"');
  }
  assertOneProblem(checkPackageManifest(validPackage(), 'packages/schema'), 'expected "@pienjs/schema"');
});

test('a package is an ES module without side effects, under MIT, with its Node engines', () => {
  const dir = 'packages/core';
  assertOneProblem(checkPackageManifest(without(validPackage(), 'type'), dir), '"type" must be "module"');
  assertOneProblem(checkPackageManifest({ ...validPackage(), type: 'commonjs' }, dir), '"type" must be "module"');
  for (const sideEffects of [undefined, true, ['./dist/polyfill.js'], 'false']) {
    assertOneProblem(checkPackageManifest({ ...validPackage(), sideEffects }, dir), '"sideEffects" must be false');
  }
  for (const license of [undefined, 'Apache-2.0', 'mit', 'MIT OR Apache-2.0']) {
    assertOneProblem(checkPackageManifest({ ...validPackage(), license }, dir), '"license"');
  }
  for (const engines of [undefined, {}, { node: '' }, { node: 22 }, '>=22']) {
    assertOneProblem(checkPackageManifest({ ...validPackage(), engines }, dir), '"engines.node"');
  }
});

test('"exports" lists explicit subpaths only', () => {
  const dir = 'packages/core';
  for (const exportsField of [undefined, './dist/index.js', ['./dist/index.js'], {}, null]) {
    const manifest = { ...validPackage(), exports: exportsField };
    assertOneProblem(checkPackageManifest(manifest, dir), '"exports" must be an object');
  }
  for (const key of ['./*', './utils/*', './*.js', '*']) {
    const manifest = { ...validPackage(), exports: { '.': './dist/index.js', [key]: './dist/x.js' } };
    assertOneProblem(checkPackageManifest(manifest, dir), 'is a pattern');
  }
  for (const key of ['./', './dist/', 'import', 'result', '..', '/result']) {
    const manifest = { ...validPackage(), exports: { '.': './dist/index.js', [key]: './dist/x.js' } };
    assertOneProblem(checkPackageManifest(manifest, dir), 'is not an explicit subpath');
  }
});

test('"files" is a non-empty list of paths', () => {
  for (const files of [undefined, [], 'dist/', ['dist/', 3]]) {
    assertOneProblem(checkPackageManifest({ ...validPackage(), files }, 'packages/core'), '"files" must be');
  }
});

test('a package has zero runtime dependency', () => {
  for (const folder of ['core', ...ADAPTER_PACKAGES]) {
    const dir = `packages/${folder}`;
    for (const field of ['dependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies']) {
      const manifest = { ...validPackage(folder), [field]: {} };
      assertOneProblem(checkPackageManifest(manifest, dir), `"${field}" must be absent`);
    }
  }
});

test('only the adapters have peer dependencies', () => {
  const peers = { peerDependencies: { react: '>=19' }, peerDependenciesMeta: { react: { optional: false } } };
  assert.deepEqual(ADAPTER_PACKAGES, ['angular', 'react', 'vue']);
  for (const folder of ADAPTER_PACKAGES) {
    assert.deepEqual(checkPackageManifest({ ...validPackage(folder), ...peers }, `packages/${folder}`), []);
  }
  for (const field of ['peerDependencies', 'peerDependenciesMeta']) {
    const manifest = { ...validPackage('form'), [field]: {} };
    assertOneProblem(checkPackageManifest(manifest, 'packages/form'), `"${field}" must be absent`);
  }
});

test('a package runs no lifecycle install script and pins its devDependencies', () => {
  for (const name of LIFECYCLE_INSTALL_SCRIPTS) {
    const manifest = { ...validPackage(), scripts: { build: 'tsc -b', [name]: 'node x.js' } };
    assertOneProblem(checkPackageManifest(manifest, 'packages/core'), `scripts["${name}"] must be absent`);
  }
  const ranged = { ...validPackage(), devDependencies: { 'temporal-polyfill': '^1.0.5' } };
  assertOneProblem(checkPackageManifest(ranged, 'packages/core'), 'devDependencies["temporal-polyfill"]');
});

test('a package stays private while its version is 0.0.0', () => {
  const dir = 'packages/core';
  assertOneProblem(checkPackageManifest(without(validPackage(), 'private'), dir), '"private" must be true');
  assertOneProblem(checkPackageManifest({ ...validPackage(), private: false }, dir), '"private" must be true');
  assertOneProblem(checkPackageManifest(without(validPackage(), 'version'), dir), '"version" must be a string');
});

test('every violation of a package manifest is reported, each with the file and the field', () => {
  const problems = checkPackageManifest(
    { ...validPackage(), sideEffects: true, license: 'ISC', dependencies: { tslib: '2.8.1' } },
    'packages/core',
  );
  assert.equal(problems.length, 3, JSON.stringify(problems));
  assert.ok(problems.every((problem) => problem.startsWith('packages/core/package.json: ')));
  assert.ok(problems[0]?.includes('"sideEffects"'));
  assert.ok(problems[1]?.includes('"license"'));
  assert.ok(problems[2]?.includes('"dependencies"'));
  assertOneProblem(checkPackageManifest('{}', 'packages/core'), 'packages/core/package.json: not a JSON object');
});

test('workspace globs are read in the "<dir>/*" form only', () => {
  assert.deepEqual(parseWorkspaceGlobs({ workspaces: ['packages/*'] }), { parents: ['packages'], problems: [] });
  assert.deepEqual(parseWorkspaceGlobs({ workspaces: ['packages/*', 'tools/adapters/*'] }).parents, [
    'packages',
    'tools/adapters',
  ]);
  const refused = ['packages/**', 'packages', 'packages/core', './packages/*', '../outside/*', '/abs/*', '*', 'p/*/x'];
  for (const glob of [...refused, '.hidden/*', 'packages/*/', 'packages\\*', 42]) {
    const globs = parseWorkspaceGlobs({ workspaces: [glob] });
    assert.deepEqual(globs.parents, []);
    assertOneProblem(globs.problems, 'is not of the form "<dir>/*"');
  }
  for (const manifest of [{}, { workspaces: [] }, { workspaces: { packages: ['packages/*'] } }, null]) {
    assertOneProblem(parseWorkspaceGlobs(manifest).problems, '"workspaces" must be a non-empty array');
  }
});

test('workspace packages are the visible folders with a manifest, sorted, and a folder without one is reported', () => {
  const root = temporaryRoot();
  writeFile(root, 'packages/schema/package.json', '{}');
  writeFile(root, 'packages/core/package.json', '{}');
  writeFile(root, 'packages/stray/README.md', '# stray');
  writeFile(root, 'packages/.cache/package.json', '{}');
  writeFile(root, 'packages/notes.txt', 'not a folder');
  const listing = listWorkspacePackages(root, { workspaces: ['packages/*', 'missing/*'] });
  assert.deepEqual(
    listing.packages.map(({ name, dir }) => ({ name, dir })),
    [
      { name: 'core', dir: 'packages/core' },
      { name: 'schema', dir: 'packages/schema' },
    ],
  );
  assert.equal(listing.packages[0]?.path, path.join(root, 'packages', 'core'));
  assert.equal(listing.problems.length, 2, JSON.stringify(listing.problems));
  assert.ok(listing.problems.some((problem) => problem.startsWith('packages/stray: no package.json')));
  assert.ok(listing.problems.some((problem) => problem.includes('workspace folder missing/ cannot be listed')));
});

test('the repository check reads every manifest from disk', () => {
  const root = temporaryRoot();
  writeFile(root, 'package.json', JSON.stringify(validRoot()));
  writeFile(root, 'packages/core/package.json', JSON.stringify(validPackage()));
  writeFile(root, 'packages/schema/package.json', JSON.stringify({ ...validPackage('schema'), sideEffects: true }));
  const verdict = checkRepositoryManifests(root);
  assert.deepEqual(verdict.packages, ['packages/core', 'packages/schema']);
  assertOneProblem(verdict.problems, 'packages/schema/package.json: "sideEffects" must be false');

  writeFile(root, 'packages/schema/package.json', '{ "name": ');
  assertOneProblem(checkRepositoryManifests(root).problems, 'packages/schema/package.json: cannot be read as JSON');
  writeFile(root, 'package.json', JSON.stringify(without(validRoot(), 'type')));
  writeFile(root, 'packages/schema/package.json', JSON.stringify(validPackage('schema')));
  assertOneProblem(checkRepositoryManifests(root).problems, 'package.json: "type" must be "module"');
  fs.rmSync(path.join(root, 'package.json'));
  assertOneProblem(checkRepositoryManifests(root).problems, 'package.json: cannot be read as JSON');
});

test('the manifests of this repository follow the rules', () => {
  const verdict = checkRepositoryManifests(repositoryRoot);
  assert.deepEqual(verdict.problems, []);
  assert.ok(verdict.packages.includes('packages/core'));
});

test('run as a program, the check reads this repository and prints its verdict', () => {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, 'scripts', 'check-manifests.ts')], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ok: package\.json and \d+ workspace manifest\(s\) follow the packaging rules\.\n$/);
});
