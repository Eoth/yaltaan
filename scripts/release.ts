// Checks a release from its tag and makes what the publishing job uploads (ADR 0029). The stages run in order, and
// the first one that fails stops the run:
//   1. consistency: the tag is annotated, names the checked-out commit and a SemVer version; the working tree is
//      clean; every published package carries that version, its repository and its publishing settings; the
//      CHANGELOG section of the version sits below "Unreleased", dated with the release commit's date;
//   2. build from nothing and pack every published package into the output folder;
//   3. reproducibility: the tracked files of the commit built again in another folder, packed, identical to the byte;
//   4. inspection of every tarball (scripts/check-package-contents.ts, publint included);
//   5. one CycloneDX SBOM per tarball, by `npm sbom`, checked against the package's manifest;
//   6. a consumer's view: the tarballs installed offline into an empty project, every subpath of "exports" loaded by
//      Node through `import` and `require`, and compiled by TypeScript 7 and 6.0 under `nodenext` and `bundler`;
//   7. the output folder: the tarballs, their SBOMs, SHA512SUMS, the release notes and release.json, which tells the
//      publishing job the version, its dist-tag and the integrity of each tarball.
// A rehearsal (--rehearsal) runs the same stages; it only allows private packages and a `-rehearsal.N` version.
//
// Usage: node scripts/release.ts --tag <tag> --out <folder> [--rehearsal] [--repository-url https://github.com/o/r]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  compilerPath,
  inspectTarball,
  listPublishedPackages,
  packPackage,
  runNpm,
  unpackFiles,
} from './check-package-contents.ts';
import {
  checkReleaseConsistency,
  distTagOf,
  normalizeRepositoryUrl,
  parseReleaseTag,
  readChangelogSection,
} from './lib/release.ts';
import type { ReleasePackage, ReleaseVersion } from './lib/release.ts';
import { describeError, isJsonObject, readJson, repositoryRoot, report } from './lib/workspace.ts';
import type { JsonObject } from './lib/workspace.ts';
import { findCompilers } from './type-cost.ts';

export interface ReleaseOptions {
  readonly tag: string;
  /** Folder the tarballs, SBOMs, sums and notes are written to; created if missing. */
  readonly out: string;
  readonly rehearsal: boolean;
  /** `https://github.com/owner/repo`; by default the workflow's repository, else the remote `origin`. */
  readonly repositoryUrl: string | undefined;
}

const USAGE =
  'usage: node scripts/release.ts --tag <tag> --out <folder> [--rehearsal] [--repository-url https://github.com/o/r]';

/** Reads the command line, or returns the usage error to print. */
export function parseReleaseArguments(args: readonly string[]): ReleaseOptions | string {
  let tag: string | undefined;
  let out: string | undefined;
  let repositoryUrl: string | undefined;
  let rehearsal = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--rehearsal') {
      rehearsal = true;
    } else if ((arg === '--tag' || arg === '--out' || arg === '--repository-url') && value !== undefined) {
      index += 1;
      if (arg === '--tag') {
        tag = value;
      } else if (arg === '--out') {
        out = path.resolve(value);
      } else {
        repositoryUrl = value;
      }
    } else {
      return `${USAGE}\nunexpected argument: ${String(arg)}`;
    }
  }
  if (tag === undefined || out === undefined) {
    return USAGE;
  }
  return { tag, out, rehearsal, repositoryUrl };
}

/** A tarball made by the release, with the manifest it holds. */
export interface ReleaseTarball {
  readonly dir: string;
  readonly name: string;
  readonly file: string;
  readonly manifest: JsonObject;
  readonly integrity: string;
}

export interface ReleaseVerdict {
  readonly problems: readonly string[];
  readonly tarballs: readonly ReleaseTarball[];
}

