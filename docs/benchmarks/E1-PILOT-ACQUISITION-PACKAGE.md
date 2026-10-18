# E1 pilot-set acquisition package (DRAFT, for PO approval)

**Status:** draft, not in use.
- **Nothing sent:** no drawing owner or QS has been contacted, and no request has been sent.
- **Nothing received or agreed:** no file has been received, no permission is held, and no cost is committed.
- **Before use:** §B needs legal review. §B and §C need the PO's approval.

**Roadmap position:** plan of record v1.0 controls. This package covers the **first** of E1's 10–20 sets (the "pilot"). Proposed v1.1 would call this item "E1a", but v1.1 is not in force, and nothing here marks E1 or E1a complete.

**Controlling documents** (they win over this package):
- [extraction-acceptance-protocol.md](extraction-acceptance-protocol.md) (v1) and its [v1.1 amendment](extraction-acceptance-protocol-v1.1.md);
- [acceptance-set-a-handoff.md](acceptance-set-a-handoff.md);
- [reference-boq-spec.md](reference-boq-spec.md) and [reference-boq-handoff.md](reference-boq-handoff.md);
- the [E1 intake kit](E1-BENCHMARK-INTAKE-KIT.md).

**What this package checks:**
- **The pilot** must qualify for the existing **Set A** acceptance protocol: a vector set with a QTY / NO. schedule and room tags that print both area and L × W.
- **E1 as a whole** still needs the full mix: 10–20 sets across residential, commercial and institutional buildings, both vector and scanned (kit §1.1). That mix is not checked here.

---

## 0. Shortlist and selection rationale

The ranked shortlist of real candidate sets is kept in the local-only, git-ignored file `benchmark-inputs/E1/SHORTLIST.local.md`. Under §D, candidate sources are not named in Git until permission is held.

**How candidates are ranked:**
1. **Set A likelihood.** Public evidence of a QTY / NO. schedule, plus room tags that may print area and L × W. Evidence of a text layer, which suggests vector pages.
2. **Completeness.** Plans, sections, elevations and schedules for one building, at a single current revision.
3. **Permission route.** One identifiable owner, plus the architect where the drawings carry a design-copyright notice, and a named office able to grant permission.
4. **Freshness.** No match with any §A5 project or hash. The app inventory (30 drawing revisions) and the repository contain no record of the candidate.

**What the shortlist does not establish:**
- Search-engine extracts and public tender pages are leads, not verification.
- A drawing being publicly available is not a licence to use it for benchmarking.
- No candidate has been downloaded, opened, processed or contacted.

---

## A. Qualifying drawing-set checklist

Every row must be **PASS**, with its evidence recorded in §D, before a set can be accepted. Any row left blank or marked BLOCKED keeps the set unaccepted.

### A1. Typology and coverage

| # | Requirement | Evidence to record |
|---|---|---|
| A1.1 | A real Indian building that was built or tendered: residential, commercial or institutional. Not a training exercise, template sample or standard-drawing book. | Owner's written statement (§B) + typology |
| A1.2 | Architectural floor plans of **every** floor, at least one section, and the elevations | Sheet list with sheet numbers |
| A1.3 | At least one schedule with an explicit **QTY / NO.** column (door/window, fixtures or similar) | Sheet number of the schedule |
| A1.4 | Room tags that print **both an area and its L × W** | Count per floor plan |
| A1.5 | Printed dimensions are legible, with text roughly 1.4 mm or larger at print size (the v1 input-contract floor) | Spot-check result per sheet |
| A1.6 | Every sheet has a title block with project, sheet number, scale and revision | Per sheet |
| A1.7 | **Revision consistency:** one current revision per sheet; no superseded sheets mixed in; revision letters agree with the sheet list or transmittal | Revision per sheet |
| A1.8 | Structural drawings included? Not required. If absent, RCC items become `out_of_scope` (kit §1.2) | Yes / no |
| A1.9 | No "must not be copied or reproduced" notice, unless the written permission names this use | Per sheet |

### A2. Vector or scanned (reproducible)

| # | Check | Command | Rule |
|---|---|---|---|
| A2.1 | Page count | `pdfinfo <file>` | Recorded |
| A2.2 | Text layer per page | for each page *n*: `pdftotext -f n -l n -layout <file> - \| wc -w` | Word count above 0 |
| A2.3 | Fonts | `pdffonts <file>` | At least one font |
| A2.4 | Page is not a full-page image | `pdfimages -list -f n -l n <file>` | No single image covers a page whose text layer is empty |
| A2.5 | Class | From A2.2–A2.4 | **Vector** only if every in-scope page passes A2.2 and A2.4. Any raster page makes the set **scanned**, because protocol v1 §1 refuses raster pages. **The pilot must be vector.** |

