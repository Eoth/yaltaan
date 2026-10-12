import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withRepo } from './run-script.ts';

const SCRIPT = 'scripts/check-commit-message.sh';

function judge(message: string): number | null {
  return withRepo({ 'msg.txt': message }, (repo) => repo.run(SCRIPT, 'msg.txt').status);
}

test('Conventional Commits subjects pass, with or without scope and breaking mark', () => {
  for (const message of [
    'feat(core): add the Result type\n',
    'fix: refuse __proto__ as a path segment\n\nBody explaining why.\n',
    'refactor(path)!: drop the string form inside the library\n',
    'docs(roadmap): close T0.1\n',
    'fixup! feat: x\n',
    'amend! feat(core): add the Result type\n',
    'Revert "feat: x"\n',
    '# comment lines are stripped by git\nchore: ok\n',
  ]) {
    assert.equal(judge(message), 0, message);
  }
});

test('malformed subjects are refused', () => {
  for (const message of [
    'Feat: capitalised type\n',
    'feature: unknown type\n',
    'fix:missing space\n',
    'fix: final period.\n',
    `feat: ${'x'.repeat(95)}\n`,
    'update stuff\n',
  ]) {
    assert.equal(judge(message), 1, message);
  }
});

test('co-author and generator trailers are refused, in any case', () => {
  for (const trailer of ['Co-authored-by: A <a@b>', 'co-authored-by: A <a@b>', 'Assisted-by: x', 'Generated-By: x']) {
    assert.equal(judge(`chore: ok\n\n${trailer}\n`), 1, trailer);
  }
});

test('local notes and the word session are refused in a message', () => {
  for (const body of ['see HANDOFF.md', 'per CLAUDE.md', 'from guide/outils', 'found in this session']) {
    assert.equal(judge(`docs: ok\n\n${body}\n`), 1, body);
  }
  assert.equal(judge('docs: ok\n\nsee docs/guide/start.md\n'), 0);
});
