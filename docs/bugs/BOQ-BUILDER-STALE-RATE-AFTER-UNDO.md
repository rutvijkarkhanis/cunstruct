# BUG: BOQ builder rate input shows the undone value until reload

**Status: FIXED IN CODE, merged to `main` via [PR #201](https://github.com/rutvijkarkhanis/cunstruct/pull/201) (2026-10-21), separately from the R7 + DSR deployment. Verified by jsdom component tests only, not in a real browser. Production rollout follows the `main` → Vercel deploy; see the deployment log.**
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

## Root cause (confirmed 2026-10-21) and fix

Confirmed with a failing component test before the fix. It is broader than the field "keeping what
was typed". React writes `defaultValue` into the input's `value` once, on mount, which marks the
field as edited. After that, a new `defaultValue` changes the attribute but never what is shown,
whether or not the user typed. So no change to the saved rate (Undo, Redo, a re-read) ever reached
the field. A related path: when a re-read landed while the user was typing, leaving the field
guarded the write on the newly read rate, so the typed value silently overwrote the other change.

Fix (`src/pages/ops/OpsBoqBuilder.tsx`, `SavedValueInput`, used for the rate field only):

- The field shows the saved rate again whenever it changes, except while the field has focus or
  holds typed text.
- Leaving the field without typing writes nothing and shows the current saved rate.
- A typed rate is committed together with the rate it was typed over. If that rate changed in the
  meantime, nothing is written and the existing "changed elsewhere" message is shown.

Regression tests in `src/pages/ops/OpsBoqBuilder.rateEdit.test.tsx` cover: rate edit → Undo; rate
edit → Undo → Redo; a re-read bringing a new saved rate; a re-read during typing (not overwritten,
not saved over the newer rate); and leaving without typing (no write).

**Not changed:** the quantity, unit, description and cost inputs use the same uncontrolled
pattern. They were not checked or changed under B1.
