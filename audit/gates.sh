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
# M675: the device guards its own library (device_guard: serve.py alone), the browser and the device together
# (device_pair: nineteen scenes, one of them waits three minutes), a host that is not the tavern's (static_host) and the
# stored-page repair's hold of the screen (perf_repair) are standing gates too; and that the tale left open is opened
# when the app starts, like any other (boot_open).
# M676: the word he types, run as he runs it (launcher: install.sh, updates, a folder that is not a usual one, the words
# on phones today) and his update end to end — the release before, used, updated by the word, the same browser and its
# service worker (upgrade_in_place). Both light the tavern on the word's own port, 8080.
for t in perf_send holdsone cutthinking notes_layout backup backupdupes restore_backup_unit restore_zip backup_fresh backup_sent rowtap device_guard static_host device_pair perf_repair boot_open launcher upgrade_in_place; do s=$(date +%s); timeout 1200 python3 -B tests/$t.py > /tmp/gates/${TAG}_$t.log 2>&1; echo "$t EXIT $? ($(( $(date +%s)-s ))s)" >> /tmp/gates/${TAG}_browser.log; done
echo ALLDONE > /tmp/gates/${TAG}_done
