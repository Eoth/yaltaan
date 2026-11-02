#!/usr/bin/env bash
# Runs a schema of @yaltaan/schema in real form engines, with no bridge: the tarballs of the workspace installed into an
# empty project with exact versions of Angular and TanStack Form, then each engine's file of this folder. About 85 MB
# downloaded into a temporary folder, removed at the end: outside the gate until the interoperability matrix enters CI.
#
# Usage: tests/interop/run.sh
set -euo pipefail

root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cd "$root"
bash scripts/build.sh >/dev/null
npm pack --workspace packages/core --workspace packages/schema --pack-destination "$work" --silent >/dev/null

cd "$work"
printf '{ "name": "yaltaan-interop", "version": "0.0.0", "private": true, "type": "module" }\n' >package.json
npm install --no-audit --no-fund --ignore-scripts --save-exact --silent \
  @angular/common@22.2.4 @angular/compiler@22.2.4 @angular/core@22.2.4 @angular/forms@22.2.4 \
  @angular/platform-browser@22.2.4 @tanstack/form-core@1.33.5 jsdom@30.1.3 rxjs@7.8.2 ./*.tgz
for engine in angular tanstack; do
  cp "$root/tests/interop/$engine.mjs" .
  node "$engine.mjs"
done
