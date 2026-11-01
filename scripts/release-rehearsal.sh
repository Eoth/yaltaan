#!/usr/bin/env bash
# Rehearses a release from end to end and publishes nothing (ADR 0029). The repository is cloned into a temporary
# folder; there, the release commit of a test version is prepared (scripts/release-prepare.ts), checked against the
# manifest and lockfile rules, committed and tagged; every check of a release runs on that tag
# (scripts/release.ts --rehearsal); last, npm says what it would publish (npm publish --dry-run, which asks the
# registry for the versions already published). The repository itself is left untouched.
#
# Usage: scripts/release-rehearsal.sh [--working-tree] [--out <folder>]
#   --working-tree  rehearses the working tree, uncommitted changes and untracked files included (the gate does, so
#                   that it judges what the next commit holds); by default, the committed HEAD alone.
#   --out           keeps the tarballs, SBOMs, sums and notes in <folder>; by default they go with the clone.
set -euo pipefail

usage() {
  echo "usage: $0 [--working-tree] [--out <folder>]" >&2
  exit 2
}
out=""
working_tree=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --working-tree) working_tree=true ;;
    --out)
      [ -n "${2:-}" ] || usage
      mkdir -p "$2"
      out=$(cd "$2" && pwd)
      shift
      ;;
    *) usage ;;
  esac
  shift
done

root=$(git rev-parse --show-toplevel)
work=$(mktemp -d "${TMPDIR:-/tmp}/yaltaan-rehearsal-XXXXXX")
trap 'rm -rf "$work"' EXIT
[ -n "$out" ] || out="$work/out"
identity=(-c user.name="Release rehearsal" -c user.email="rehearsal@example.invalid")

git clone --quiet "$root" "$work/repo"
cd "$work/repo"
# The provenance and the manifests name the repository on GitHub, not the folder the clone came from.
if origin=$(git -C "$root" remote get-url origin 2> /dev/null); then
  git remote set-url origin "$origin"
fi
if [ "$working_tree" = true ]; then
  # Every file git does not ignore, as it is now; a tracked file deleted from the working tree is deleted here too.
  git -C "$root" ls-files -z --deleted | xargs -0 -r rm -f --
  (
    cd "$root"
    git ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' file; do
      if [ -e "$file" ]; then
        printf '%s\0' "$file"
      fi
    done | tar --null -cf - -T -
  ) | tar -xf -
  git add --all
  if [ -n "$(git status --porcelain)" ]; then
    git "${identity[@]}" commit --quiet --message "Working tree of the rehearsed repository"
  fi
fi
# The clone builds and checks with the dependencies installed in the repository. The link is no folder, so the
# "node_modules/" line of .gitignore does not cover it: excluded here, it leaves the working tree clean.
ln -s "$root/node_modules" node_modules
echo node_modules >> .git/info/exclude

version=$(node scripts/release-prepare.ts --rehearsal | tail -n 1)
node scripts/check-manifests.ts
node scripts/check-lockfile.ts
git "${identity[@]}" commit --quiet --all --message "chore(release): $version"
git "${identity[@]}" tag --annotate "v$version" --message "v$version"

node scripts/release.ts --tag "v$version" --out "$out" --rehearsal

dist_tag=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).distTag" "$out/release.json")
for tarball in "$out"/*.tgz; do
  npm publish --dry-run --tag "$dist_tag" "$tarball"
done
echo "ok: rehearsal of v$version passed; nothing was published"
