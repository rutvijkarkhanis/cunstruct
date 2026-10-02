# M9 Live Verification Checklist — Find Similar / Click-to-Identify

Run this against the real deployed preview, not a local dev server. It
covers M9.3–M9.7. I will not make any code changes until you return results
from this checklist — M9 stays reported as "not verified live" until then.

**Preview URL:** `https://cunstruct-git-claude-coverage-by-project-t-000ee0-whistleblower.vercel.app`
(Vercel auto-redeploys this on every push to `claude/coverage-by-project-type-3ag0in`,
so it should reflect the current branch tip, commit `1386cb1`.)

**Before you start:**
- Use your normal ops/admin test account — do not create a new bypass path.
- Pick a project + BOQ that already has a real architectural drawing imported
  (or import one you're authorized to use — see "Choosing a drawing" below).
- **Redact before sending anything back to me:** email addresses, auth
  tokens, API keys, full URLs containing a token/signature, and any
  content on the drawing that's confidential (client name, address, pricing).
  Blur or crop screenshots rather than omitting them entirely where possible.
- Dev tools are only needed for Step A.5 (console errors) — everywhere else,
  plain browser use is enough.

---

## 0 — Infra Preflight (run BEFORE Section A)

Sections A–F assume the preview is already reachable and functional. If any
check below is wrong, Section A will fail for an infra reason that looks
like an app bug (e.g. a blank storefront homepage instead of the ops
dashboard, or AI actions erroring out) — run these five first and don't
waste time on A–F until they're clean.

**Every check here is read-only.** None of them require changing a Vercel
env var, a Supabase secret, a project flag, a database row, or a migration
— if a check fails, the fix itself is a separate, explicitly authorized
action, not something to do reflexively while verifying.

| # | Check | Dashboard location | Expected | If it fails |
|---|---|---|---|---|
| 0.1 | Preview routing env vars | Vercel → your project → **Settings → Environment Variables**, filtered to the **Preview** environment (or the specific branch, if per-branch overrides exist) | `VITE_IS_APP_SUBDOMAIN=true` is set, **or** `VITE_APP_URL` points at a reachable app-subdomain host | `/ops/*` (including Find Similar) will redirect to a nonexistent `track.<preview-alias>` host instead of loading. **Next action:** report the exact env var state found; an authorized operator (whoever owns Vercel project settings) adds the missing variable — do not attempt to route around this in app code. |
| 0.2 | `ai-analysis` actually contains `find_similar` | Supabase → **Edge Functions → ai-analysis**. A recent "Last deployed" timestamp alone is **not proof** the deployed code includes this PR's `find_similar` action — the function could have been redeployed for an unrelated reason after a stale checkout. If the Dashboard shows function source/logs, confirm the `find_similar` action literally appears; if it only shows a timestamp, treat the code revision as unconfirmed even if the timestamp looks recent | `find_similar` action present and confirmed from actual deployed source/logs, not inferred from a timestamp | Sections B/C will return a generic error or 404, not a feature bug, and could be misread as "the AI got it wrong" instead of "this isn't deployed yet." **Next action:** report exactly what was confirmed (timestamp only vs. actual source/logs); an authorized operator deploys from the merged commit if needed — PR #149 is still unmerged, so deploying its code ahead of merge is a separate decision for whoever owns that call, not something to do as part of "checking." |
| 0.3 | Migrations | Already confirmed from the repository, no Dashboard check needed | **PR #149 adds zero migration files** — confirmed via `git diff origin/main...claude/coverage-by-project-type-3ag0in -- supabase/migrations/` returning empty. Find Similar performs no database writes by design (see Section F and the structural zero-write guarantee), so there is nothing new to apply for this feature specifically. | N/A for this PR. (This repo has a separately documented, pre-existing migration-history/schema divergence — see `docs/deployment-log.md` — that is unrelated to Find Similar and out of scope here.) |
| 0.4 | `OPENAI_API_KEY` present — name only | Supabase → **Edge Functions → Secrets** | `OPENAI_API_KEY` is listed. **Never open, copy, or paste its value anywhere — presence by name is the entire check.** | Missing → every `identify`/`find_similar` call returns a clean `500 "AI generation is not configured on the server."` (confirmed in `ai-analysis/index.ts`), not a crash — but Sections B/C will show nothing but errors. **Next action:** report "missing by name"; an authorized operator (whoever owns Supabase secrets) adds it — never type a key into a prompt, ticket, chat, or this checklist. |
| 0.5 | `ai_processing_enabled` for the test project | Supabase → **Table Editor → projects** → the specific row for the project you intend to test with. **There is no in-app toggle for this anywhere in the Cunstruct UI** (confirmed: zero references in `src/pages/` or `src/components/`) — Table Editor is the only place to check or change it. | `true` for the project you're about to use | `false` → every AI action on that project returns `403 "AI processing is not enabled for this project."`, which will look like Find Similar is broken rather than a project-config issue. **Next action:** either pick a different test project that already has this `true`, or have an authorized operator (whoever owns write access to this table) flip it for your specific test project — do not edit this row yourself unless you already hold that authorization. |

---

## Choosing a drawing (M9.2)

Pick (or import) a PDF with, ideally:
- Multiple doors and/or windows (same type, repeated — good for Find Similar)
- At least one wall/partition
- Two elements that *look* similar but are actually different types (e.g. a
  door vs. a window-shaped opening) — this tests false positives
- 2+ pages if available, with at least one element type appearing on more
  than one page

Record: file name (not the file itself if confidential), page count, which
pages you tested, and which specific elements you're using as test points
(e.g. "the door at the top-left of the ground-floor plan, page 1").

---

## A — Sign-in & Document Loading (M9.3)

| # | Action | Expected | What to send back |
|---|---|---|---|
| A.1 | Go to the preview URL, sign in with your normal test account | You land on the normal ops dashboard, not an error or the storefront homepage | Screenshot if anything looks wrong |
| A.2 | Navigate to the project → BOQ → Review workflow for your chosen drawing | The review workspace opens (drawing canvas + element list on one screen) | — |
| A.3 | Confirm the PDF renders — you can see real drawing content, not a blank page or spinner | Drawing visible, correct page count shown (e.g. "Sheet 1 of 4") | Screenshot of the loaded drawing |
| A.4 | Try: zoom in, zoom out, "Fit page", and Next/Previous page | Each control visibly changes the view; page number updates; no blank/frozen canvas | Note anything that didn't respond |
| A.5 | Open browser DevTools → Console tab (F12, or right-click → Inspect), reload the page once | — | Copy any **red error lines** you see (redact tokens/URLs first) |
| A.6 | Confirm the title bar / breadcrumb shows the document name you expect | Correct document, not a different drawing | — |

**Report for Section A:** pass/fail per row, screenshots from A.3, console errors from A.5 (redacted).

---

## B — Click-to-Identify Against Real AI (M9.4)

Pick **4–6 elements** on your drawing: include at least 2 "easy" ones (clear,
isolated door/window) and at least 2 "hard" ones (crowded area, two similar
elements near each other, or something partially obscured by text/dimension
lines).

For **each** element, repeat:

| # | Action | Expected | What to send back |
|---|---|---|---|
| B.1 | Before clicking: note what the element actually is and where (e.g. "Door, page 1, left side of the entry wall") | — | Write this down first, before seeing the AI's answer — this is your ground truth |
| B.2 | Click "Identify" mode, then click directly on that element | A brief loading state, then a result appears | — |
| B.3 | Read the returned label, description, and confidence | — | Copy the exact label/description/confidence shown |
| B.4 | Judge: does the label match what's actually there? | Door→"Door", not "Window" or something unrelated | Mark **Correct** / **Wrong type** / **Nothing found** / **Vague-but-not-wrong** |
| B.5 | Look at the highlighted box on the drawing | The highlight should sit ON or very close to the element you clicked, not elsewhere on the page or off-page | Screenshot with the highlight visible. Mark **Aligned** / **Off-position** / **No highlight shown** |
| B.6 | If the result seems wrong or the highlight is badly placed, click Dismiss (don't Confirm) before moving to the next element | — | — |

Do this for all 4–6 elements, then also do **one deliberate "nothing here"
test**: click an empty area of blank page with no drawing content, and
record whether the app honestly says "couldn't identify anything" rather
than inventing a candidate.

**Report for Section B:** one row per element — element description, what
AI returned, correct/wrong/nothing judgment, highlight-aligned judgment,
screenshot.

---

## C — Find Similar Against Real AI (M9.5)

Pick **2 reference elements** from Section B that returned a *correct*
identification (ideally a type you know repeats elsewhere in the drawing,
like a door type used several times).

For **each** reference:

| # | Action | Expected | What to send back |
|---|---|---|---|
| C.1 | With that element identified, click **Confirm** | The result changes to a confirmed state, a "Find Similar" button appears | — |
| C.2 | Click **Find Similar** | A loading state, then a list of matches (or an honest "no similar elements found") | — |
| C.3 | Before judging the AI, go find the OTHER real occurrences of this same element type yourself by scrolling/paging through the drawing | — | Write down how many you found and roughly where (this is your ground truth for recall) |
| C.4 | For each returned match: is it actually the same element type, at a real location? | — | For each match: **Correct** / **Wrong type** / **Duplicate of another match** / **Same as the reference itself** (should NOT happen) |
| C.5 | Compare your own count from C.3 against the matches returned | — | Note any real occurrence you found that the AI's list is missing |
| C.6 | Check each match's confidence (if shown) against how clearly correct it looks to you | — | Note any case where a low-confidence match looked fine, or a high-confidence match looked wrong |
| C.7 | For a match whose evidence box lands on a *different page* than the one currently shown, confirm the app tells you that (a small message near the drawing) rather than silently showing nothing | Message appears, e.g. "found on another page" | Screenshot |
| C.8 | Navigate to that other page using the page controls | The match's highlight now appears there, in the right spot | Screenshot |

**Report for Section C:** per reference element — number of real occurrences
you found yourself, number/list of matches returned, which were
correct/wrong/duplicate, which real occurrences were missed, and the
page-crossing check (C.7/C.8).

---

## D — Highlight Geometry Across Zoom/Pages (M9.6)

Using one of your confirmed Find Similar results from Section C:

| # | Action | Expected | What to send back |
|---|---|---|---|
| D.1 | With matches showing, zoom in significantly, then zoom back out | Highlight boxes stay correctly positioned on the element at every zoom level — they don't drift or detach | Screenshot at 2 different zoom levels |
| D.2 | Click "Fit page" | Highlights remain aligned after the view resets | Screenshot |
| D.3 | Navigate away to a different page, then back | The right highlights reappear on the right page each time — nothing stays stuck from the previous page | — |
| D.4 | If any match's evidence looked only approximate (e.g., a very large or oddly-shaped box, not tight around the real element) | — | Note which match, and describe how loose/wrong the box looked — this is a separate "weak evidence" finding, not a "wrong identification" finding |

---

## E — Cross-Document Isolation (M9.5/M9.6 continued)

If your BOQ/project has **two or more drawings**:

| # | Action | Expected | What to send back |
|---|---|---|---|
| E.1 | With an Identify highlight and/or Find Similar matches showing on Document A | — | — |
| E.2 | Switch to a different element that belongs to Document B (a different drawing) | Document B loads; **no highlight or match boxes from Document A appear**, even if B has a page with the same page number as A | Screenshot of Document B's view |
| E.3 | Switch back to the Document A element | The original highlight/matches reappear | Screenshot |

If you only have one drawing available, skip this section and say so —
this exact scenario was already verified with mocked data in M8; this step
is only to confirm it holds with a second real document if one exists.

---

## F — Reviewer Actions & BOQ Boundaries (M9.7)

| # | Action | Expected | What to send back |
|---|---|---|---|
| F.1 | Before touching Find Similar results: note the current BOQ quantity/status for the item you're testing (e.g. "Door D1: qty 2, status Pending") | — | Write this down — your "before" state |
| F.2 | In the Find Similar results, click **Confirm** on one match | That match's box turns a different color (green/confirmed); its Confirm/Reject buttons are replaced with a "Confirmed" label | Screenshot |
| F.3 | Click **Reject** on a different match | That match's box turns dashed/muted; its own buttons replaced with "Rejected" | Screenshot |
| F.4 | Check that a third (untouched) match, if any, is still showing its original pending (cyan) state | Confirm/Reject on one match never changes another | — |
| F.5 | Click **Exit** to leave Identify/Find Similar entirely | You're back to the normal item panel; no stray highlight boxes remain visible on the drawing | — |
| F.6 | Re-check the SAME BOQ quantity/status you recorded in F.1 | **Unchanged** — confirming/rejecting Find Similar matches must never alter BOQ quantity, unit, or review status by itself | Write down the "after" state next to your "before" state from F.1 |
| F.7 | (Optional, only if you have it) Check any project activity/audit log for this BOQ around the time of this test | No new write entries caused merely by running Identify/Find Similar or confirming/rejecting a match | Note what you saw, or "no audit log available to me" |

**Report for Section F:** the before/after BOQ state from F.1/F.6 (this is
the single most important line in this whole checklist), plus pass/fail on
F.2–F.5.

---

## What to send back to me

For each section (A–F), either the filled-in table above or just a plain
list of "step number → what happened", plus:
- Screenshots (redacted) called out in each row
- Any console errors from A.5
- Your own ground-truth notes from B.1 and C.3 (what's *actually* on the
  drawing) — these are what let me score the AI's answers, not just record
  that it answered

Once I have this, I'll build the M9.8 accuracy audit from your real
observations, categorize anything that looks like a genuine defect, and
only then consider any code change (M9.9) — strictly for a reproducible
problem, never a UI redesign or prompt change bundled in.

---

## Current verification status

Status values:
- **PASS — repo evidence**: confirmed from the codebase/diff itself; no live access needed or possible for this one.
- **PASS — live evidence**: confirmed by actually running the check against the real deployed system.
- **FAIL**: checked live and it did not match the expected result.
- **BLOCKED**: requires Dashboard or signed-in-browser access this environment does not have; not yet checked.
- **NOT RUN**: in scope but not attempted yet (e.g. depends on an earlier BLOCKED step).

| # | Check | Status | Basis |
|---|---|---|---|
| 0.1 | Preview routing env vars | BLOCKED | No Vercel CLI, connector, or network access from this environment |
| 0.2 | `ai-analysis` contains `find_similar` | BLOCKED | No Supabase CLI, connector, or network access from this environment |
| 0.3 | Migrations | **PASS — repo evidence** | `git diff origin/main...claude/coverage-by-project-type-3ag0in -- supabase/migrations/` is empty — PR #149 adds no migration files |
| 0.4 | `OPENAI_API_KEY` present | BLOCKED | Supabase Dashboard access required; not available here |
| 0.5 | `ai_processing_enabled` for test project | BLOCKED | Supabase Table Editor access required; not available here |
| A | Sign-in & document loading | NOT RUN | Depends on 0.1–0.5; requires a live signed-in browser session not available here |
| B | Click-to-Identify vs. real AI | NOT RUN | Same — requires live browser + real AI access |
| C | Find Similar vs. real AI | NOT RUN | Same |
| D | Highlight geometry across zoom/pages | NOT RUN | Same |
| E | Cross-document isolation (live) | NOT RUN | Same. Note: this exact scenario is already covered with mocked data — see M8 row below |
| F | Reviewer actions & BOQ boundary (live before/after) | NOT RUN — **remains mandatory, not substitutable** | Same. The structural guarantee below is not a replacement for this live check |
| — | M8 Playwright suite (mocked Supabase/AI, real pdf.js rendering/clicks/geometry) | **PASS — repo evidence** | Existing automated suite, already passing on this branch; proves real-browser rendering/interaction mechanics, not real-AI correctness |
| — | BOQ zero-write guarantee (structural) | **PASS — repo evidence** | `findSimilarHandler.ts` receives no Supabase client at all, only a narrow `{loadDocumentFile, callOpenAi}` pair — no method in scope could write anything. This is evidence the *code* can't write, not evidence that *production* doesn't — Section F's live before/after check still applies |

**No check above is marked PASS — live evidence.** M9 remains not verified live.
