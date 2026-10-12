// Checks the package.json files of the workspace: the root, which only holds development tools, and every workspace
// package, which must stay publishable as an ESM module with zero runtime dependency and an explicit public surface.
//
// Usage: node scripts/check-manifests.ts
import {
  isJsonObject,
  listWorkspacePackages,
  readJson,
  readRootManifest,
  repositoryRoot,
  report,
} from './lib/workspace.ts';
import type { JsonObject } from './lib/workspace.ts';

/** npm runs these scripts on install (or on pack and publish), so they would run code on every clone or consumer. */
export const LIFECYCLE_INSTALL_SCRIPTS: readonly string[] = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'preprepare',
  'postprepare',
];

/** Package folders that adapt a framework: the framework is a peer, installed by the application, never by us. */
export const ADAPTER_PACKAGES: readonly string[] = ['angular', 'react', 'vue'];

export const NPM_SCOPE = '@yaltaan';

const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

// Every field through which a package pulls third-party code at install time; peers are allowed to adapters only.
// "dependencies" is read apart: it holds the edges of the graph between the workspace packages, and nothing else.
const RUNTIME_DEPENDENCY_FIELDS = ['optionalDependencies', 'bundleDependencies', 'bundledDependencies'];
const PEER_DEPENDENCY_FIELDS = ['peerDependencies', 'peerDependenciesMeta'];

/** Problems of the root package.json, each prefixed with the file name. */
export function checkRootManifest(manifest: unknown): string[] {
  const file = 'package.json';
  if (!isJsonObject(manifest)) {
    return [`${file}: not a JSON object`];
  }
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(`${file}: ${message}`);
  };
  if (manifest['private'] !== true) {
    fail('"private" must be true: the workspace root is never published');
  }
  if (manifest['type'] !== 'module') {
    fail('"type" must be "module": the scripts are ES modules');
  }
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    if (Object.hasOwn(manifest, field)) {
      fail(`"${field}" must be absent: the root holds development tools only, in "devDependencies"`);
    }
  }
  if (!hasNodeRuntime(manifest['devEngines'])) {
    fail(
      '"devEngines.runtime" must name "node" with a "version": npm then refuses to work under a Node release the ' +
        'scripts were not written for',
    );
  }
  problems.push(...checkPinnedDevDependencies(manifest, file));
  problems.push(...checkNoInstallScripts(manifest, file));
  return problems;
}

/**
 * Problems of a workspace package's package.json, each prefixed with the file name. `dir` is the package folder from
 * the repository root, with forward slashes (`packages/core`); its last segment is the expected package name.
 */
