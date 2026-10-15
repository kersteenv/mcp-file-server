# DECISIONS

Append-only. Record each choice and the reason, so a later session does not reverse it by accident.
Format: `- [date] [session] DECISION: choice. WHY: reason.`

- [2026-10-16] [setup] DECISION: handoff files live in the workspace root as Markdown. WHY: agents can reach them with the same tools they use for everything else.
- [2026-10-16] [session-1] DECISION: one Markdown file per section under guide/, with README as the index. WHY: a later session can finish or revise one section without touching the others.
- [2026-10-16] [session-2] DECISION: reworded "spending money" to "making payments" in 03-sandboxing.md. WHY: the literal search for "pending" matched inside "spending", and a clean check is simpler to verify than explaining a false positive.
