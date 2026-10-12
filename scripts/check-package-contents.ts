// Checks what `npm pack` would put in each workspace package's tarball, as npm itself computes it: only the manifest,
// the README, the licence and the built output under dist/ (JavaScript, declarations and their source maps). Sources,
// tests and fixtures never ship: they weigh on every install and can leak what was never meant to be public.
//
// Usage: node scripts/check-package-contents.ts
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  describeError,
  isJsonObject,
  listWorkspacePackages,
  readRootManifest,
  repositoryRoot,
  report,
} from './lib/workspace.ts';

/** Files allowed at the root of a tarball. */
export const ROOT_FILES: readonly string[] = ['package.json', 'README.md', 'LICENSE'];

const DIST_FILE = /^dist\/(?:[^/]+\/)*[^/]+\.(?:js|js\.map|d\.ts|d\.ts\.map)$/;
const DIST_DESCRIPTION = 'dist/**/*.js, *.js.map, *.d.ts, *.d.ts.map';

// `--ignore-scripts`: listing the files must not run the package's prepack or prepare script.
const PACK_ARGS: readonly string[] = ['pack', '--dry-run', '--json', '--ignore-scripts'];

/** The files of one tarball as `npm pack --dry-run --json` lists them, or why they could not be listed. */
export type PackListing =
  { readonly ok: true; readonly paths: readonly string[] } | { readonly ok: false; readonly problem: string };

/** Problems of the file list of one tarball; `dir` names the package in the messages (`packages/core`). */
export function checkPackedFiles(paths: readonly string[], dir: string): string[] {
  const problems: string[] = [];
  for (const file of paths) {
    const anchored = `/${file}`;
    if (file.includes('.test.') || ['/tests/', '/fixtures/', '/src/'].some((part) => anchored.includes(part))) {
      problems.push(`${dir}: the tarball would contain ${file}: tests, fixtures and sources never ship`);
    } else if (!ROOT_FILES.includes(file) && !DIST_FILE.test(file)) {
      problems.push(
        `${dir}: the tarball would contain ${file}, outside the allowlist (${ROOT_FILES.join(', ')}, ` +
          `${DIST_DESCRIPTION}): narrow "files" in its package.json`,
      );
    }
  }
  for (const required of ['package.json', 'LICENSE']) {
    if (!paths.includes(required)) {
      problems.push(`${dir}: the tarball would contain no ${required}`);
    }
  }
  return problems;
}

/** Runs `npm pack --dry-run --json --ignore-scripts` in `packagePath` and reads the file list it prints. */
export function listPackedFiles(packagePath: string, dir: string): PackListing {
  const result = runNpmPack(packagePath);
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
  const tarballs: unknown[] = Array.isArray(parsed) ? parsed : [];
  const tarball = tarballs.length === 1 ? tarballs[0] : undefined;
  const files = isJsonObject(tarball) ? tarball['files'] : undefined;
  const paths: string[] = [];
  for (const file of Array.isArray(files) ? files : [undefined]) {
    const filePath = isJsonObject(file) ? file['path'] : undefined;
    if (typeof filePath !== 'string') {
      return { ok: false, problem: `${dir}: npm pack printed JSON without the expected list of files` };
    }
    paths.push(filePath);
  }
  return { ok: true, paths };
}

export interface ContentsVerdict {
  readonly problems: readonly string[];
  /** Folder of every workspace package whose tarball was listed: `packages/core`. */
  readonly packages: readonly string[];
}

/** Lists and judges the tarball of every workspace package of the real repository. */
export function checkRepositoryPackageContents(root: string): ContentsVerdict {
  const rootRead = readRootManifest(root);
  if (!rootRead.ok) {
    return { problems: [rootRead.problem], packages: [] };
  }
  const listing = listWorkspacePackages(root, rootRead.value);
  const problems = [...listing.problems];
  for (const workspacePackage of listing.packages) {
    const packed = listPackedFiles(workspacePackage.path, workspacePackage.dir);
    problems.push(...(packed.ok ? checkPackedFiles(packed.paths, workspacePackage.dir) : [packed.problem]));
    // npm does not copy the repository's licence into a workspace package: each keeps its own copy, which must not
    // drift from the one the repository is published under.
    const licence = path.join(workspacePackage.path, 'LICENSE');
    if (fs.existsSync(licence) && !fs.readFileSync(licence).equals(fs.readFileSync(path.join(root, 'LICENSE')))) {
      problems.push(`${workspacePackage.dir}/LICENSE differs from the repository's LICENSE: copy it again`);
    }
  }
  return { problems, packages: listing.packages.map((workspacePackage) => workspacePackage.dir) };
}

function runNpmPack(cwd: string): SpawnSyncReturns<string> {
  const options = { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 } as const;
  // Under an npm script, npm_execpath names the entry point of the npm that runs it: starting it with this very Node
  // binary needs no shell and uses the same npm. Another package manager sets the variable to its own entry point,
  // hence the file name check.
  const npmCli = process.env['npm_execpath'];
  if (npmCli !== undefined && path.basename(npmCli) === 'npm-cli.js') {
    return spawnSync(process.execPath, [npmCli, ...PACK_ARGS], { ...options, shell: false });
  }
  // Run directly, npm is found on the PATH. On Windows it is npm.cmd, a batch file that only a shell can start. The
  // command line is a constant, so the shell interprets nothing that comes from outside; it is one string because an
  // argument array is concatenated unescaped under shell: true, which Node deprecates (DEP0190).
  if (process.platform === 'win32') {
    return spawnSync(['npm', ...PACK_ARGS].join(' '), { ...options, shell: true });
  }
  return spawnSync('npm', PACK_ARGS, { ...options, shell: false });
}

if (import.meta.main) {
  const verdict = checkRepositoryPackageContents(repositoryRoot);
  const names = verdict.packages.join(', ');
  report(verdict.problems, `${verdict.packages.length} tarball(s) (${names}) hold only allowed files.`);
}