export function checkPackageManifest(manifest: unknown, dir: string): string[] {
  const file = `${dir}/package.json`;
  if (!isJsonObject(manifest)) {
    return [`${file}: not a JSON object`];
  }
  const folder = dir.slice(dir.lastIndexOf('/') + 1);
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(`${file}: ${message}`);
  };

  const expectedName = `${NPM_SCOPE}/${folder}`;
  if (manifest['name'] !== expectedName) {
    fail(`"name" is ${JSON.stringify(manifest['name'])}, expected "${expectedName}" (the scope and the folder name)`);
  }
  if (manifest['type'] !== 'module') {
    fail('"type" must be "module": the packages ship ES modules only');
  }
  if (manifest['sideEffects'] !== false) {
    fail('"sideEffects" must be false: bundlers then drop every module an application does not import');
  }
  if (manifest['license'] !== 'MIT') {
    fail(`"license" is ${JSON.stringify(manifest['license'])}, expected "MIT", the licence of every package`);
  }
  const engines = manifest['engines'];
  if (!isJsonObject(engines) || typeof engines['node'] !== 'string' || engines['node'] === '') {
    fail('"engines.node" must state the Node versions the package supports');
  }
  problems.push(...checkExports(manifest['exports']).map((message) => `${file}: ${message}`));
  const files = manifest['files'];
  if (!Array.isArray(files) || files.length === 0 || !files.every((entry) => typeof entry === 'string')) {
    fail('"files" must be a non-empty array of paths: without it npm publishes every file of the folder');
  }

  for (const field of RUNTIME_DEPENDENCY_FIELDS) {
    if (Object.hasOwn(manifest, field)) {
      fail(`"${field}" must be absent: a package has zero third-party runtime dependency`);
    }
  }
  problems.push(...checkInternalDependencies(manifest['dependencies'], file));
  if (!ADAPTER_PACKAGES.includes(folder)) {
    for (const field of PEER_DEPENDENCY_FIELDS) {
      if (Object.hasOwn(manifest, field)) {
        fail(`"${field}" must be absent: only the adapters (${ADAPTER_PACKAGES.join(', ')}) have peers`);
      }
    }
  }
  const peers = manifest['peerDependencies'];
  for (const name of isJsonObject(peers) ? Object.keys(peers) : []) {
    if (name.startsWith(`${NPM_SCOPE}/`)) {
      fail(
        `peerDependencies["${name}"]: a package of the workspace is a dependency, never a peer, so that the size ` +
          'report measures it inside the bundles of the packages above it',
      );
    }
  }
  problems.push(...checkPinnedDevDependencies(manifest, file));
  problems.push(...checkNoInstallScripts(manifest, file));

  const version = manifest['version'];
  if (typeof version !== 'string') {
    fail('"version" must be a string');
  } else if (version === '0.0.0' && manifest['private'] !== true) {
    fail('"private" must be true while "version" is "0.0.0": nothing is published before the release workflow');
  }
  return problems;
}

export interface ManifestsVerdict {
  readonly problems: readonly string[];
  /** Folder of every workspace package whose manifest was read: `packages/core`. */
  readonly packages: readonly string[];
}

/** Reads the real repository: the root manifest and the manifest of every workspace package. */
export function checkRepositoryManifests(root: string): ManifestsVerdict {
  const rootRead = readRootManifest(root);
  if (!rootRead.ok) {
    return { problems: [rootRead.problem], packages: [] };
  }
  const problems = checkRootManifest(rootRead.value);
  const listing = listWorkspacePackages(root, rootRead.value);
  problems.push(...listing.problems);
  const manifests = new Map<string, JsonObject>();
  for (const workspacePackage of listing.packages) {
    const read = readJson(root, `${workspacePackage.dir}/package.json`);
    problems.push(...(read.ok ? checkPackageManifest(read.value, workspacePackage.dir) : [read.problem]));
    if (read.ok && isJsonObject(read.value)) {
      manifests.set(workspacePackage.dir, read.value);
    }
  }
  problems.push(...checkWorkspaceVersions(manifests));
  return { problems, packages: listing.packages.map((workspacePackage) => workspacePackage.dir) };
}

/**
 * Problems of the internal dependencies across the workspace: each must name a workspace package, at its exact
 * version. npm links a workspace package only when its version satisfies the spec; any other spec makes npm install
 * the name from the registry instead, where nothing guarantees who published it. `manifests` maps each package folder
 * (`packages/core`) to its manifest.
 */
export function checkWorkspaceVersions(manifests: ReadonlyMap<string, JsonObject>): string[] {
  const versions = new Map<string, unknown>();
  for (const manifest of manifests.values()) {
    if (typeof manifest['name'] === 'string') {
      versions.set(manifest['name'], manifest['version']);
    }
  }
  const problems: string[] = [];
  for (const [dir, manifest] of manifests) {
    const dependencies = manifest['dependencies'];
    for (const [name, spec] of isJsonObject(dependencies) ? Object.entries(dependencies) : []) {
      if (!versions.has(name)) {
        problems.push(`${dir}/package.json: dependencies["${name}"] names no package of the workspace`);
      } else if (spec !== versions.get(name)) {
        problems.push(
          `${dir}/package.json: dependencies["${name}"] is ${JSON.stringify(spec)}, not the workspace version ` +
            `${JSON.stringify(versions.get(name))}: npm would install the name from the registry instead`,
        );
      }
    }
  }
  return problems;
}

