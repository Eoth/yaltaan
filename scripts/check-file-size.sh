#!/usr/bin/env bash
# Holds every production TypeScript or JavaScript file of the packages to 1 200 lines, and refuses a test written
# inside a production file.
#
# A file past that length mixes responsibilities and is only ever read in pieces: it is split by responsibility
# instead. A file that has to be longer for a while is listed in docs/file-size-caps.tsv with its length, and a cap
# only falls. Refused: a capped file that grows, a cap raised or added in the caps file (compared with a reference
# revision), a production file past 1 200 lines without a cap. Refused as well until --update records it: a capped
# file that shrank, back within the limit or gone. A gain left unrecorded would let the next change spend it unseen.
# A cap belongs to a path: a capped file moved elsewhere starts again at 1 200 lines, so it is split before it moves.
#
# Production: every `.ts`, `.mts`, `.cts`, `.js` or `.mjs` file under packages/ but declaration files (`.d.ts`),
# tests (`*.test.*`, anything under a `test/` or `tests/` folder), benchmarks (`bench/`) and test data (`fixtures/`),
# so that a new location counts by default. An internal package (ARCHITECTURE.md §6) holds test support code that no
# package ships: like a test, it is not production. Lines are counted as an editor numbers them: a last line without a
# line ending counts, CRLF counts once.
#
# Tests live in their own files: a production line that opens a test (`describe(`, `it(`, `test(`, `suite(`, with
# or without `.only`, `.skip`, `.todo` or `.each`) would ship the test code, and its imports, to every user.
#
# Usage:
#   scripts/check-file-size.sh                # the working tree, untracked files included; caps compared with the
#                                             # upstream branch, else HEAD (verify.sh)
#   scripts/check-file-size.sh --cached       # the index, i.e. the next commit; caps compared with HEAD (pre-commit)
#   scripts/check-file-size.sh --since <rev>  # the working tree; caps compared with <rev> (CI: the push base)
#   scripts/check-file-size.sh --update       # lower or drop the caps to match the working tree, never raise one
set -uo pipefail

root=$(git rev-parse --show-toplevel) || exit 1
cd "$root" || exit 1

limit=1200
caps="docs/file-size-caps.tsv"
header=$'file\tlines'
source=(--untracked)
mode=check
case "${1:-}" in
  "") ref=$(git rev-parse -q --verify '@{upstream}' 2> /dev/null || git rev-parse -q --verify HEAD || true) ;;
  --cached)
    source=(--cached)
    ref=$(git rev-parse -q --verify HEAD || true)
    ;;
  --since)
    ref="${2:-}"
    # A new branch or tag is pushed with an all-zero "before": compare with its last commit's parent instead.
    if [ -z "$ref" ] || [ -z "${ref//0/}" ] || ! git cat-file -e "$ref^{commit}" 2> /dev/null; then
      ref=$(git rev-parse -q --verify HEAD~1 || true)
    fi
    ;;
  --update)
    mode=update
    ref=""
    ;;
  *)
    echo "usage: $0 [--cached | --since <rev> | --update]" >&2
    exit 2
    ;;
esac

production=(
  ':(glob)packages/**/*.ts' ':(glob)packages/**/*.mts' ':(glob)packages/**/*.cts' ':(glob)packages/**/*.js'
  ':(glob)packages/**/*.mjs'
  ':(exclude,glob)**/*.d.ts' ':(exclude,glob)**/*.d.mts' ':(exclude,glob)**/*.d.cts' ':(exclude,glob)**/*.test.*'
  ':(exclude,glob)**/test/**' ':(exclude,glob)**/tests/**' ':(exclude,glob)**/bench/**'
  ':(exclude,glob)**/fixtures/**'
)
internal=$(node scripts/lib/internal-packages.ts) || exit 1
for name in $internal; do
  production+=(":(exclude,glob)packages/$name/**")
done

tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
# The reference does not hold the caps file before the commit that creates it: only the exact-length rule applies.
: > "$tmp/ref"
has_ref=0
if [ -n "$ref" ] && git show "$ref:$caps" > "$tmp/ref" 2> /dev/null; then has_ref=1; fi
if [ "${source[0]}" = --cached ]; then
  git show ":$caps" > "$tmp/caps" 2> /dev/null || : > "$tmp/caps"
else
  cp "$caps" "$tmp/caps" 2> /dev/null || : > "$tmp/caps"
fi

