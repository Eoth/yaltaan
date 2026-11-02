// Inspects the tarball `npm pack` really writes for each published workspace package (ADR 0029). Its expected content
// is computed from the package itself, never from a list of names: the targets of every condition of "exports" and of
// the other entry fields, then every module they import, followed through the built JavaScript (Rollup's parser) and
// through the declarations (TypeScript 7), plus the files npm adds whatever "files" says, package.json, README.md and
// LICENSE. A file of the tarball that nothing reaches is refused, whatever its name: a test, a fixture, a source or a
// note slipped into "files" never ships. A relative import whose target is missing, or declarations that do not
// compile, are refused too, and so is a licence that differs from the repository's. The declarations of a reached
// module count as reached. publint judges the same bytes.
//
// What the inspection does not see: a file the code really imports ships whatever it holds (a test helper imported
// by production code ships, as it must for the import to work; the dependency graph check and the review catch that
// import); a reached file is judged by its imports, not by its content; an import of another package is the
// dependency graph check's to judge. Internal packages (ARCHITECTURE.md §6) are never packed and are skipped.
//
// Usage: node scripts/check-package-contents.ts
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { publint } from 'publint';
import { formatMessage } from 'publint/utils';

import { readInternalPackages } from './lib/internal-packages.ts';
import { readModule } from './lib/module-rules.ts';
import { readTarball } from './lib/tarball.ts';
import {
  describeError,
  isJsonObject,
  listWorkspacePackages,
  readRootManifest,
  repositoryRoot,
  report,
} from './lib/workspace.ts';
import type { JsonObject, WorkspacePackage } from './lib/workspace.ts';

/** Files npm puts in every tarball whatever "files" says: the documentation and the licence a user reads. */
export const DOCUMENTATION_FILES: readonly string[] = ['README.md', 'LICENSE'];

/** Fields of a manifest that name a file a consumer loads, besides "exports". */
const ENTRY_FIELDS: readonly string[] = ['main', 'module', 'browser', 'types', 'typings', 'bin'];

const JAVASCRIPT = /\.[cm]?js$/;
const DECLARATIONS = /\.d\.[cm]?ts$/;

/** The files of a tarball by path inside the package (`dist/index.js`), or the problems that kept them unread. */
export interface PackageFiles {
  readonly files: ReadonlyMap<string, Buffer>;
  readonly problems: readonly string[];
}

/** Every file a consumer may load directly: the targets of the entry fields, as paths inside the package. */
export interface EntryTargets {
  readonly targets: readonly string[];
  readonly problems: readonly string[];
}

/** The files reached from the entry targets, and the imports that reach nothing. */
export interface Reached {
  readonly reached: ReadonlySet<string>;
  readonly problems: readonly string[];
}

/** Reads the archive and maps each entry under `package/` to its path inside the package. */
export function unpackFiles(compressed: Uint8Array, dir: string): PackageFiles {
  const read = readTarball(compressed);
  if (!read.ok) {
    return { files: new Map(), problems: [`${dir}: the tarball cannot be read: ${read.problem}`] };
  }
  const files = new Map<string, Buffer>();
  const problems: string[] = [];
  for (const entry of read.entries) {
    const inside = entry.path.startsWith('package/') ? path.posix.normalize(entry.path.slice('package/'.length)) : '';
    if (inside === '' || inside.startsWith('../') || path.posix.isAbsolute(inside)) {
      problems.push(`${dir}: the tarball holds ${entry.path}, outside its package/ folder`);
    } else if (files.has(inside)) {
      problems.push(`${dir}: the tarball holds ${inside} twice`);
    } else {
      files.set(inside, entry.bytes);
    }
  }
  return { files, problems };
}

