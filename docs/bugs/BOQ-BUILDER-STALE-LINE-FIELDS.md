# BUG B2: BOQ builder quantity, unit, description and cost fields go stale

**Status: FIXED IN CODE, merged to `main` via [PR #202](https://github.com/rutvijkarkhanis/cunstruct/pull/202)
(2026-10-21), after the B1 fix. Verified by jsdom component tests only, not in a real browser.
Production rollout follows the `main` → Vercel deploy; see the deployment log.**
Found while following up B1 ([BOQ-BUILDER-STALE-RATE-AFTER-UNDO.md](BOQ-BUILDER-STALE-RATE-AFTER-UNDO.md)).

## Confirmed defects (each reproduced by a failing test before the fix)

`src/pages/ops/OpsBoqBuilder.tsx` rendered these fields as uncontrolled
`<Input defaultValue=…>`, the same pattern as B1:

| Field | Undo / Redo | Re-read brings a newer value | Re-read lands while typing |
|---|---|---|---|
| Quantity | old text kept | old text kept | typed value **saved over** the newer value |
| Unit | old text kept | old text kept | typed value **saved over** the newer value |
| Description | old text kept | old text kept | typed value **saved over** the newer value |
| Cost (Make view) | old text kept | shown correctly* | typed value **saved over** the newer value |

\* The cost field is mounted when the Make view opens, so it picks up a value that was already
re-read. Its Undo/Redo and mid-edit failures were still real.

The overwrite comes from `updateLine` / `saveLineEdit` guarding on the line as rendered when the
field is left, which is already the re-read line. The write is recorded in history (for example
`qty 50 → 45`), but the user typed over a value they never saw.

## Fix

The four fields now use `SavedValueInput`, the B1 component. The check "the saved value changed
while this was being typed" moved into that component, through its `conflictMessage` prop, so
the rate field and these fields behave the same way:

- After Undo, Redo or a re-read, the field shows the saved value, unless it has focus or holds
  typed text.
- Leaving the field without typing writes nothing.
- A typed value whose saved value changed meanwhile is not written. The field shows the saved
  value and reports "Change not saved: this line was changed elsewhere since it was loaded. The
  current values are now shown."

Tests: `src/pages/ops/OpsBoqBuilder.fieldSync.test.tsx`, 5 cases × 4 fields. 18 failed and 2 passed
before the fix; 20/20 pass after.

## Not investigated

Same uncontrolled pattern, not tested or changed here:
- the line's **Trade** field
- the Advanced settings commercials inputs
- the firm name and tagline inputs
