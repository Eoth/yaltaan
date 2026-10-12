// Reads installed packages the way a browser bundler does, for the size report: which package a file belongs to,
// which file a bare import resolves to, whether a file may have side effects, and which packages an import may pull
// in. esbuild does all of this itself; Rollup does none of it, so the report gives it these answers and then checks
// that both bundlers read the same files.
//
// Only the forms the measured packages use are implemented. Any other form (a subpath pattern, a glob in
// "sideEffects", an object "browser" field) throws: a resolution guessed wrong would measure another file than the
// one an application ships, and nothing would say so.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { isJsonObject, type JsonObject } from './workspace.ts';

/**
 * Conditions of the "exports" field, as esbuild sets them for the browser platform. Which one wins is decided by the
 * key order of the package's own "exports" object, not by the order of this list.
 */
export const EXPORT_CONDITIONS: ReadonlySet<string> = new Set(['browser', 'module', 'import', 'default']);

export interface PackageInfo {
  readonly name: string;
  /** Real path (symbolic links resolved, as bundlers do) of the folder that holds the package.json. */
  readonly dir: string;
  readonly manifest: JsonObject;
}

/** A bare import specifier split into the package it names and the subpath inside it. */
export interface BareSpecifier {
  readonly name: string;
  /** `.` for the package itself, `./sub/path` otherwise. */
  readonly subpath: string;
}

