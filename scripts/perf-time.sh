#!/usr/bin/env bash
# Times every performance scenario on this machine and prints the publication: environment, then batch, samples, loop
# floor, p50, p99, minimum, maximum, margin and bytes allocated per call of each variant. Method and options: the
# header of scripts/perf-time.ts.
#
# Usage:
#   scripts/perf-time.sh [--warmup <ms>] [--budget <ms>] [--folder <dir>] [--json] [variant regex]
set -euo pipefail

# Node marks its type stripping, which this script uses (not the timed processes), experimental, and says so on every
# run.
exec node --disable-warning=ExperimentalWarning "$(dirname "$0")/perf-time.ts" "$@"
