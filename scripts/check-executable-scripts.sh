#!/usr/bin/env bash
# Refuses a tracked file that starts with a shebang (#!/...) but is not recorded executable. Git on Linux and macOS
# skips a non-executable hook with a mere hint, so the pre-push gate would silently never run, and a script run
# directly stops at "Permission denied". Git on Windows records no execute bit by default (core.fileMode false): a
# script created there is non-executable everywhere else, and nothing on Windows shows it.
#
# Reads the index: what the next commit contains (pre-commit hook), or the checked-out commit (CI).
# Usage: scripts/check-executable-scripts.sh
set -uo pipefail

bad=()
while IFS= read -r -d '' path && IFS= read -r -d '' line && IFS= read -r _; do
  [ "$line" = 1 ] || continue
  [ "$(git ls-files -s -- "$path" | cut -d ' ' -f 1)" = 100755 ] || bad+=("$path")
done < <(git grep --cached -z -n -I -E -e '^#! ?/' || true)

if [ "${#bad[@]}" -gt 0 ]; then
  echo "error: file(s) starting with a shebang but not recorded executable:" >&2
  printf '  %s\n' "${bad[@]}" >&2
  echo "fix, in the same commit: git update-index --chmod=+x <path>" >&2
  exit 1
fi
echo "ok: every file starting with a shebang is recorded executable."
