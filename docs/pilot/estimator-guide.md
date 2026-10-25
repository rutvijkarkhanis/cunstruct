# Pilot estimator guide — one real drawing to a contractor-ready working estimate

**For:** a Cunstruct staff estimator (an `ops` or `admin` account) using the workbench on the staging preview.
**Produces:** a priced **working estimate** (PDF and CSV) that a contractor reviews.

**Not supported in this pilot.** Do not promise any of these to a contractor:
- formal issue or sign-off;
- approvals;
- contractor accounts;
- post-issue variations;
- a frozen issued revision. Freezing needs database functions that production does not have. In the workbench it reports "not set up", unless staging was given them for testing.

Every export says "working estimate, not frozen". The BOQ status **Finalized** is internal only: it freezes nothing.

## 1. Choose the project and drawings

- Pick a real, current private project, such as an interior fit-out, retail or residential job, with a **PDF** plan whose scale and revision you can name.
- Use one drawing per trial at first. Prefer a drawing where at least one quantity is genuinely uncertain, so the uncertain-item path gets used.
- Record outside the app, in a trial log: project, client, drawing file name, revision and date, who supplied it, and its SHA-256. Commands for the SHA-256:

  | System | Command |
  |---|---|
  | Linux | `sha256sum plan.pdf` |
  | macOS | `shasum -a 256 plan.pdf` |
  | Windows PowerShell | `Get-FileHash plan.pdf -Algorithm SHA256` |
- Never edit the drawing to make it "fit". If it is unclear, that is a finding to record.

## 2. Set up

1. **Ops console → Projects → Onboard project.** Give it a real name and client. "Create & build BOQ" also works; a project cannot be saved without a name.
2. **Projects → the project → open it in the workbench** at `/app/projects/<id>/workbench`.
3. **Drawings → Upload or manage**, and upload the PDF.
4. **Ops console → the project → Workspace → Analyze Project.** Opening it computes the drawing's fingerprint on the server and runs **no AI**. Do this once after every upload. Without it, an imported take-off cannot be tied to the drawing and **Apply will stay blocked**.
5. **New BOQ.** Name the work package, for example "Shop floor – civil & finishes". Use one BOQ per package. The project can hold several.

## 3. Load the take-off for review (no AI)

1. Write the take-off as Cunstruct analysis JSON. `docs/samples/staging-analysis-sample.json` shows the shape.
   - Each item has a key, name, unit, `quantity` (or `null` when not known), `status` (`MEASURED`, `INFERRED` or `PENDING`) and `source` (drawing name and page).
   - Add at the top level `"source_drawing": { "sha256": "<the SHA-256 from §1>", "filename": "<file name>", "extractor": "<your name>" }`.
2. **Keys group the review list by drawing-mark prefix:** C = Columns, S = Slabs, F = Footings, W, D, B, P likewise. For fit-out items use keys that do not start with those letters, such as `FC-1` for a false ceiling or `FL-1` for flooring. Items without such a prefix are grouped by name ("tile", "plaster" and so on → Finishes), otherwise under Other.
3. **Review → paste → Validate & load for review.** Loading changes no BOQ line.
   - "Not imported: … fingerprint has not been computed yet": do §2.4, then load again.
   - "Apply is blocked … no record of which revision": the JSON lacks `source_drawing`. Add it and load again.

## 4. Check quantities before applying

For each item, open it, look at the drawing (and **Details** for the stated source page), then decide:

- **Verify** only when you can see the quantity on the drawing.
- **Edit → Save correction** when the drawing says otherwise. The original value is kept beside your correction.
- **Flag** (with a reason) or **Mark Pending** when it cannot be settled from the drawing. Flagged and pending items are **never** applied, and every export states them as not in the BOQ.
- **Never invent a quantity to clear a flag.** Leave it pending and record why in the trial log.

**Apply to BOQ** shows exactly what will be added or changed. Check it, then apply. Afterwards, on the BOQ:
- an applied line's basis reads "… verified in review" or "… corrected in review";
- **History** on the line shows "Applied from drawing review".

## 5. Build out the BOQ

- **Add line** for scope the take-off missed. Give it a description and unit.
  - Leave the quantity empty if it is unknown: the line is "Pending", never 0.
  - **Pick from DSR 2023…** is optional. Private-project items need no code.
- Lines you type in show the basis "Changed manually". That wording is shared with a deployed component and is unchanged for now. Note in the log which lines you entered.
- **Exclude** instead of removing when in doubt. Excluded lines appear in no export and no total.

## 6. Rates and commercial assumptions

- Enter **own rates** in the BOQ's Rate column. Each entry is recorded and can be undone.
- A line without a rate is shown as "No rate" and is **not** costed at zero.
- **Export → Commercials:** contingency, overhead & profit, labour cess and GST percentages; firm name and tagline.
  - The defaults are CPWD-style. Set each one the contractor's terms require.
  - Overhead, cess and GST are added only on own-rate lines, because DSR rates already include them.
- Write every commercial assumption into the trial log: why each percentage, and the source of each rate.

## 7. Resolve blockers

- **Overview** shows the next step.
- **Check** lists every open item by name, each with a link that opens the exact field or review item:
  - **Enter quantity** for lines waiting for a quantity;
  - **Enter rate** for lines without a rate;
  - **Open in review** for review items not in the BOQ (flagged, pending or undecided).
- A flagged item may legitimately stay open. The documents then say so.

## 8. Export and check the deliverable

**Export** shows the pre-issue summary: priced, pending, no-rate and excluded counts, cost of works, and the grand total, marked "currently priced scope only" while anything is open. Then:

1. **Download Excel (CSV)** and **PDF (priced)**. "PDF — specs & quantities" leaves the rates blank.
2. Check by hand, every time:
   - [ ] each line's description, unit, quantity and rate match the BOQ screen;
   - [ ] the quantity basis column says where each quantity came from;
   - [ ] the screen grand total = the CSV "Grand total" line = the PDF grand total;
   - [ ] unpriced lines are blank (never ₹0), and a sub-head with unpriced lines says "+ N to be priced";
   - [ ] pending items appear in the pending section; flagged or undecided review items are stated as not in the BOQ;
   - [ ] both files say "working estimate, not frozen".
3. Any mismatch is a **defect**. Log it (§9) and do not send the files.

## 9. Record defects without changing the evidence

Log each one with:
- date, project, BOQ and line;
- what you did, what you expected, what happened;
- a screenshot, and the exported file if relevant.

Do not alter the drawing, the imported JSON or the review decisions to hide a defect. Correct quantities only through Edit → Save correction (kept beside the original) or the BOQ editors (recorded in History).

## 10. Hand over

- Send the PDF and CSV with `docs/pilot/contractor-review-sheet.md`.
- State plainly that this is a **working estimate**: unvalidated, not issued or frozen, with open items listed in the documents.
- Record the contractor's answers in the trial log. Do not enter them into the BOQ until you have checked each one against the drawing.
