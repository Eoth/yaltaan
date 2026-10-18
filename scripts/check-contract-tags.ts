// Checks the contract tags of every public export (ARCHITECTURE.md §5.6) and keeps the reference documentation that
// is written from them up to date.
//
// The public surface is what each "exports" subpath of a workspace package publishes: its declaration file, read by
// the compiler (scripts/lib/declarations.ts), which follows re-exports and merges overloads. Each export is judged
// against the tag list of scripts/lib/contract-tags.ts. The value exports the compiler sees are compared with the
// keys of the module namespace Node loads from the same subpath: a reading that misses exports fails instead of
// passing on less than the package publishes.
//
// Internal packages (ARCHITECTURE.md §6) publish nothing and are skipped.
//
// Runs after the build. The reference under docs/reference/ is compared byte for byte with what the tags give;
// `--update` rewrites it, and only when every tag passes.
//
// Usage: node scripts/check-contract-tags.ts [--update]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { NPM_SCOPE } from './check-manifests.ts';
import { REFERENCE_DIR, renderReference, type ReferencedPackage } from './lib/contract-reference.ts';
import { judgeExport, type PublicExport } from './lib/contract-tags.ts';
import { readDeclarations } from './lib/declarations.ts';
import { readInternalPackages } from './lib/internal-packages.ts';
import { relativePosix } from './lib/packages.ts';
import {
  describeError,
  isJsonObject,
  listWorkspacePackages,
  readJson,
  readRootManifest,
  repositoryRoot,
  report,
} from './lib/workspace.ts';

export interface ContractVerdict {
  readonly problems: readonly string[];
  readonly packages: number;
  /** Subpaths whose declarations were read. */
  readonly subpaths: number;
  readonly exports: number;
  /** Whether `--update` wrote the reference. */
  readonly written: boolean;
}

/** One code subpath of a package: the files it maps to, absolute. */
interface Entry {
  readonly folder: string;
  readonly specifier: string;
  readonly declarations: string;
  readonly module: string;
}

/** Checks the repository at `root`; with `update`, writes the reference instead of comparing it. */
export async function checkContractTags(
  root: string,
  options: { readonly update?: boolean } = {},
): Promise<ContractVerdict> {
  const rootRead = readRootManifest(root);
  if (!rootRead.ok) {
    return { problems: [rootRead.problem], packages: 0, subpaths: 0, exports: 0, written: false };
  }
  const listing = listWorkspacePackages(root, rootRead.value);
  const internal = readInternalPackages(root);
  if (!internal.ok) {
    return { problems: [internal.problem], packages: 0, subpaths: 0, exports: 0, written: false };
  }
  const problems = [...listing.problems];
  const entries: Entry[] = [];
  const packages: { readonly folder: string; readonly name: string }[] = [];
  for (const workspacePackage of listing.packages.filter((candidate) => !internal.names.has(candidate.name))) {
    const name = `${NPM_SCOPE}/${workspacePackage.name}`;
    packages.push({ folder: workspacePackage.name, name });
    const read = readJson(root, `${workspacePackage.dir}/package.json`);
    if (!read.ok) {
      problems.push(read.problem);
      continue;
    }
    const hasSources = existsSync(path.join(workspacePackage.path, 'src'));
    if (hasSources && !existsSync(path.join(workspacePackage.path, 'dist'))) {
      problems.push(`${workspacePackage.dir}: has src/ but no dist/: build it before this check`);
      continue;
    }
    const exportsField = isJsonObject(read.value) ? read.value['exports'] : undefined;
    for (const [key, target] of Object.entries(isJsonObject(exportsField) ? exportsField : {})) {
      const shown = `${workspacePackage.dir}/package.json: "exports" ${JSON.stringify(key)}`;
      const files = filesOf(target);
      if (files === 'not code') {
        continue;
      }
      if (typeof files === 'string') {
        problems.push(`${shown} ${files}`);
        continue;
      }
      const entry = {
        folder: workspacePackage.name,
        specifier: key === '.' ? name : `${name}/${key.slice(2)}`,
        declarations: path.resolve(workspacePackage.path, files.declarations),
        module: path.resolve(workspacePackage.path, files.module),
      };
      const missing = [entry.declarations, entry.module].filter((file) => !existsSync(file));
      if (missing.length > 0) {
        const names = missing.map((file) => relativePosix(root, file)).join(' and ');
        problems.push(`${shown} maps to ${names}, which the build did not write`);
        continue;
      }
      entries.push(entry);
    }
  }
  const read = readDeclarations(entries.map((entry) => entry.declarations));
  if (!read.ok) {
    return {
      problems: [...problems, read.problem],
      packages: packages.length,
      subpaths: 0,
      exports: 0,
      written: false,
    };
  }
  let exportCount = 0;
  const bySpecifier = new Map<string, readonly PublicExport[]>();
  for (const entry of entries) {
    const exports = read.modules.get(entry.declarations) ?? [];
    const shown = relativePosix(root, entry.declarations);
    if (exports.length === 0) {
      problems.push(`${shown}: ${entry.specifier} exports nothing: remove the subpath or export from it`);
    }
    for (const exported of exports) {
      problems.push(...judgeExport(exported).map((problem) => `${shown}: ${exported.name} ${problem}`));
    }
    problems.push(...(await compareWithRuntime(root, entry, exports)));
    exportCount += exports.length;
    bySpecifier.set(entry.specifier, exports);
  }
  const referenced: ReferencedPackage[] = packages.map((referencedPackage) => ({
    ...referencedPackage,
    subpaths: entries
      .filter((entry) => entry.folder === referencedPackage.folder)
      .map((entry) => ({ specifier: entry.specifier, exports: bySpecifier.get(entry.specifier) ?? [] })),
  }));
  const reference = renderReference(referenced);
  let written = false;
  if (options.update === true) {
    if (problems.length === 0) {
      writeReference(root, reference);
      written = true;
    }
  } else {
    problems.push(...compareReference(root, reference));
  }
  return { problems, packages: packages.length, subpaths: entries.length, exports: exportCount, written };
}

