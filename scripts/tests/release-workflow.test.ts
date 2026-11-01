// Guards the promise that no npm token exists and that only a pushed release tag publishes (ADR 0029): every workflow
// of .github/workflows and every .npmrc git tracks is read; the release workflow's only job that may ask for an OIDC
// token runs no code of the repository; the verdict that lets it run is executed on every event.
//
// The workflows are read as text, job by job (a job starts at a two-space key under `jobs:`): a token passed through
// a YAML anchor, a reusable workflow or a composite action of another repository would not be seen. actionlint, in
// the gate, checks the workflows' syntax.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { repositoryRoot } from '../lib/workspace.ts';
import { bashPath } from './run-script.ts';

const WORKFLOWS = path.join(repositoryRoot, '.github', 'workflows');

/** What would put an npm token in play: a secret other than the workflow's own token, or npm's token settings. */
const TOKEN_SIGNS: readonly RegExp[] = [
  // Any reading of the secrets but the workflow's own token, `secrets['X']` and `toJSON(secrets)` included.
  /\bsecrets\b(?!\.GITHUB_TOKEN\b)\s*[.[)}]/,
  /NODE_AUTH_TOKEN|NPM_TOKEN|_authToken/,
  // setup-node writes `//registry/:_authToken=${NODE_AUTH_TOKEN}` into .npmrc when it is given a registry.
  /registry-url/,
];

/** The text of each job of a workflow, by its key. */
function splitJobs(workflow: string): Map<string, string> {
  const jobs = new Map<string, string>();
  const lines = workflow.split('\n');
  const start = lines.indexOf('jobs:');
  let current: string | undefined;
  for (const line of start === -1 ? [] : lines.slice(start + 1)) {
    const key = /^ {2}([\w-]+):\s*$/.exec(line)?.[1];
    if (key !== undefined) {
      current = key;
      jobs.set(key, '');
    } else if (/^\S/.test(line)) {
      break;
    } else if (current !== undefined) {
      jobs.set(current, `${jobs.get(current) ?? ''}${line}\n`);
    }
  }
  return jobs;
}

function readWorkflows(): Map<string, string> {
  const files = fs.readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file));
  return new Map(files.map((file) => [file, fs.readFileSync(path.join(WORKFLOWS, file), 'utf8')]));
}

test('no workflow and no tracked .npmrc names an npm token or a secret beyond the workflow token', () => {
  const workflows = readWorkflows();
  assert.ok(workflows.has('release.yml'), [...workflows.keys()].join(', '));
  const npmrcs = spawnSync('git', ['ls-files', '--', '.npmrc', '**/.npmrc'], { cwd: repositoryRoot, encoding: 'utf8' })
    .stdout.split('\n')
    .filter((file) => file !== '');
  assert.ok(npmrcs.includes('.npmrc'), npmrcs.join(', '));
  const texts = [
    ...workflows,
    ...npmrcs.map((file): [string, string] => [file, fs.readFileSync(path.join(repositoryRoot, file), 'utf8')]),
  ];
  for (const [file, text] of texts) {
    const lines = text.split('\n').filter((line) => !line.trimStart().startsWith('#'));
    for (const sign of TOKEN_SIGNS) {
      const found = lines.find((line) => sign.test(line));
      assert.equal(found, undefined, `${file}: ${found ?? ''}`);
    }
  }
});

