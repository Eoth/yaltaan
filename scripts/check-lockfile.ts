// Checks package-lock.json, the exact list of code that `npm ci` installs: every locked package comes from the public
// npm registry with a SHA-512 checksum, under an allowed licence, and runs no install script unless allowed by name;
// no two packages at the top of node_modules ship a command of the same name; the lockfile also records the same
// development tools as package.json.
//
// Usage: node scripts/check-lockfile.ts
import {
  isJsonObject,
  listWorkspacePackages,
  parseWorkspaceGlobs,
  readJson,
  readRootManifest,
  repositoryRoot,
  report,
} from './lib/workspace.ts';

/**
 * Licences a locked package may carry, as exact SPDX identifiers (an SPDX expression such as "MIT OR Apache-2.0" is
 * not listed, so it fails until it is listed itself). Adding an entry requires an architecture decision record that
 * justifies the dependency bringing it. An entry that no locked package uses is a stale exception and fails the check.
 */
export const ALLOWED_LICENSES: readonly string[] = ['MIT', 'Apache-2.0'];

/**
 * Packages allowed to declare an install script (`"hasInstallScript": true`). Adding an entry requires an architecture
 * decision record that justifies the dependency and its script. An entry that no locked package needs fails the check.
 * The repository's .npmrc runs no install script at all: an entry only accepts a package whose script is never needed.
 *
 * - fsevents: an optional dependency of Rollup, installed on macOS only for watch mode, which ships its compiled
 *   binary (docs/adr/0009-size-harness-bundlers-and-references.md).
 */
export const INSTALL_SCRIPT_ALLOWLIST: readonly string[] = ['fsevents'];

/** The only source a locked package may come from. */
export const REGISTRY = 'https://registry.npmjs.org/';

export interface LockfilePolicy {
  readonly licenses: readonly string[];
  readonly installScripts: readonly string[];
}

const DEFAULT_POLICY: LockfilePolicy = { licenses: ALLOWED_LICENSES, installScripts: INSTALL_SCRIPT_ALLOWLIST };

const FILE = 'package-lock.json';

/**
 * Problems of a parsed package-lock.json, judged against the parsed root package.json (for its workspace globs and its
 * devDependencies). `policy` defaults to the allowlists above.
 */
