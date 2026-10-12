#!/usr/bin/env bash
# Format of every tracked text file, so that a diff shows only what changed and a file reads the same in every editor
# and terminal:
# - indentation in spaces, never a tab, by an even number of them; a line whose first non-space character is `*` is
#   let through, since the continuation lines of a block comment (` * @param`) sit one space in;
# - at most 120 characters per line outside Markdown, counted in characters, not bytes;
# - no trailing white space outside Markdown, where two trailing spaces are a hard line break;
# - in Markdown, outside fenced code, no paragraph or list item wrapped over several lines: with one line per
#   paragraph, a diff names the sentence that changed and the reader's editor does the wrapping;
# - a newline at the end of every file: without it the last line shows as changed when a line is added after it.
# Exceptions: LICENSE, legal text reproduced verbatim; package-lock.json, written by npm.
#
# Characters are counted in the C locale as the bytes that do not continue a UTF-8 sequence: the same count in gawk,
# mawk and BWK awk whatever locales the machine has installed. A carriage return before the newline is not counted.
#
# Usage:
#   scripts/check-text-format.sh            # the working tree (verify.sh, CI)
#   scripts/check-text-format.sh --cached   # the index, i.e. the next commit (pre-commit hook)
set -uo pipefail

cached=0
case "${1:-}" in
  "") ;;
  --cached) cached=1 ;;
  *)
    echo "usage: $0 [--cached]" >&2
    exit 2
    ;;
esac

root=$(git rev-parse --show-toplevel) || exit 1
cd "$root" || exit 1
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT

# Text files as git sees them (-I leaves out what it takes for binary), NUL-separated so that any path is read
# verbatim. Exit status 1 only means that no file matched.
git grep --cached -I -l -z -e '' > "$tmp/all"
rc=$?
if [ "$rc" -gt 1 ]; then
  echo "error: cannot list the tracked text files" >&2
  exit 1
fi

files=()
while IFS= read -r -d '' file; do
  case "$file" in LICENSE | */LICENSE | package-lock.json | */package-lock.json) continue ;; esac
  files+=("$file")
done < "$tmp/all"
if [ "${#files[@]}" -eq 0 ]; then
  echo "ok: no tracked text file to check."
  exit 0
fi

if [ "$cached" = 1 ]; then
  # The index content is judged as a clone checks it out, from a copy outside the working tree.
  printf '%s\0' "${files[@]}" | git checkout-index --prefix="$tmp/index/" -z --stdin || {
    echo "error: cannot read the index" >&2
    exit 1
  }
  cd "$tmp/index" || exit 1
fi

# `./` keeps awk from reading a path such as `a=b.txt` as a variable assignment.
args=()
for file in "${files[@]}"; do
  # A file deleted from the working tree but not from the index has no format left to judge here.
  [ -f "$file" ] && args+=("./$file")
done
if [ "${#args[@]}" -eq 0 ]; then
  echo "ok: no tracked text file to check."
  exit 0
fi

# Each file is read as a single record (RS is a control character no text file holds in practice, and records are
# joined back if one does): only then can awk see whether the last line ends with a newline.
LC_ALL=C awk -v limit=120 '
  function report(file, n, why) {
    printf "%s:%d: %s\n", file, n, why
    bad = 1
  }
  function judge(path, text,    file, md, lines, n, i, line, rest, k, blank, start, prose, fence) {
    file = substr(path, 3)
    md = (file ~ /\.md$/)
    n = split(text, lines, "\n")
    if (substr(text, length(text)) == "\n") n--
    else report(file, n, "no newline at the end of the file")
    prose = 0
    fence = ""
    for (i = 1; i <= n; i++) {
      line = lines[i]
      sub(/\r$/, "", line)
      if (md) {
        if (fence != "") {
          if (line ~ ("^ *" fence)) fence = ""
          continue
        }
        if (match(line, /^ *(```|~~~)/)) {
          fence = substr(line, RSTART + RLENGTH - 3, 3)
          prose = 0
          continue
        }
        blank = (line ~ /^ *$/)
        start = (blank || line ~ /^ *(#|\||<|>)/ || line ~ /^ *([-*+]|[0-9]+\.)( |$)/)
        if (!start && prose) report(file, i, "wrapped Markdown paragraph or list item: write it on one line")
        prose = (!blank && line !~ /^ *(#|\||<|>)/)
      } else {
        rest = line
        k = gsub(/[\200-\277]/, "", rest)
        if (length(line) - k > limit) {
          report(file, i, sprintf("%d characters (maximum %d)", length(line) - k, limit))
        }
        if (line ~ /[ \t]$/) report(file, i, "trailing white space")
      }
      if (line ~ /^ *\t/) report(file, i, "tab in the indentation")
      if (line !~ /^ *$/ && match(line, /^ +/) && RLENGTH % 2 == 1 && substr(line, RLENGTH + 1, 1) != "*") {
        report(file, i, sprintf("odd indentation (%d spaces)", RLENGTH))
      }
    }
  }
  BEGIN { RS = "\001" }
  FNR == 1 {
    if (NR > 1) judge(path, text)
    path = FILENAME
    text = $0
    next
  }
  { text = text RS $0 }
  END {
    if (NR > 0) judge(path, text)
    exit bad
  }
' "${args[@]}" >&2
status=$?

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "error: the line(s) above break the text format described at the top of scripts/check-text-format.sh;" >&2
  echo "npx prettier --write <file> fixes most of them in code, Markdown is fixed by hand." >&2
  exit 1
fi
echo "ok: ${#args[@]} text files: indentation, line length, trailing white space, Markdown paragraphs, final newline."
