# Cunstruct — UX/UI Audit and Evidence-Based Product Rating

**Branch:** `feat/app-journey` · **Audit date:** 16 Oct 2026 · **Auditor:** Claude Code (automated + scripted browser evaluation)

This audit rates Cunstruct as a contractor-facing construction BOQ system, where quantities, drawing evidence, review decisions, rates and revisions affect real project work. It was carried out on the real application, signed in as the ops test account, against the configured Supabase project. It is an expert evaluation, not user research: **no contractors were observed or interviewed**, and scores are the evaluator's judgement against the cited benchmarks, backed by the evidence listed.

### Method and safeguards

- **App:** `npm run dev` with `VITE_IS_APP_SUBDOMAIN=true` at `http://127.0.0.1:8080`, driven by Playwright (Chromium 1194). The data is real, from the project's Supabase database.
- **Write protection:** every database write from the browser was intercepted and aborted: REST/RPC calls other than GET/HEAD/OPTIONS, and edge-function POSTs. Each attempt was logged. Only sign-in/sign-out and read-only storage URL signing were allowed through. No record was modified. Save, decision and Apply paths were therefore exercised up to the write, and their failure handling observed. Successful writes were verified only in unit/integration tests and in an earlier stubbed-database walkthrough, and are marked as such below.
- **Test data:** mainly the test project **"ZZ-TEST cunstruct e2e 20261014"** (2 drawings, 1 BOQ of 18 lines, a review run of 79 items with 62 unreviewed). Read-only checks also ran on the real project **"Srikakulam Apartment"** (28 drawings, 10 BOQs) and on 9 empty projects.
- **Widths:** 1280 px (desktop), 768 px (tablet) and 390 px (phone).
- **Accessibility tooling:** axe-core 4.10.2 (WCAG 2A/2AA/2.1AA plus best-practice rules) and a scripted keyboard pass. Automated scans find only a subset of WCAG failures, so **no WCAG conformance is claimed**.
- **Known gap in the brief:** the "nine known UX issues" referred to in the brief were not provided to this session and do not exist in the repository. They could not be assessed one by one. Every issue found is listed in the registers below. Please supply the list and it will be mapped onto these findings.

---

## 1. Executive assessment

The new step-by-step project journey (**Projects → Overview → Drawings → BOQ → Export & History**) is coherent, honest about incompleteness, and clean in automated accessibility checks at all three widths. The surrounding product is less consistent:
- The BOQ builder, the drawing workspace and the Review workstation are a separate, denser "Ops console" UI with different editing patterns.
- Sign-in lands staff on a procurement-forecasting dashboard that has nothing to do with BOQ work.
- Tracing a quantity to its drawing opens the right page but never shows *what* on the page was counted or measured.

The audit found and fixed a set of defects that undermined quantity trust or recovery:
- Staff were routed to the contractor home after signing in.
- The builder sent negative quantities for saving.
- Failed or refused saves kept the unsaved value on screen.
- A failed load looked like an empty BOQ.
- Client exports printed an internal section name.
- The viewer stated a wrong page count while loading.
- Core editing controls had no accessible names.

The product is usable by a trained internal operator today. A contractor working alone would still struggle to *explain and defend* a quantity from inside the product, which is the job it exists to support.

## 2. Weighted score

**55 / 100**, after the fixes in this audit (estimated **≈ 47** before them). The figure is the evaluator's judgement from the evidence below, not a measured outcome.

| # | Dimension | Weight | Score /10 | Weighted |
|---|---|---|---|---|
| 1 | Quantity trust, evidence and traceability | 20% | 5 | 10.0 |
| 2 | Workflow clarity and task completion | 15% | 5 | 7.5 |
| 3 | Error prevention, editing and recovery | 15% | 6 | 9.0 |
| 4 | Status visibility, review and change history | 15% | 6 | 9.0 |
| 5 | Navigation and information architecture | 10% | 5 | 5.0 |
| 6 | Efficiency for experienced contractors | 10% | 5 | 5.0 |
| 7 | Accessibility and responsive usability | 10% | 6 | 6.0 |
| 8 | Visual hierarchy and consistency | 5% | 6 | 3.0 |
| | **Total** | 100% | | **54.5 → 55** |

