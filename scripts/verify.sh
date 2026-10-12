#!/usr/bin/env bash
# The verification gate: every check a change passes before it is committed and pushed. The pre-push hook and the
# CI "verify" job run this same script, so a green run here is the verdict CI will give on the same tree.
#
# Every step runs even after an earlier one failed (no `set -e`): a run expected to fail at one step must not hide a
# second failing step. The summary lists each failed step once. A tool that is missing is reported as skipped, never
# taken as a pass.
#
# Usage: bash scripts/verify.sh
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1
failures=()
skipped=()
current=""

step() {
  current="$1"
  echo
  echo "== $1 =="
}
failed() {
  [[ " ${failures[*]-} " == *" $current "* ]] || failures+=("$current")
}
skip() {
  echo "skipped: $1"
  skipped+=("$current: $1")
}

step "node and npm"
node_version=$(node -p 'process.versions.node' 2> /dev/null) || node_version=""
if [ -z "$node_version" ]; then
  echo "node is not installed"
  failed
elif ! node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  process.exit(major > 22 || (major === 22 && minor >= 18) ? 0 : 1);'; then
  # 22.18 is the first Node 22 that runs TypeScript files without a flag or a warning.
  echo "node $node_version is older than 22.18"
  failed
else
  echo "node $node_version, npm $(npm --version)"
fi

step "dependencies installed as locked"
if [ ! -d node_modules ]; then
  echo "node_modules is missing: run npm ci"
  failed
elif ! npm ls --all > /dev/null; then
  echo "the installed tree differs from package-lock.json: run npm ci"
  failed
else
  echo "ok: installed tree matches package-lock.json"
fi

step "internal references"
bash scripts/check-no-internal-doc-refs.sh || failed

step "commit messages not yet pushed"
# Hooks can be bypassed and history can be replayed; the messages that will be pushed are judged again here.
if upstream=$(git rev-parse -q --verify '@{upstream}' 2> /dev/null); then
  range="$upstream..HEAD"
else
  range="HEAD"
fi
message_file=$(mktemp)
bad_messages=0
for sha in $(git rev-list "$range" 2> /dev/null); do
  git log -1 --format=%B "$sha" > "$message_file"
  if ! bash scripts/check-commit-message.sh "$message_file" 2> /dev/null; then
    echo "$(git rev-parse --short "$sha") $(git log -1 --format=%s "$sha")"
    bash scripts/check-commit-message.sh "$message_file" 2>&1 | sed 's/^/    /'
    bad_messages=1
  fi
done
rm -f "$message_file"
if [ "$bad_messages" = 0 ]; then echo "ok: every message in $range follows the rules"; else failed; fi

step "text format"
bash scripts/check-text-format.sh || failed

step "comment hygiene"
bash scripts/check-comment-hygiene.sh || failed

step "file size"
bash scripts/check-file-size.sh || failed

step "roadmap tickets"
bash scripts/check-roadmap-tickets.sh || failed

step "executable scripts"
bash scripts/check-executable-scripts.sh || failed

step "package manifests"
node scripts/check-manifests.ts || failed

step "lockfile: sources, integrity, licences, install scripts"
node scripts/check-lockfile.ts || failed

step "format"
npx --no-install prettier --check . || failed

step "types"
npx --no-install tsc -b && echo "ok: types check" || failed

step "tests"
# The runner's summary is read, not only its exit code: a run that finds no test file exits 0 and reports nothing.
test_log=$(mktemp)
npm test > "$test_log" 2>&1
test_status=$?
grep -E '^ℹ (tests|pass|fail|cancelled|skipped|todo) ' "$test_log"
tests=$(sed -n 's/^ℹ tests \([0-9]*\)$/\1/p' "$test_log")
fails=$(sed -n 's/^ℹ fail \([0-9]*\)$/\1/p' "$test_log")
cancelled=$(sed -n 's/^ℹ cancelled \([0-9]*\)$/\1/p' "$test_log")
if [ "$test_status" != 0 ] || [ "${tests:-0}" -eq 0 ] || [ "${fails:-1}" != 0 ] || [ "${cancelled:-1}" != 0 ]; then
  grep -E -A20 '^✖ failing tests:' "$test_log" | head -60
  [ "${tests:-0}" -eq 0 ] && echo "no test ran"
  failed
fi
rm -f "$test_log"

step "build"
built=0
for config in packages/*/tsconfig.build.json; do
  [ -f "$config" ] || continue
  built=$((built + 1))
  npx --no-install tsc -b "$config" || failed
done
[ "$built" = 0 ] && echo "ok (not applicable: no package has sources yet)"

step "import sizes"
# After the build: the library's scenarios bundle what the packages publish.
node scripts/size-report.ts || failed

step "package contents"
node scripts/check-package-contents.ts || failed

step "audit"
# Both commands ask the registry. Without network the step is reported skipped, never passed; CI runs it online.
audit_log=$(mktemp)
if npm audit --audit-level=low > "$audit_log" 2>&1; then
  tail -n 1 "$audit_log"
  if npm audit signatures > "$audit_log" 2>&1; then
    grep -E 'verified|attestation' "$audit_log" | head -3
  else
    cat "$audit_log"
    failed
  fi
elif grep -q -E 'ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network' "$audit_log"; then
  skip "the registry cannot be reached"
else
  cat "$audit_log"
  failed
fi
rm -f "$audit_log"

step "workflows"
actionlint_bin=${ACTIONLINT:-$(command -v actionlint 2> /dev/null || true)}
if [ -z "$actionlint_bin" ]; then
  skip "actionlint is not installed (set ACTIONLINT=<path>)"
elif "$actionlint_bin" -shellcheck= .github/workflows/*.yml; then
  echo "ok: workflows pass actionlint"
else
  failed
fi

echo
if [ "${#skipped[@]}" -gt 0 ]; then
  echo "SKIPPED, ${#skipped[@]} check(s):"
  printf '  %s\n' "${skipped[@]}"
fi
if [ "${#failures[@]}" -eq 0 ]; then
  echo "OK"
  exit 0
fi
echo "FAILED, ${#failures[@]} step(s):"
printf '  %s\n' "${failures[@]}"
exit 1
