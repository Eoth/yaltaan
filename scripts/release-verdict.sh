#!/usr/bin/env bash
# Decides what the jobs after the release check do (ADR 0029), from the event that started the workflow and the
# release.json the check wrote, and prints their inputs in the format of $GITHUB_OUTPUT:
#   publish=true   only for a tag pushed (GITHUB_EVENT_NAME=push, GITHUB_REF_TYPE=tag) whose release.json says it is
#                  no rehearsal; a manual run started from a tag, a pull request, a push to a branch, a release.json
#                  that cannot be read or says anything else: false;
#   dist-tag, prerelease  from release.json;
#   sums           the SHA512SUMS of the release folder, which the next jobs check the downloaded files against.
#
# Usage: GITHUB_EVENT_NAME=<event> GITHUB_REF_TYPE=<tag|branch> scripts/release-verdict.sh <release folder>
set -euo pipefail

[ "$#" = 1 ] || {
  echo "usage: $0 <release folder>" >&2
  exit 2
}
folder=$1
# Read strictly: only the boolean false is no rehearsal (the string "false" is not), and only the two dist-tags the
# release writes are taken; anything else fails here, and the jobs after it do not run.
# shellcheck disable=SC2016 # the backquotes and ${} are JavaScript's, inside single quotes on purpose
fields=$(node -e '
  const description = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (!["latest", "next"].includes(description.distTag)) {
    throw new Error(`release.json gives the dist-tag ${JSON.stringify(description.distTag)}`);
  }
  process.stdout.write(`${description.rehearsal === false ? "release" : "rehearsal"} ${description.distTag}`);
' "$folder/release.json")
kind=${fields% *}
dist_tag=${fields#* }

publish=false
if [ "${GITHUB_EVENT_NAME:-}" = push ] && [ "${GITHUB_REF_TYPE:-}" = tag ] && [ "$kind" = release ]; then
  publish=true
fi
prerelease=true
if [ "$dist_tag" = latest ]; then
  prerelease=false
fi
echo "publish=$publish"
echo "dist-tag=$dist_tag"
echo "prerelease=$prerelease"
echo "sums<<END_OF_SUMS"
cat "$folder/SHA512SUMS"
echo "END_OF_SUMS"