/** The file targets of "exports" (every condition, at any depth) and of the other entry fields of `manifest`. */
export function listEntryTargets(manifest: JsonObject): EntryTargets {
  const targets: string[] = [];
  const problems: string[] = [];
  const visit = (value: unknown, where: string): void => {
    if (typeof value === 'string') {
      const target = value.startsWith('./') ? path.posix.normalize(value) : '';
      if (target === '' || target.startsWith('../') || value.includes('*')) {
        problems.push(`${where} is ${JSON.stringify(value)}: the inspection follows only a "./" path to one file`);
      } else if (!targets.includes(target)) {
        targets.push(target);
      }
    } else if (isJsonObject(value)) {
      for (const [key, inner] of Object.entries(value)) {
        visit(inner, `${where}[${JSON.stringify(key)}]`);
      }
    } else if (value !== null) {
      problems.push(`${where} is neither a path, an object of conditions nor null`);
    }
  };
  visit(manifest['exports'], '"exports"');
  for (const field of ENTRY_FIELDS) {
    if (Object.hasOwn(manifest, field)) {
      // Outside "exports" npm and Node also accept a path without "./"; it names the same file.
      const value = manifest[field];
      visit(typeof value === 'string' && !value.startsWith('./') ? `./${value}` : value, `"${field}"`);
    }
  }
  return { targets, problems };
}

/** Follows the relative imports of the JavaScript files among `roots`, through `files`. */
export function followJavaScript(files: ReadonlyMap<string, Buffer>, roots: readonly string[]): Reached {
  const reached = new Set<string>();
  const problems: string[] = [];
  const pending = roots.filter((root) => JAVASCRIPT.test(root) && files.has(root));
  while (pending.length > 0) {
    const file = pending.pop() ?? '';
    if (reached.has(file)) {
      continue;
    }
    reached.add(file);
    for (const edge of readModule(files.get(file)?.toString('utf8') ?? '').edges) {
      if (!edge.specifier.startsWith('./') && !edge.specifier.startsWith('../')) {
        continue;
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), edge.specifier));
      if (files.has(target)) {
        pending.push(target);
      } else {
        problems.push(`${file} line ${edge.line} imports ${edge.specifier}, which the tarball lacks`);
      }
    }
  }
  return { reached, problems };
}

/**
 * Compiles the declaration files among `roots` with TypeScript 7, from the package written out in `folder`, and
 * returns every declaration file of the package the compiler loaded. An import the compiler cannot resolve is an
 * error, as it would be for a consumer.
 */
export function followDeclarations(folder: string, roots: readonly string[]): Reached {
  const declarations = roots.filter((root) => DECLARATIONS.test(root) && fs.existsSync(path.join(folder, root)));
  if (declarations.length === 0) {
    return { reached: new Set(), problems: [] };
  }
  const config = path.join(folder, 'tsconfig.inspection.json');
  const compilerOptions = { noEmit: true, module: 'nodenext', target: 'es2023', lib: ['es2023'], types: [] };
  fs.writeFileSync(config, JSON.stringify({ compilerOptions, files: declarations }));
  const result = spawnSync(process.execPath, [compilerPath(), '-p', config, '--listFiles', '--pretty', 'false'], {
    cwd: folder,
    encoding: 'utf8',
    timeout: 120_000,
  });
  fs.rmSync(config);
  if (result.error !== undefined) {
    return { reached: new Set(), problems: [`the compiler could not run (${describeError(result.error)})`] };
  }
  const reached = new Set<string>();
  const problems: string[] = [];
  const realFolder = fs.realpathSync(folder);
  for (const line of result.stdout.split('\n').map((text) => text.trim())) {
    if (line.includes(': error TS')) {
      problems.push(`the declarations do not compile: ${path.isAbsolute(line) ? path.relative(folder, line) : line}`);
    } else if (line !== '' && path.isAbsolute(line)) {
      const inside = path.relative(realFolder, fs.existsSync(line) ? fs.realpathSync(line) : line);
      // Only a declaration file counts. The emitted declarations import `./x.ts`, and the compiler prefers a source
      // `x.ts` to `x.d.ts` when both are there: a source shipped beside them would be loaded, and a consumer's
      // compiler would check it with its own settings, `skipLibCheck` or not.
      if (!inside.startsWith('..') && !path.isAbsolute(inside) && DECLARATIONS.test(inside)) {
        reached.add(inside.split(path.sep).join('/'));
      }
    }
  }
  if (result.status !== 0 && problems.length === 0) {
    problems.push(`the compiler failed (exit ${result.status}): ${`${result.stdout}${result.stderr}`.trim()}`);
  }
  return { reached, problems };
}

