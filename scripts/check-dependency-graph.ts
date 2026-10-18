// Checks the dependency graph between the workspace packages, from three readings that must agree:
//
// - the manifests, the only source of edges: the `@yaltaan/*` names in "dependencies" and "peerDependencies", each
//   allowed by the graph that ARCHITECTURE.md §6 draws; an internal package listed there beside the graph declares
//   none and no package declares it, so test support code never reaches what is published;
// - the built JavaScript under each package's dist/, which bundlers and runtimes load: every import names a declared
//   package through a subpath it exports, or a file of the same package; no barrel re-exports another package; the
//   body of a module only declares;
// - the files the compiler reads to build each package, which include the type-only imports that the JavaScript no
//   longer shows: each belongs to the package or to a declared dependency.
//
// Runs after the build: a package with sources but no dist/ fails, since nothing of it would have been read.
//
// Usage: node scripts/check-dependency-graph.ts
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { NPM_SCOPE } from './check-manifests.ts';
import { readInternalPackages, textBlockAfter } from './lib/internal-packages.ts';
import { readModule } from './lib/module-rules.ts';
import { PackageIndex, relativePosix, splitBareSpecifier } from './lib/packages.ts';
import {
  describeError,
  isJsonObject,
  listWorkspacePackages,
  readJson,
  readRootManifest,
  repositoryRoot,
  report,
  type WorkspacePackage,
} from './lib/workspace.ts';

/** The document that draws the graph, and the line that introduces its `text` block. */
export const GRAPH_DOCUMENT = 'ARCHITECTURE.md';
export const GRAPH_HEADING = 'Allowed dependency graph';

/** The build configuration of a package, from its folder; the compiler lists the files it reads. */
export const BUILD_CONFIG = 'tsconfig.build.json';

const PACKAGE_NAME = /^[a-z][a-z0-9-]*$/;

/** Each package of the graph, with every package it may depend on (the graph's arrows, followed transitively). */
export type AllowedGraph = ReadonlyMap<string, ReadonlySet<string>>;

export type GraphRead =
  { readonly ok: true; readonly graph: AllowedGraph } | { readonly ok: false; readonly problem: string };

export interface GraphVerdict {
  readonly problems: readonly string[];
  readonly packages: number;
  /** Built JavaScript files read. */
  readonly modules: number;
  /** Packages whose build was listed by the compiler. */
  readonly builds: number;
}

/**
 * Reads the graph from the `text` block that follows `GRAPH_HEADING` in `markdown`. Each line is a chain
 * `a ← b ← c | d`: every package of a link may depend on every package of the link before it.
 */
export function parseAllowedGraph(markdown: string): GraphRead {
  const block = textBlockAfter(markdown, GRAPH_HEADING);
  if (!block.ok) {
    return { ok: false, problem: `${GRAPH_DOCUMENT}: no \`text\` block after the line "${GRAPH_HEADING}…"` };
  }
  const direct = new Map<string, Set<string>>();
  for (const line of block.lines) {
    if (line.trim() === '') {
      continue;
    }
    const links = line.split('←').map((link) => link.split('|').map((name) => name.trim()));
    const bad = links.flat().find((name) => !PACKAGE_NAME.test(name));
    if (bad !== undefined) {
      return { ok: false, problem: `${GRAPH_DOCUMENT}: "${line}" names ${JSON.stringify(bad)}, not a package folder` };
    }
    links.forEach((link, index) => {
      for (const name of link) {
        const below = direct.get(name) ?? new Set<string>();
        for (const lower of links[index - 1] ?? []) {
          below.add(lower);
        }
        direct.set(name, below);
      }
    });
  }
  const graph = new Map<string, ReadonlySet<string>>();
  for (const name of direct.keys()) {
    const reachable = new Set<string>();
    const pending = [...(direct.get(name) ?? [])];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (!reachable.has(next)) {
        reachable.add(next);
        pending.push(...(direct.get(next) ?? []));
      }
    }
    if (reachable.has(name)) {
      return { ok: false, problem: `${GRAPH_DOCUMENT}: the graph has a cycle through ${name}` };
    }
    graph.set(name, reachable);
  }
  return { ok: true, graph };
}

/** One workspace package as the check reads it. */
interface PackageView {
  readonly folder: string;
  readonly dir: string;
  readonly path: string;
  readonly name: string;
  /** Names in "dependencies" and "peerDependencies". */
  readonly declared: ReadonlySet<string>;
  /** Keys of "exports": the subpaths another package may import. */
  readonly subpaths: ReadonlySet<string>;
}

