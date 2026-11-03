#!/usr/bin/env bash
# Judges the Temporal implementations by test262: fetches a pinned Node (the native Temporal) and a pinned commit of
# test262, checks both against the sums written here, then runs scripts/test262.ts, which compares each implementation
# with its table in docs/test262/. Neither goes through npm: they never enter the lockfile. A false test is seen twice:
# a change in the fetched files fails the sum, and a witness run makes one test false and must fail the comparison.
#
# The run is skipped when nothing it reads has changed since the last green run on this machine; CI, with an empty
# cache, always runs it. Exit status: 0 same results, 1 different results or a wrong sum, 3 it could not run.
#
# Usage: scripts/test262.sh [--write | --print-node]
#   --write        rewrites the tables after a change of a pin
#   --print-node   fetches the pinned Node if needed and prints its path
set -uo pipefail

node_version=26.12.1
node_sum=6170b2d474e1c626f43cff3adc118df9fe3b573258a4fc3d850c8dbc6b079bbd
test262_commit=0b4e0812022b18236b5276d2804948fdd9f71603
test262_digest=f487918d0e880a46beee485884e4beb19979ecf0928b4c2f4805c14c74033d1c
witness=built-ins/Temporal/PlainDate/from/argument-string

cd "$(git rev-parse --show-toplevel)" || exit 1
cache=${XDG_CACHE_HOME:-$HOME/.cache}/yaltaan
test262=$cache/test262-$test262_commit

cannot_run() {
  echo "$1"
  exit 3
}

tree_digest() {
  (cd "$1" && find harness test LICENSE features.txt -type f | LC_ALL=C sort | xargs -d '\n' sha256sum | sha256sum |
    cut -d' ' -f1)
}

fetch_node() {
  local archive="node-v$node_version-linux-x64.tar.xz" work
  [ "$(uname -sm)" = "Linux x86_64" ] || cannot_run "no pinned Node for $(uname -sm)"
  work=$(mktemp -d)
  if ! curl -fsSL -m 300 -o "$work/$archive" "https://nodejs.org/dist/v$node_version/$archive"; then
    rm -rf "$work"
    cannot_run "nodejs.org cannot be reached to fetch Node $node_version"
  fi
  if ! (cd "$work" && echo "$node_sum  $archive" | sha256sum --check --strict --quiet); then
    rm -rf "$work"
    echo "error: the archive of Node $node_version does not match its pinned sum" >&2
    exit 1
  fi
  mkdir -p "$cache"
  tar -xJf "$work/$archive" -C "$cache"
  rm -rf "$work"
}

fetch_test262() {
  local partial="$test262.partial"
  rm -rf "$partial"
  mkdir -p "$partial"
  if ! curl -fsSL -m 300 "https://codeload.github.com/tc39/test262/tar.gz/$test262_commit" |
    tar -xz -C "$partial" --strip-components=1 --wildcards \
      "test262-$test262_commit/harness/*" "test262-$test262_commit/test/built-ins/Temporal/*" \
      "test262-$test262_commit/test/intl402/Temporal/*" "test262-$test262_commit/LICENSE" \
      "test262-$test262_commit/features.txt"; then
    rm -rf "$partial"
    cannot_run "github.com cannot be reached to fetch test262"
  fi
  mv "$partial" "$test262"
}

node_bin=${YALTAAN_NODE26:-$cache/node-v$node_version-linux-x64/bin/node}
[ -x "$node_bin" ] || fetch_node
[ "$("$node_bin" -v)" = "v$node_version" ] || cannot_run "$node_bin is not Node $node_version"
if [ "${1:-}" = --print-node ]; then
  echo "$node_bin"
  exit 0
fi
[ -d "$test262" ] || fetch_test262
digest=$(tree_digest "$test262")
if [ "$digest" != "$test262_digest" ]; then
  echo "error: $test262 differs from the commit it should hold (sum $digest): a test was changed; remove the folder" >&2
  exit 1
fi

run() {
  "$node_bin" scripts/test262.ts --root "$test262" --commit "$test262_commit" "$@"
}

if [ "${1:-}" = --write ]; then
  run --write
  exit
fi

stamp=$cache/test262-green
key=$(cat scripts/test262.sh scripts/test262.ts scripts/lib/test262.ts scripts/lib/test262-worker.ts \
  docs/test262/* node_modules/temporal-polyfill/global.js node_modules/temporal-polyfill/full/global.js |
  sha256sum | cut -d' ' -f1)
if [ "$(cat "$stamp" 2> /dev/null)" = "$key" ]; then
  echo "ok: test262 tables unchanged, same inputs as the last green run on this machine."
  exit 0
fi
run || exit 1

log=$(mktemp)
run --implementation native --falsify "$witness" > "$log" 2>&1
status=$?
if [ "$status" != 1 ] || ! grep -q "^+ $witness	" "$log"; then
  cat "$log"
  rm -f "$log"
  echo "error: a test made false on purpose did not fail the comparison" >&2
  exit 1
fi
rm -f "$log"
mkdir -p "$cache"
echo "$key" > "$stamp"
echo "ok: test262 gives the tables of docs/test262, and a test made false on purpose fails the comparison."
