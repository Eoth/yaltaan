#!/usr/bin/env bash
# Compares the instructions of one call of every performance scenario at two commits, under Callgrind. Method, options
# and exit status: the header of scripts/perf-count.ts.
#
# Usage:
#   scripts/perf-count.sh <A> <B> [variant regex]
#   scripts/perf-count.sh <A> --worktree [variant regex]
#   scripts/perf-count.sh --repeat <commit>|--worktree <runs> [variant regex]
#   scripts/perf-count.sh --clean
set -euo pipefail

# Node marks its type stripping, which the count uses on the scenarios, experimental, and says so on every run.
exec node --disable-warning=ExperimentalWarning "$(dirname "$0")/perf-count.ts" "$@"