export function checkLockfile(lock: unknown, rootManifest: unknown, policy: LockfilePolicy = DEFAULT_POLICY): string[] {
  if (!isJsonObject(lock)) {
    return [`${FILE}: not a JSON object`];
  }
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(`${FILE}: ${message}`);
  };
  if (lock['lockfileVersion'] !== 3) {
    fail(`"lockfileVersion" is ${JSON.stringify(lock['lockfileVersion'])}, expected 3 (npm 9 and later)`);
  }
  const packages = lock['packages'];
  if (!isJsonObject(packages)) {
    fail('"packages" must be an object');
    return problems;
  }

  const globs = parseWorkspaceGlobs(rootManifest);
  if (globs.problems.length > 0) {
    // Without the workspace folders, every workspace link would be reported as a foreign link: one cause, one report.
    return [...problems, ...globs.problems];
  }
  // A workspace package is `<parent>/<folder>`, one level below a workspace glob's folder: anything deeper (its own
  // node_modules) is a real dependency and is checked like any other.
  const isWorkspaceDir = (location: unknown): boolean =>
    typeof location === 'string' &&
    globs.parents.some((parent) => {
      const rest = location.startsWith(`${parent}/`) ? location.slice(parent.length + 1) : '';
      return rest !== '' && !rest.includes('/');
    });

  const usedLicenses = new Set<string>();
  const usedInstallScripts = new Set<string>();
  const commands = new Map<string, string[]>();
  for (const [location, entry] of Object.entries(packages)) {
    if (location === '' || !isJsonObject(entry)) {
      if (location !== '') {
        fail(`packages["${location}"] is not an object`);
      }
      continue;
    }
    if (isWorkspaceDir(location) || (entry['link'] !== true && isTopLevel(location))) {
      for (const command of commandNames(entry, location)) {
        commands.set(command, [...(commands.get(command) ?? []), location]);
      }
    }
    if (isWorkspaceDir(location)) {
      continue;
    }
    const where = `packages["${location}"]`;
    if (entry['link'] === true) {
      if (!isWorkspaceDir(entry['resolved'])) {
        fail(`${where} links to ${JSON.stringify(entry['resolved'])}: only a workspace package may be linked`);
      }
      continue;
    }
    const name = typeof entry['name'] === 'string' ? entry['name'] : nameFromLocation(location);
    const resolved = entry['resolved'];
    if (typeof resolved !== 'string' || !resolved.startsWith(REGISTRY)) {
      fail(`${where} is resolved from ${JSON.stringify(resolved)}, not from ${REGISTRY}`);
    }
    const integrity = entry['integrity'];
    if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
      fail(`${where} has integrity ${JSON.stringify(integrity)}, not a "sha512-" checksum`);
    }
    const license = entry['license'];
    if (typeof license === 'string' && policy.licenses.includes(license)) {
      usedLicenses.add(license);
    } else {
      fail(
        `${where} has licence ${JSON.stringify(license)}, not one of ${policy.licenses.join(', ')}: ` +
          'allowing another one takes an architecture decision record',
      );
    }
    if (entry['hasInstallScript'] === true) {
      if (policy.installScripts.includes(name)) {
        usedInstallScripts.add(name);
      } else {
        fail(`${where} (${name}) has an install script, and ${name} is not in the install-script allowlist`);
      }
    }
  }

  for (const [command, owners] of commands) {
    if (owners.length > 1) {
      fail(
        `${[...owners]
          .sort()
          .map((owner) => `packages["${owner}"]`)
          .join(' and ')} ship the command "${command}": npm links ` +
          'one of them in node_modules/.bin, the other silently loses; keep only one at the top of node_modules',
      );
    }
  }
  for (const license of policy.licenses) {
    if (!usedLicenses.has(license)) {
      fail(`licence ${license} is allowed but no locked package carries it: remove the stale allowance`);
    }
  }
  for (const name of policy.installScripts) {
    if (!usedInstallScripts.has(name)) {
      fail(`${name} may run an install script but no locked package named so has one: remove the stale allowance`);
    }
  }
  problems.push(...compareRootDevDependencies(packages[''], rootManifest));
  return problems;
}

export interface LockfileVerdict {
  readonly problems: readonly string[];
  /** Number of entries of "packages", the root included. */
  readonly entries: number;
}

/** Fields npm copies from a workspace package.json into the lockfile entry of that package. */
export const WORKSPACE_FIELDS: readonly string[] = [
  'name',
  'version',
  'license',
  'engines',
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
];

/**
 * Problems between the lockfile entries of the workspace packages and their package.json files (folder -> parsed
 * manifest). `npm ci` neither rewrites the lockfile nor compares these copies, and `npm ls` does not either: a field
 * changed in a package.json alone (its engines, its name) would stay stale in the lockfile without this check.
 */
export function checkWorkspaceEntries(lock: unknown, manifests: ReadonlyMap<string, unknown>): string[] {
  const packages = isJsonObject(lock) ? lock['packages'] : undefined;
  if (!isJsonObject(packages)) {
    return [];
  }
  const problems: string[] = [];
  for (const [dir, manifest] of manifests) {
    const entry = packages[dir];
    if (!isJsonObject(entry) || !isJsonObject(manifest)) {
      problems.push(`${FILE}: packages["${dir}"] is missing: run npm install`);
      continue;
    }
    for (const field of WORKSPACE_FIELDS) {
      const locked = JSON.stringify(entry[field]);
      const declared = JSON.stringify(manifest[field]);
      if (locked !== declared) {
        problems.push(
          `${FILE}: packages["${dir}"].${field} is ${locked ?? 'absent'}, but ${dir}/package.json says ` +
            `${declared ?? 'nothing'}: run npm install`,
        );
      }
    }
  }
  return problems;
}

