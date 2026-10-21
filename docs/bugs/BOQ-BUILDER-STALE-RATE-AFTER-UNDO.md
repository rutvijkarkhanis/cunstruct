# BUG: BOQ builder rate input shows the undone value until reload

**Status: OPEN. Not fixed as part of the R7 + DSR production deployment (2026-10-21).**
Severity: display only. The saved data is correct; the risk is a user believing the undone rate
still applies.

## Observed (production, ZZ-TEST, 2026-10-21, during the R7 smoke test)

1. Ops BOQ builder (`/ops/projects/:id/boqs/:boqId`), line "External Door", rate empty.
2. Type `1234` in the rate box and leave it. It saves: `custom_rate` 1234, plus one
   `boq_line_change_log` row.
3. Advanced settings → Changes this session → **Undo**. The database is reverted: `custom_rate`
   null, plus a second history row.
4. The rate box still shows `1234` (screenshot taken in the session). After a page reload it shows
   empty, which is correct.

## Likely cause (from reading the code, not confirmed by a fix)

`src/pages/ops/OpsBoqBuilder.tsx` (rate `<Input>` around line 1618) is uncontrolled:
`defaultValue={rate ?? ""}` inside a row keyed by `l.id`. React does not re-apply `defaultValue`
after mount. The Undo step (`backward: () => auditedRateChange(...)`, around line 622) does not
reset the DOM input value, so the box keeps whatever was typed. The quantity and unit inputs use
the same pattern; whether they show the same symptom after Undo was **not checked**.

## Done when

After Undo or Redo of a rate edit, the rate box shows the saved value without a reload. Add a
component test in the style of `OpsBoqBuilder.editSafety.test.tsx` / `.removeUndo.test.tsx`.