/** Runs every stage of the release of the repository at `root`. */
export async function runRelease(root: string, options: ReleaseOptions): Promise<ReleaseVerdict> {
  const stage = (name: string): void => {
    console.log(`release: ${name}`);
  };
  // A rehearsal version is a rehearsal whoever asks: the version itself says so, nothing else has to agree.
  const rehearsal = options.rehearsal || parseReleaseTag(options.tag)?.rehearsal === true;
  stage(`consistency of ${options.tag}${rehearsal ? ' (rehearsal: nothing is published)' : ''}`);
  const facts = readGitFacts(root, options.tag);
  if (typeof facts === 'string') {
    return { problems: [facts], tarballs: [] };
  }
  const published = listPublishedPackages(root);
  const packages: ReleasePackage[] = [];
  const problems = [...published.problems, ...facts.problems];
  for (const workspacePackage of published.packages) {
    const read = readJson(root, `${workspacePackage.dir}/package.json`);
    if (read.ok && isJsonObject(read.value)) {
      packages.push({ dir: workspacePackage.dir, manifest: read.value });
    } else {
      problems.push(read.ok ? `${workspacePackage.dir}/package.json: not a JSON object` : read.problem);
    }
  }
  const repositoryUrl = options.repositoryUrl ?? readRepositoryUrl(root);
  if (repositoryUrl === undefined) {
    problems.push('the repository is not on GitHub, or has no remote "origin": pass --repository-url');
  }
  // Every tarball of the output folder is published: one left by an earlier run would go out with the release.
  if (fs.existsSync(options.out) && fs.readdirSync(options.out).length > 0) {
    problems.push(`the output folder ${options.out} is not empty`);
  }
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  problems.push(
    ...checkReleaseConsistency({
      tag: options.tag,
      packages,
      changelog,
      commitDates: facts.commitDates,
      repositoryUrl: repositoryUrl ?? '',
      rehearsal,
    }),
  );
  const tag = parseReleaseTag(options.tag);
  const section = tag === undefined ? undefined : readChangelogSection(changelog, tag.version);
  if (problems.length > 0 || tag === undefined || section?.ok !== true) {
    return { problems, tarballs: [] };
  }

  stage('build from nothing, then pack');
  const build = spawnSync('bash', ['scripts/build.sh'], { cwd: root, encoding: 'utf8' });
  if (build.status !== 0) {
    return { problems: [`the build failed: ${`${build.stdout}${build.stderr}`.trim()}`], tarballs: [] };
  }
  fs.mkdirSync(options.out, { recursive: true });
  const tarballs: ReleaseTarball[] = [];
  for (const { dir, manifest } of packages) {
    const packed = packPackage(path.join(root, dir), dir, options.out);
    if (!packed.ok) {
      return { problems: [packed.problem], tarballs };
    }
    const bytes = fs.readFileSync(packed.file);
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    tarballs.push({ dir, name: String(manifest['name']), file: packed.file, manifest, integrity });
  }

  const stages: [string, () => Promise<string[]> | string[]][] = [
    ['reproducibility: a second build in another folder', () => reproduce(root, tarballs)],
    ['inspection of the tarballs', () => inspectAll(root, tarballs)],
    ['SBOM of each tarball', () => tarballs.flatMap((tarball) => writeSbom(tarball, tarballs, options.out))],
    ['a consumer installs, imports, requires and compiles', () => checkConsumer(tarballs)],
  ];
  for (const [name, run] of stages) {
    stage(name);
    const found = await run();
    if (found.length > 0) {
      return { problems: found, tarballs };
    }
  }

  stage(`release files in ${options.out}`);
  fs.writeFileSync(path.join(options.out, 'RELEASE_NOTES.md'), `${section.section.body}\n`);
  const description = describeRelease(tag, rehearsal, tarballs);
  fs.writeFileSync(path.join(options.out, 'release.json'), `${JSON.stringify(description, null, 2)}\n`);
  // Every file the next jobs upload or read, so that an artifact replaced between the jobs changes a sum.
  const sums = fs
    .readdirSync(options.out)
    .sort()
    .map(
      (file) =>
        `${createHash('sha512')
          .update(fs.readFileSync(path.join(options.out, file)))
          .digest('hex')}  ${file}`,
    );
  fs.writeFileSync(path.join(options.out, 'SHA512SUMS'), `${sums.join('\n')}\n`);
  for (const tarball of tarballs) {
    console.log(`${path.basename(tarball.file)} ${tarball.integrity}`);
    if (process.env['GITHUB_ACTIONS'] === 'true') {
      // A notice is readable from the API of a public repository without a token: another machine compares its own
      // rehearsal of the same commit with it.
      console.log(`::notice title=${path.basename(tarball.file)}::${tarball.integrity}`);
    }
  }
  return { problems: [], tarballs };
}

/** What release.json tells the publishing job. */
export interface ReleaseDescription {
  readonly version: string;
  readonly distTag: 'latest' | 'next';
  /** True for a rehearsal run and for a rehearsal version: the workflow publishes only when it is false. */
  readonly rehearsal: boolean;
  readonly tarballs: readonly { readonly name: string; readonly file: string; readonly integrity: string }[];
}

