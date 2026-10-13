# The documents

Current references, read when the task touches them:

- WORKFLOW.md: the commands for every check, what each can see, handoff and publishing.
- LEDGER_PIPELINE.md: who owns what in the ledger pipeline (readers, World, People, the
  final auditor). AGENTS.md asks for it before any broad ledger repair.

Milestone reports, history only. They explain why the ledger and auditor are built as
they are; where one disagrees with AGENTS.md or the code, AGENTS.md and the code win.
Laws in tests/ cite some of them by path, so they stay where they are.

| File | Milestone |
|---|---|
| LEDGER-AUDIT-M684.md | M684 ledger audit |
| LEDGER-AUDIT-M685.md | M685 recovery across the four rooms |
| AUTONOMOUS-RECOVERY-M686.md | M686 autonomous ledger recovery |
| AUDITOR-SCENE-REPAIR-M687.md | M687 the auditor finishes scene repairs |
| WORKER-CONTEXT-M687.md | M687 review of the workers' context |
| AUDITOR-EVIDENCE-CONTRACT-M688.md | M688 evidence through the repair path |
| LEDGER-PIPELINE-M689.md | M689 pipeline review (the owner agreed: scene judgments move to the final reviewer) |
| LEDGER_SYSTEM_AUDIT_M713.md | M713 ledger system audit |
| LEDGER_FOUNDATION_M714.md | M714 foundation repairs |
| M719.md | M719 evidence based identity, durable character lifecycle |
| M737_CONTEXT_REPORT.md | M737 context selection |
| M738_CORRECTION_REPORT.md | M738 knowledge correction |
| M743_REPAIR_REPORT.md | M743 source facts and Essentials (Essentials retired in M750) |
| M744_REPAIR_REPORT.md | M744 Essentials (retired in M750) |
| M745_REPAIR_REPORT.md | M745 source repair before Essentials (retired in M750) |

archive/ holds earlier versions of the agent documents, verbatim: the instructions,
handoffs, specs and workflow as they stood before M683, before M689 and before the
M752 tidy, and the old gate script. `python3 tools/context.py "M731" --in handoff`
searches the archived handoffs.
