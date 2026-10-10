#!/usr/bin/env bash
# Compatibility entry: all standing release checks, measured and resumable.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
exec python3 tools/check.py release --tag "${1:-gate}" "${@:2}"
