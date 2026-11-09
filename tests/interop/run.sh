#!/usr/bin/env bash
# Runs a schema of @yaltaan/schema and rules of @yaltaan/rules in real form engines, with no bridge, the recipes of the
# reactive guide that turn a node into an Angular signal and a Vue ref, and the states of @yaltaan/form beside those of
# Angular Signal Forms and TanStack Form: the tarballs of the workspace installed into an empty project with exact
# versions of Angular, TanStack Form and Vue, then each file of this folder. About 100 MB downloaded into a temporary
# folder, removed at the end: outside the gate until the interoperability matrix enters CI.
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
npm install --no-audit --no-fund --ignore-scripts --save-exact --silent \
  @angular/common@22.2.4 @angular/compiler@22.2.4 @angular/core@22.2.4 @angular/forms@22.2.4 \
  @angular/platform-browser@22.2.4 @tanstack/form-core@1.33.5 jsdom@30.1.3 rxjs@7.8.2 vue@3.5.44 ./*.tgz
node "$root/tests/interop/recipes.mjs" "$root/docs/guide/en/reactive.md" "$root/docs/guide/fr/reactive.md"
for engine in angular tanstack reactive-angular reactive-vue form-states; do
  cp "$root/tests/interop/$engine.mjs" .
  node "$engine.mjs"
done
