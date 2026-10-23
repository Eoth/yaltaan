#!/usr/bin/env bash
# Runs every test file under the repository's reporter, after building every package from nothing (scripts/build.sh):
# some tests read what dist/ holds, which neither a fresh clone nor an earlier build can be trusted to hold.
#
# Usage: scripts/test.sh (or npm test)
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
bash scripts/build.sh
exec node --import ./scripts/test-env.ts --test --test-reporter=@yaltaan/testing/reporter '**/*.test.ts'
