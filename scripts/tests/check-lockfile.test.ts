import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  ALLOWED_LICENSES,
  INSTALL_SCRIPT_ALLOWLIST,
  REGISTRY,
  checkLockfile,
  checkRepositoryLockfile,
  checkWorkspaceEntries,
} from '../check-lockfile.ts';
import { repositoryRoot } from '../lib/workspace.ts';

type Json = Record<string, unknown>;

const temporaryRoots: string[] = [];
after(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const DEV_DEPENDENCIES = { '@types/node': '22.20.5', prettier: '3.9.9', typescript: '7.0.2' };

function rootManifest(changes: Json = {}): Json {
  return { private: true, workspaces: ['packages/*'], devDependencies: DEV_DEPENDENCIES, ...changes };
}

function registryEntry(name: string, version: string, license: unknown, changes: Json = {}): Json {
  const tarball = `${name.slice(name.lastIndexOf('/') + 1)}-${version}.tgz`;
  return {
    version,
    resolved: `${REGISTRY}${name}/-/${tarball}`,
    integrity: `sha512-${Buffer.from(name).toString('base64')}==`,
    dev: true,
    license,
    ...changes,
  };
}

/** A lockfile like the one of this repository; `changes` replaces entries of "packages", `undefined` removes one. */
function lockfile(changes: Json = {}): Json {
  const packages: Json = {
    '': { name: 'yaltaan-workspace', license: 'MIT', workspaces: ['packages/*'], devDependencies: DEV_DEPENDENCIES },
    'node_modules/@yaltaan/core': { resolved: 'packages/core', link: true },
    'node_modules/@types/node': registryEntry('@types/node', '22.20.5', 'MIT'),
    'node_modules/fsevents': registryEntry('fsevents', '2.3.3', 'MIT', {
      optional: true,
      os: ['darwin'],
      hasInstallScript: true,
    }),
    'node_modules/prettier': registryEntry('prettier', '3.9.9', 'MIT', { bin: { prettier: 'bin/prettier.cjs' } }),
    'node_modules/typescript': registryEntry('typescript', '7.0.2', 'Apache-2.0', { bin: { tsc: 'bin/tsc' } }),
    'node_modules/undici-types': registryEntry('undici-types', '6.21.0', 'MIT'),
    'packages/core': { name: '@yaltaan/core', version: '0.0.0', license: 'MIT' },
    ...changes,
  };
  for (const [location, entry] of Object.entries(packages)) {
    if (entry === undefined) {
      delete packages[location];
    }
  }
  return { name: 'yaltaan-workspace', lockfileVersion: 3, requires: true, packages };
}

/** Asserts that `problems` holds exactly one problem, and that it contains `fragment`. */
function assertOneProblem(problems: readonly string[], fragment: string): void {
  assert.equal(problems.length, 1, `expected one problem, got: ${JSON.stringify(problems)}`);
  assert.ok(problems[0]?.includes(fragment), `"${problems[0]}" does not contain "${fragment}"`);
}

test('a lockfile that follows every rule has no problem', () => {
  assert.deepEqual(checkLockfile(lockfile(), rootManifest()), []);
});

test('the allowlists are MIT and Apache-2.0, and the install script of fsevents alone', () => {
  assert.deepEqual(ALLOWED_LICENSES, ['MIT', 'Apache-2.0']);
  assert.deepEqual(INSTALL_SCRIPT_ALLOWLIST, ['fsevents']);
});

test('the lockfile is a version 3 object with a "packages" map', () => {
  for (const version of [1, 2, '3', undefined]) {
    assertOneProblem(checkLockfile({ ...lockfile(), lockfileVersion: version }, rootManifest()), '"lockfileVersion"');
  }
  assertOneProblem(checkLockfile({ lockfileVersion: 3, dependencies: {} }, rootManifest()), '"packages" must be');
  assertOneProblem(checkLockfile([], rootManifest()), 'package-lock.json: not a JSON object');
});

test('every locked package comes from the npm registry', () => {
  const sources = [
    undefined,
    'https://registry.yarnpkg.com/prettier/-/prettier-3.9.9.tgz',
    'http://registry.npmjs.org/prettier/-/prettier-3.9.9.tgz',
    'https://registry.npmjs.org.example.com/prettier/-/prettier-3.9.9.tgz',
    'git+ssh://git@github.com/prettier/prettier.git#abc123',
    'file:../prettier',
  ];
  for (const resolved of sources) {
    const entry = registryEntry('prettier', '3.9.9', 'MIT', { resolved });
    assertOneProblem(checkLockfile(lockfile({ 'node_modules/prettier': entry }), rootManifest()), 'is resolved from');
  }
});

test('every locked package has a SHA-512 checksum', () => {
  for (const integrity of [undefined, '', 'sha1-2jmj7l5rSw0yVb/vlWAYkK/YBwk=', 'sha256-abc', 'SHA512-abc']) {
    const entry = registryEntry('prettier', '3.9.9', 'MIT', { integrity });
    const problems = checkLockfile(lockfile({ 'node_modules/prettier': entry }), rootManifest());
    assertOneProblem(problems, 'not a "sha512-" checksum');
  }
});

test('every locked package carries an allowed licence, as an exact SPDX identifier', () => {
  for (const license of [undefined, 'GPL-3.0-only', 'ISC', 'mit', 'MIT OR Apache-2.0', '(MIT OR Apache-2.0)', 42]) {
    const entry = registryEntry('prettier', '3.9.9', license);
    const problems = checkLockfile(lockfile({ 'node_modules/prettier': entry }), rootManifest());
    assertOneProblem(problems, 'packages["node_modules/prettier"] has licence');
  }
});

test('an allowed licence that no locked package carries is a stale allowance', () => {
  const policy = { licenses: ['MIT', 'Apache-2.0', 'ISC'], installScripts: INSTALL_SCRIPT_ALLOWLIST };
  assertOneProblem(checkLockfile(lockfile(), rootManifest(), policy), 'licence ISC is allowed but no locked package');
  // Removing the only Apache-2.0 package leaves its allowance unused: the workspace entries, skipped, never count.
  const problems = checkLockfile(lockfile({ 'node_modules/typescript': undefined }), rootManifest());
  assertOneProblem(problems, 'licence Apache-2.0 is allowed but no locked package');
});

test('a locked package runs an install script only when allowed by name', () => {
  const scripted = { 'node_modules/prettier': registryEntry('prettier', '3.9.9', 'MIT', { hasInstallScript: true }) };
  assertOneProblem(
    checkLockfile(lockfile(scripted), rootManifest()),
    'prettier is not in the install-script allowlist',
  );
  const allowed = { licenses: ALLOWED_LICENSES, installScripts: [...INSTALL_SCRIPT_ALLOWLIST, 'prettier'] };
  assert.deepEqual(checkLockfile(lockfile(scripted), rootManifest(), allowed), []);
  // A nested copy and an alias are judged by the name of the package they install.
  const nested = {
    'node_modules/prettier/node_modules/@scope/helper': registryEntry('@scope/helper', '1.0.0', 'MIT', {
      hasInstallScript: true,
    }),
    'node_modules/alias': registryEntry('real-name', '1.0.0', 'MIT', { name: 'real-name', hasInstallScript: true }),
  };
  const nestedPolicy = {
    licenses: ALLOWED_LICENSES,
    installScripts: [...INSTALL_SCRIPT_ALLOWLIST, '@scope/helper', 'real-name'],
  };
  assert.deepEqual(checkLockfile(lockfile(nested), rootManifest(), nestedPolicy), []);
  const problems = checkLockfile(lockfile(nested), rootManifest(), {
    ...nestedPolicy,
    installScripts: [...INSTALL_SCRIPT_ALLOWLIST, '@scope/helper'],
  });
  assertOneProblem(problems, 'real-name is not in the install-script allowlist');
});

test('an install-script allowance that no locked package needs is stale', () => {
  const policy = { licenses: ALLOWED_LICENSES, installScripts: [...INSTALL_SCRIPT_ALLOWLIST, 'esbuild'] };
  assertOneProblem(checkLockfile(lockfile(), rootManifest(), policy), 'esbuild may run an install script but no');
});

test('workspace packages are skipped, any other link is refused, nested dependencies are checked', () => {
  const unlicensedWorkspace = { 'packages/core': { name: '@yaltaan/core', version: '0.0.0' } };
  assert.deepEqual(checkLockfile(lockfile(unlicensedWorkspace), rootManifest()), []);
  for (const resolved of ['../outside', 'packages/core/nested', 'packages', 'vendor/core', undefined]) {
    const link = { 'node_modules/@yaltaan/core': { resolved, link: true } };
    assertOneProblem(checkLockfile(lockfile(link), rootManifest()), 'only a workspace package may be linked');
  }
  const nested = { 'packages/core/node_modules/left-pad': registryEntry('left-pad', '1.3.0', 'WTFPL') };
  assertOneProblem(checkLockfile(lockfile(nested), rootManifest()), 'packages["packages/core/node_modules/left-pad"]');
  const outside = { 'tools/x': { version: '1.0.0', license: 'MIT' } };
  assert.equal(checkLockfile(lockfile(outside), rootManifest()).length, 2);
  assertOneProblem(
    checkLockfile(lockfile({ 'node_modules/prettier': 'prettier@3.9.9' }), rootManifest()),
    'not an object',
  );
});

test('no two packages at the top of node_modules ship the same command', () => {
  // TypeScript 6.0, hoisted as a dependency of its wrapper, replaced the `tsc` of TypeScript 7 in node_modules/.bin.
  const typescript6 = registryEntry('typescript', '6.0.3', 'Apache-2.0', {
    name: 'typescript',
    bin: { tsc: 'bin/tsc', tsserver: 'bin/tsserver' },
  });
  const hoisted = { 'node_modules/@typescript/old': typescript6 };
  assertOneProblem(
    checkLockfile(lockfile(hoisted), rootManifest()),
    'packages["node_modules/@typescript/old"] and packages["node_modules/typescript"] ship the command "tsc"',
  );
  const nested = { 'node_modules/@typescript/typescript6/node_modules/@typescript/old': typescript6 };
  assert.deepEqual(checkLockfile(lockfile(nested), rootManifest()), []);
  // A "bin" given as one file is a command named after the package, without its scope.
  const single = { 'node_modules/@other/tsc': registryEntry('@other/tsc', '1.0.0', 'MIT', { bin: 'cli.js' }) };
  assertOneProblem(checkLockfile(lockfile(single), rootManifest()), 'ship the command "tsc"');
  const workspace = { 'packages/core': { name: '@yaltaan/core', version: '0.0.0', bin: { prettier: 'x.js' } } };
  assertOneProblem(checkLockfile(lockfile(workspace), rootManifest()), 'packages["packages/core"]');
});

test('a root manifest whose workspaces cannot be read is reported', () => {
  const problems = checkLockfile(
    lockfile({ 'packages/core': undefined }),
    rootManifest({ workspaces: ['packages/**'] }),
  );
  assertOneProblem(problems, 'is not of the form "<dir>/*"');
});

test('the lockfile records the devDependencies of package.json', () => {
  const differs = rootManifest({ devDependencies: { ...DEV_DEPENDENCIES, prettier: '3.9.8' } });
  assertOneProblem(checkLockfile(lockfile(), differs), 'root devDependencies["prettier"] is "3.9.9" in the lockfile');
  const added = rootManifest({ devDependencies: { ...DEV_DEPENDENCIES, esbuild: '0.26.0' } });
  assertOneProblem(checkLockfile(lockfile(), added), 'is null in the lockfile but "0.26.0" in package.json');
  const removed = rootManifest({ devDependencies: { prettier: '3.9.9', typescript: '7.0.2' } });
  assertOneProblem(checkLockfile(lockfile(), removed), 'root devDependencies["@types/node"] is "22.20.5"');
  assertOneProblem(checkLockfile(lockfile({ '': undefined }), rootManifest()), 'the root entry, is missing');
  const notAnObject = rootManifest({ devDependencies: ['prettier'] });
  assertOneProblem(checkLockfile(lockfile(), notAnObject), 'is not an object');
});

test('every violation of a lockfile is reported', () => {
  const entry = registryEntry('prettier', '3.9.9', 'GPL-3.0-only', { resolved: 'file:../p', integrity: 'sha1-x' });
  const problems = checkLockfile(
    { ...lockfile({ 'node_modules/prettier': entry }), lockfileVersion: 2 },
    rootManifest(),
  );
  assert.equal(problems.length, 4, JSON.stringify(problems));
  assert.ok(problems.every((problem) => problem.startsWith('package-lock.json: ')));
});

test('the repository check reads package.json and package-lock.json from disk', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-test-'));
  temporaryRoots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(rootManifest()));
  fs.mkdirSync(path.join(root, 'packages', 'core'), { recursive: true });
  const coreManifest = { name: '@yaltaan/core', version: '0.0.0', license: 'MIT', private: true };
  fs.writeFileSync(path.join(root, 'packages', 'core', 'package.json'), JSON.stringify(coreManifest));
  assertOneProblem(checkRepositoryLockfile(root).problems, 'package-lock.json: cannot be read as JSON');
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lockfile()));
  assert.deepEqual(checkRepositoryLockfile(root), { problems: [], entries: 8 });
  const unlicensed = lockfile({ 'node_modules/prettier': registryEntry('prettier', '3.9.9', undefined) });
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(unlicensed));
  assertOneProblem(checkRepositoryLockfile(root).problems, 'has licence undefined');
});