function hasNodeRuntime(devEngines: unknown): boolean {
  const runtime = isJsonObject(devEngines) ? devEngines['runtime'] : undefined;
  // npm accepts one runtime or an array of alternatives.
  const runtimes: unknown[] = Array.isArray(runtime) ? runtime : [runtime];
  return runtimes.some(
    (entry) =>
      isJsonObject(entry) &&
      entry['name'] === 'node' &&
      typeof entry['version'] === 'string' &&
      entry['version'] !== '',
  );
}

// The public surface is the list of "exports" keys and nothing else: a "./*" pattern (or a "./dir/" folder mapping)
// would expose every internal module that matches it, and an internal module would then be an API to keep stable.
function checkExports(exportsField: unknown): string[] {
  if (!isJsonObject(exportsField) || Object.keys(exportsField).length === 0) {
    return ['"exports" must be an object that maps each public subpath ("." or "./name") to its files'];
  }
  const problems: string[] = [];
  for (const key of Object.keys(exportsField)) {
    if (key.includes('*')) {
      problems.push(`"exports" key ${JSON.stringify(key)} is a pattern: list each public subpath explicitly`);
    } else if (key !== '.' && !(key.startsWith('./') && key.length > 2 && !key.endsWith('/'))) {
      problems.push(`"exports" key ${JSON.stringify(key)} is not an explicit subpath ("." or "./name")`);
    }
  }
  return problems;
}

// An exact version is the one that was reviewed; a range, a tag, a URL, a git or a file spec lets a later install pick
// code that nobody read. The lockfile records the result, but only an exact spec keeps package.json and the lockfile
// telling the same story.
function checkPinnedDevDependencies(manifest: JsonObject, file: string): string[] {
  const devDependencies = manifest['devDependencies'];
  if (devDependencies === undefined) {
    return [];
  }
  if (!isJsonObject(devDependencies)) {
    return [`${file}: "devDependencies" must be an object`];
  }
  return Object.entries(devDependencies)
    .filter(([, spec]) => typeof spec !== 'string' || !EXACT_VERSION.test(spec))
    .map(
      ([name, spec]) =>
        `${file}: devDependencies["${name}"] is ${JSON.stringify(spec)}, not an exact version x.y.z (no range, tag, ` +
        'URL, git or file spec)',
    );
}

// The only runtime dependencies are the packages below in the graph, each pinned to the exact version that the
// workspace check compares with the package's own.
function checkInternalDependencies(dependencies: unknown, file: string): string[] {
  if (dependencies === undefined) {
    return [];
  }
  if (!isJsonObject(dependencies)) {
    return [`${file}: "dependencies" must be an object`];
  }
  return Object.entries(dependencies).flatMap(([name, spec]) => {
    if (!name.startsWith(`${NPM_SCOPE}/`)) {
      return [`${file}: dependencies["${name}"] must be absent: a package has zero third-party runtime dependency`];
    }
    if (typeof spec !== 'string' || !EXACT_VERSION.test(spec)) {
      return [`${file}: dependencies["${name}"] is ${JSON.stringify(spec)}, not an exact version x.y.z`];
    }
    return [];
  });
}

function checkNoInstallScripts(manifest: JsonObject, file: string): string[] {
  const scripts = manifest['scripts'];
  if (scripts === undefined) {
    return [];
  }
  if (!isJsonObject(scripts)) {
    return [`${file}: "scripts" must be an object`];
  }
  return LIFECYCLE_INSTALL_SCRIPTS.filter((name) => Object.hasOwn(scripts, name)).map(
    (name) => `${file}: scripts["${name}"] must be absent: npm runs it on install, on every clone or consumer machine`,
  );
}

if (import.meta.main) {
  const verdict = checkRepositoryManifests(repositoryRoot);
  report(
    verdict.problems,
    `package.json and ${verdict.packages.length} workspace manifest(s) follow the packaging rules.`,
  );
}
