// The rules of a release that read only text (ADR 0029): the tag, the manifests of the published packages, the
// changelog. They are pure, so that the tests can generate their cases; the scripts that read git and the file system
// hand them plain values.
//
// One version for every published package; the tag `v<version>`; a version whose first prerelease identifier is
// `rehearsal` is a test version, never published. The CHANGELOG section of a version sits right below `Unreleased`,
// dated with the release commit's date, as Keep a Changelog 1.1.0 writes it.
import { isJsonObject } from './workspace.ts';
import type { JsonObject } from './workspace.ts';

const CORE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// SemVer 2.0.0 §9: a numeric identifier has no leading zero; an alphanumeric one has at least one non-digit.
const PRERELEASE_IDENTIFIER = /^(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)$/;
const UNRELEASED = '## [Unreleased]';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const REHEARSAL = 'rehearsal';

export interface ReleaseVersion {
  readonly version: string;
  /** The prerelease identifiers, empty for a release version. */
  readonly prerelease: readonly string[];
  /** A test version (`1.2.0-rehearsal.0`): checked like a release, never published. */
  readonly rehearsal: boolean;
}

/** Reads a SemVer version without build metadata (npm drops it), or `undefined`. */
export function parseVersion(version: string): ReleaseVersion | undefined {
  const dash = version.indexOf('-');
  const core = dash === -1 ? version : version.slice(0, dash);
  const prerelease = dash === -1 ? [] : version.slice(dash + 1).split('.');
  if (!CORE.test(core) || !prerelease.every((identifier) => PRERELEASE_IDENTIFIER.test(identifier))) {
    return undefined;
  }
  return { version, prerelease, rehearsal: prerelease[0] === REHEARSAL };
}

/** Reads `v<version>`, or `undefined`. */
export function parseReleaseTag(tag: string): ReleaseVersion | undefined {
  return tag.startsWith('v') ? parseVersion(tag.slice(1)) : undefined;
}

/** The npm dist-tag a version is published under: `next` for a prerelease, so that `latest` stays a release. */
export function distTagOf(version: ReleaseVersion): 'latest' | 'next' {
  return version.prerelease.length === 0 ? 'latest' : 'next';
}

/** `https://github.com/owner/repo` from the forms git and GitHub give it, or `undefined` for another host. */
export function normalizeRepositoryUrl(remote: string): string | undefined {
  const match = /^(?:git\+)?(?:https:\/\/|ssh:\/\/git@|git@)github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
    remote.trim(),
  );
  return match === null ? undefined : `https://github.com/${match[1]}/${match[2]}`;
}

export interface ChangelogSection {
  readonly date: string;
  /** The lines between the heading of the version and the next heading of the same level, trimmed. */
  readonly body: string;
}

export type SectionRead =
  { readonly ok: true; readonly section: ChangelogSection } | { readonly ok: false; readonly problem: string };

/** The section of `version`, which must be the first one below `Unreleased` and hold at least one entry. */
export function readChangelogSection(changelog: string, version: string): SectionRead {
  const lines = changelog.split('\n');
  const headings = lines.flatMap((line, index) => (line.startsWith('## ') ? [index] : []));
  const unreleased = headings.find((index) => lines[index] === UNRELEASED);
  if (unreleased === undefined) {
    return { ok: false, problem: `CHANGELOG.md has no "${UNRELEASED}" heading` };
  }
  const prefix = `## [${version}] - `;
  const own = headings.filter((index) => lines[index]?.startsWith(prefix) === true);
  const next = headings.find((index) => index > unreleased);
  const heading = own[0];
  if (own.length !== 1 || heading === undefined || next !== heading) {
    return {
      ok: false,
      problem:
        `CHANGELOG.md must hold one "${prefix}<date>" heading, right below "${UNRELEASED}" ` +
        `(found ${own.length}${own.length === 1 ? ', not the next heading' : ''})`,
    };
  }
  const date = lines[heading]?.slice(prefix.length) ?? '';
  if (!DATE.test(date)) {
    return { ok: false, problem: `CHANGELOG.md dates ${version} "${date}", not YYYY-MM-DD` };
  }
  const end = headings.find((index) => index > heading) ?? lines.length;
  const body = lines
    .slice(heading + 1, end)
    .join('\n')
    .trim();
  if (!body.split('\n').some((line) => line.startsWith('- '))) {
    return { ok: false, problem: `CHANGELOG.md has no entry under ${version}` };
  }
  return { ok: true, section: { date, body } };
}