### A3. Permission

| # | Requirement |
|---|---|
| A3.1 | Signed permission in the §B form, **after** legal review, from a person authorised to grant it |
| A3.2 | The permission covers storage, extractor processing, release to the three named QS, comparison and aggregate publication |
| A3.3 | The signed copy is filed in the set's `permission/` folder (kept out of Git) and its status recorded in the local register |

### A4. Exclusion-hash check (fails closed)

A candidate is **fresh** only if **all** of the following hold:

1. **Hash and compare.** The full SHA-256 of **every** file received, computed with `sha256sum` on receipt and before any file is opened, differs from every **full** hash in the §A5 register, including the hashes held in the local-only register `benchmark-inputs/E1/EXCLUSION-HASHES.local.md`.
2. **Shortened hash.** For the Set B entry, only a shortened hash is on record.
   - A candidate whose hash **starts with `af382dca` and ends with `f9db5`** is **rejected** as Set B.
   - A candidate that differs in that prefix or suffix is provably **not byte-identical** to the Set B file.
   - That does **not** clear the entry. It stays BLOCKED until the full hash is recorded (see point 4).
3. **Same building, different file.** A hash only detects byte-identical files. A re-export, re-save or partial copy of an excluded drawing has a different hash. So, in addition to point 1, the project name, title blocks and sheet numbers must not match any project in §A5. Even then, a match on this check alone is **not** proof of freshness.
4. **Unresolved entries block acceptance.** Every register entry marked **BLOCKED** that could apply to the candidate must be resolved first. X12 (local extractor runs) is resolved **per candidate** under point 5, not by inventorying every historical run. Resolve it by hashing the original source file and recording the full hash, or by a written PO decision that names the entry and the evidence relied on.
   - An owner's assertion or a title block alone does not resolve an entry.
   - Until then, the candidate's §D status is **"Not accepted — exclusion risk unresolved"**.
5. **Freshness by provenance (resolves X12 for one candidate).** Record three things:
   - **(a)** the date and route by which Cunstruct first obtained the files, directly from the owner or from the owner's official publication;
   - **(b)** a signed declaration from each developer who has run the extractor that they have never processed any drawing of **this named project**;
   - **(c)** a check of points 1–3 against the files as received.

   Any "yes" or "unsure" in (b) rejects the candidate.

### A4.6 Developer declaration (template for A4.5(b))

> I, **[name]**, have run Cunstruct's drawing extractor (`scripts/drawing-ocr/drawing_ocr.py`), or a development version of it, outside the app. To the best of my records, I have **never** processed, opened in a development tool, or received any drawing of the project **[candidate project name]**. My records are: **[shell history / local folders / notes checked]**.
>
> ☐ Never processed  ☐ Processed or unsure, so the candidate is rejected
>
> Signed / date

### A5. Excluded-drawing register

