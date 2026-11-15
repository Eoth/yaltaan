#!/usr/bin/env bash
# Runs a schema of @yaltaan/schema and rules of @yaltaan/rules in real form engines, with no bridge, the recipes of the
# reactive guide that turn a node into an Angular signal and a Vue ref, and the states of @yaltaan/form, arrays,
# validators, rules and the nodes left out of a submission included, beside those of Angular Signal Forms and TanStack
# Form: the tarballs of the workspace installed into an empty project with exact versions of Angular, TanStack Form and
# Vue, then each file of this folder. Angular, rxjs, jsdom and fast-check at the versions the workspace installs, read
# from its package.json, so that this folder and the tests of @yaltaan/angular judge the same Angular.
# 100 MB downloaded into a temporary folder, removed at the end: outside the gate until the interoperability matrix
# enters CI. The Angular bridge is a package of the workspace, judged by the gate (packages/angular/).
#
# Usage: tests/interop/run.sh
set -euo pipefail

root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cd "$root"
bash scripts/build.sh >/dev/null
npm pack --workspace packages/core --workspace packages/schema --workspace packages/rules --workspace packages/form \
  --pack-destination "$work" --silent >/dev/null

cd "$work"
printf '{ "name": "yaltaan-interop", "version": "0.0.0", "private": true, "type": "module" }\n' >package.json
# shellcheck disable=SC2046 # one word per package, by construction
npm install --no-audit --no-fund --ignore-scripts --save-exact --silent \
  $(node -e '
    const { devDependencies } = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const names = Object.keys(devDependencies).filter((name) => /^(@angular\/|rxjs$|jsdom$|fast-check$)/.test(name));
    console.log(names.map((name) => name + "@" + devDependencies[name]).join(" "));
  ' "$root/package.json") \
  @tanstack/form-core@1.33.5 vue@3.5.44 ./*.tgz
node "$root/tests/interop/recipes.mjs" "$root/docs/guide/en/reactive.md" "$root/docs/guide/fr/reactive.md"
for engine in angular tanstack reactive-angular reactive-vue \
  form-states form-arrays form-async form-rules form-conditions; do
  cp "$root/tests/interop/$engine.mjs" .
  node "$engine.mjs"
done
