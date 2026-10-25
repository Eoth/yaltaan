// Holds the issue codes of each published package to its registry, docs/issue-codes/<package>.md (ADR 0019). A code
// is a public contract: an application matches on it to pick a message, so a code that disappears or is renamed
// breaks it without a type error. Refused:
// - a code of the published declarations (`code: 'x.y'` in dist/**/*.d.ts) without a live row of the registry;
// - a live row whose code the declarations no longer hold: the code was removed without its `Removed` version;
// - a code of any committed version of a registry that the registry no longer lists, or whose `Since` changed: rows
//   are never deleted, so a removal stays on record and a renaming shows as one;
// - a `Removed` version that breaks SemVer: not after `Since`, or from 1.0 on, anything but a major version;
// - a code that is not `<namespace>.<name>` in lowercase, or listed twice, in one registry or in two.
// The committed history is read in full (CI checks out every commit); a shallow clone reads less, and says so.
//
// Usage: node scripts/check-issue-codes.ts
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { readInternalPackages } from './lib/internal-packages.ts';
import { listWorkspacePackages, readRootManifest, repositoryRoot, report } from './lib/workspace.ts';

export const REGISTRY_DIR = 'docs/issue-codes';
export const REGISTRY_HEADER = '| Code | Parameters | Meaning | Since | Removed |';

const CODE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
// Comments first, so that an example in a JSDoc block (`{ code: 'x.y', … }`) is never read as a declaration.
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const LITERAL = String.raw`(?:'[^'\n]*'|"[^"\n]*")`;
const CODE_PROPERTY = new RegExp(String.raw`\bcode\??\s*:\s*(?:\|\s*)?(${LITERAL}(?:\s*\|\s*${LITERAL})*)`, 'g');

export interface RegistryRow {
  readonly code: string;
  readonly since: string;
  /** The version that removed the code; `undefined` while it is live. */
  readonly removed: string | undefined;
}

export type RegistryRead =
  { readonly ok: true; readonly rows: readonly RegistryRow[] } | { readonly ok: false; readonly problems: string[] };

/** One committed version of a registry. */
export interface RegistryVersion {
  /** Short hash of the commit, for the messages. */
  readonly revision: string;
  readonly rows: readonly RegistryRow[];
}

/** Reads the table of a registry; `file` names it in the messages. */
export function parseRegistry(markdown: string, file: string): RegistryRead {
  const lines = markdown.split('\n');
  const header = lines.indexOf(REGISTRY_HEADER);
  if (header === -1 || !/^\|(?:---\|){5}$/.test(lines[header + 1] ?? '')) {
    return { ok: false, problems: [`${file}: no table under the header ${REGISTRY_HEADER}`] };
  }
  const rows: RegistryRow[] = [];
  const problems: string[] = [];
  for (let index = header + 2; index < lines.length && (lines[index] ?? '').startsWith('|'); index += 1) {
    const where = `${file}:${index + 1}`;
    const cells = (lines[index] ?? '').split('|').map((cell) => cell.trim());
    // A row `| a | b | c | d | e |` splits into seven cells, the first and the last empty.
    const [quoted = '', , , since = '', removed = ''] = cells.slice(1, -1);
    const code = /^`([^`]*)`$/.exec(quoted)?.[1];
    if (cells.length !== 7) {
      problems.push(`${where}: a row has five cells`);
    } else if (code === undefined || !CODE.test(code)) {
      problems.push(`${where}: ${quoted} is not a code: <namespace>.<name>, lowercase, in backticks`);
    } else if (!VERSION.test(since) || (removed !== '' && !VERSION.test(removed))) {
      problems.push(`${where}: Since and Removed are versions MAJOR.MINOR, Removed empty while the code is live`);
    } else {
      rows.push({ code, since, removed: removed === '' ? undefined : removed });
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, rows };
}

/**
 * The live codes of the registry of package `name` (`core`), for the tests that compare the codes a module produces
 * at run time with the registry; throws when the registry cannot be read, which fails the test that asked.
 */
export function liveCodes(name: string, root: string = repositoryRoot): ReadonlySet<string> {
  const file = `${REGISTRY_DIR}/${name}.md`;
  const read = parseRegistry(fs.readFileSync(path.join(root, file), 'utf8'), file);
  if (!read.ok) {
    throw new Error(read.problems.join('\n'));
  }
  return new Set(read.rows.filter((row) => row.removed === undefined).map((row) => row.code));
}

/** The codes that declaration text gives to a `code` property as string literal types, in order of appearance. */
export function declaredCodes(declarations: string): string[] {
  const codes: string[] = [];
  for (const match of declarations.replace(COMMENT, '').matchAll(CODE_PROPERTY)) {
    for (const literal of (match[1] ?? '').matchAll(/'([^']*)'|"([^"]*)"/g)) {
      codes.push(literal[1] ?? literal[2] ?? '');
    }
  }
  return codes;
}

function parseVersion(version: string): readonly [number, number] {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return [major, minor];
}

function removalProblem(row: RegistryRow): string | undefined {
  if (row.removed === undefined) {
    return undefined;
  }
  const [sinceMajor, sinceMinor] = parseVersion(row.since);
  const [major, minor] = parseVersion(row.removed);
  if (major < sinceMajor || (major === sinceMajor && minor <= sinceMinor)) {
    return `\`${row.code}\` is removed in ${row.removed}, not after it was added in ${row.since}`;
  }
  if (major >= 1 && (minor !== 0 || major === sinceMajor)) {
    return `\`${row.code}\` is removed in ${row.removed}: from 1.0 on, a code is removed only in a major version`;
  }
  return undefined;
}

