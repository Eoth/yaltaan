import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import fc from 'fast-check';

import { listPublishedPackages, packPackage, unpackFiles } from '../check-package-contents.ts';
import {
  checkReleaseConsistency,
  cutChangelog,
  distTagOf,
  normalizeRepositoryUrl,
  parseReleaseTag,
  parseVersion,
  readChangelogSection,
} from '../lib/release.ts';
import type { ReleaseInput } from '../lib/release.ts';
import { repositoryRoot } from '../lib/workspace.ts';
import type { JsonObject } from '../lib/workspace.ts';
import { nextRehearsalVersion, prepareManifest, prepareRelease, withRehearsalEntry } from '../release-prepare.ts';
import {
  checkConsumer,
  checkSbom,
  compareTarballs,
  describeRelease,
  listSubpathSpecifiers,
  parseReleaseArguments,
  purlOf,
  readGitFacts,
} from '../release.ts';
import { withRepo } from './run-script.ts';
import { writeTarball } from './tarball-fixtures.ts';

const folders: string[] = [];
after(() => {
  for (const folder of folders) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

const numeric = fc.nat({ max: 999 }).map(String);
const alphanumeric = fc.stringMatching(/^[0-9A-Za-z-]{0,6}[A-Za-z-][0-9A-Za-z-]{0,6}$/);
const prerelease = fc.array(fc.oneof(numeric, alphanumeric), { maxLength: 3 });
const dates = fc
  .date({ min: new Date('2000-01-01'), max: new Date('2099-12-31'), noInvalidDate: true })
  .map((date) => date.toISOString().slice(0, 10));
const entries = fc.array(fc.stringMatching(/^[a-z](?:[a-z ]{0,18}[a-z])?$/), { minLength: 1, maxLength: 4 });

/** A version written with its prerelease identifiers joined by dots, as SemVer writes them. */
function semver(core: [string, string, string], identifiers: readonly string[]): string {
  return `${core.join('.')}${identifiers.length === 0 ? '' : `-${identifiers.join('.')}`}`;
}

test('a SemVer version reads back as written, and a rehearsal is a version whose first identifier says so', () => {
  fc.assert(
    fc.property(fc.tuple(numeric, numeric, numeric), prerelease, (core, identifiers) => {
      const version = semver(core, identifiers);
      const read = parseVersion(version);
      assert.deepEqual(read, { version, prerelease: identifiers, rehearsal: identifiers[0] === 'rehearsal' });
      assert.deepEqual(parseReleaseTag(`v${version}`), read);
      assert.equal(parseReleaseTag(version), undefined);
      assert.equal(distTagOf(read), identifiers.length === 0 ? 'latest' : 'next');
    }),
  );
  assert.equal(parseVersion('1.2.0-rehearsal.0')?.rehearsal, true);
  for (const wrong of ['1.2', '01.2.3', '1.02.3', '1.2.3-', '1.2.3-01', '1.2.3-a..b', '1.2.3+build', 'v1.2.3', '']) {
    assert.equal(parseVersion(wrong), undefined, wrong);
  }
});

test('the repository URL is read from the forms git and GitHub give it', () => {
  const expected = 'https://github.com/owner/repo';
  for (const remote of [
    'https://github.com/owner/repo',
    'https://github.com/owner/repo.git',
    'git+https://github.com/owner/repo.git',
    'git@github.com:owner/repo.git',
    'ssh://git@github.com/owner/repo.git\n',
  ]) {
    assert.equal(normalizeRepositoryUrl(remote), expected, remote);
  }
  for (const remote of ['https://gitlab.com/owner/repo', '/home/me/repo', 'https://github.com/owner']) {
    assert.equal(normalizeRepositoryUrl(remote), undefined, remote);
  }
});

/** A release that follows every rule, for `version`, of `count` packages, committed on `date`. */
function validRelease(version: string, date: string, count: number, notes: readonly string[]): ReleaseInput {
  const repositoryUrl = 'https://github.com/owner/repo';
  const packages = Array.from({ length: count }, (_, index) => {
    const dir = `packages/p${index}`;
    const manifest: JsonObject = {
      name: `@yaltaan/p${index}`,
      version,
      repository: { type: 'git', url: `git+${repositoryUrl}.git`, directory: dir },
      publishConfig: { access: 'public', provenance: true },
    };
    return { dir, manifest };
  });
  const changelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    `## [${version}] - ${date}`,
    '',
    '### Added',
    '',
    ...notes.map((note) => `- ${note}`),
    '',
    '## [0.0.1] - 1999-01-01',
    '',
    '- older',
    '',
  ].join('\n');
  return { tag: `v${version}`, packages, changelog, commitDates: [date, date], repositoryUrl, rehearsal: false };
}

/** Each way a release can break one rule, and a fragment of the one problem it must cause. */
const BREAKS: readonly [string, (input: ReleaseInput) => ReleaseInput][] = [
  ['of the tag', (input) => withManifest(input, { version: '9.9.9-other' })],
  ['npm would refuse', (input) => withManifest(input, { private: true })],
  ['"repository" must be', (input) => withManifest(input, { repository: undefined })],
  [
    '"repository" must be',
    (input) => {
      const dir = input.packages.at(-1)?.dir;
      return withManifest(input, {
        repository: { type: 'git', url: 'git+https://github.com/someone/else.git', directory: dir },
      });
    },
  ],
  ['"publishConfig" must be', (input) => withManifest(input, { publishConfig: { access: 'public' } })],
  ['but the release commit is of', (input) => ({ ...input, commitDates: ['1999-12-31', '1999-12-31'] })],
  [
    'found 2',
    (input) => ({
      ...input,
      changelog: input.changelog.replace(
        '## [0.0.1]',
        `## [${input.tag.slice(1)}] - 1999-01-01\n\n- again\n\n## [0.0.1]`,
      ),
    }),
  ],
  ['no "## [Unreleased]"', (input) => ({ ...input, changelog: input.changelog.replace('## [Unreleased]', '## Next') })],
  [
    'right below',
    (input) => ({
      ...input,
      changelog: input.changelog.replace('## [Unreleased]', '## [Unreleased]\n\n## [0.0.2] - 2000-01-01'),
    }),
  ],
  ['no entry under', (input) => ({ ...input, changelog: input.changelog.replace(/^- (?!older).*$/gm, '') })],
  [
    'not YYYY-MM-DD',
    (input) => ({ ...input, changelog: input.changelog.replace(/\] - \d{4}-\d{2}-\d{2}\n\n### /, '] - soon\n\n### ') }),
  ],
  ['is not "v" followed by', (input) => ({ ...input, tag: input.tag.slice(1) })],
  ['no published package', (input) => ({ ...input, packages: [] })],
];

/** The input with `changes` made to the manifest of its last package (`undefined` removes a field). */
function withManifest(input: ReleaseInput, changes: Record<string, unknown>): ReleaseInput {
  const packages = input.packages.map((releasePackage, index) => {
    if (index !== input.packages.length - 1) {
      return releasePackage;
    }
    const manifest: JsonObject = { ...releasePackage.manifest, ...changes };
    for (const [field, value] of Object.entries(changes)) {
      if (value === undefined) {
        delete manifest[field];
      }
    }
    return { ...releasePackage, manifest };
  });
  return { ...input, packages };
}

test('a release whose tag, manifests and changelog agree passes, and each broken rule gives its one problem', () => {
  const releases = fc
    .tuple(
      fc.tuple(numeric, numeric, numeric),
      fc.array(numeric, { maxLength: 2 }),
      dates,
      fc.integer({ min: 1, max: 3 }),
    )
    .chain(([core, identifiers, date, count]) =>
      entries.map((notes) => validRelease(semver(core, identifiers), date, count, notes)),
    );
  fc.assert(
    fc.property(releases, fc.constantFrom(...BREAKS), (input, [fragment, breakRule]) => {
      assert.deepEqual(checkReleaseConsistency(input), []);
      const problems = checkReleaseConsistency(breakRule(input));
      assert.equal(problems.length, 1, `${fragment}: ${problems.join('\n')}`);
      assert.ok(problems[0]?.includes(fragment), `${fragment}: ${problems[0]}`);
    }),
  );
});

test('the changelog may carry the author date of the release commit, which an amend on a later day keeps', () => {
  const input = validRelease('1.0.0', '2026-11-01', 1, ['a change']);
  assert.deepEqual(checkReleaseConsistency({ ...input, commitDates: ['2026-11-01', '2026-11-02'] }), []);
  const problems = checkReleaseConsistency({ ...input, commitDates: ['2026-10-31', '2026-11-02'] });
  assert.deepEqual(problems, [
    'CHANGELOG.md dates 1.0.0 2026-11-01, but the release commit is of 2026-10-31 and 2026-11-02',
  ]);
});

test('release.json marks a rehearsal run and a rehearsal version as rehearsals, and names each tarball', () => {
  fc.assert(
    fc.property(fc.tuple(numeric, numeric, numeric), prerelease, fc.boolean(), (core, identifiers, run) => {
      const tag = parseReleaseTag(`v${semver(core, identifiers)}`);
      assert.ok(tag !== undefined);
      const tarball = { dir: 'packages/core', name: '@yaltaan/core', file: '/out/a.tgz', manifest: {}, integrity: 'x' };
      const description = describeRelease(tag, run, [tarball]);
      // The one value the workflow publishes on: false only for a run that is no rehearsal, of a version that is none.
      assert.equal(description.rehearsal, run || identifiers[0] === 'rehearsal');
      assert.equal(description.distTag, identifiers.length === 0 ? 'latest' : 'next');
      assert.deepEqual(description.tarballs, [{ name: '@yaltaan/core', file: 'a.tgz', integrity: 'x' }]);
    }),
  );
});

test('a rehearsal version is checked like a release, published only by a rehearsal, which allows private', () => {
  const input = validRelease('1.2.0-rehearsal.0', '2026-11-01', 1, ['a change']);
  assert.deepEqual(checkReleaseConsistency({ ...input, rehearsal: true }), []);
  const problems = checkReleaseConsistency(input);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.ok(problems[0]?.includes('which is never published'));
  assert.deepEqual(checkReleaseConsistency({ ...withManifest(input, { private: true }), rehearsal: true }), []);
});

test('cutting the changelog moves every entry of Unreleased under the version, and the next cut follows it', () => {
  fc.assert(
    fc.property(entries, entries, dates, (first, second, date) => {
      const notes = first.map((note) => `- ${note}`).join('\n');
      const changelog = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n${notes}\n`;
      const cut = cutChangelog(changelog, '1.0.0', date);
      assert.ok(cut.ok, cut.ok ? '' : cut.problem);
      assert.equal(cut.section.date, date);
      assert.ok(first.every((note) => cut.section.body.includes(`- ${note}`)));
      // Unreleased is empty again: a second cut has nothing to release until new entries arrive.
      assert.ok(!cutChangelog(cut.text, '1.1.0', date).ok);
      const added = cut.text.replace(
        '## [Unreleased]\n',
        `## [Unreleased]\n\n${second.map((note) => `- ${note}`).join('\n')}\n`,
      );
      const next = cutChangelog(added, '1.1.0', date);
      assert.ok(next.ok, next.ok ? '' : next.problem);
      // The older section is no longer the first one below Unreleased.
      assert.ok(!readChangelogSection(next.text, '1.0.0').ok);
      assert.ok(readChangelogSection(next.text, '1.1.0').ok);
    }),
  );
});

test('preparing a release sets the version, frees the published packages and follows their workspace specs', () => {
  assert.equal(nextRehearsalVersion(['0.0.0']), '0.1.0-rehearsal.0');
  assert.equal(nextRehearsalVersion(['0.3.2', '1.4.0-beta.1', '1.2.9']), '1.5.0-rehearsal.0');
  assert.equal(nextRehearsalVersion([]), '0.1.0-rehearsal.0');
  const names = new Set(['@yaltaan/core']);
  const core = { name: '@yaltaan/core', version: '0.0.0', private: true, license: 'MIT' };
  assert.deepEqual(prepareManifest(core, '0.1.0', names, true), {
    name: '@yaltaan/core',
    version: '0.1.0',
    license: 'MIT',
  });
  const schema = {
    name: '@yaltaan/schema',
    version: '0.0.0',
    dependencies: { '@yaltaan/core': '0.0.0', other: '1.0.0' },
  };
  assert.deepEqual(prepareManifest(schema, '0.1.0', names, true)['dependencies'], {
    '@yaltaan/core': '0.1.0',
    other: '1.0.0',
  });
  // An internal package keeps its version and stays private; only its specs of published packages follow.
  const testing = {
    name: '@yaltaan/testing',
    version: '0.0.0',
    private: true,
    dependencies: { '@yaltaan/core': '0.0.0' },
  };
  assert.deepEqual(prepareManifest(testing, '0.1.0', names, false), {
    ...testing,
    dependencies: { '@yaltaan/core': '0.1.0' },
  });
});

test('preparing a release writes the manifests, the lockfile and the changelog, or nothing at all', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-test-'));
  folders.push(copy);
  const files = ['package.json', 'package-lock.json', 'ARCHITECTURE.md', 'CHANGELOG.md'];
  for (const workspacePackage of fs.readdirSync(path.join(repositoryRoot, 'packages'))) {
    files.push(`packages/${workspacePackage}/package.json`);
  }
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, file), path.join(copy, file));
  }
  const snapshot = (): string[] => files.map((file) => fs.readFileSync(path.join(copy, file), 'utf8'));
  const before = snapshot();
  // A changelog whose Unreleased holds no entry cannot be released: nothing is written.
  const changelog = path.join(copy, 'CHANGELOG.md');
  const emptied = before[3]?.replace(/## \[Unreleased\][\s\S]*$/, '## [Unreleased]\n') ?? '';
  fs.writeFileSync(changelog, emptied);
  assert.equal(prepareRelease(copy, '0.1.0', '2026-11-01', false).length, 1);
  assert.deepEqual(snapshot(), [...before.slice(0, 3), emptied, ...before.slice(4)]);
  fs.writeFileSync(changelog, before[3] ?? '');
  assert.deepEqual(prepareRelease(copy, '0.1.0', '2026-11-01', false), []);
  const core = JSON.parse(fs.readFileSync(path.join(copy, 'packages/core/package.json'), 'utf8'));
  assert.equal(core.version, '0.1.0');
  assert.ok(!('private' in core));
  const testing = JSON.parse(fs.readFileSync(path.join(copy, 'packages/testing/package.json'), 'utf8'));
  assert.deepEqual([testing.version, testing.private], ['0.0.0', true]);
  const lock = JSON.parse(fs.readFileSync(path.join(copy, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['packages/core'].version, '0.1.0');
  assert.ok(readChangelogSection(fs.readFileSync(changelog, 'utf8'), '0.1.0').ok);
});

test('a rehearsal writes an entry under an empty Unreleased, and leaves one that has entries alone', () => {
  const empty = '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-01-01\n\n- old\n';
  const filled = withRehearsalEntry(empty);
  assert.ok(cutChangelog(filled, '0.2.0-rehearsal.0', '2026-11-01').ok);
  const withEntries = '# Changelog\n\n## [Unreleased]\n\n- new\n';
  assert.equal(withRehearsalEntry(withEntries), withEntries);
});

test('the command line names a tag and an output folder', () => {
  assert.deepEqual(parseReleaseArguments(['--tag', 'v1.0.0', '--out', '/tmp/x', '--rehearsal']), {
    tag: 'v1.0.0',
    out: path.resolve('/tmp/x'),
    rehearsal: true,
    repositoryUrl: undefined,
  });
  for (const args of [[], ['--tag', 'v1.0.0'], ['--out', 'x'], ['--tag'], ['--tag', 'v1', '--out', 'x', '--publish']]) {
    assert.equal(typeof parseReleaseArguments(args), 'string', args.join(' '));
  }
});

test('a release tag is annotated, names the checked-out commit of a clean tree, and gives its commit date', () => {
  withRepo({ 'a.txt': 'a\n' }, (repo) => {
    repo.git('commit', '-q', '-m', 'first');
    repo.git('tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
    repo.git('tag', 'v1.0.1');
    const facts = readGitFacts(repo.dir, 'v1.0.0');
    assert.ok(typeof facts !== 'string');
    assert.deepEqual(facts.problems, []);
    assert.equal(facts.commitDates.length, 2);
    assert.ok(
      facts.commitDates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
      String(facts.commitDates),
    );
    assert.equal(readGitFacts(repo.dir, 'v9.9.9'), 'there is no tag v9.9.9');
    const lightweight = readGitFacts(repo.dir, 'v1.0.1');
    assert.ok(
      typeof lightweight !== 'string' && lightweight.problems.some((problem) => problem.includes('lightweight')),
    );
    repo.write({ 'b.txt': 'b\n' });
    const dirty = readGitFacts(repo.dir, 'v1.0.0');
    assert.ok(typeof dirty !== 'string' && dirty.problems.some((problem) => problem.includes('not clean')));
    repo.git('commit', '-q', '-m', 'second');
    const moved = readGitFacts(repo.dir, 'v1.0.0');
    assert.ok(typeof moved !== 'string' && moved.problems.some((problem) => problem.includes('checked-out commit')));
  });
});

test('two tarballs are the same only to the byte, and a difference is named by file', () => {
  const a = writeTarball([
    { path: 'package/a.js', bytes: 'a' },
    { path: 'package/b.js', bytes: 'b' },
  ]);
  assert.deepEqual(compareTarballs(a, Buffer.from(a), 'packages/x'), []);
  const changed = writeTarball([
    { path: 'package/a.js', bytes: 'a' },
    { path: 'package/b.js', bytes: 'B' },
  ]);
  assert.deepEqual(compareTarballs(a, changed, 'packages/x'), [
    'packages/x: two builds of the same commit give different tarballs (b.js)',
  ]);
  const dated = writeTarball([
    { path: 'package/a.js', bytes: 'a', mtime: 1 },
    { path: 'package/b.js', bytes: 'b' },
  ]);
  assert.ok(compareTarballs(a, dated, 'packages/x')[0]?.includes('the archive itself differs'));
});

test('an SBOM names the package, its version, purl and licence, and lists exactly its dependencies', () => {
  const manifest = {
    name: '@yaltaan/schema',
    version: '0.1.0',
    license: 'MIT',
    dependencies: { '@yaltaan/core': '0.1.0' },
  };
  const component = { name: '@yaltaan/schema', version: '0.1.0', purl: purlOf('@yaltaan/schema', '0.1.0') };
  const sbom = {
    bomFormat: 'CycloneDX',
    metadata: { component: { ...component, licenses: [{ license: { id: 'MIT' } }] } },
    components: [{ name: '@yaltaan/core' }],
  };
  assert.equal(component.purl, 'pkg:npm/%40yaltaan/schema@0.1.0');
  assert.deepEqual(checkSbom(sbom, manifest), []);
  const breaks: unknown[] = [
    { ...sbom, bomFormat: 'SPDX' },
    { ...sbom, metadata: { component: { ...sbom.metadata.component, name: 'package' } } },
    { ...sbom, metadata: { component: { ...sbom.metadata.component, version: '0.0.0' } } },
    { ...sbom, metadata: { component: { ...sbom.metadata.component, purl: 'pkg:npm/schema@0.1.0' } } },
    { ...sbom, metadata: { component: { ...sbom.metadata.component, licenses: [] } } },
    { ...sbom, components: [] },
    { ...sbom, components: [{ name: '@yaltaan/core' }, { name: 'left-pad' }] },
  ];
  for (const broken of breaks) {
    assert.equal(checkSbom(broken, manifest).length, 1, JSON.stringify(broken));
  }
});

test('the subpaths a consumer loads are every module of "exports", not the manifest', () => {
  const manifest = {
    name: '@yaltaan/core',
    exports: {
      './result': { types: './r.d.ts', default: './r.js' },
      './package.json': './package.json',
      '.': './i.js',
    },
  };
  assert.deepEqual(listSubpathSpecifiers(manifest), ['@yaltaan/core/result', '@yaltaan/core']);
});

test('a consumer sees a module or a declaration missing from a tarball, at run time and at compile time', () => {
  const core = listPublishedPackages(repositoryRoot).packages.find(
    (workspacePackage) => workspacePackage.dir === 'packages/core',
  );
  assert.ok(core !== undefined);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-test-'));
  folders.push(folder);
  const packed = packPackage(core.path, core.dir, folder);
  assert.ok(packed.ok, packed.ok ? '' : packed.problem);
  const files = unpackFiles(fs.readFileSync(packed.file), core.dir).files;
  const manifest = JSON.parse(files.get('package.json')?.toString('utf8') ?? '{}') as JsonObject;
  const tarball = (file: string, without: readonly string[]): string => {
    const kept = [...files].filter(([name]) => !without.includes(name));
    fs.writeFileSync(file, writeTarball(kept.map(([name, bytes]) => ({ path: `package/${name}`, bytes }))));
    return file;
  };
  const whole = tarball(path.join(folder, 'whole.tgz'), []);
  const release = (file: string) => [{ dir: core.dir, name: '@yaltaan/core', file, manifest, integrity: '' }];
  assert.deepEqual(checkConsumer(release(whole)), []);
  const broken = tarball(path.join(folder, 'broken.tgz'), ['dist/path/index.js', 'dist/result/index.d.ts']);
  const problems = checkConsumer(release(broken));
  // Node fails to import and to require; each of the two compilers fails under each of the two resolutions.
  assert.equal(problems.length, 6, problems.join('\n'));
  assert.equal(problems.filter((problem) => problem.includes('compile every subpath')).length, 4);
});