/** The description of a release of `tag`, made by a rehearsal run or not, with its tarballs. */
export function describeRelease(
  tag: ReleaseVersion,
  rehearsal: boolean,
  tarballs: readonly ReleaseTarball[],
): ReleaseDescription {
  return {
    version: tag.version,
    distTag: distTagOf(tag),
    rehearsal: rehearsal || tag.rehearsal,
    tarballs: tarballs.map((tarball) => ({
      name: tarball.name,
      file: path.basename(tarball.file),
      integrity: tarball.integrity,
    })),
  };
}

export interface GitFacts {
  readonly commitDates: readonly string[];
  readonly problems: readonly string[];
}

/** The facts of git a release depends on, or the problem that kept them unread. */
export function readGitFacts(root: string, tag: string): GitFacts | string {
  const git = (...args: string[]): string | undefined => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : undefined;
  };
  const kind = git('cat-file', '-t', `refs/tags/${tag}`);
  if (kind === undefined) {
    return `there is no tag ${tag}`;
  }
  const problems: string[] = [];
  if (kind !== 'tag') {
    problems.push(`the tag ${tag} is lightweight: a release tag is annotated (git tag -a), so that it has an author`);
  }
  const commit = git('rev-parse', `refs/tags/${tag}^{commit}`);
  if (commit === undefined || commit !== git('rev-parse', 'HEAD')) {
    problems.push(`the tag ${tag} does not name the checked-out commit: check it out first`);
  }
  const dirty = git('status', '--porcelain', '--untracked-files=normal');
  if (dirty !== '') {
    problems.push(`the working tree is not clean, so the release would not be the tagged commit:\n${dirty}`);
  }
  const dates = git('log', '-1', '--format=%as %cs', `refs/tags/${tag}^{commit}`) ?? '';
  return { commitDates: dates.split(' ').filter((date) => date !== ''), problems };
}

/** The workflow's repository on GitHub Actions, else the remote `origin`. */
function readRepositoryUrl(root: string): string | undefined {
  const server = process.env['GITHUB_SERVER_URL'];
  const repository = process.env['GITHUB_REPOSITORY'];
  if (server !== undefined && repository !== undefined) {
    return normalizeRepositoryUrl(`${server}/${repository}`);
  }
  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' });
  return remote.status === 0 ? normalizeRepositoryUrl(remote.stdout) : undefined;
}

/**
 * Builds the tracked files of HEAD again in another folder, under another path, packs them and compares each tarball
 * with the first one, byte for byte. The second build reads the dependencies installed for the first.
 */
function reproduce(root: string, tarballs: readonly ReleaseTarball[]): string[] {
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-reproduce-'));
  try {
    const archive = spawnSync('git', ['archive', '--format=tar', 'HEAD'], { cwd: root, maxBuffer: 1 << 30 });
    const extract = spawnSync('tar', ['-x', '-C', second], { input: archive.stdout });
    if (archive.status !== 0 || extract.status !== 0) {
      return ['the tracked files of HEAD could not be copied into a second folder (git archive, tar)'];
    }
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(second, 'node_modules'), 'junction');
    const problems: string[] = [];
    for (const tarball of tarballs) {
      const config = path.join(second, tarball.dir, 'tsconfig.build.json');
      if (fs.existsSync(config)) {
        const build = spawnSync(process.execPath, [compilerPath(), '-b', config], { cwd: second, encoding: 'utf8' });
        if (build.status !== 0) {
          problems.push(`${tarball.dir}: the second build failed: ${`${build.stdout}${build.stderr}`.trim()}`);
          continue;
        }
      }
      const packed = packPackage(path.join(second, tarball.dir), tarball.dir, second);
      if (!packed.ok) {
        problems.push(packed.problem);
      } else {
        problems.push(...compareTarballs(fs.readFileSync(tarball.file), fs.readFileSync(packed.file), tarball.dir));
      }
    }
    return problems;
  } finally {
    fs.rmSync(second, { recursive: true, force: true });
  }
}

/** Nothing when both tarballs are identical to the byte; otherwise what differs, file by file when it can. */
export function compareTarballs(first: Buffer, second: Buffer, dir: string): string[] {
  if (first.equals(second)) {
    return [];
  }
  const a = unpackFiles(first, dir).files;
  const b = unpackFiles(second, dir).files;
  const differing = [...new Set([...a.keys(), ...b.keys()])]
    .filter((file) => !(a.get(file)?.equals(b.get(file) ?? Buffer.alloc(0)) ?? false))
    .sort();
  const where = differing.length === 0 ? 'the files are the same: the archive itself differs' : differing.join(', ');
  return [`${dir}: two builds of the same commit give different tarballs (${where})`];
}

