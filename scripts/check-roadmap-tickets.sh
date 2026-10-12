#!/usr/bin/env bash
# Refuses a ROADMAP.md that opens one ticket number twice, or that keeps a ticket open (its `#### T<lot>.<n> — title`
# heading) after closing it (a `| T<lot>.<n> |` row of the closed table; a closed step, `| T<lot>.<n> a |`, leaves the
# ticket open for its other steps). When two branches each take the next free
# number on their own, git merges the two headings without a conflict as long as they land at different places of the
# file, and every commit message and cross-reference that cites the number becomes ambiguous; only a check of the
# merged result sees it.
#
# Usage:
#   scripts/check-roadmap-tickets.sh            the working tree (verify.sh)
#   scripts/check-roadmap-tickets.sh --cached   the index, i.e. the next commit (pre-commit hook)
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
if [ "${1:-}" = --cached ]; then
  if ! git cat-file -e :ROADMAP.md 2> /dev/null; then
    echo "ok (not applicable: the index holds no ROADMAP.md)"
    exit 0
  fi
  roadmap=$(git show :ROADMAP.md) || exit 1
else
  roadmap=$(cat ROADMAP.md) || exit 1
fi
roadmap=$(printf '%s\n' "$roadmap" | tr -d '\r')
opened=$(printf '%s\n' "$roadmap" | sed -n 's/^#### \(T[0-9][0-9]*\.[0-9][0-9]*\) .*/\1/p' | sort)
closed=$(printf '%s\n' "$roadmap" | sed -n 's/^| \(T[0-9][0-9]*\.[0-9][0-9]*\) |.*/\1/p' | sort -u)
status=0

duplicates=$(printf '%s\n' "$opened" | uniq -d | tr '\n' ' ')
if [ -n "${duplicates// /}" ]; then
  echo "error: ROADMAP.md opens these tickets more than once: ${duplicates% }" >&2
  echo "Give the newer one a free number, in its heading and in every mention." >&2
  status=1
fi
both=$(comm -12 <(printf '%s\n' "$opened" | sort -u) <(printf '%s\n' "$closed") | tr '\n' ' ')
if [ -n "${both// /}" ]; then
  echo "error: ROADMAP.md keeps these tickets open although a closing row exists: ${both% }" >&2
  echo "Remove the ticket from the open tickets when its closing row is added (or the row, if it is not closed)." >&2
  status=1
fi
[ "$status" = 0 ] && echo "ok: ROADMAP.md opens each ticket once and closes none that stays open."
exit "$status"