/** Every problem of one tarball: its files against what its code reaches, its licence, publint's verdict. */
export async function inspectTarball(compressed: Buffer, dir: string, licence: Buffer): Promise<string[]> {
  const unpacked = unpackFiles(compressed, dir);
  return [...unpacked.problems, ...inspectFiles(unpacked.files, dir, licence), ...(await lint(compressed, dir))];
}

/** The problems of the files of one tarball against what its code reaches, and of its licence. */
export function inspectFiles(files: ReadonlyMap<string, Buffer>, dir: string, licence: Buffer): string[] {
  const problems: string[] = [];
  const manifestBytes = files.get('package.json');
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes?.toString('utf8') ?? 'null');
  } catch (error) {
    problems.push(`${dir}: the package.json of the tarball is not JSON (${describeError(error)})`);
  }
  if (!isJsonObject(manifest)) {
    return [...problems, `${dir}: the tarball holds no package.json object`];
  }
  const entries = listEntryTargets(manifest);
  problems.push(...entries.problems.map((problem) => `${dir}: ${problem}`));
  for (const target of entries.targets.filter((file) => !files.has(file))) {
    problems.push(`${dir}: an entry field names ${target}, which the tarball lacks`);
  }
  const javascript = followJavaScript(files, entries.targets);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-tarball-'));
  let declarations: Reached;
  try {
    for (const [file, bytes] of files) {
      fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      fs.writeFileSync(path.join(folder, file), bytes);
    }
    // Its declared dependencies, where a consumer's install would put them: an import of anything else stays an error.
    const dependencies = isJsonObject(manifest['dependencies']) ? Object.keys(manifest['dependencies']) : [];
    for (const name of dependencies) {
      const link = path.join(folder, 'node_modules', name);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(path.join(repositoryRoot, 'node_modules', name), link, 'junction');
    }
    declarations = followDeclarations(folder, entries.targets);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
  problems.push(...[...javascript.problems, ...declarations.problems].map((problem) => `${dir}: ${problem}`));
  const reached = new Set(['package.json', ...DOCUMENTATION_FILES, ...entries.targets]);
  for (const file of [...javascript.reached, ...declarations.reached]) {
    reached.add(file);
  }
  // TypeScript emits one declaration file per module: the declarations of a module the JavaScript reaches travel with
  // it, even when no public declaration imports them (an internal helper's). Excluding them would take a list of
  // internal modules written into "files" by hand.
  for (const file of javascript.reached) {
    reached.add(file.replace(/\.([cm]?)js$/, '.d.$1ts'));
  }
  for (const file of [...files.keys()].sort()) {
    if (!reached.has(file)) {
      problems.push(
        `${dir}: the tarball holds ${file}, which nothing reachable from "exports" imports: narrow "files" in its ` +
          'package.json',
      );
    }
  }
  for (const file of DOCUMENTATION_FILES.filter((name) => !files.has(name))) {
    problems.push(`${dir}: the tarball holds no ${file}`);
  }
  // npm does not copy the repository's licence into a workspace package: each keeps its own copy, which must not
  // drift from the one the repository is published under.
  const packed = files.get('LICENSE');
  if (packed !== undefined && !packed.equals(licence)) {
    problems.push(`${dir}: the LICENSE of the tarball differs from the repository's LICENSE: copy it again`);
  }
  return problems;
}

/** publint's messages on the bytes of the tarball, every level counted: it reads them and spawns nothing. */
async function lint(compressed: Buffer, dir: string): Promise<string[]> {
  const tarball = compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);
  try {
    const result = await publint({ pack: { tarball: tarball as ArrayBuffer }, level: 'suggestion', strict: true });
    return result.messages.map(
      (message) => `${dir}: publint ${message.code}: ${formatMessage(message, result.pkg, { color: false }) ?? ''}`,
    );
  } catch (error) {
    return [`${dir}: publint could not read the tarball (${describeError(error)})`];
  }
}

/** The tarball file `npm pack` wrote into `destination`, or why there is none. */
export type PackResult =
  { readonly ok: true; readonly file: string } | { readonly ok: false; readonly problem: string };

