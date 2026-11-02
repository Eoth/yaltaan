#!/usr/bin/env bash
# Builds every package that has sources, from nothing, each after the packages its manifest declares, whose declarations
# it compiles against: each dist/ and build-info file is removed first. Tests and
# checks read what dist/ holds, so a dist/ left by an earlier build (a module since removed or renamed) would let them
# pass on files the sources no longer produce. The test run (scripts/test.sh) builds first, so a fresh clone, the CI
# test jobs and the verification gate all test what the sources build.
#
# Usage: scripts/build.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
built=0
order=$(node -e '
  const fs = require("node:fs");
  const packages = new Map();
  for (const dir of fs.readdirSync("packages")) {
    if (fs.existsSync(`packages/${dir}/tsconfig.build.json`)) {
      const { name, dependencies = {} } = JSON.parse(fs.readFileSync(`packages/${dir}/package.json`, "utf8"));
      packages.set(name, { dir, needs: Object.keys(dependencies) });
    }
  }
  const seen = new Set();
  const visit = (name) => {
    const found = packages.get(name);
    if (found !== undefined && !seen.has(name)) {
      seen.add(name);
      found.needs.forEach(visit);
      console.log(found.dir);
    }
  };
  [...packages.keys()].forEach(visit);
')
for dir in $order; do
  package="packages/$dir"
  rm -rf "$package/dist" "$package/tsconfig.build.tsbuildinfo"
  npx --no-install tsc -b "$package/tsconfig.build.json"
  built=$((built + 1))
done
if [ "$built" = 0 ]; then
  echo "ok (not applicable: no package has sources yet)"
else
  echo "ok: $built package(s) built from nothing"
fi