/** `@scope/pkg/sub` → `@scope/pkg` and `./sub`; `undefined` for a relative, absolute, `#` or `node:` specifier. */
export function splitBareSpecifier(specifier: string): BareSpecifier | undefined {
  if (/^[./#]/.test(specifier) || specifier.includes(':') || specifier.includes('\\')) {
    return undefined;
  }
  const parts = specifier.split('/');
  const length = specifier.startsWith('@') ? 2 : 1;
  if (parts.length < length || parts.slice(0, length).some((part) => part === '')) {
    return undefined;
  }
  const name = parts.slice(0, length).join('/');
  return { name, subpath: parts.length === length ? '.' : `./${parts.slice(length).join('/')}` };
}

/** Path of `file` from `root`, with forward slashes on every platform. */
export function relativePosix(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

/**
 * The installed packages seen from one root. Answers are cached for the life of the instance: one instance per run,
 * so that a file changed between two runs (a test fixture) is read again.
 */
export class PackageIndex {
  readonly #owners = new Map<string, PackageInfo | null>();

  /**
   * The package `file` belongs to: the nearest package.json above it that has a name. A package.json without one only
   * sets the module type of its folder (`{"type": "module"}` under `dist/esm/`) and does not start a package.
   */
  ownerOf(file: string): PackageInfo | undefined {
    return this.#ownerOfDir(path.dirname(file)) ?? undefined;
  }

  /** The package `name`, installed in a `node_modules` folder of `fromDir` or of a parent, as Node finds it. */
  find(name: string, fromDir: string): PackageInfo {
    for (let dir = fromDir; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', name);
      if (existsSync(path.join(candidate, 'package.json'))) {
        const info = this.#ownerOfDir(realpathSync(candidate));
        if (info?.name !== name) {
          throw new Error(`${candidate}/package.json names ${JSON.stringify(info?.name)}, not ${name}`);
        }
        return info;
      }
      if (path.dirname(dir) === dir) {
        throw new Error(`package ${name} is not installed above ${fromDir}`);
      }
    }
  }

  /** The file a bare `specifier` imported from `importer` resolves to. */
  resolve(specifier: string, importer: string): string {
    const bare = splitBareSpecifier(specifier);
    if (bare === undefined) {
      throw new Error(`${specifier}, imported by ${importer}, is not a bare package specifier`);
    }
    const info = this.find(bare.name, path.dirname(importer));
    const target = exportTarget(info, bare.subpath);
    const file = path.join(info.dir, target);
    if (!existsSync(file)) {
      throw new Error(`${specifier} resolves to ${file}, which does not exist`);
    }
    return file;
  }

  /** Whether `file` may have side effects when it loads, from the "sideEffects" field of its package. */
  hasSideEffects(file: string): boolean {
    const info = this.ownerOf(file);
    const field = info?.manifest['sideEffects'];
    if (info === undefined || field === undefined || field === true) {
      return true;
    }
    if (field === false) {
      return false;
    }
    if (!Array.isArray(field)) {
      throw new Error(`${info.name}: "sideEffects" is ${JSON.stringify(field)}, neither a boolean nor an array`);
    }
    const relative = relativePosix(info.dir, file);
    return field.some((entry) => {
      // A glob, or a name without a slash (which bundlers match against the base name anywhere), is not implemented.
      if (typeof entry !== 'string' || /[*?[\]{}!]/.test(entry) || !entry.includes('/')) {
        throw new Error(`${info.name}: "sideEffects" entry ${JSON.stringify(entry)} is not a plain file path`);
      }
      return entry.replace(/^\.\//, '') === relative;
    });
  }

  /**
   * The packages an import of `subjects` may put code into a bundle from: the subjects and, transitively, their
   * "dependencies". Peer dependencies are left to the application and listed apart: a bundle measures them as
   * external, never as part of the library.
   */
  closure(subjects: readonly PackageInfo[]): { readonly allowed: ReadonlySet<string>; readonly peers: string[] } {
    const allowed = new Set<string>();
    const peers = new Set<string>();
    const pending = [...subjects];
    for (let info = pending.pop(); info !== undefined; info = pending.pop()) {
      if (allowed.has(info.name)) {
        continue;
      }
      allowed.add(info.name);
      for (const name of dependencyNames(info, 'peerDependencies')) {
        peers.add(name);
      }
      for (const name of dependencyNames(info, 'dependencies')) {
        pending.push(this.find(name, info.dir));
      }
    }
    return { allowed, peers: [...peers].filter((name) => !allowed.has(name)).sort() };
  }

  #ownerOfDir(start: string): PackageInfo | null {
    const visited: string[] = [];
    let found: PackageInfo | null = null;
    for (let dir = start; ; dir = path.dirname(dir)) {
      const cached = this.#owners.get(dir);
      if (cached !== undefined) {
        found = cached;
        break;
      }
      visited.push(dir);
      const manifest = readManifest(path.join(dir, 'package.json'));
      if (manifest !== undefined && typeof manifest['name'] === 'string') {
        found = { name: manifest['name'], dir, manifest };
        break;
      }
      if (path.dirname(dir) === dir) {
        break;
      }
    }
    for (const dir of visited) {
      this.#owners.set(dir, found);
    }
    return found;
  }
}

function readManifest(file: string): JsonObject | undefined {
  if (!existsSync(file)) {
    return undefined;
  }
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isJsonObject(value)) {
    throw new Error(`${file} is not a JSON object`);
  }
  return value;
}

function dependencyNames(info: PackageInfo, field: string): string[] {
  const value = info.manifest[field];
  if (value === undefined) {
    return [];
  }
  if (!isJsonObject(value)) {
    throw new Error(`${info.name}: "${field}" is not an object`);
  }
  return Object.keys(value);
}

// Node's PACKAGE_EXPORTS_RESOLVE for exact subpaths, and the "module", "main" fallbacks of a package without
// "exports" (a subpath of such a package is a file path inside it).
function exportTarget(info: PackageInfo, subpath: string): string {
  const exportsField = info.manifest['exports'];
  if (exportsField === undefined) {
    if (subpath !== '.') {
      return subpath;
    }
    const browser = info.manifest['browser'];
    if (browser !== undefined && typeof browser !== 'string') {
      throw new Error(`${info.name}: an object "browser" field is not implemented`);
    }
    const main = [browser, info.manifest['module'], info.manifest['main']].find((value) => typeof value === 'string');
    return typeof main === 'string' ? main : 'index.js';
  }
  const bySubpath =
    isJsonObject(exportsField) && Object.keys(exportsField).some((key) => key.startsWith('.'))
      ? exportsField
      : { '.': exportsField };
  if (!Object.hasOwn(bySubpath, subpath)) {
    if (Object.keys(bySubpath).some((key) => key.includes('*'))) {
      throw new Error(`${info.name}: subpath patterns of "exports" are not implemented (looking for ${subpath})`);
    }
    throw new Error(`${info.name} does not export ${subpath}`);
  }
  const target = conditionalTarget(bySubpath[subpath]);
  if (typeof target !== 'string' || !target.startsWith('./')) {
    throw new Error(`${info.name}: no target for ${subpath} under the conditions ${[...EXPORT_CONDITIONS].join(', ')}`);
  }
  return target;
}

// A string is the target; null means "not exported"; in an array the first usable entry wins; in an object the first
// key, in the package's order, that is an active condition and yields a target.
function conditionalTarget(value: unknown): string | null | undefined {
  if (typeof value === 'string' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(conditionalTarget).find((target) => target !== undefined);
  }
  if (isJsonObject(value)) {
    for (const [condition, nested] of Object.entries(value)) {
      if (EXPORT_CONDITIONS.has(condition)) {
        const target = conditionalTarget(nested);
        if (target !== undefined) {
          return target;
        }
      }
    }
  }
  return undefined;
}