// A subpath maps to a JavaScript file whose declarations sit beside it, or to a flat object of conditions that names
// both. Nested conditions are refused rather than guessed: a reading that took the wrong branch would check files no
// user loads.
function filesOf(target: unknown): { readonly declarations: string; readonly module: string } | 'not code' | string {
  if (typeof target === 'string') {
    if (target.endsWith('.json')) {
      return 'not code';
    }
    return target.endsWith('.js')
      ? { declarations: `${target.slice(0, -3)}.d.ts`, module: target }
      : `maps to ${JSON.stringify(target)}, neither a .js nor a .json file`;
  }
  if (isJsonObject(target)) {
    const types = target['types'];
    const module = target['import'] ?? target['default'];
    if (typeof module === 'string' && module.endsWith('.js')) {
      if (types === undefined) {
        return { declarations: `${module.slice(0, -3)}.d.ts`, module };
      }
      if (typeof types === 'string' && types.endsWith('.d.ts')) {
        return { declarations: types, module };
      }
    }
  }
  return 'is neither a file nor flat conditions {"types", "import" or "default"} that this check reads';
}

// Node loads the module the way users do; its namespace holds every value export, whatever the compiler made of the
// declarations. A query string keeps a second check of the same file within one process from reading a cached module.
let loads = 0;

async function compareWithRuntime(root: string, entry: Entry, exports: readonly PublicExport[]): Promise<string[]> {
  const shown = relativePosix(root, entry.module);
  let namespace: object;
  try {
    loads += 1;
    namespace = (await import(`${pathToFileURL(entry.module).href}?check=${loads}`)) as object;
  } catch (error) {
    return [`${shown}: cannot be loaded (${describeError(error)})`];
  }
  const atRunTime = Object.keys(namespace).sort();
  const declared = exports
    .filter((exported) => exported.value)
    .map((exported) => exported.name)
    .sort();
  if (atRunTime.join('\n') === declared.join('\n')) {
    return [];
  }
  const missing = atRunTime.filter((name) => !declared.includes(name));
  const extra = declared.filter((name) => !atRunTime.includes(name));
  return [
    `${shown}: the module and its declarations disagree: ` +
      [
        missing.length > 0 ? `loaded but not declared: ${missing.join(', ')}` : '',
        extra.length > 0 ? `declared but not loaded: ${extra.join(', ')}` : '',
      ]
        .filter((part) => part !== '')
        .join('; '),
  ];
}

function compareReference(root: string, reference: ReadonlyMap<string, string>): string[] {
  const dir = path.join(root, REFERENCE_DIR);
  const present = existsSync(dir) ? readdirSync(dir).sort() : [];
  const problems: string[] = [];
  const fix = 'run node scripts/check-contract-tags.ts --update';
  for (const [name, content] of reference) {
    const file = path.join(dir, name);
    if (!existsSync(file)) {
      problems.push(`${REFERENCE_DIR}/${name}: missing: ${fix}`);
    } else if (readFileSync(file, 'utf8') !== content) {
      problems.push(`${REFERENCE_DIR}/${name}: differs from what the contract tags give: ${fix}`);
    }
  }
  for (const name of present.filter((candidate) => !reference.has(candidate))) {
    problems.push(`${REFERENCE_DIR}/${name}: is not generated from any package: ${fix}`);
  }
  return problems;
}

function writeReference(root: string, reference: ReadonlyMap<string, string>): void {
  const dir = path.join(root, REFERENCE_DIR);
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (!reference.has(name)) {
      rmSync(path.join(dir, name), { recursive: true, force: true });
    }
  }
  for (const [name, content] of reference) {
    writeFileSync(path.join(dir, name), content);
  }
}

if (import.meta.main) {
  const update = process.argv.includes('--update');
  const verdict = await checkContractTags(repositoryRoot, { update });
  const counts = `${verdict.exports} export(s) of ${verdict.subpaths} subpath(s) in ${verdict.packages} package(s)`;
  report(
    verdict.problems,
    verdict.written
      ? `${counts} carry their contract tags; ${REFERENCE_DIR}/ written.`
      : `${counts} carry their contract tags; ${REFERENCE_DIR}/ is up to date.`,
  );
}