/** Checks the repository at `root`: its manifests, the built modules of its packages and their builds. */
export function checkDependencyGraph(root: string): GraphVerdict {
  const empty = { packages: 0, modules: 0, builds: 0 };
  const rootRead = readRootManifest(root);
  if (!rootRead.ok) {
    return { problems: [rootRead.problem], ...empty };
  }
  const listing = listWorkspacePackages(root, rootRead.value);
  const problems = [...listing.problems];
  let markdown: string;
  try {
    markdown = readFileSync(path.join(root, GRAPH_DOCUMENT), 'utf8');
  } catch (error) {
    return { problems: [...problems, `${GRAPH_DOCUMENT}: cannot be read (${describeError(error)})`], ...empty };
  }
  const graphRead = parseAllowedGraph(markdown);
  if (!graphRead.ok) {
    return { problems: [...problems, graphRead.problem], ...empty };
  }
  const internalRead = readInternalPackages(root);
  if (!internalRead.ok) {
    return { problems: [...problems, internalRead.problem], ...empty };
  }
  const internal = internalRead.names;
  for (const name of internal) {
    if (graphRead.graph.has(name)) {
      problems.push(`${GRAPH_DOCUMENT}: ${name} is both in the graph and an internal package`);
    }
  }
  const views = new Map<string, PackageView>();
  for (const workspacePackage of listing.packages) {
    const read = readJson(root, `${workspacePackage.dir}/package.json`);
    if (read.ok) {
      views.set(`${NPM_SCOPE}/${workspacePackage.name}`, viewOf(workspacePackage, read.value));
    } else {
      problems.push(read.problem);
    }
  }
  let modules = 0;
  let builds = 0;
  for (const view of views.values()) {
    if (internal.has(view.folder)) {
      problems.push(...checkInternalPackage(view));
      continue;
    }
    problems.push(...checkDeclaredEdges(view, views, graphRead.graph, internal));
    const built = checkBuiltModules(view, views);
    problems.push(...built.problems);
    modules += built.modules;
    if (existsSync(path.join(view.path, BUILD_CONFIG))) {
      problems.push(...checkBuildInputs(root, view));
      builds += 1;
    }
  }
  return { problems, packages: views.size, modules, builds };
}

function viewOf(workspacePackage: WorkspacePackage, manifest: unknown): PackageView {
  const fields = isJsonObject(manifest) ? manifest : {};
  const declared = new Set<string>();
  for (const field of ['dependencies', 'peerDependencies']) {
    const value = fields[field];
    for (const name of isJsonObject(value) ? Object.keys(value) : []) {
      declared.add(name);
    }
  }
  const exportsField = fields['exports'];
  const keys = isJsonObject(exportsField) ? Object.keys(exportsField) : [];
  // An "exports" string, or an object of conditions, exports the package root only.
  const subpaths = keys.some((key) => key.startsWith('.')) ? keys : exportsField === undefined ? [] : ['.'];
  return {
    folder: workspacePackage.name,
    dir: workspacePackage.dir,
    path: workspacePackage.path,
    name: `${NPM_SCOPE}/${workspacePackage.name}`,
    declared,
    subpaths: new Set(subpaths),
  };
}

// Test support code reaches a test file through the workspace link that npm makes for every package, never through
// an edge: an edge would put it in the installed tree of every user.
function checkInternalPackage(view: PackageView): string[] {
  return [...view.declared].map(
    (name) =>
      `${view.dir}/package.json: declares ${name}, but an internal package of ${GRAPH_DOCUMENT} §6 depends on ` +
      'no package',
  );
}

function checkDeclaredEdges(
  view: PackageView,
  views: ReadonlyMap<string, PackageView>,
  graph: AllowedGraph,
  internal: ReadonlySet<string>,
): string[] {
  const allowed = graph.get(view.folder);
  if (allowed === undefined) {
    return [
      `${view.dir}: the package is not in the graph of ${GRAPH_DOCUMENT} §6: a new package takes its place there ` +
        'through a decision record',
    ];
  }
  const problems: string[] = [];
  for (const name of view.declared) {
    if (!name.startsWith(`${NPM_SCOPE}/`)) {
      continue;
    }
    const target = views.get(name);
    if (target === undefined) {
      problems.push(`${view.dir}/package.json: declares ${name}, which is not a package of the workspace`);
    } else if (target === view) {
      problems.push(`${view.dir}/package.json: declares a dependency on itself`);
    } else if (internal.has(target.folder)) {
      problems.push(
        `${view.dir}/package.json: declares ${name}, an internal package of ${GRAPH_DOCUMENT} §6, which test files ` +
          'import through the workspace and nothing published depends on',
      );
    } else if (!allowed.has(target.folder)) {
      problems.push(`${view.dir}/package.json: declares ${name}, but ${describeAllowed(view.folder, allowed)}`);
    }
  }
  return problems;
}