test('only the publishing job of the release asks for an OIDC token, and it runs no code of the repository', () => {
  const jobs = splitJobs(readWorkflows().get('release.yml') ?? '');
  assert.ok(jobs.size >= 3, [...jobs.keys()].join(', '));
  const withToken = [...jobs].filter(([, text]) => /id-token:\s*write/.test(text)).map(([key]) => key);
  assert.deepEqual(withToken, ['publish']);
  const publish = jobs.get('publish') ?? '';
  for (const sign of [/actions\/checkout/, /npm (?:ci|install|exec|run)\b/, /\bnpx\b/, /scripts\//, /node /]) {
    assert.ok(!sign.test(publish), `the publishing job matches ${sign}`);
  }
  // The actions it runs, each pinned to a commit: downloading the checked files and installing Node.
  const actions = [...publish.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]?.replace(/@[0-9a-f]{40}$/, '@sha'));
  assert.deepEqual(actions, ['actions/download-artifact@sha', 'actions/setup-node@sha']);
  assert.match(publish, /environment: npm/);
  assert.match(publish, /sha512sum --check --strict/);
  // It runs only on the verdict, and refuses by itself any event but a pushed tag.
  assert.match(publish, /^ {4}if: needs\.check\.outputs\.publish == 'true'$/m);
  assert.match(publish, /"\$GITHUB_EVENT_NAME" != push \] \|\| \[ "\$GITHUB_REF_TYPE" != tag/);
  assert.match(jobs.get('check') ?? '', /bash scripts\/release-verdict\.sh/);
  // The GitHub release follows a publication only: without an `if:` of its own, a skipped publication skips it.
  const githubRelease = jobs.get('github-release') ?? '';
  assert.match(githubRelease, /needs: \[check, publish\]/);
  assert.doesNotMatch(githubRelease, /^ {4}if:/m);
  assert.match(githubRelease, /sha512sum --check --strict/);
});

test('the verdict publishes a pushed tag of a release that is no rehearsal, and nothing else', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'yaltaan-test-'));
  try {
    fs.writeFileSync(path.join(folder, 'SHA512SUMS'), 'abc  yaltaan-core-1.0.0.tgz\n');
    const verdict = (env: Record<string, string>, description: string): string => {
      fs.writeFileSync(path.join(folder, 'release.json'), description);
      const result = spawnSync(bashPath(), ['scripts/release-verdict.sh', folder], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_EVENT_NAME: '', GITHUB_REF_TYPE: '', ...env },
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    // Every event a workflow can start on, every kind of ref, both values of the description: an exhaustive table.
    const events = ['push', 'workflow_dispatch', 'pull_request', 'pull_request_target', 'schedule', 'release', ''];
    for (const event of events) {
      for (const refType of ['tag', 'branch', '']) {
        for (const rehearsal of [false, true]) {
          const description = JSON.stringify({ rehearsal, distTag: 'latest' });
          const output = verdict({ GITHUB_EVENT_NAME: event, GITHUB_REF_TYPE: refType }, description);
          const expected = event === 'push' && refType === 'tag' && !rehearsal;
          assert.match(output, new RegExp(`^publish=${expected}$`, 'm'), `${event} ${refType} ${rehearsal}`);
        }
      }
    }
    const pushedTag = { GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag' };
    // A description that does not say "false" plainly never publishes.
    for (const description of [
      '{"distTag":"latest"}',
      '{"rehearsal":"false","distTag":"latest"}',
      '{"rehearsal":0,"distTag":"next"}',
    ]) {
      assert.match(verdict(pushedTag, description), /^publish=false$/m, description);
    }
    // A dist-tag the release never writes stops the verdict, and with it the jobs that need it.
    fs.writeFileSync(path.join(folder, 'release.json'), '{"rehearsal":false,"distTag":"beta"}');
    const refused = spawnSync(bashPath(), ['scripts/release-verdict.sh', folder], { cwd: repositoryRoot });
    assert.notEqual(refused.status, 0);
    const output = verdict(pushedTag, '{"rehearsal":false,"distTag":"next"}');
    assert.match(
      output,
      /^dist-tag=next\nprerelease=true\nsums<<END_OF_SUMS\nabc {2}yaltaan-core-1\.0\.0\.tgz\nEND_OF_SUMS$/m,
    );
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('the jobs of a workflow are read by their two-space keys', () => {
  const workflow = 'name: x\non:\n  push:\njobs:\n  a:\n    steps:\n      - run: one\n  b-c:\n    runs-on: y\n';
  assert.deepEqual(
    [...splitJobs(workflow)],
    [
      ['a', '    steps:\n      - run: one\n'],
      ['b-c', '    runs-on: y\n\n'],
    ],
  );
});
