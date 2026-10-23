#!/usr/bin/env bash
# Builds every package that has sources, from nothing: each dist/ and build-info file is removed first. Tests and
# checks read what dist/ holds, so a dist/ left by an earlier build (a module since removed or renamed) would let them
# pass on files the sources no longer produce. The test run (scripts/test.sh) builds first, so a fresh clone, the CI
# test jobs and the verification gate all test what the sources build.
#
# Usage: scripts/build.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
built=0
for config in packages/*/tsconfig.build.json; do
  [ -f "$config" ] || continue
  package=$(dirname "$config")
  rm -rf "$package/dist" "$package/tsconfig.build.tsbuildinfo"
  npx --no-install tsc -b "$config"
  built=$((built + 1))
done
if [ "$built" = 0 ]; then
  echo "ok (not applicable: no package has sources yet)"
else
  echo "ok: $built package(s) built from nothing"
fi
