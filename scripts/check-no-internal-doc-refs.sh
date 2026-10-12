#!/usr/bin/env bash
# Fails (exit 1) if a tracked file names a local development-notes file or folder that clones never receive
# (CLAUDE.md, AGENTS.md, HANDOFF.md, HANDOFF-ARCHIVE.md, the guide/ folder at the repository root): a reference to
# them points at text a reader will never have, so the reason it stood for must be written out in place instead.
#
# Also refused, as a whole word in any case: "session" and "sessions". How the work is divided up is not part of
# what the repository ships: a document names the change, the ticket or the iteration.
#
# Usage:
#   scripts/check-no-internal-doc-refs.sh            checks the working tree (CI)
#   scripts/check-no-internal-doc-refs.sh --cached   checks the index (pre-commit hook)
set -uo pipefail

mode_args=()
if [ "${1:-}" = "--cached" ]; then
  mode_args=(--cached)
fi

# `guide/` counts only as a root folder: at the start of a path or after a character that cannot end a path segment,
# so `docs/guide/` is allowed.
pattern='CLAUDE\.md|AGENTS\.md|HANDOFF(-ARCHIVE)?\.md|(^|[^[:alnum:]_./-])guide/'

# These files name the very patterns they refuse.
self_exclude=(
  ':(exclude)scripts/check-no-internal-doc-refs.sh'
  ':(exclude)scripts/check-commit-message.sh'
  ':(exclude)scripts/tests/check-no-internal-doc-refs.test.ts'
  ':(exclude)scripts/tests/check-commit-message.test.ts'
)

status=0
if git grep "${mode_args[@]}" -n -i -E "$pattern" -- . "${self_exclude[@]}"; then
  echo >&2
  echo "error: the line(s) above name local development notes that no clone receives;" >&2
  echo "write the reason out in place so the text stands on its own, then retry." >&2
  status=1
fi
if git grep "${mode_args[@]}" -n -i -w -E 'sessions?' -- . "${self_exclude[@]}"; then
  echo >&2
  echo "error: the line(s) above say \"session\": name the change, the ticket or the iteration instead" >&2
  echo "(\"itération\" in French), then retry." >&2
  status=1
fi
[ "$status" = 0 ] && echo "ok: no reference to local development notes, no \"session\"."
exit "$status"
