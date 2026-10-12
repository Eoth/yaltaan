// Helpers shared by the checks that read the npm workspace: the root manifest, the workspace packages it declares,
// and the way a check reports its verdict. JSON is read as `unknown` and narrowed field by field: a manifest is input
// that a careless edit can break, and a check must report that breakage, never crash on it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the repository root (this file lives in `scripts/lib/`). */
export const repositoryRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

export type JsonObject = Record<string, unknown>;

/** A parsed JSON file, or the problem that prevented reading it. */
export type JsonRead =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly problem: string };

/** A workspace package: one folder matched by a `"<dir>/*"` glob of the root manifest. */
export interface WorkspacePackage {
  /** The folder name, which is also the package name under the npm scope: `core`. */
  readonly name: string;
  /** Path from the repository root, with forward slashes on every platform: `packages/core`. */
  readonly dir: string;
  /** Absolute path of the folder. */
  readonly path: string;
}

export interface WorkspaceGlobs {
  /** Parent folder of each `"<dir>/*"` glob: `packages`. */
  readonly parents: readonly string[];
  readonly problems: readonly string[];
}

export interface WorkspaceListing {
  readonly packages: readonly WorkspacePackage[];
  readonly problems: readonly string[];
}

// npm accepts any glob in "workspaces"; only "<dir>/*" is understood here. Another form is refused rather than
// approximated, since a glob read wrongly would silently leave packages out of every check. Segments never start with
// a dot, which keeps ".", ".." and hidden folders out.
const WORKSPACE_GLOB = /^((?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*)\/\*$/;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads `relative` (forward slashes, from `root`) as JSON. */
export function readJson(root: string, relative: string): JsonRead {
  try {
    const value: unknown = JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
    return { ok: true, value };
  } catch (error) {
    return { ok: false, problem: `${relative}: cannot be read as JSON (${describeError(error)})` };
  }
}

export function readRootManifest(root: string): JsonRead {
  return readJson(root, 'package.json');
}

/** Reads the `"workspaces"` field of a root manifest; every glob that is not `"<dir>/*"` is a problem. */
export function parseWorkspaceGlobs(manifest: unknown): WorkspaceGlobs {
  const parents: string[] = [];
  const problems: string[] = [];
  const workspaces = isJsonObject(manifest) ? manifest['workspaces'] : undefined;
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    problems.push('package.json: "workspaces" must be a non-empty array of "<dir>/*" globs');
    return { parents, problems };
  }
  for (const glob of workspaces) {
    const parent = typeof glob === 'string' ? WORKSPACE_GLOB.exec(glob)?.[1] : undefined;
    if (parent === undefined) {
      problems.push(
        `package.json: workspace glob ${JSON.stringify(glob)} is not of the form "<dir>/*", the only form the ` +
          'checks know how to list: write the packages as "<dir>/*" or teach scripts/lib/workspace.ts the new form',
      );
    } else {
      parents.push(parent);
    }
  }
  return { parents, problems };
}

/**
 * Lists the workspace packages, sorted by path. Like npm, a folder counts only if it holds a package.json and hidden
 * folders are skipped; a visible folder without a manifest is reported, since npm would ignore it without a word.
 */
export function listWorkspacePackages(root: string, manifest: unknown): WorkspaceListing {
  const globs = parseWorkspaceGlobs(manifest);
  const problems = [...globs.problems];
  const packages: WorkspacePackage[] = [];
  for (const parent of globs.parents) {
    let names: string[];
    try {
      names = readdirSync(path.join(root, parent), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      problems.push(`package.json: workspace folder ${parent}/ cannot be listed (${describeError(error)})`);
      continue;
    }
    for (const name of names) {
      const dir = `${parent}/${name}`;
      const packagePath = path.join(root, parent, name);
      if (existsSync(path.join(packagePath, 'package.json'))) {
        packages.push({ name, dir, path: packagePath });
      } else {
        problems.push(`${dir}: no package.json, so npm ignores this folder and no packaging check reads it`);
      }
    }
  }
  return { packages, problems };
}

/** Prints the verdict of a check: `ok: <message>`, or every problem on stderr with a failing exit code. */
export function report(problems: readonly string[], okMessage: string): void {
  if (problems.length === 0) {
    console.log(`ok: ${okMessage}`);
    return;
  }
  for (const problem of problems) {
    console.error(`error: ${problem}`);
  }
  console.error(`${problems.length} problem(s) found.`);
  process.exitCode = 1;
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
