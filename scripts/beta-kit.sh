#!/usr/bin/env bash
# Builds what a beta tester receives, from the committed HEAD, and publishes nothing: the archives of @yaltaan/core and
# @yaltaan/temporal from a rehearsal of the release (two builds identical to the byte, inspected, a consumer's
# compilation), the guide with its commit filled in, the comparison and the test262 tables. Then judges them as a tester
# would: both archives into an empty project, on the Node that has Temporal and on the current one with the polyfill.
#
# Usage: scripts/beta-kit.sh --out <empty folder>
set -euo pipefail

[ "${1:-}" = --out ] && [ -n "${2:-}" ] || {
  echo "usage: $0 --out <empty folder>" >&2
  exit 2
}
mkdir -p "$2"
out=$(cd "$2" && pwd)
if [ -n "$(ls -A "$out")" ]; then
  echo "error: $out is not empty" >&2
  exit 1
fi
root=$(git rev-parse --show-toplevel)
cd "$root"
commit=$(git rev-parse HEAD)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

bash scripts/release-rehearsal.sh --out "$work/release" > "$work/rehearsal.log" 2>&1 || {
  tail -n 20 "$work/rehearsal.log" >&2
  exit 1
}
cp "$work"/release/yaltaan-core-*.tgz "$work"/release/yaltaan-temporal-*.tgz "$out/"
for guide in README.md README.fr.md; do
  sed "s/{commit}/$commit/g" "docs/beta/$guide" > "$out/$guide"
done
cp docs/beta/FEEDBACK.md docs/beta/try.mjs docs/comparisons/dayjs.md docs/comparisons/dayjs-migration.md \
  docs/comparisons/dayjs-measures.md "$out/"
cp docs/test262/README.md "$out/test262.md"
(cd "$out" && sha256sum -- * > SHA256SUMS)

judge() {
  local node_bin=$1 project
  project=$(mktemp -d -p "$work")
  (
    cd "$project"
    npm init -y > /dev/null
    npm pkg set type=module > /dev/null
    npm install --no-audit --no-fund --silent "$out"/yaltaan-core-*.tgz "$out"/yaltaan-temporal-*.tgz
    npm install --no-audit --no-fund --silent --save-exact temporal-polyfill@1.0.5
    cp "$out/try.mjs" .
    "$node_bin" try.mjs
  )
}
judge "$(command -v node)"
judge "$(bash scripts/test262.sh --print-node)"
(cd "$out" && sha256sum --check --strict --quiet SHA256SUMS)
echo "ok: $out holds the kit of $commit; nothing was published."
