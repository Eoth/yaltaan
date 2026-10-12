import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withRepo } from './run-script.ts';

const SCRIPT = 'scripts/check-no-internal-doc-refs.sh';

test('a clean tree passes', () => {
  withRepo({ 'README.md': '# Title\n\nSee docs/guide/start.md and sessionStorage.\n' }, (repo) => {
    const result = repo.run(SCRIPT);
    assert.equal(result.status, 0, result.stderr + result.stdout);
  });
});

for (const [label, text] of [
  ['the hand-over notes', 'Read HANDOFF.md first.'],
  ['their archive', 'Moved to HANDOFF-ARCHIVE.md.'],
  ['the governance file', 'As CLAUDE.md says.'],
  ['the other agents file', 'See agents.md for details.'],
  ['the root guide folder', 'Run guide/outils/replay-wip.sh.'],
  ['the word session', 'Done in the last Session.'],
  ['the plural', 'Over several sessions.'],
] as const) {
  test(`a tracked file naming ${label} is refused`, () => {
    withRepo({ 'docs/note.md': `${text}\n` }, (repo) => {
      const result = repo.run(SCRIPT);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stdout, /docs\/note\.md:1:/);
    });
  });
}

test('--cached judges the index, not the working tree', () => {
  withRepo({ 'a.txt': 'clean\n' }, (repo) => {
    repo.write({ 'b.txt': 'see HANDOFF.md\n' });
    repo.git('reset', '-q', '--', 'b.txt');
    // b.txt is now untracked: the index does not hold it, the working tree does.
    assert.equal(repo.run(SCRIPT, '--cached').status, 0);
    assert.equal(repo.run(SCRIPT).status, 1);
    repo.git('add', 'b.txt');
    assert.equal(repo.run(SCRIPT, '--cached').status, 1);
  });
});

test('an ignored file is never judged', () => {
  withRepo({ '.gitignore': 'notes/\n' }, (repo) => {
    repo.write({ 'notes/b.txt': 'see HANDOFF.md\n' });
    assert.equal(repo.run(SCRIPT).status, 0);
    assert.equal(repo.run(SCRIPT, '--cached').status, 0);
  });
});
