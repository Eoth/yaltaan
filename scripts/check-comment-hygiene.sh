#!/usr/bin/env bash
# Refuses a comment line of a TypeScript, JavaScript or shell file that carries a date (20NN-NN-NN), names
# ROADMAP.md or cites a ticket identifier (T<lot>.<n>). A comment says why the code is the way it is today: an
# invariant, a trap, a clause of a specification. When something was found and which ticket it was belong to the
# commit message, where history keeps them without ageing in the code; a ticket number in a comment points at a line
# of the roadmap that is gone once the ticket closes.
#
# Every line of every tracked file is judged, since the repository started clean. The comment part of a line starts
# at `//` or `/*` at the start of the line or after white space, so that a URL (`https://`) in code is not taken for
# one; a line whose first non-space character is `*` continues a block comment. In a shell script, a comment is a
# line that starts with `#` after optional white space, the shebang aside.
#
# Usage:
#   scripts/check-comment-hygiene.sh            # the working tree (verify.sh, CI)
#   scripts/check-comment-hygiene.sh --cached   # the index, i.e. the next commit (pre-commit hook)
set -uo pipefail

mode_args=()
case "${1:-}" in
  "") ;;
  --cached) mode_args=(--cached) ;;
  *)
    echo "usage: $0 [--cached]" >&2
    exit 2
    ;;
esac

root=$(git rev-parse --show-toplevel) || exit 1
cd "$root" || exit 1
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT

# These files name the very patterns they refuse, or are about the roadmap itself.
self_exclude=(
  ':(exclude)scripts/check-comment-hygiene.sh'
  ':(exclude)scripts/check-roadmap-tickets.sh'
  ':(exclude)scripts/tests/check-comment-hygiene.test.ts'
  ':(exclude)scripts/tests/check-roadmap-tickets.test.ts'
)

# git grep keeps the lines that may hold a violation anywhere; awk then judges only their comment part.
git -c core.quotePath=false grep "${mode_args[@]}" -n -I -E \
  -e '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' -e 'ROADMAP\.md' -e 'T[0-9]+\.[0-9]+' \
  -- '*.ts' '*.mts' '*.cts' '*.js' '*.mjs' '*.sh' "${self_exclude[@]}" > "$tmp/candidates"
if [ $? -gt 1 ]; then
  echo "error: cannot search the tracked files" >&2
  exit 1
fi

awk '
  {
    sub(/\r$/, "")
    # `path:line:text`: the path ends before the first `:<digits>:`, the text may hold colons of its own.
    if (!match($0, /:[0-9]+:/)) next
    path = substr($0, 1, RSTART - 1)
    n = substr($0, RSTART + 1, RLENGTH - 2) + 0
    text = substr($0, RSTART + RLENGTH)
    comment = ""
    if (path ~ /\.sh$/) {
      if (text ~ /^[ \t]*#/ && !(n == 1 && text ~ /^#!/)) comment = text
    } else if (text ~ /^[ \t]*(\/\/|\/\*|\*)/) {
      comment = text
    } else if (match(text, /[ \t](\/\/|\/\*)/)) {
      comment = substr(text, RSTART)
    }
    if (comment == "") next
    if (comment ~ /20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]/ || comment ~ /ROADMAP\.md/ ||
        comment ~ /(^|[^A-Za-z0-9_])T[0-9]+\.[0-9]+([^A-Za-z0-9_]|$)/) {
      printf "%s:%d: %s\n", path, n, text
      found = 1
    }
  }
  END { exit found }
' "$tmp/candidates" >&2
if [ $? -ne 0 ]; then
  echo >&2
  echo "error: the comment line(s) above carry a date, a ROADMAP.md reference or a ticket identifier." >&2
  echo "Say why the code is the way it is (invariant, trap, specification clause); the story and the ticket go" >&2
  echo "in the commit message." >&2
  exit 1
fi
echo "ok: no comment line carries a date, a roadmap reference or a ticket identifier."
