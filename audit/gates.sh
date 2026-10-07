#!/usr/bin/env bash
# Cozy Tavern — every gate, in order, logs under /tmp/gates/<tag>_*.  Usage: bash audit/gates.sh m607
# Run it detached (setsid bash audit/gates.sh m607 &) and poll the logs: one tool call must stay under 300 s, and a call
# that times out kills what it started. The whole run takes ~13-15 minutes on 2+ CPUs.
TAG="${1:-gate}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p /tmp/gates && rm -f /tmp/gates/${TAG}_*
cd "$REPO" && node tests/harness/run.mjs > /tmp/gates/${TAG}_harness.log 2>&1; echo "EXIT $?" >> /tmp/gates/${TAG}_harness.log
cd "$REPO/tests/dom" && node run.mjs > /tmp/gates/${TAG}_walk.log 2>&1; echo "EXIT $?" >> /tmp/gates/${TAG}_walk.log
node longplay.mjs > /tmp/gates/${TAG}_long.log 2>&1; echo "EXIT $?" >> /tmp/gates/${TAG}_long.log
cd "$REPO" && bash tests/audit_lint.sh > /tmp/gates/${TAG}_lint.log 2>&1; echo "EXIT $?" >> /tmp/gates/${TAG}_lint.log
# M670: the backup's promise (a copy brought back is the library it was taken from) is a standing gate — the five tests
# below run against the real serve.py; four of them existed and were run only at their own milestones.
for t in perf_send holdsone cutthinking notes_layout backup backupdupes restore_backup_unit restore_zip backup_fresh backup_sent; do s=$(date +%s); timeout 600 python3 tests/$t.py > /tmp/gates/${TAG}_$t.log 2>&1; echo "$t EXIT $? ($(( $(date +%s)-s ))s)" >> /tmp/gates/${TAG}_browser.log; done
echo ALLDONE > /tmp/gates/${TAG}_done