/** Problems of one registry against the codes its package declares and against its committed versions. */
export function checkRegistry(
  file: string,
  rows: readonly RegistryRow[],
  declared: ReadonlySet<string>,
  history: readonly RegistryVersion[],
): string[] {
  const problems: string[] = [];
  const byCode = new Map<string, RegistryRow>();
  for (const row of rows) {
    if (byCode.has(row.code)) {
      problems.push(`${file}: \`${row.code}\` is listed twice`);
    }
    byCode.set(row.code, row);
    const removal = removalProblem(row);
    if (removal !== undefined) {
      problems.push(`${file}: ${removal}`);
    }
    if (row.removed === undefined && !declared.has(row.code)) {
      problems.push(
        `${file}: \`${row.code}\` is live but no published declaration holds it any more: a code is removed only ` +
          'with the version that removes it in Removed',
      );
    }
    if (row.removed !== undefined && declared.has(row.code)) {
      problems.push(`${file}: \`${row.code}\` is marked removed in ${row.removed} but is still declared`);
    }
  }
  for (const code of declared) {
    if (!byCode.has(code)) {
      problems.push(`${file}: \`${code}\` is declared but has no row: add it, with the version that adds it`);
    }
  }
  const reported = new Set<string>();
  for (const version of history) {
    for (const past of version.rows) {
      const row = byCode.get(past.code);
      if (reported.has(past.code)) {
        continue;
      }
      if (row === undefined) {
        reported.add(past.code);
        problems.push(
          `${file}: \`${past.code}\` was registered at ${version.revision} and its row is gone: a row is never ` +
            'deleted; keep it and write the version that removes the code in Removed',
        );
      } else if (row.since !== past.since) {
        reported.add(past.code);
        problems.push(
          `${file}: \`${past.code}\` was added in ${past.since} (at ${version.revision}), not ${row.since}`,
        );
      }
    }
  }
  return problems;
}

function git(root: string, args: readonly string[]): { readonly ok: boolean; readonly stdout: string } {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { ok: result.status === 0, stdout: result.stdout };
}

export interface HistoryRead {
  /** Committed versions of each registry, by its path from the root. */
  readonly versions: ReadonlyMap<string, readonly RegistryVersion[]>;
  readonly commits: number;
  readonly shallow: boolean;
  readonly problems: readonly string[];
}