## 3. Eight-dimension scorecard

### 3.1 Quantity trust, evidence and traceability — 5/10

**Observed**
- Every BOQ line in the journey shows a status ("Quantity pending", "No rate", "Complete", "Excluded") using the builder's own pending rule (`lib/boqRevision.qtyPending`).
- An amber banner states exactly what the priced subtotal leaves out: on ZZ-TEST, "18 lines have no rate"; on Srikakulam, "4 lines have a pending quantity and 5 lines have no rate".
- Lines with a source link to the drawing at the cited page. "Fire Sprinkler Heads — 23 nos — p.4" opened `/drawings?document=…&page=4` showing "Sheet 4 of 4".
- Exports state "Incomplete scope. 62 drawing-review items are still pending or flagged and are not included in this BOQ", and carry Source Document and Source Page columns.

**Gaps against the benchmark**
- Tracing stops at the page. The viewer then says "Select an Evidence link to inspect the drawing source", and nothing on the sheet shows which door or which area produced "23 nos". Bluebeam's takeoff model ties each quantity to a markup *on the drawing* that can be selected, listed and summarised (Markups List). Cunstruct's Review workstation does draw evidence boxes, but they are not reachable from a BOQ line.
- The journey table has no basis column: measured, counted, AI-extracted, entered by hand. On the real Srikakulam BOQ (9 lines) none of the lines carries a source. "Glass railing 4 nos" has no indication of where 4 came from.
- No scale or calibration concept is shown anywhere. Measured quantities (m², kg) have no visible measurement provenance.
- The review run contains noise items such as "SD-AR-101:TABLE:8032,216 · Ruled table" in "Other (59)". That is an extraction-quality issue, but the reviewer must still triage each one.
- The builder's 4.5 rem quantity inputs truncate values ("94.4…", "83.3…"; screenshot `c-d-ops-boq-builder`).

**To reach 7:** a BOQ line opens the drawing with the evidence region highlighted, and the table shows each line's basis.

### 3.2 Workflow clarity and task completion — 5/10

**Observed**
- The journey's numbered steps and its single "Next step" card point the right way. On ZZ-TEST it says "62 drawing review items are not finished. Apply stays blocked until review is complete" and links to Review.
- Review and Apply live outside the journey, in the Ops console (`/ops/projects/:id/boqs/:boqId/review`). The user leaves the journey's header and tabs mid-task, and the only way back is the browser or the review page's back arrow.
- After sign-in, staff land on "Operations Overview" (procurement KPIs: "Proactive Order Rate 0%"), not on their projects.
- The bare root `/` sends staff to the contractor home (`/my-projects`).

**Unverified:** the end-to-end tasks of editing, applying and freezing could not be completed against the real database, because writes were blocked by design. They are covered by tests only.

**To reach 7:** add Review as a journey step, and land staff on a "resume work" view listing unfinished reviews and BOQs with pending lines.

### 3.3 Error prevention, editing and recovery — 6/10 (≈4 before fixes)

**Observed (journey BOQ)**
- `-1` → "Quantity cannot be negative."; `abc` and blank → "Enter a number."; a blank description → "Description cannot be empty." None of these writes was attempted.
- Escape closed the editor with no write and returned focus to the cell.
- A failed save kept the editor open: "Could not save. Try again, or press Escape to cancel."

