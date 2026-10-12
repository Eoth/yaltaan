#!/usr/bin/env bash
# Checks a commit message (the file git passes to the commit-msg hook):
# - the subject follows Conventional Commits: `type(scope)!: subject`, at most 100 characters; `fixup!`, `amend!`,
#   `squash!` and `Revert "` subjects made by git itself are let through;
# - no trailer that credits a co-author or a generator (`Co-authored-by:`, `Assisted-by:`, `Generated-by:`): a commit
#   has one author, the person who answers for it;
# - no name of a local development-notes file (CLAUDE.md, AGENTS.md, HANDOFF.md, HANDOFF-ARCHIVE.md, the root guide/
#   folder) and no "session", for the reasons given in scripts/check-no-internal-doc-refs.sh.
#
# Usage: scripts/check-commit-message.sh <message-file>
set -uo pipefail

file=${1:?usage: scripts/check-commit-message.sh <message-file>}
# Git strips comment lines itself; judge only what will be recorded.
message=$(grep -v '^#' "$file" | sed 's/\r$//')
subject=$(printf '%s\n' "$message" | sed -n '1p')
status=0

fail() {
  echo "commit-msg: $1" >&2
  status=1
}

types='feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert'
case "$subject" in
  'fixup! '* | 'amend! '* | 'squash! '* | 'Revert "'*) ;;
  *)
    if ! printf '%s\n' "$subject" | grep -q -E "^($types)(\([a-z0-9][a-z0-9-]*\))?!?: [^ ].*[^.]$"; then
      fail "the subject is not a Conventional Commit: \"type(scope): imperative summary\" (types: ${types//|/, }),"
      fail "  without a final period: $subject"
    fi
    ;;
esac
if [ "${#subject}" -gt 100 ]; then
  fail "the subject has ${#subject} characters (maximum 100)"
fi
if printf '%s\n' "$message" | grep -n -i -E '^(co-authored-by|assisted-by|generated-by):' >&2; then
  fail "a commit names no co-author or generator trailer (line above)"
fi
internal_names='CLAUDE\.md|AGENTS\.md|HANDOFF(-ARCHIVE)?\.md|(^|[^[:alnum:]_./-])guide/'
if printf '%s\n' "$message" | grep -n -i -E "$internal_names" >&2; then
  fail "the message names local development notes that no clone receives (line above)"
fi
if printf '%s\n' "$message" | grep -n -i -w -E 'sessions?' >&2; then
  fail "the message says \"session\": name the change, the ticket or the iteration instead (line above)"
fi
exit "$status"