| # | Drawing (source) | File name | Full SHA-256 | Hash basis | Why excluded |
|---|---|---|---|---|---|
| X1 | External benchmark, Uttarakhand PWD standard drawings ([INPUTS.md](../../benchmark-inputs/external-20261013/INPUTS.md)) | `drawing-1.pdf` | `6ef6c85bf0cf43ea260e5a7e78bbbfaf08ef26586801a626a605ad3b0b1e7e72` | Repository record. The file is not present in this environment, so it could not be recomputed. | The extractor has already been run on it (external-20261013) |
| X2 | External benchmark, ENARCH drawing ([INPUTS.md](../../benchmark-inputs/external-20261013/INPUTS.md)) | `drawing-2.pdf` | `05d0a2c400fc3c029c366814d793af71dd70a0749dbfd58b60d7a3b1a1810abb` | Repository record. The file is not present in this environment. | The extractor has already been run on it. It also carries a "must not be copied" notice. |
| X3 | Set B, the Arab Creators set ([protocol v1](extraction-acceptance-protocol.md) §3) | ZZ-TEST revision `ea62ae3f…` (4 pages) | **Recovered**: in the local-only register `benchmark-inputs/E1/EXCLUSION-HASHES.local.md` (git-ignored; never committed) | Stored server-side `content_hash` on `document_revision`; it matches the protocol's recorded prefix `af382dca` **and** suffix `f9db5` (13 of 64 hex characters). That is conclusive for practical purposes, but formally an identification by partial hash, because the protocol never recorded the full value | Development set: the extractor was built on it. Confirmed history: AI analysis (OpenAI) and a JSON import both SUCCEEDED on 2026-10-14 |
| X4 | Test project "ZZ-TEST cunstruct e2e 20261014": 2 drawing revisions ([UX-UI-AUDIT.md](../UX-UI-AUDIT.md)) | 2 revisions (one of them is X3) | **Recovered**: 2 distinct hashes in the local-only register `benchmark-inputs/E1/EXCLUSION-HASHES.local.md` (git-ignored; never committed) | Stored `content_hash` for both revisions | Used in development and testing. Confirmed history: both revisions have SUCCEEDED AI-analysis claims dated 2026-10-14. One of the two is the Set B file (X3). |
| X5 | "Srikakulam Apartment": 28 drawing revisions ([UX-UI-AUDIT.md](../UX-UI-AUDIT.md)) | 28 revisions | **Recovered**: 24 distinct hashes (4 revisions repeat an earlier file) in the local-only register `benchmark-inputs/E1/EXCLUSION-HASHES.local.md` (git-ignored; never committed) | Stored `content_hash` for all 28 | Seen during development. Confirmed history: 8 revisions have AI-analysis claims, and 9 analysis runs exist for the project |
| X6 | Every other drawing uploaded to the app | — | **Resolved: none exist.** The other 9 projects have 0 drawing revisions | Read-only inventory, 17 Oct 2026: 30 revisions in total, every one with a stored `content_hash`. The storage bucket holds exactly 30 objects, all referenced, with 0 orphans. Every AI-analysis claim's hash matches a stored revision | Any file already in the system has been seen by the product |
| X12 | Drawings processed **outside the app**: local extractor runs on development machines, other than X1 and X2 | — | **Unresolved globally.** Resolved per candidate by A4.5 (provenance plus a developer declaration for that named project) | The database cannot show them. The 6 JSON-import runs record no file hash | Any drawing the extractor or its developers have seen |
| X7 | Repository fixture (synthetic) | `e2e/fixtures/document-a.pdf` | `6d220af14626bfb6d092b1f39d198d6ce0a25c3d46cc467c79fb11e6671f47ec` | Computed here from the tracked file | Generated test fixture |
| X8 | Repository fixture (synthetic) | `e2e/fixtures/document-b.pdf` | `919b6d49f47522788b8a4af337e03f83fea70a6e8d9f215a58a365b99894f3a2` | Computed here | Generated test fixture |
| X9 | Repository fixture (synthetic) | `src/lib/review/__fixtures__/raster-only.pdf` | `af627014b6720f493b8aa03dde4794cea47472cbdd97d7a82506026dd59ba349` | Computed here | Test fixture |
| X10 | Repository fixture (synthetic) | `src/lib/review/__fixtures__/rotated-90.pdf` | `d472bd79921f9d704baddb77eedc0737c70bb3c5f45156d035dade1ac07301af` | Computed here | Test fixture |
| X11 | Repository fixture (synthetic) | `src/lib/review/__fixtures__/vector-geometry.pdf` | `818f73a061aeb1989658bfedc14d13faba4f2174c53d37a23a23ebaceb5b6ef7` | Computed here | Test fixture |

**Searched and not found:** every commit on every branch was searched for tracked drawing files and for a full Set B hash. The only PDFs ever tracked are X7–X11, and no full Set B hash exists.

**Limits of the recovered hashes:**
- **Not re-hashed:** X3–X5 use the hash stored in the database (computed server-side when the file was analysed). No file was downloaded to re-hash, because every revision already had a stored hash.
- **Visibility:** the inventory covers what the ops test account can read.
- **X12** is handled per candidate (A4.5). It does not block the search for a fresh set.

---

## B. Drawing-owner request: DRAFT — LEGAL REVIEW REQUIRED — DO NOT SEND

The send-ready owner message and the permission letter are in [E1-FIRST-SET-HANDOUT.md](E1-FIRST-SET-HANDOUT.md) Parts 1–2. The letter's wording moved there unchanged, so there is one copy to review.

**Legal adviser to confirm:**
- the legal entity name;
- the retention period;
- deletion timelines;
- DPDP Act implications, if any personal data appears on the drawings;
- whether the authority confirmation is sufficient;
- the model-training clause.

