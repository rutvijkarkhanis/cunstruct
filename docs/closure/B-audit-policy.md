# BOQ change history: when a write must stop without it (Workstream B)

Written 17 Oct 2026. Covers every write to a BOQ line or decision, in two cases:

- **Absent**: the history table `boq_line_change_log` does not exist. That is production today, because migration `20260921000000_boq_review_apply.sql` has not been applied.
- **Insert fails**: the table exists, but the history row cannot be written (RLS, network, constraint).

Terms:

- **Fail closed**: nothing is changed, or the change is put back. The person is told why.
- **Fail open, disclosed**: the change stands, and the person is told it is not in the history.

Every write is compare-and-swap on the values the person saw, whichever policy applies. A change made elsewhere is never overwritten, and the person is told "changed elsewhere".

Evidence: Vitest with in-memory stand-ins only. No path has run against real Postgres, PostgREST or RLS.

## Decision table

| Mutation | Owner | Absent | Insert fails | Rationale |
|---|---|---|---|---|
| Quantity / unit edit (journey BOQ, builder) | B | **Fail open, disclosed**: "Change saved. Change history is not set up…" | **Fail closed**: guarded revert. If the revert fails too: "was saved, but … Check this line", and the step stays undoable. | **D1-b, decided.** Editing quantities is the core job, and production has no table, so failing closed would stop all BOQ editing. The edit also stamps `basis = MANUAL` on the line, so it never claims a drawing or review origin it no longer has. Once the table exists, there is no reason to accept an unrecorded change. |
| Description / section / included / cost edit | B | Fail open, disclosed (same message) | Fail closed (guarded revert, as above) | Same write path (`saveLineEdit`). These fields carry no provenance marker, so this is a weaker position than for quantities. It is accepted only because the table is absent everywhere, and it is disclosed on every save. |
| Undo / redo of any edit above | B | Fail open, disclosed | Fail closed (guarded revert). The step stays in place, or moves only if the database holds the change. | Guarded on the values the edit left, so a later change by someone else is never reversed. |
| Manual rate edit (builder) | B | **Fail closed**: refused (`audit_unavailable`). Nothing is written, not even a reverted write. | Fail closed (guarded revert). If the revert fails: "The rate was changed … Check this line", and the step is kept. | Unchanged from before. A rate edit replaces an adopted, evidenced rate, and the commercial amount follows from it. |
| Undo / redo of a rate edit | B | Fail closed (refused) | Fail closed | Same path as the edit. |
| **Line removal** (builder) | B | **Fail closed, new.** Refused: "Exclude the line from the total instead". Excluding is a recorded, reversible edit. | **Fail closed, new.** The line is put back with its links. If putting it back fails, the error carries the snapshot and the step is kept, so Undo can restore it. | Removal destroys the row. Without history, the only record of what was removed is one browser tab. Switch: `REMOVAL_REQUIRES_HISTORY` in `src/lib/lineRemoval.ts`. |
| Undo of a removal (restore) | B | Not reachable, because removal is refused while the table is absent | **Fail open, disclosed**: the line stays restored, with a warning that the restore is not in the history | Removing the line again would itself be an unrecorded destructive change. The `line_removed` row is re-attached to the line on restore, so the trail stays connected. |
| Add line (builder: catalogue or blank) | B | Fail open, disclosed: "Line added. Change history is not set up…" | Fail closed: the new line is taken out again ("Line not added…"). If that fails, the person is told and the step is kept. | **New.** Adding destroys nothing. The `line_created`, `qty` and `unit` rows match what Apply writes for the lines it creates. |
| Undo of an add | B | Allowed, unrecorded. It is a guarded removal with `requireHistory: false`. | Fail closed (the line is put back) | The line was created in this session and is guarded to be unchanged since, so nothing of value is destroyed. Redo restores the same row (same id). |
| Add lines from JSON (builder) | B | Not recorded | Not recorded | **Gap, not changed.** This is a bulk insert, not undoable. The lines carry their own source and basis, and nothing is destroyed. Listed as a remaining limitation. |
| Apply from review | A | Fail open, disclosed (the receipt says "change history NOT recorded") | Fail open, disclosed | Recorded here only. Apply is a multi-line, guarded batch. Workstream A owns the policy. |
| Rate adoption (`adopt_boq_line_rate`) | — | Fail closed (the adoption table is required) | Atomic (one RPC transaction) | Recorded here only. `applyAdoptedRate` in `applyFinding.ts` is not called by production code. |
| Review decisions (verify / flag / correct / pending) | A / C | Fail open, disclosed (`historyRecorded: false`) | Fail open, disclosed | Recorded here only. The decision row holds the current state. |
| DSR scope decisions (accept / reject / defer / undo) | C | Fail open, disclosed | Fail open, disclosed | Recorded here only. The decision is stored in `boq.spec` under a compare-and-swap on `updated_at`. |
| "Use schedule rate" (DSR) | C | Fail closed (`audit_unavailable`) | Fail closed (guarded revert) | Recorded here only. Consistent with manual rate edits. |

## Undo and redo rules (both editors)

- An undo or redo step is kept, or moves, **only if the database holds the change**. A change whose history failed and could not be put back keeps its step and is reported as an error, so the undo list never disagrees with the database.
- Undo and redo run one step at a time. A second Ctrl+Z while a step is still running is ignored; before this change it replayed the same step and showed a false error.
- After a successful save, the screen's copy of the line is updated at once. A quick second edit of the same line is then guarded on the values just saved, rather than refused as "changed elsewhere".

## What D1 acceptance must now include

- **D1-b**: a quantity edit writes one `qty` row with `changed_by`. Once the table exists, a failed history insert puts the value back.
- **New**: a removal writes `line_removed`, with the full row in `old_value`. Undo writes `line_restored` and re-links the `line_removed` row. An add writes `line_created`, `qty` and `unit`.
- **New**: until D1 is applied, line removal is unavailable in production. Ops must exclude lines instead. **Product sign-off is needed on this behaviour change.**
