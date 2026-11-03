#!/usr/bin/env bash
# Measures what dayjs, the native Temporal and temporal-polyfill cost: bytes of import and instructions per call. dayjs
# stays out of the lockfile, in a temporary folder removed at the end. Needs valgrind and the Node of
# scripts/test262.sh.
#
# Usage: tests/compare-dayjs/measure.sh
set -euo pipefail

dayjs_version=1.11.23

root=$(git rev-parse --show-toplevel)
cd "$root"
node_bin=$(bash scripts/test262.sh --print-node)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
(
  cd "$work"
  printf '{ "name": "compare-dayjs", "version": "0.0.0", "private": true }\n' > package.json
  npm install --no-audit --no-fund --ignore-scripts --save-exact --silent "dayjs@$dayjs_version"
)
"$node_bin" --disable-warning=ExperimentalWarning tests/compare-dayjs/measure.mjs --dayjs "$work" "$@"