---

## C. QS quotation brief (DRAFT — for PO approval; do not send)

The surveyor and adjudicator briefs (roles, independence, deliverables, corrections) are in [E1-FIRST-SET-HANDOUT.md](E1-FIRST-SET-HANDOUT.md) Parts 4A–4B, carried over from this section. A quotation request is that brief plus the following:

> **Subject: Request for itemised quotation — independent measurement of one building drawing set**
>
> We invite itemised quotations for independent measurement of **one** Indian building drawing set: **[typology]**, **[n]** sheets, vector PDF, about **[built-up area]** m². The drawings are released only after you sign the confidentiality, independence and deletion declaration. There are three separate engagements (QS-A, QS-B, adjudicator), and no firm may hold more than one. The brief for your role is attached.
>
> **Timetable:**
> - Quotation due **[date]**.
> - QS-A and QS-B deliver within **[n]** working days of receiving the drawings.
> - The adjudicator delivers within **[n]** working days of receiving both submissions.
>
> **Payment milestones (proposed):**
> - **[x] %** on delivery of files that pass our format check;
> - **[y] %** on acceptance, after the format correction round and the signed deletion confirmation.
> - No payment is due before a signed engagement.
>
> **Please quote, itemised:**
> 1. Fee for the measurement sheet.
> 2. Fee for the reference BOQ.
> 3. Adjudication fee (adjudicator only).
> 4. Format-correction terms.
> 5. GST: rate and whether it is included.
> 6. Delivery time in working days.
> 7. Earliest start date.
> 8. Two redacted sample IS 1200 measurement sheets.
> 9. Years of IS 1200 measurement experience.
>
> [Contact, quotation deadline]

**No prices are stated here.** The intake kit's §4.4 range comes from listing prices and is **not** a quotation. Obtain at least three quotations per role before recommending an engagement.

---

## D. Candidate and quotation comparison sheet

**Rule:** a candidate's status is **"Accepted"** only when every row from "Typology" through "Exclusion: unresolved register entries" is PASS, legal review is done, and the PO has approved in writing. Otherwise it is **"Not accepted"** with the reason. Leave a cell blank or mark it BLOCKED until its evidence exists.

| Field | Candidate 1 | Candidate 2 | Candidate 3 |
|---|---|---|---|
| Candidate source (local register reference only; never named in Git) | | | |
| Typology, and real Indian building (A1.1) | | | |
| Sheet coverage (A1.2) · Schedule with QTY / NO. (A1.3) · Room tags with area and L × W (A1.4) | | | |
| Legibility (A1.5) · Title blocks (A1.6) · Revision consistency (A1.7) · Structural present (A1.8) · No restrictive notice (A1.9) | | | |
| Document completeness: missing sheets or items | | | |
| Vector / scanned (A2.5); pages (A2.1) | | | |
| Full SHA-256 of every file (A4.1) | | | |
| Exclusion: full-hash comparison with X1–X5 and X7–X11 (X3–X5 from the local-only register) | | | |
| Exclusion: Set B prefix/suffix check (A4.2) | | | |
| Exclusion: project and title-block comparison with X1–X6 (A4.3) | | | |
| Exclusion: provenance and developer declaration for this project (A4.5) | | | |
| Permission: requested / signed / date / scope / project may be named? (A3) | | | |
| Legal review of §B done? | | | |
| QS-A quotation: firm · sheet fee · BOQ fee · GST · days · start | | | |
| QS-B quotation: firm · sheet fee · BOQ fee · GST · days · start | | | |
| Adjudicator: firm · fee · GST · days · availability | | | |
| Independence declarations received (A / B / Adj) | | | |
| **Total proposed cost** (sum of QS-A, QS-B and adjudicator quotations incl. GST; filled **only** when all three written quotations exist, never from listing prices) | | | |
| Outstanding approvals and conditions | | | |
| **Status** | Not accepted | Not accepted | Not accepted |

---

## E. PO decisions needed before any use

1. **Legal review, then approve §B and §C.** Nothing may be sent before then.
2. **Choose the candidate to approach first** from the local shortlist (§0). Before any request is sent, a person should view that candidate's public tender PDF in a browser and record the A1/A2 screening in §D, without downloading it into Cunstruct.
3. **Approve the developer declaration form** used in A4.5(b).
4. **Fill in the placeholders:** retention period, deadlines and payment-milestone percentages. The cost total stays blank until real quotations exist.
