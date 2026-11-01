// Prepares the commit of a release in the working tree (ADR 0029): every published package gets the version, the
// specs of the workspace packages that depend on one follow it, in the manifests and in the lockfile, and "private"
// is removed; the entries under "Unreleased" move into the section of the version, dated today. Nothing is committed
// or tagged: the diff is read, then committed and tagged by hand (`git tag -a v<version>`).
//
// --rehearsal prepares the test version `<next minor>-rehearsal.0` instead, and prints it. When "Unreleased" holds no
// entry, a rehearsal writes one saying so: a rehearsal tests the mechanics of a release on any commit, while a real
// release with nothing to announce fails.
//
// Usage: node scripts/release-prepare.ts <version> | --rehearsal
import fs from 'node:fs';
import path from 'node:path';

import { listPublishedPackages } from './check-package-contents.ts';
import { cutChangelog, parseVersion, REHEARSAL } from './lib/release.ts';
import { isJsonObject, listWorkspacePackages, readRootManifest, repositoryRoot, report } from './lib/workspace.ts';
import type { JsonObject } from './lib/workspace.ts';

const REHEARSAL_ENTRY = '- Release rehearsal: no user-visible change.';

/** The next minor version after the highest of `versions` (prerelease identifiers ignored), as a rehearsal version. */
export function nextRehearsalVersion(versions: readonly string[]): string {
  let [major, minor] = [0, 0];
  for (const version of versions) {
    const [readMajor = 0, readMinor = 0] = version.split('-')[0]?.split('.').map(Number) ?? [];
    if (readMajor > major || (readMajor === major && readMinor > minor)) {
      [major, minor] = [readMajor, readMinor];
    }
  }
  return `${major}.${minor + 1}.0-${REHEARSAL}.0`;
}

/** The manifest with `version`, without "private", and with the specs of `published` names set to `version`. */
export function prepareManifest(
  manifest: JsonObject,
  version: string,
  published: ReadonlySet<string>,
  isPublished: boolean,
): JsonObject {
  const prepared: JsonObject = {};
  for (const [field, value] of Object.entries(manifest)) {
    if (field === 'private' && isPublished) {
      continue;
    }
    prepared[field] = field === 'version' && isPublished ? version : value;
  }
  const dependencies = manifest['dependencies'];
  if (isJsonObject(dependencies)) {
    prepared['dependencies'] = Object.fromEntries(
      Object.entries(dependencies).map(([name, spec]) => [name, published.has(name) ? version : spec]),
    );
  }
  return prepared;
}

/** Prepares the release of `version` in the repository at `root`; returns the problems, empty on success. */
export function prepareRelease(root: string, version: string, date: string, rehearsal: boolean): string[] {
  if (parseVersion(version) === undefined) {
    return [`"${version}" is not a SemVer version without build metadata`];
  }
  const rootManifest = readRootManifest(root);
  const published = listPublishedPackages(root);
  if (!rootManifest.ok || published.problems.length > 0) {
    return rootManifest.ok ? published.problems : [rootManifest.problem];
  }
  // Every file is computed before any is written: a release that cannot be prepared leaves the tree untouched.
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const cut = cutChangelog(rehearsal ? withRehearsalEntry(changelog) : changelog, version, date);
  if (!cut.ok) {
    return [cut.problem];
  }
  const writes = new Map<string, string>([['CHANGELOG.md', cut.text]]);
  const workspace = listWorkspacePackages(root, rootManifest.value).packages;
  const publishedDirs = new Set(published.packages.map((workspacePackage) => workspacePackage.dir));
  const read = (file: string): JsonObject => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as JsonObject;
  const names = new Set(
    published.packages.map((workspacePackage) => String(read(`${workspacePackage.dir}/package.json`)['name'])),
  );
  const lock = read('package-lock.json');
  const locked = lock['packages'];
  for (const { dir } of workspace) {
    const file = `${dir}/package.json`;
    const prepared = prepareManifest(read(file), version, names, publishedDirs.has(dir));
    writes.set(file, `${JSON.stringify(prepared, null, 2)}\n`);
    const entry = isJsonObject(locked) ? locked[dir] : undefined;
    if (isJsonObject(entry) && isJsonObject(locked)) {
      locked[dir] = { ...entry, ...pickLocked(prepared, entry) };
    }
  }
  writes.set('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
  for (const [file, text] of writes) {
    fs.writeFileSync(path.join(root, file), text);
  }
  return [];
}

/** The fields of a lockfile entry that a prepared manifest changes: the version and the dependency specs. */
function pickLocked(prepared: JsonObject, entry: JsonObject): JsonObject {
  const picked: JsonObject = { version: prepared['version'] };
  if (isJsonObject(entry['dependencies']) && isJsonObject(prepared['dependencies'])) {
    picked['dependencies'] = prepared['dependencies'];
  }
  return picked;
}

/** The changelog, with an entry under "Unreleased" when it has none. */
export function withRehearsalEntry(changelog: string): string {
  // Cutting a probe section succeeds exactly when "Unreleased" exists and holds an entry.
  if (cutChangelog(changelog, '0.0.0-probe', '2000-01-01').ok) {
    return changelog;
  }
  return changelog.replace('## [Unreleased]\n', `## [Unreleased]\n\n${REHEARSAL_ENTRY}\n`);
}

/** Today in the machine's time zone, YYYY-MM-DD: the date git records for a commit made now (`%cs`). */
export function localDate(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const rehearsal = args.length === 1 && args[0] === '--rehearsal';
  if (args.length !== 1 || args[0] === undefined || (args[0].startsWith('--') && !rehearsal)) {
    console.error('usage: node scripts/release-prepare.ts <version> | --rehearsal');
    process.exitCode = 2;
  } else {
    const published = listPublishedPackages(repositoryRoot).packages;
    const versions = published.map((workspacePackage) => {
      const manifest: unknown = JSON.parse(fs.readFileSync(path.join(workspacePackage.path, 'package.json'), 'utf8'));
      return isJsonObject(manifest) ? String(manifest['version']) : '0.0.0';
    });
    const version = rehearsal ? nextRehearsalVersion(versions) : args[0];
    const date = localDate(new Date());
    const problems = prepareRelease(repositoryRoot, version, date, rehearsal);
    report(problems, `release ${version} prepared, dated ${date}: read the diff, commit, then tag v${version}`);
    if (problems.length === 0 && rehearsal) {
      console.log(version);
    }
  }
}