async function inspectAll(root: string, tarballs: readonly ReleaseTarball[]): Promise<string[]> {
  const licence = fs.readFileSync(path.join(root, 'LICENSE'));
  const problems: string[] = [];
  for (const tarball of tarballs) {
    problems.push(...(await inspectTarball(fs.readFileSync(tarball.file), tarball.dir, licence)));
  }
  return problems;
}

/** The package URL of an npm package, as CycloneDX writes it: `pkg:npm/%40scope/name@1.0.0`. */
export function purlOf(name: string, version: string): string {
  return `pkg:npm/${name.replace(/^@/, '%40')}@${version}`;
}

/** Problems of an SBOM that `npm sbom` printed for the package of `manifest`. */
export function checkSbom(sbom: unknown, manifest: JsonObject): string[] {
  const name = String(manifest['name']);
  const version = String(manifest['version']);
  const metadata = isJsonObject(sbom) ? sbom['metadata'] : undefined;
  const component = isJsonObject(metadata) ? metadata['component'] : undefined;
  if (!isJsonObject(sbom) || sbom['bomFormat'] !== 'CycloneDX' || !isJsonObject(component)) {
    return [`the SBOM of ${name} is not a CycloneDX document with a component`];
  }
  const problems: string[] = [];
  const licences = component['licenses'];
  const first: unknown = Array.isArray(licences) ? licences[0] : undefined;
  const licence = isJsonObject(first) ? first['license'] : undefined;
  const expected: Record<string, unknown> = { name, version, purl: purlOf(name, version) };
  for (const [field, value] of Object.entries(expected)) {
    if (component[field] !== value) {
      problems.push(`the SBOM of ${name} gives "${field}" ${JSON.stringify(component[field])}, not "${String(value)}"`);
    }
  }
  if (!isJsonObject(licence) || licence['id'] !== manifest['license']) {
    problems.push(`the SBOM of ${name} does not give the licence ${String(manifest['license'])}`);
  }
  const components = sbom['components'];
  const listed = (Array.isArray(components) ? components : []).map((entry) =>
    isJsonObject(entry) ? String(entry['name']) : '',
  );
  const dependencies = manifest['dependencies'];
  const declared = isJsonObject(dependencies) ? Object.keys(dependencies) : [];
  if ([...listed].sort().join('\n') !== [...declared].sort().join('\n')) {
    problems.push(`the SBOM of ${name} lists [${listed.join(', ')}], not its dependencies [${declared.join(', ')}]`);
  }
  return problems;
}

/**
 * Writes the SBOM of one tarball next to it. `npm sbom` names the component after the folder it runs in, so the
 * tarball is extracted as `node_modules/<name>`, the folder an installation would give it.
 */