/** Every committed version of every registry, deleted registries included. */
export function readRegistryHistory(root: string): HistoryRead {
  const versions = new Map<string, RegistryVersion[]>();
  const problems: string[] = [];
  const log = git(root, ['log', '--format=%h', '--', REGISTRY_DIR]);
  if (!log.ok) {
    return { versions, commits: 0, shallow: false, problems: [`git log -- ${REGISTRY_DIR} failed: no history read`] };
  }
  const commits = log.stdout.split('\n').filter((line) => line !== '');
  for (const revision of commits) {
    const files = git(root, ['ls-tree', '-r', '--name-only', revision, '--', `${REGISTRY_DIR}/`]);
    for (const file of files.stdout.split('\n').filter((line) => line.endsWith('.md'))) {
      const shown = git(root, ['show', `${revision}:${file}`]);
      const read = parseRegistry(shown.stdout, `${file} at ${revision}`);
      if (!shown.ok || !read.ok) {
        // A committed version that cannot be read is the one that would hide a deletion: refused, never skipped.
        problems.push(...(read.ok ? [`${file} at ${revision}: cannot be read`] : read.problems));
        continue;
      }
      versions.set(file, [...(versions.get(file) ?? []), { revision, rows: read.rows }]);
    }
  }
  const shallow = git(root, ['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true';
  return { versions, commits: commits.length, shallow, problems };
}

function declarationFiles(folder: string): string[] {
  if (!fs.existsSync(folder)) {
    return [];
  }
  return fs
    .readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.d.ts'))
    .sort()
    .map((file) => path.join(folder, file));
}

export interface IssueCodesVerdict {
  readonly problems: readonly string[];
  readonly codes: number;
  readonly registries: number;
  readonly commits: number;
  readonly shallow: boolean;
}

/** Checks every registry of the repository at `root` against the built declarations of its published packages. */
export function checkRepositoryIssueCodes(root: string): IssueCodesVerdict {
  const problems: string[] = [];
  const manifest = readRootManifest(root);
  const internal = readInternalPackages(root);
  if (!manifest.ok || !internal.ok) {
    return {
      problems: [manifest.ok ? '' : manifest.problem, internal.ok ? '' : internal.problem].filter(Boolean),
      codes: 0,
      registries: 0,
      commits: 0,
      shallow: false,
    };
  }
  const listing = listWorkspacePackages(root, manifest.value);
  problems.push(...listing.problems);
  const history = readRegistryHistory(root);
  problems.push(...history.problems);
  const owners = new Map<string, string>();
  const registries = new Set([...history.versions.keys()]);
  let codes = 0;
  for (const workspacePackage of listing.packages.filter((candidate) => !internal.names.has(candidate.name))) {
    const declared = new Set<string>();
    for (const file of declarationFiles(path.join(workspacePackage.path, 'dist'))) {
      for (const code of declaredCodes(fs.readFileSync(file, 'utf8'))) {
        declared.add(code);
      }
    }
    const file = `${REGISTRY_DIR}/${workspacePackage.name}.md`;
    registries.delete(file);
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) {
      if (declared.size > 0 || history.versions.has(file)) {
        problems.push(`${file} is missing: ${workspacePackage.dir} declares codes, or did`);
      }
      continue;
    }
    const read = parseRegistry(fs.readFileSync(absolute, 'utf8'), file);
    if (!read.ok) {
      problems.push(...read.problems);
      continue;
    }
    problems.push(...checkRegistry(file, read.rows, declared, history.versions.get(file) ?? []));
    for (const row of read.rows) {
      const owner = owners.get(row.code);
      if (owner !== undefined && owner !== file) {
        problems.push(`\`${row.code}\` is listed in ${owner} and in ${file}: a code belongs to one package`);
      }
      owners.set(row.code, file);
    }
    codes += read.rows.filter((row) => row.removed === undefined).length;
  }
  for (const file of registries) {
    problems.push(`${file} was committed but no published package of that name exists any more`);
  }
  for (const file of fs.existsSync(path.join(root, REGISTRY_DIR))
    ? fs.readdirSync(path.join(root, REGISTRY_DIR))
    : []) {
    const name = `${REGISTRY_DIR}/${file}`;
    if (!listing.packages.some((candidate) => `${REGISTRY_DIR}/${candidate.name}.md` === name)) {
      problems.push(`${name} names no workspace package`);
    }
  }
  return {
    problems: [...new Set(problems)],
    codes,
    registries: owners.size === 0 ? 0 : new Set(owners.values()).size,
    commits: history.commits,
    shallow: history.shallow,
  };
}

if (import.meta.main) {
  const verdict = checkRepositoryIssueCodes(repositoryRoot);
  const shallow = verdict.shallow ? ' (shallow clone: not all)' : '';
  const codes = `${verdict.codes} live issue code(s) in ${verdict.registries} registry(ies)`;
  report(
    verdict.problems,
    `${codes} match the published declarations; ${verdict.commits} commit(s) of the registries read${shallow}.`,
  );
}