/** Reads the real repository's package.json and package-lock.json. */
export function checkRepositoryLockfile(root: string): LockfileVerdict {
  const manifestRead = readRootManifest(root);
  const lockRead = readJson(root, FILE);
  if (!manifestRead.ok || !lockRead.ok) {
    const problems = [manifestRead, lockRead].flatMap((read) => (read.ok ? [] : [read.problem]));
    return { problems, entries: 0 };
  }
  const packages = isJsonObject(lockRead.value) ? lockRead.value['packages'] : undefined;
  const listing = listWorkspacePackages(root, manifestRead.value);
  const manifests = new Map<string, unknown>();
  for (const workspacePackage of listing.packages) {
    const read = readJson(root, `${workspacePackage.dir}/package.json`);
    manifests.set(workspacePackage.dir, read.ok ? read.value : undefined);
  }
  return {
    problems: [
      ...checkLockfile(lockRead.value, manifestRead.value),
      ...listing.problems,
      ...checkWorkspaceEntries(lockRead.value, manifests),
    ],
    entries: isJsonObject(packages) ? Object.keys(packages).length : 0,
  };
}

// `node_modules/a/node_modules/@scope/b` installs `@scope/b`; an entry without "node_modules/" in its location is not
// an installed package, and its location is the best name it has.
function nameFromLocation(location: string): string {
  const marker = 'node_modules/';
  const index = location.lastIndexOf(marker);
  return index === -1 ? location : location.slice(index + marker.length);
}

// npm links the commands of every package placed at `node_modules/<name>` (a dependency of a dependency included, once
// hoisted there), and of every workspace package; a package nested under another one has its commands linked nowhere.
function isTopLevel(location: string): boolean {
  const name = location.startsWith('node_modules/') ? location.slice('node_modules/'.length) : '';
  return name !== '' && !name.includes('/node_modules/') && /^(@[^/]+\/)?[^/@][^/]*$/.test(name);
}

// "bin" is a map from command to file, or one file for a command named after the package without its scope.
function commandNames(entry: Readonly<Record<string, unknown>>, location: string): string[] {
  const bin = entry['bin'];
  if (typeof bin === 'string') {
    const name = typeof entry['name'] === 'string' ? entry['name'] : nameFromLocation(location);
    return [name.slice(name.lastIndexOf('/') + 1)];
  }
  return isJsonObject(bin) ? Object.keys(bin) : [];
}

// npm ci installs what the lockfile says, not what package.json says: if the two disagree on a tool, the version that
// was reviewed in package.json is not the one that runs.
function compareRootDevDependencies(rootEntry: unknown, rootManifest: unknown): string[] {
  if (!isJsonObject(rootEntry)) {
    return [`${FILE}: packages[""], the root entry, is missing`];
  }
  const locked = rootEntry['devDependencies'];
  const declared = isJsonObject(rootManifest) ? rootManifest['devDependencies'] : undefined;
  if ((locked !== undefined && !isJsonObject(locked)) || (declared !== undefined && !isJsonObject(declared))) {
    return [`${FILE}: the root "devDependencies" of package.json or of the lockfile is not an object`];
  }
  const lockedMap = isJsonObject(locked) ? locked : {};
  const declaredMap = isJsonObject(declared) ? declared : {};
  const names = [...new Set([...Object.keys(declaredMap), ...Object.keys(lockedMap)])].sort();
  return names
    .filter((name) => declaredMap[name] !== lockedMap[name])
    .map(
      (name) =>
        `${FILE}: root devDependencies["${name}"] is ${JSON.stringify(lockedMap[name] ?? null)} in the lockfile ` +
        `but ${JSON.stringify(declaredMap[name] ?? null)} in package.json: run npm install, then review the change`,
    );
}

if (import.meta.main) {
  const verdict = checkRepositoryLockfile(repositoryRoot);
  report(
    verdict.problems,
    `${verdict.entries} lockfile entries: registry sources, sha512 checksums, allowed licences, install scripts, ` +
      'one package per command.',
  );
}
