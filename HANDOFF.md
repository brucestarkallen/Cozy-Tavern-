# Cozy Tavern: current handoff

## Current release: m686-001

The owner expects a plug and play frontend: detected ledger faults are repaired by
the app, with no Audit button required to start or continue recovery. M686 closes
the idle recovery gap left by M685. See docs/AUTONOMOUS-RECOVERY-M686.md and the
section by section prior audit in docs/LEDGER-AUDIT-M685.md. SPEC.md holds the contract.

Application checkpoint: 50f1289. Test fixture checkpoint: a3d55bf. Subsequent release
notes change no execution inputs. Exact results are in audit/results/m686.json.

## What changed

* js/ui/chat.js schedules full original source recovery when an existing story is
  opened and continues incomplete audits while idle. Completed source work is kept.
  It resumes from saved coverage and findings on reopen. There is no terminal retry
  count. A progressing pass resumes after fifteen seconds; unsuccessful passes wait
  one, two, four, then at most five minutes. The configured model remains in use.
* The job runs through the existing reader queue and cancellation mechanism. A new
  story turn interrupts idle recovery. Current source checks, story switches, other
  browsers, replays, explicit Stop, disabled agents and stopped partial pages retain
  their guards. Completion stops the loop. Owed world work follows the audit; a
  disabled world worker does not create an impossible task. Recovered world status
  is updated. An incomplete audit cannot produce the completion light.
* js/ui/drawer.js describes automatic continuation. An auditor row no longer offers
  Finish it, including old saved rows with a resume action. Earlier ledger repair,
  source recovery, identity preservation and simulation rules remain in place.

## Verification

Full harness 1499/1499, walkthrough 304/304, long play 9/9, lint zero errors.
All 33 release checks have qualifying passing results. This was not one all-green
invocation: m686a passed 31/33. One source-spelling assertion expected the old button
condition; the live drawer is covered by DOM-M686-6. Five older walkthrough fixtures
expected a completed ledger without its source coverage or their mock characters'
identities. Their initial data now makes that premise true; all behavioral assertions
remain. DOM-53 also explicitly enables its own keeper. Only tests changed after
m686a. The full harness, walkthrough and lint passed again in m686b. The app and all
browser/performance inputs were unchanged; no timing budget was relaxed.

Seven new app scenarios pass. Four fail on published M685; the other three preserve
Stop, disabled audit and stopped-page behavior. They cover initial recovery without
input, continuation beyond three attempts, completion stopping the loop, a temporary
provider outage, yielding to an actual send, and no manual Finish it action. The fast
profile passed six checks in 26.79 seconds. Tests use scripted providers and disposable
stories. No paid story model calls or phone ledger data were used.

## Continuity and next session

Claude's M680 (4a19de3), M681 (8880a0), final fixes f087472/63f87, M683 (71b22e8),
M684 (613c174) and M685 (8e3c46d) remain ancestors. HISTORY is append only and the
original instruction archives remain intact. Canon Verification remains v0.68.3 /
5aed234; do not replace the vendor copy without reconciling its Cozy changes.

After updating, opening an existing story starts recovery automatically. The older
M685 instruction to press Audit once is superseded. No user's phone was accessed,
and this release does not claim that a specific live story has already been repaired.

Read AGENTS.md and this handoff once. Use tools/context.py for relevant history.
Use fast checks during editing and release checks on a stable candidate; preserve
failed results. This environment's launcher/upgrade checks need
PATH=/tmp/cozy-work-test-bin:$PATH. Do not repeat gates for documentation-only edits.