/** Runs `npm pack` in `packagePath`, writing the tarball into `destination`. */
export function packPackage(packagePath: string, dir: string, destination: string): PackResult {
  // `--ignore-scripts`: packing must not run the package's prepack or prepare script.
  const result = runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', destination], packagePath);
  if (result.error !== undefined) {
    return { ok: false, problem: `${dir}: npm pack could not run (${describeError(result.error)})` };
  }
  if (result.status !== 0) {
    return { ok: false, problem: `${dir}: npm pack failed (exit ${result.status}): ${result.stderr.trim()}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    return { ok: false, problem: `${dir}: npm pack printed no JSON (${describeError(error)})` };
  }
  const tarball: unknown = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : undefined;
  const filename = isJsonObject(tarball) ? tarball['filename'] : undefined;
  if (typeof filename !== 'string' || filename.includes('/') || filename.includes('\\')) {
    return { ok: false, problem: `${dir}: npm pack printed JSON without the name of one tarball` };
  }
  return { ok: true, file: path.join(destination, filename) };
}

/** The workspace packages that are published: every one but the internal packages. */
export function listPublishedPackages(root: string): { packages: WorkspacePackage[]; problems: string[] } {
  const rootRead = readRootManifest(root);
  if (!rootRead.ok) {
    return { packages: [], problems: [rootRead.problem] };
  }
  const internal = readInternalPackages(root);
  if (!internal.ok) {
    return { packages: [], problems: [internal.problem] };
  }
  const listing = listWorkspacePackages(root, rootRead.value);
  const packages = listing.packages.filter((workspacePackage) => !internal.names.has(workspacePackage.name));
  return { packages, problems: [...listing.problems] };
}

export interface ContentsVerdict {
  readonly problems: readonly string[];
  /** Folder of every workspace package whose tarball was inspected: `packages/core`. */
  readonly packages: readonly string[];
}

/** Packs and inspects the tarball of every published workspace package of the repository at `root`. */
export async function checkRepositoryPackageContents(root: string): Promise<ContentsVerdict> {
  const published = listPublishedPackages(root);
  const problems = [...published.problems];
  const licence = fs.readFileSync(path.join(root, 'LICENSE'));
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-pack-'));
  try {
    for (const workspacePackage of published.packages) {
      const packed = packPackage(workspacePackage.path, workspacePackage.dir, destination);
      if (!packed.ok) {
        problems.push(packed.problem);
        continue;
      }
      problems.push(...(await inspectTarball(fs.readFileSync(packed.file), workspacePackage.dir, licence)));
    }
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
  return { problems, packages: published.packages.map((workspacePackage) => workspacePackage.dir) };
}

/** Path of TypeScript 7's `tsc`, from this script's own dependencies. */
export function compilerPath(): string {
  const manifest = createRequire(import.meta.url).resolve('typescript/package.json');
  return path.join(path.dirname(manifest), 'bin', 'tsc');
}

/** Runs npm with `args` in `cwd`, the same npm that runs this script when there is one. */
export function runNpm(args: readonly string[], cwd: string, timeout = 120_000): SpawnSyncReturns<string> {
  const options = { cwd, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 } as const;
  // Under an npm script, npm_execpath names the entry point of the npm that runs it: starting it with this very Node
  // binary needs no shell and uses the same npm. Another package manager sets the variable to its own entry point,
  // hence the file name check.
  const npmCli = process.env['npm_execpath'];
  if (npmCli !== undefined && path.basename(npmCli) === 'npm-cli.js') {
    return spawnSync(process.execPath, [npmCli, ...args], { ...options, shell: false });
  }
  // Run directly, npm is found on the PATH. On Windows it is npm.cmd, a batch file that only a shell can start. The
  // arguments are this script's own constants and temporary paths, quoted against spaces; one string, because an
  // argument array is concatenated unescaped under shell: true, which Node deprecates (DEP0190).
  if (process.platform === 'win32') {
    return spawnSync(['npm', ...args.map((arg) => `"${arg}"`)].join(' '), { ...options, shell: true });
  }
  return spawnSync('npm', args, { ...options, shell: false });
}

if (import.meta.main) {
  const verdict = await checkRepositoryPackageContents(repositoryRoot);
  const names = verdict.packages.join(', ');
  report(
    verdict.problems,
    `${verdict.packages.length} tarball(s) (${names}) hold exactly what their exports reach, and publint is satisfied.`,
  );
}