function describeAllowed(folder: string, allowed: ReadonlySet<string>): string {
  const names = [...allowed].sort().join(', ');
  return `the graph of ${GRAPH_DOCUMENT} §6 lets ${folder} depend on ${names === '' ? 'no package' : names} only`;
}

function checkBuiltModules(
  view: PackageView,
  views: ReadonlyMap<string, PackageView>,
): { readonly problems: string[]; readonly modules: number } {
  const dist = path.join(view.path, 'dist');
  if (!existsSync(dist)) {
    const sources = existsSync(path.join(view.path, 'src'));
    return { problems: sources ? [`${view.dir}: has src/ but no dist/: build it before this check`] : [], modules: 0 };
  }
  const problems: string[] = [];
  const files = listJavaScript(dist);
  for (const file of files) {
    const shown = `${view.dir}/${relativePosix(view.path, file)}`;
    const facts = readModule(readFileSync(file, 'utf8'));
    problems.push(...facts.problems.map((problem) => `${shown}: ${problem}`));
    for (const edge of facts.edges) {
      const problem = checkSpecifier(view, views, file, edge.specifier);
      if (problem !== undefined) {
        problems.push(`${shown}: line ${edge.line}: ${edge.kind} of ${edge.specifier}: ${problem}`);
      }
    }
  }
  return { problems, modules: files.length };
}

function checkSpecifier(
  view: PackageView,
  views: ReadonlyMap<string, PackageView>,
  file: string,
  specifier: string,
): string | undefined {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const target = path.resolve(path.dirname(file), specifier);
    return target.startsWith(view.path + path.sep) ? undefined : 'leaves the package: reach another one by its name';
  }
  const bare = splitBareSpecifier(specifier);
  if (bare === undefined) {
    return 'neither a relative path nor a package name (built-in modules and URLs are never dependencies)';
  }
  if (bare.name === view.name) {
    return 'the package imports itself by name: use a relative path';
  }
  if (!view.declared.has(bare.name)) {
    return `${view.dir}/package.json does not declare ${bare.name}`;
  }
  const target = views.get(bare.name);
  if (target !== undefined && !target.subpaths.has(bare.subpath)) {
    return `${bare.name} does not export ${bare.subpath}: import a subpath listed in its "exports"`;
  }
  return undefined;
}

function listJavaScript(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJavaScript(full));
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

// The compiler resolves type-only imports that the built JavaScript no longer shows. Its own library files
// (`lib.*.d.ts`, shipped in the platform package of TypeScript 7) are the only files outside a declared package that
// a build may read.
function checkBuildInputs(root: string, view: PackageView): string[] {
  const config = `${view.dir}/${BUILD_CONFIG}`;
  const result = spawnSync(process.execPath, [compilerPath(), '-p', config, '--listFilesOnly'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error !== undefined || result.status !== 0) {
    const output = `${result.stdout}${result.stderr}`.trim().split('\n').slice(0, 5).join(' / ');
    return [`${config}: the compiler cannot list the files of the build (${result.error?.message ?? output})`];
  }
  const index = new PackageIndex();
  const ownDir = realpathSync(view.path);
  const problems: string[] = [];
  const reported = new Set<string>();
  for (const line of result.stdout.split('\n')) {
    const listed = line.trim();
    if (listed === '') {
      continue;
    }
    const file = existsSync(listed) ? realpathSync(listed) : listed;
    const owner = index.ownerOf(file);
    if (owner === undefined) {
      problems.push(`${config}: the build reads ${listed}, which belongs to no package`);
      continue;
    }
    if (owner.dir === ownDir || view.declared.has(owner.name)) {
      continue;
    }
    const isCompilerLibrary = /^lib\.[^/\\]*\.d\.ts$/.test(path.basename(file));
    if (isCompilerLibrary && (owner.name === 'typescript' || owner.name.startsWith('@typescript/typescript-'))) {
      continue;
    }
    if (!reported.has(owner.name)) {
      reported.add(owner.name);
      problems.push(
        `${config}: the build reads ${relativePosix(root, file)}, from ${owner.name}, which ` +
          `${view.dir}/package.json does not declare (a type-only import is an edge too)`,
      );
    }
  }
  return problems;
}

// The compiler of this repository, wherever the checked root is: test fixtures live in a temporary folder.
function compilerPath(): string {
  const manifest = createRequire(import.meta.url).resolve('typescript/package.json');
  return path.join(path.dirname(manifest), 'bin', 'tsc');
}

if (import.meta.main) {
  const verdict = checkDependencyGraph(repositoryRoot);
  report(
    verdict.problems,
    `${verdict.packages} package(s) follow the graph of ${GRAPH_DOCUMENT} §6; ${verdict.modules} built module(s) ` +
      `and ${verdict.builds} build(s) read.`,
  );
}