# `path:count`, one line per non-empty file; the count follows the last colon, so a path may hold one. Exit status 1
# only means that no file matched.
git -c core.quotePath=false grep "${source[@]}" -I -c -e '' -- "${production[@]}" > "$tmp/lines"
if [ $? -gt 1 ]; then
  echo "error: cannot list the production files" >&2
  exit 1
fi

status=0
awk -F'\t' -v limit="$limit" -v mode="$mode" -v has_ref="$has_ref" -v header="$header" -v caps="$caps" \
  -v ref_file="$tmp/ref" -v caps_file="$tmp/caps" -v out="$tmp/new" '
  function refuse(path, why) { printf "  %s: %s\n", path, why; refused = 1 }
  { sub(/\r$/, "") }
  FILENAME == ref_file { if (FNR > 1 && $0 != "") ref[$1] = $2 + 0; next }
  FILENAME == caps_file {
    if (FNR == 1) { if ($0 != header) refuse(caps, "first line is not the header \"file<TAB>lines\""); next }
    if ($0 == "") next
    if (NF != 2 || $2 !~ /^[0-9]+$/ || ($1 in cap)) { refuse(caps ":" FNR, "not a new <path><TAB><lines> row"); next }
    cap[$1] = $2 + 0; order[++capped] = $1
    next
  }
  {
    n = $0; sub(/.*:/, "", n)
    lines[substr($0, 1, length($0) - length(n) - 1)] = n + 0
    files++
  }
  END {
    for (i = 1; i <= capped; i++) {
      # Membership first: reading lines[p] would create the entry.
      p = order[i]; c = cap[p]; present = (p in lines); n = present ? lines[p] : 0
      if (!present || n <= limit) {
        why = present ? sprintf("%d lines, within the %d-line limit", n, limit) : "no longer a production file"
        if (mode == "update") { printf "  %s: cap %d dropped, %s\n", p, c, why; continue }
        refuse(p, sprintf("capped at %d lines but %s: run --update to drop its cap", c, why))
      } else if (n > c) {
        refuse(p, sprintf("%d lines, over its cap of %d: split it, a cap never rises", n, c))
      } else if (n < c) {
        if (mode == "update") printf "  %s: cap lowered %d -> %d (%+d)\n", p, c, n, n - c
        else refuse(p, sprintf("%d lines, under its cap of %d: run --update to lower the cap", n, c))
      }
      keep[p] = n
      if (has_ref && !(p in ref)) refuse(p, sprintf("cap of %d added: a cap is never added, split the file", c))
      else if (has_ref && c > ref[p]) refuse(p, sprintf("cap raised from %d to %d: a cap never rises", ref[p], c))
    }
    for (p in lines)
      if (!(p in cap) && lines[p] > limit)
        refuse(p, sprintf("%d lines, over the %d-line limit: split it by responsibility", lines[p], limit))
    if (refused) exit 1
    if (mode == "update") {
      print header > out
      for (i = 1; i <= capped; i++) if (order[i] in keep) printf "%s\t%d\n", order[i], keep[order[i]] > out
    } else {
      printf "ok: %d production files, none over %d lines but the %d capped, each at its cap.\n", files, limit, capped
    }
  }' "$tmp/ref" "$tmp/caps" "$tmp/lines" > "$tmp/report" || status=1

if [ "$mode" = update ]; then
  if [ "$status" -ne 0 ]; then
    sort "$tmp/report" >&2
    echo "error: nothing updated. --update only lowers or drops a cap; split the file(s) above." >&2
    exit 1
  fi
  cat "$tmp/report"
  mkdir -p "$(dirname "$caps")" && cp "$tmp/new" "$caps" || exit 1
  echo "caps updated: $caps"
  exit 0
fi
if [ "$status" -ne 0 ]; then
  echo "error: production file length (limit $limit lines; $caps holds the caps):" >&2
  grep -v '^ok:' "$tmp/report" | sort >&2
  echo "Split by responsibility; a cap only falls. Lower or drop a cap in the same commit with $0 --update." >&2
  exit 1
fi
cat "$tmp/report"

git -c core.quotePath=false grep "${source[@]}" -n -I -E \
  -e '^[[:space:]]*(describe|it|test|suite)(\.(only|skip|todo|each))?[[:space:]]*\(' -- "${production[@]}" \
  > "$tmp/inline"
case $? in
  0)
    echo "error: test(s) written in production code:" >&2
    sed 's/^/  /' "$tmp/inline" >&2
    echo "Move them into a test file next to the code (x.test.ts), which no package ships." >&2
    exit 1
    ;;
  1) ;;
  *)
    echo "error: cannot search the production files" >&2
    exit 1
    ;;
esac
echo "ok: no test in production code."