function writeSbom(tarball: ReleaseTarball, tarballs: readonly ReleaseTarball[], out: string): string[] {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-sbom-'));
  const unpack = (from: ReleaseTarball, into: string): void => {
    for (const [file, bytes] of unpackFiles(fs.readFileSync(from.file), from.dir).files) {
      fs.mkdirSync(path.dirname(path.join(into, file)), { recursive: true });
      fs.writeFileSync(path.join(into, file), bytes);
    }
  };
  try {
    const packageFolder = path.join(folder, 'node_modules', ...tarball.name.split('/'));
    unpack(tarball, packageFolder);
    // npm refuses a tree without the dependencies a manifest declares: those of this release, from their tarballs.
    const dependencies = tarball.manifest['dependencies'];
    const declared = isJsonObject(dependencies) ? Object.keys(dependencies) : [];
    for (const dependency of tarballs.filter(({ name }) => declared.includes(name))) {
      unpack(dependency, path.join(packageFolder, 'node_modules', ...dependency.name.split('/')));
    }
    const result = runNpm(['sbom', '--sbom-format', 'cyclonedx', '--sbom-type', 'library'], packageFolder);
    if (result.status !== 0) {
      return [`${tarball.dir}: npm sbom failed (exit ${result.status}): ${`${result.stdout}${result.stderr}`.trim()}`];
    }
    let sbom: unknown;
    try {
      sbom = JSON.parse(result.stdout);
    } catch (error) {
      return [`${tarball.dir}: npm sbom printed no JSON (${describeError(error)})`];
    }
    const problems = checkSbom(sbom, tarball.manifest).map((problem) => `${tarball.dir}: ${problem}`);
    fs.writeFileSync(path.join(out, path.basename(tarball.file).replace(/\.tgz$/, '.cdx.json')), result.stdout);
    return problems;
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

/** The bare specifier of every subpath of "exports" that names a module (`@yaltaan/core/result`). */
export function listSubpathSpecifiers(manifest: JsonObject): string[] {
  const name = String(manifest['name']);
  const exports = manifest['exports'];
  if (!isJsonObject(exports)) {
    return [];
  }
  return Object.entries(exports)
    .filter(([key, target]) => (key === '.' || key.startsWith('./')) && !JSON.stringify(target).includes('.json"'))
    .map(([key]) => (key === '.' ? name : `${name}${key.slice(1)}`));
}

/** Installs the tarballs into an empty project, then loads and compiles every subpath as a consumer would. */
export function checkConsumer(tarballs: readonly ReleaseTarball[]): string[] {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-consumer-'));
  try {
    const manifest = { name: 'yaltaan-consumer', version: '0.0.0', private: true, type: 'module' };
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify(manifest));
    const install = runNpm(
      ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', '--no-package-lock'].concat(
        tarballs.map((tarball) => tarball.file),
      ),
      folder,
    );
    if (install.status !== 0) {
      return [`the tarballs do not install offline: ${`${install.stdout}${install.stderr}`.trim()}`];
    }
    const specifiers = tarballs.flatMap((tarball) => listSubpathSpecifiers(tarball.manifest));
    const quoted = specifiers.map((specifier) => JSON.stringify(specifier));
    const empty = (call: string): string =>
      quoted
        .map((specifier) => `if (Object.keys(${call}(${specifier})).length === 0) throw new Error(${specifier});`)
        .join('\n');
    fs.writeFileSync(path.join(folder, 'import.mjs'), `${empty('await import')}\n`);
    fs.writeFileSync(path.join(folder, 'require.cjs'), `${empty('require')}\n`);
    fs.writeFileSync(
      path.join(folder, 'consumer.ts'),
      quoted.map((specifier, index) => `import * as m${index} from ${specifier};`).join('\n') +
        `\nexport type Modules = [${specifiers.map((_, index) => `typeof m${index}`).join(', ')}];\n`,
    );
    const common = { strict: true, noEmit: true, skipLibCheck: false, types: [], target: 'es2023', lib: ['es2023'] };
    const resolutions = {
      nodenext: { module: 'nodenext', moduleResolution: 'nodenext' },
      bundler: { module: 'preserve', moduleResolution: 'bundler' },
    };
    for (const [resolution, options] of Object.entries(resolutions)) {
      const config = { compilerOptions: { ...common, ...options }, files: ['consumer.ts'] };
      fs.writeFileSync(path.join(folder, `tsconfig.${resolution}.json`), JSON.stringify(config));
    }
    const problems: string[] = [];
    const run = (label: string, args: string[]): void => {
      const result = spawnSync(process.execPath, args, { cwd: folder, encoding: 'utf8', timeout: 120_000 });
      if (result.status !== 0) {
        const output = `${result.stdout}${result.stderr}`.trim().split('\n').slice(0, 8).join('\n');
        problems.push(`a consumer fails to ${label}: ${output || describeError(result.error)}`);
      }
    };
    run(`import every subpath (${specifiers.length})`, ['import.mjs']);
    run(`require every subpath (${specifiers.length})`, ['require.cjs']);
    for (const compiler of findCompilers()) {
      for (const resolution of Object.keys(resolutions)) {
        const label = `compile every subpath with TypeScript ${compiler.version} under ${resolution} resolution`;
        run(label, [compiler.bin, '-p', `tsconfig.${resolution}.json`, '--pretty', 'false']);
      }
    }
    return problems;
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const options = parseReleaseArguments(process.argv.slice(2));
  if (typeof options === 'string') {
    console.error(options);
    process.exitCode = 2;
  } else {
    const verdict = await runRelease(repositoryRoot, options);
    const files = verdict.tarballs.map((tarball) => path.basename(tarball.file)).join(', ');
    const kind = options.rehearsal || parseReleaseTag(options.tag)?.rehearsal === true ? 'rehearsal' : 'release';
    report(verdict.problems, `${kind} of ${options.tag} checked: ${files} in ${options.out}`);
  }
}
