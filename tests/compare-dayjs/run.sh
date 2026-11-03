#!/usr/bin/env bash
# Compares dayjs and its plugins with the native Temporal and temporal-polyfill, java.time as the referee, on generated
# cases. dayjs stays out of the lockfile and of the gate, in a temporary folder removed at the end: it is compared, not
# used. Needs a JDK on PATH (javac, java) and the Node pinned by scripts/test262.sh.
#
# Usage: tests/compare-dayjs/run.sh [--write]    --write rewrites docs/comparisons/dayjs.md
set -euo pipefail

dayjs_version=1.11.23
dayjs_integrity=sha512-QDTCU0M0MxR3hQfnlDJfwekQiaanm1ubOD231u73WBckQ/fsamwRLiE2GBz6D3a/xF1NgfiDLJjXBa1hYOYTtQ==

root=$(git rev-parse --show-toplevel)
cd "$root"
node_bin=$(bash scripts/test262.sh --print-node)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

(
  cd "$work"
  printf '{ "name": "compare-dayjs", "version": "0.0.0", "private": true }\n' > package.json
  npm install --no-audit --no-fund --ignore-scripts --save-exact --silent "dayjs@$dayjs_version"
  found=$(node -p "require('./package-lock.json').packages['node_modules/dayjs'].integrity")
  if [ "$found" != "$dayjs_integrity" ]; then
    echo "error: dayjs $dayjs_version has integrity $found, not the pinned one" >&2
    exit 1
  fi
)
javac -d "$work/classes" tests/compare-dayjs/Oracle.java
TZ=UTC "$node_bin" --disable-warning=ExperimentalWarning tests/compare-dayjs/compare.mjs \
  --dayjs "$work" --java "$work/classes" "$@"