export type ChangelogCut =
  | { readonly ok: true; readonly text: string; readonly section: ChangelogSection }
  | { readonly ok: false; readonly problem: string };

/** Moves the entries under `Unreleased` into a section for `version` dated `date`, below a new empty `Unreleased`. */
export function cutChangelog(changelog: string, version: string, date: string): ChangelogCut {
  const lines = changelog.split('\n');
  const unreleased = lines.indexOf(UNRELEASED);
  if (unreleased === -1) {
    return { ok: false, problem: `CHANGELOG.md has no "${UNRELEASED}" heading` };
  }
  const cut = [...lines.slice(0, unreleased + 1), '', `## [${version}] - ${date}`, ...lines.slice(unreleased + 1)];
  const text = cut.join('\n');
  const read = readChangelogSection(text, version);
  return read.ok ? { ok: true, text, section: read.section } : read;
}

/** A published package as the release reads it: its folder (`packages/core`) and its manifest. */
export interface ReleasePackage {
  readonly dir: string;
  readonly manifest: JsonObject;
}

export interface ReleaseInput {
  readonly tag: string;
  readonly packages: readonly ReleasePackage[];
  readonly changelog: string;
  /**
   * Dates of the release commit, YYYY-MM-DD, as git records them: its author date and its committer date (`%as`,
   * `%cs`). An amend or a rebase on a later day keeps the first and moves the second.
   */
  readonly commitDates: readonly string[];
  /** The repository the release runs from, `https://github.com/owner/repo`. */
  readonly repositoryUrl: string;
  /** A rehearsal publishes nothing: private packages and rehearsal versions are allowed. */
  readonly rehearsal: boolean;
}

/** Every problem that makes the tag, the manifests and the changelog disagree about a release. */
export function checkReleaseConsistency(input: ReleaseInput): string[] {
  const tag = parseReleaseTag(input.tag);
  if (tag === undefined) {
    return [`the tag "${input.tag}" is not "v" followed by a SemVer version without build metadata`];
  }
  const problems: string[] = [];
  if (tag.rehearsal && !input.rehearsal) {
    problems.push(`the tag ${input.tag} names a ${REHEARSAL} version, which is never published`);
  }
  if (input.packages.length === 0) {
    problems.push('no published package: there is nothing to release');
  }
  const repository = `git+${input.repositoryUrl}.git`;
  for (const { dir, manifest } of input.packages) {
    const file = `${dir}/package.json`;
    if (manifest['version'] !== tag.version) {
      problems.push(`${file}: "version" is ${JSON.stringify(manifest['version'])}, not ${tag.version} of the tag`);
    }
    if (manifest['private'] === true && !input.rehearsal) {
      problems.push(`${file}: "private" is true: npm would refuse to publish it`);
    }
    const declared = manifest['repository'];
    if (
      !isJsonObject(declared) ||
      declared['type'] !== 'git' ||
      declared['url'] !== repository ||
      declared['directory'] !== dir
    ) {
      problems.push(
        `${file}: "repository" must be { "type": "git", "url": "${repository}", "directory": "${dir}" }: npm ` +
          'compares it with the repository named by the provenance',
      );
    }
    const publishConfig = manifest['publishConfig'];
    if (!isJsonObject(publishConfig) || publishConfig['access'] !== 'public' || publishConfig['provenance'] !== true) {
      problems.push(
        `${file}: "publishConfig" must be { "access": "public", "provenance": true }: a scoped package is private ` +
          'by default, and a publication without provenance fails instead of going out unsigned',
      );
    }
  }
  const section = readChangelogSection(input.changelog, tag.version);
  if (!section.ok) {
    problems.push(section.problem);
  } else if (!input.commitDates.includes(section.section.date)) {
    problems.push(
      `CHANGELOG.md dates ${tag.version} ${section.section.date}, but the release commit is of ` +
        `${[...new Set(input.commitDates)].join(' and ') || 'no known date'}`,
    );
  }
  return problems;
}