const lockfileAbsent = !fs.existsSync(path.join(repositoryRoot, 'package-lock.json'));
const skipWithoutLockfile = lockfileAbsent ? 'package-lock.json is absent: run npm install first' : false;

test('the lockfile of this repository follows the rules', { skip: skipWithoutLockfile }, () => {
  const verdict = checkRepositoryLockfile(repositoryRoot);
  assert.deepEqual(verdict.problems, []);
  assert.ok(verdict.entries > 1);
});

test('run as a program, the check reads this repository and prints its verdict', { skip: skipWithoutLockfile }, () => {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, 'scripts', 'check-lockfile.ts')], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ok: \d+ lockfile entries: registry sources, sha512 checksums, allowed licences/);
});

test('the lockfile entry of a workspace package matches its package.json', () => {
  const entry = { name: '@yaltaan/core', version: '0.0.0', license: 'MIT', engines: { node: '>=22.12' } };
  const lock = { lockfileVersion: 3, packages: { 'packages/core': entry } };
  assert.deepEqual(checkWorkspaceEntries(lock, new Map([['packages/core', { ...entry, private: true }]])), []);
  const stale = checkWorkspaceEntries(lock, new Map([['packages/core', { ...entry, engines: { node: '>=24' } }]]));
  assert.equal(stale.length, 1);
  assert.match(stale[0] ?? '', /engines/);
  const missing = checkWorkspaceEntries(lock, new Map([['packages/schema', entry]]));
  assert.match(missing[0] ?? '', /packages\["packages\/schema"\] is missing/);
});