**Observed (builder, before fixes)**
- `-5` was sent as a PATCH (only the audit's write block stopped it), and the field still showed −5 afterwards.
- A refused rate edit showed "Nothing was saved" while the field kept 1500.
- A failed lines load rendered as "0 lines", like an empty BOQ.

**After fixes:** all three are refused or reverted with a plain-language reason, and the failed load shows an error with "Try again" (verified live, §9).

**Remaining**
- Undo is per session only, and filters reset on reload.
- Quantity edits use a plain update (last writer wins), so concurrent editors silently overwrite each other.
- Review's save failure says only "Failed to save review".

**To reach 8:** durable undo or change history per line, compare-and-swap on quantity edits (as rate edits already do), and specific Review save errors.

### 3.4 Status visibility, review and change history — 6/10

**Observed (strengths)**
- Review shows progress ("17 / 79 reviewed · 22%"), per-category "needs review" counts, and a disabled Verify with a reason ("No quantity to verify — Edit to supply one, or Mark Pending").
- The Apply dialog states "Review not finished — 17 of 79 reviewed · 62 still need review" and blocks Apply (verified live).
- Rate edits fail closed with a precise message: "Rate not changed: rate edits are audited, and audit history is not set up on this database yet … Nothing was saved."

**Observed (weaknesses)**
- **Revision history is unavailable on this database.** `GET boq_commercial_revision` returns 404 because migration 20261006000000 is not applied. The page says so honestly, but the feature cannot be used.
- There is no per-line change history in the UI.
- When a request fails, the user sees a skeleton for **~38 s** before an error (16 retried requests: the Supabase client's own retries multiplied by React Query's).
- Drawings take ~6 s to appear. During that time the viewer previously claimed "1 / 1" for a 4-page PDF (fixed).

**To reach 8:** surface the existing `boq_line_change_log` per line, apply the missing migrations, and cap retries so failures surface within ~5 s.

### 3.5 Navigation and information architecture — 5/10

**Observed**
- **Two parallel surfaces for the same work:** the journey (`/app/projects/...`) and the Ops console (Workspace, BOQ builder, Review, BOQ management).
- The Ops sidebar has 11 entries, most of them procurement or forecasting, unrelated to the BOQ job.
- Deep links and the sign-in return URL work: a signed-out `/app/projects` → `/auth?returnUrl=/app/projects` → back after sign-in. `?boq=` survives step switches.
- BOQ filters and sort are not in the URL, so they are lost on reload.

**To reach 7:** one project home for BOQ work, with the Ops console reserved for administration.

### 3.6 Efficiency for experienced contractors — 5/10

**Observed (strengths)**
- The journey table supports keyboard editing (Enter, Escape, Ctrl/Cmd+Z), sorting and filtering.
- Review has single-key shortcuts (V verify, E edit, F flag, P pending, ←/→; `BoqReviewWorkstation.tsx` ~line 1784).

**Observed (weaknesses)**
- The shortcuts are **not shown anywhere in the UI**.
- There is no bulk action: 62 items must be decided one by one.
- Review takes ~5–6 s to load; drawings ~6 s.

**To reach 7:** visible shortcut hints, batch verify for high-confidence items, and faster first render of drawings.

### 3.7 Accessibility and responsive usability — 6/10 (≈4 before fixes)

**Observed**
- The five journey screens have **0 axe violations** at 1280, 768 and 390 px, and no horizontal overflow.
- All 40 Tab stops on the BOQ step show a visible focus indicator.
- Before fixes, the builder had 36 unlabeled form controls and 18 unnamed buttons. Ops Projects had 11 unnamed delete buttons, 11 unnamed progress bars, and muted text at 4.29–4.44:1.
- After fixes, the remaining issues are: Review has no `h1`/`main` landmark and two amber text items below 4.5:1; the builder has one amber line at 3:1; Ops Projects has a Radix tab `aria-controls` pointing at unmounted panels and 2 contrast nodes.

**Unverified:** no screen-reader session (NVDA/VoiceOver), no 200–400% zoom pass, Firefox/Safari, or dark mode.

**To reach 8:** fix the remaining axe items, then a manual assistive-technology pass on Review and the builder.

### 3.8 Visual hierarchy and consistency — 6/10

**Observed**
- The journey is calm and consistent: one heading per step, consistent status chips.
- The builder is dense:
  - every line shows editable description and trade inputs at once;
  - uncoded lines are labelled "Priced separately" even when they have no price at all;
  - the headline read "CIVIL WORKS WORKS" (fixed).
- Two visual languages coexist (the journey and the Ops console).

## 4. Nielsen Norman Group heuristics

| # | Heuristic | Score | Strongest implementation | Most consequential weakness | Recommended improvement |
|---|---|---|---|---|---|
| 1 | Visibility of system status | 6 | Review progress (17/79) and the "Review not finished" Apply gate; incomplete-BOQ banner | ~38 s skeleton before a load error; ~6 s drawing load | Cap retries at one per layer, surface errors within ~5 s, show progress during PDF download |
| 2 | Match between system and real world | 6 | BOQ sub-heads and item numbering (1.01…), units, "Quantity pending" | "Priced separately" on unpriced, uncoded lines; AI noise items ("Ruled table") | Say "No DSR code" or "Own rate" explicitly; filter non-element extractions before review |
| 3 | User control and freedom | 6 | Escape always cancels the journey cell editor; Ctrl+Z undo; refused edits revert | Undo is lost on reload; "Continue review" leaves the journey | Persist the change history per line; make Review a journey step with the same header |
| 4 | Consistency and standards | 4 | The journey screens share one layout and status vocabulary | Two UIs for the same BOQ with different edit models (click-to-edit vs always-on inputs) and different labels ("Unassigned" vs "Other") | Converge on the journey's table and editing model; one label set |
| 5 | Error prevention | 6 | Apply blocked until review is finished; rate edits fail closed; journey validation | Quantity edits are last-writer-wins (no compare-and-swap) | Reuse the rate edit's compare-and-swap for quantity, unit and description |
| 6 | Recognition rather than recall | 6 | Source document and page on every line; status chips | The basis of a quantity (measured/counted/AI/manual) must be remembered or looked up | Add a Basis column and show the evidence region from the BOQ |
| 7 | Flexibility and efficiency of use | 5 | Review single-key shortcuts; table sort/filter | Shortcuts are invisible; no batch actions | Show shortcut hints on buttons; batch-verify high-confidence items with a summary |
| 8 | Aesthetic and minimalist design | 6 | The journey's restrained layout | The builder repeats description, trade and source on every line; the dashboard is irrelevant to the BOQ task | Collapse secondary line fields; land on project work |
| 9 | Recognise, diagnose, recover from errors | 5 | Save failures now explain connection or permission and revert the field | Review's "Failed to save review" is generic; a load failure takes ~38 s to appear | Use `saveErrorMessage` in Review; faster failure surfacing |
| 10 | Help and documentation | 3 | Inline hints ("Edit in builder", "Before overheads, contingency and taxes…") | No in-app help or glossary; shortcuts undocumented | A short task-based help panel (how to trace, what "pending" means, what Apply does) |

## 5. Benchmark sources and principles applied

Page bodies could not be fetched from this environment (its network allowlist admits only the Supabase host). The principles below are taken from the canonical pages, found through web search, and cited by URL.

- **NN/g, 10 Usability Heuristics** — https://www.nngroup.com/articles/ten-usability-heuristics/ (Nielsen and Molich, 1990; revised). Used for §4. Also *10 Usability Heuristics Applied to Complex Applications* — https://www.nngroup.com/articles/usability-heuristics-complex-applications/, which is why expert efficiency (heuristic 7) and status visibility are weighted heavily for a professional tool.
- **W3C WCAG 2.2** (Recommendation, 5 Oct 2023) — https://www.w3.org/TR/WCAG22/. Applied:
  - 1.3.1 Info and Relationships;
  - 1.4.3 Contrast (Minimum);
  - 2.1.1 Keyboard;
  - 2.4.7 Focus Visible;
  - 2.4.11 Focus Not Obscured (Minimum) — https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html;
  - 2.5.8 Target Size (Minimum) — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html;
  - 3.3.1 Error Identification;
  - 3.3.3 Error Suggestion;
  - 3.3.4 Error Prevention;
  - 4.1.2 Name, Role, Value;
  - 4.1.3 Status Messages.
- **GOV.UK Design System:**
  - Error message — https://design-system.service.gov.uk/components/error-message/ (say what happened and how to fix it; avoid generic text such as "An error occurred"; keep the user's input);
  - Error summary — https://design-system.service.gov.uk/components/error-summary/;
  - Recover from validation errors — https://design-system.service.gov.uk/patterns/validation/;
  - Check answers — https://design-system.service.gov.uk/patterns/check-answers/ (review before a consequential submission, as Apply-to-BOQ and Freeze revision are);
  - Notification banner — https://design-system.service.gov.uk/components/notification-banner/ (for a persistent outcome message, as the Apply receipt does).

  These are applied to *forms and consequential submissions*, not to Cunstruct's visual style.
- **Bluebeam Revu:**
  - Measure tool — https://support.bluebeam.com/user-manual/menus/tools/measure-tool.html;
  - Measurements panel (calibration) — https://support.bluebeam.com/user-manual/menus/window/measurements-panel.html;
  - Count tool and Markup Summary export — https://support.bluebeam.com/revu/how-to/tips-and-tricks/boost-takeoff-workflows-with-count-tool.html;
  - Quantity takeoffs — https://university.bluebeam.com/how-to-quantity-takeoffs-in-revu.

  The principle applied: every quantity is a markup on a calibrated drawing, listed with its status and author, and exportable as a summary. That makes it traceable and defensible. The pattern fits Cunstruct's job (explaining and defending a BOQ). Bluebeam's interface is not.
- **Other estimating tools** (PlanSwift, Togal, Trimble): the search found only vendor or aggregator material without primary documentation of their audit features, so no comparison is claimed. A generic audit-trail checklist (user, timestamp, item change, rationale, link to drawing) informed §3.4.

## 6. Screen-by-screen findings

| Screen (route) | What works | Findings (severity) |
|---|---|---|
| Sign-in (`/auth`) | Clear form; return URL honoured | Staff were routed to `/my-projects` after a fresh sign-in (**P1, fixed**) |
| Ops dashboard (`/ops`) | Loads in ~2 s | Procurement KPIs only; no resume-work entry (**P2**); 2 contrast nodes (fixed by the token change) |
| Ops Projects (`/ops/projects`) | Delete project asks for confirmation | 11 unnamed delete buttons and progress bars (**P1 a11y, fixed**); Radix tab `aria-controls` (**P3**) |
| Journey: Projects (`/app/projects`) | Search, empty/error/loading states | Contrast 4.44:1 (fixed by the token change) |
| Journey: Overview | One "Next step" card, honest counts | "Continue review" leaves the journey (**P2**) |
| Journey: Drawings | Existing list, viewer and upload reused; `?page=` honoured | Viewer stated "1 / 1" while a 4-page PDF loaded (**P2, fixed**); ~6 s to first render (**P2**) |
| Journey: BOQ | Labelled sortable columns, filters, validation, Escape, undo, source links | No basis column (**P1 trust, open**); filters lost on reload (**P3**); raw "TypeError: Failed to fetch" (**P2, fixed**); ~38 s before a load error (**P2**) |
| Journey: Export & History | Real PDF/CSV with sources, pending section and review notice | Internal "Drawing review — added" sub-head in client exports (**P2, fixed**); revisions unavailable on this database (**P1 deployment, open**) |
| Ops Workspace | Drawing-first layout, contexts panel | No `h1`/`main` landmark (**P3**) |
| BOQ builder | Commercials, audited rate edits, undo ledger, exports | Negative quantity sent for saving (**P1, fixed**); unsaved values shown after failure (**P1, fixed**); failed load shown as empty (**P1, fixed**); 36 unlabeled controls and 18 unnamed buttons (**P1 a11y, fixed**); truncated quantities (**P2**); "Priced separately" wording (**P2**); "WORKS WORKS" (**P3, fixed**); 1 amber contrast (**P3**) |
| Review workstation | Progress, evidence boxes, Verify disabled with reason, Apply gate | Invisible shortcuts (**P2**); generic save error (**P2**); no batch actions (**P2**); no `h1`/`main` (**P3**); 2 amber contrast nodes (**P3**); noise items (**P2, data**) |

## 7. The five most consequential usability problems

1. **A quantity cannot be defended from inside the product** (P1, every line, every session).
   - The BOQ link opens the page, not the evidence; the basis is not shown; real lines often have no source.
   - **Fix:** carry the review item's evidence regions into the Drawings step (highlight them when opened from a BOQ line), and add a Basis column. The data exists in `analysis_review_item.ai_json.source.evidence` and in `quantity_status` / `measurement_method`.
   - **Verify:** from 10 random lines, a reviewer can point to the counted or measured element within 15 s.
2. **Two products for one job** (P2, constant).
   - Review, Apply, rates and revisions sit in the Ops console with a different editing model.
   - **Fix:** add Review as journey step 3, and keep the builder for commercials only.
   - **Verify:** a task-completion walkthrough without leaving `/app`.
3. **Edits are not durable or conflict-safe** (P2, every edit).
   - Session-only undo; last-writer-wins for quantity, unit and description.
   - **Fix:** compare-and-swap like `applyManualRateEdit`, plus a per-line history from `boq_line_change_log`.
   - **Verify:** concurrent-edit test; history visible after reload.
4. **Slow or invisible failure** (P2, whenever the network fails).
   - ~38 s skeleton before a load error.
   - **Fix:** `retry: 1` for queries in these screens and no client-level retries, or a timeout banner after 8 s.
   - **Verify:** failure-injection script (`errtime.mjs`) shows the error within ~5 s.
5. **Review at scale is laborious** (P2, every review).
   - 62 single decisions, hidden shortcuts, noise items.
   - **Fix:** visible shortcut hints, filter or batch for low-information items, batch-verify with a summary dialog in the GOV.UK "check answers" style.
   - **Verify:** time to clear 60 items; error rate.

## 8. Prioritised fix list (remaining)

| Pri | Finding | Freq. | Impact | Fix | Effort / deps | Verification |
|---|---|---|---|---|---|---|
| P1 | No evidence region or basis when tracing a BOQ line | Every trace | User cannot defend a quantity | Evidence highlight on Drawings from BOQ link; Basis column | M; review-item ↔ line mapping (`source_document_id`, review run) | Trace test above |
| P1 | Revision history and rate audit tables missing on this database | Every revision or rate edit | Feature unusable (fails closed, honestly) | Apply migrations 20261006000000 and 20260921000000 (authorised operation) | S; DBA approval | `GET boq_commercial_revision` 200; freeze and re-export |
| P2 | Review outside the journey | Every review | Context switch, lost bearings | Review step in the journey | M | Walkthrough |
| P2 | Last-writer-wins quantity edits | Concurrent edits | Silent overwrite | Compare-and-swap update | S–M | Unit + 2-session test |
| P2 | ~38 s before a load error | Network failure | Looks hung | Retry policy / timeout banner | S | `errtime.mjs` |
| P2 | Hidden Review shortcuts; no batch | Every review | Slow | Hints; batch with summary | S / M | Timing |
| P2 | Generic "Failed to save review" | Save failure | Can't diagnose | Use `saveErrorMessage` | S | Unit |
| P2 | Builder truncates quantities | Long values | Misread quantity | Wider input or tooltip (title added) | S | Visual |
| P2 | "Priced separately" for unpriced lines | Uncoded lines | Misleading | "No DSR code" wording | S | Copy review |
| P2 | Staff land on the procurement dashboard; `/` → `/my-projects` | Every sign-in | Extra navigation | Resume-work landing | S–M | Routing test |
| P3 | Review/Workspace lack `h1`/`main`; amber 3:1 text; Radix tab `aria-controls` | Always | Assistive-technology orientation | Landmarks, amber-700, mount tabs | S | axe |
| P3 | Filters and sort not in URL | Reload | Minor rework | Store in query string | S | Reload test |

## 9. Changes implemented in this audit, with verification

All on `feat/app-journey`; unit tests for each were shown to fail before the fix and pass after.

| Commit | Change | Verification |
|---|---|---|
| `7a55829` | Fresh sign-in no longer routes staff to `/my-projects`: `rolesReady` drops in the same update as the new user; roles reset on user switch | 4 new tests. **Live:** 3 sign-out/sign-in cycles → `/auth > /ops`, never `/my-projects`, no access-denied flash; reload and direct links stable; sign-out clears the session; signed-out deep link returns after sign-in |
| `dbe542f` | Viewer shows "– / –" and "Loading sheets…" until pdf.js has the document | Test. **Live:** both 4-page PDFs go loading → "1 / 4" (stored `page_count`=4 and pdf.js `numPages`=4 confirmed) |
| `d10e0ba` | Builder: refuses negative or unreadable quantities and rates, blank unit and description; reverts the field on a failed or refused save; no undo step for a failed write; failed load → error with "Try again"; plain-language save errors (builder and journey); named line controls | 7 tests + 3 helper tests. **Live:** −5 refused (0 writes); failed save reverted to 1 with "Not saved — the connection to the server failed…"; refused rate reverted; builder axe button-name/label → 0 |
| `25805e5` | `--muted-foreground` 46% → 42% lightness; named Ops Projects delete buttons and progress bars | **Live axe:** journey Projects contrast → 0; Ops Projects button-name and progressbar-name → 0 |
| `e9a4b5d` | Exports and builder sub-heads show "Unassigned" instead of the internal section name; "Civil works" headline | Tests. **Live:** CSV no longer contains "Drawing review" |

Earlier on this branch: the journey screens, the Apply gate and receipt, viewer keyboard scrolling, and the selected-drawing contrast fix (see the git log).

**Verification on the final audit code (16 Oct 2026):** Vitest **206 files, 2,431 tests, all passing**. TypeScript **459 errors**, identical to the `main` baseline (none added). ESLint **180 errors / 22 warnings**, identical totals to baseline. `vite build` succeeds. The full `npm run build` additionally runs the sitemap and prerender steps, which call Supabase; they were not re-run here.

## 10. Accessibility results and limitations

**Automated results (after fixes, axe 4.10.2):**

| Screen | 1280 | 768 | 390 |
|---|---|---|---|
| Journey: Projects / Overview / Drawings / BOQ / Export | 0 | 0 | 0 |
| BOQ builder | 1 contrast | 1 contrast | 1 contrast, 1 region |
| Review | 2 contrast, no main/h1, region ×12 | similar | similar |
| Ops Projects | 1 aria-valid-attr-value, 2 contrast | same | same + region |

- No horizontal overflow at any width.
- Keyboard: 40/40 focus stops visible on the journey BOQ. Escape and Enter behave correctly in the cell editor. The viewer's scroll region is focusable (an earlier fix).

**Limitations:** automated scans catch a minority of WCAG failures. Not tested:
- screen readers;
- zoom and reflow at 200/400%;
- target size (2.5.8);
- focus obscured by sticky headers (2.4.11);
- Firefox and Safari;
- dark mode.

**No WCAG 2.2 AA conformance is claimed.**

## 11. Untested areas and remaining risks

- **Contractor role:** no contractor test account. Routing is covered by unit tests only, and contractor screens (`/my-projects`) were not evaluated for a contractor's tasks.
- **Successful writes against the real database:** BOQ edit and undo, review decisions, Apply and its receipt, freezing a revision, uploads, share links and AI analysis (edge function) were not exercised live. Writes were blocked by design. Edit, undo, Apply and receipt are covered by tests and an earlier stubbed walkthrough.
- **Database schema drift:** the production database lacks the commercial-revision and rate-audit tables, so revisions and audited rate edits are unavailable there. The app reports this honestly.
- **Concurrency:** no compare-and-swap on quantity, unit or description edits.
- **Performance** was measured on a single sandbox connection: drawing ~6 s, Review ~5–6 s, failure ~38 s.
- **AI extraction quality** (noise items) affects review effort and was not evaluated systematically.
- **Usability claims** are expert judgements; no users were tested.

## 12. Release-readiness verdict

- **Usability quality:** **55/100**, evidence-based and after this audit's fixes. Strong honesty about incompleteness and a clean new journey, held back by weak quantity-to-evidence traceability and a split product.
- **Release readiness:** **Ready with limitations.**
  - It suits internal, staff-operated BOQ preparation, where the operator can explain quantities from the Review workstation.
  - It is not ready for unassisted contractor use until contractor flows are tested.
  - The production database also needs the revision and rate-audit migrations, which require approval to apply.
- **Next best investment:** **evidence-anchored BOQ lines.**
  - Opening a line from the BOQ should show its evidence region highlighted on the drawing, with a Basis column (measured / counted / AI-extracted / entered).
  - This is the single change that most improves quantity trust (20% weight), recognition (heuristic 6) and the contractor's ability to defend the BOQ.
  - Verify by timing whether a reviewer can identify the source element for 10 random lines.
