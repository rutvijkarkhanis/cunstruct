# E1 benchmark intake kit

**Plan item:** E1 *Benchmark inputs* (owner: PO), in `docs/PLAN-OF-RECORD.md` v1.0 §2.
**Done when (quoted from the plan):** 10–20 real Indian drawing sets (residential, commercial, institutional; vector and scanned) with usage permission. Two independent experienced QS produce IS 1200 measurement sheets per set, reconciled by adjudication. In/out-of-contract tags recorded.
**Evidence (from the plan):** an input register with SHA-256 per drawing; reference files kept outside Git.
**Unblocks:** E2 (benchmark run), and through it E5 and D3.

This kit is a working procedure. It does not change the frozen protocol ([v1](extraction-acceptance-protocol.md) and the [v1.1 amendment](extraction-acceptance-protocol-v1.1.md)) or the reference format ([spec](reference-boq-spec.md), [preparer brief](reference-boq-handoff.md), [template](reference-boq-template.json)). Where they say something, they win.

Labels used below: **Rule** = taken from an existing repo document; **Assumption** = a working choice that the PO should confirm or replace; **Open** = a decision that is not yet made.

---

## 0. Decide before the first engagement (Open)

| # | Decision | Why it matters | Default proposed (Assumption) |
|---|---|---|---|
| D-1 | **Measurement scope per line.** The preparer brief fixes a narrow convention: gross floor areas from printed L × W only, counts exact, no scaling. E1 asks for full IS 1200 measurement sheets. | Lines under the fixed convention are what protocol v1 gates G1–G6 can score. Full IS 1200 lines (concrete, masonry, plaster with deductions…) are what E2 needs for per-category recall and ₹-weighted error. | Keep **both** in the same `cunstruct.reference-boq.v1` file. Tier 1: room floor areas and printed counts under the brief's fixed convention, unchanged. Tier 2: every other IS 1200 item, each with its own `measurementRule` naming the IS 1200 part and clause applied (the brief allows other items with their own rule). Tier 2 uses figured (printed) dimensions only. A figure that could only be got by scaling is `ambiguous`, with a note. |
| D-2 | **Pages in scope.** The brief scopes one sheet list and lists anything needing other drawings as out of scope. | For E1 the whole set is supplied. | Pages in scope = every page of the set. `out_of_scope` is kept for items that need documents *not* in the set (specifications, BBS, services drawings not supplied). |
| D-3 | **Who adjudicates** (§6). | Must be independent of both QS and of Cunstruct output. | A third senior QS, engaged on the same independence terms. |
| D-4 | **Rates for ₹ weighting.** E2 reports ₹-weighted error. | E1 delivers quantities only. Rates depend on E3 (DSR 2023 basis, cost index, GST not yet confirmed). | Out of E1. The E2 owner records the rate source used. |

The IS 1200 clause texts are not yet verified against BIS originals (plan item E3). Until E3 is done, a clause the QS cites is the QS's professional reading. It is recorded as given and is not treated as confirmed.

---

## 1. Drawing-set selection criteria

### 1.1 Mix (target 10–20 sets)

| Dimension | Minimum (Assumption: proposed so each cell has at least a few sets) |
|---|---|
| Residential (independent house, apartment block) | 3 sets |
| Commercial (office, retail, mixed use) | 3 sets |
| Institutional (school, hospital, hostel, government building) | 3 sets |
| Vector PDF (selectable text) | at least half of all sets |
| Scanned / raster | at least 3 sets |
| Sets that also meet the Set A contract (a schedule with an explicit QTY / NO. column **and** room tags printing both area and L × W; [acceptance-set-a-handoff.md](acceptance-set-a-handoff.md) §1A) | at least 1, preferably 3 |
| Sources | no more than about a third of the sets from one architect, firm or department |

**Rule:** the frozen extractor refuses raster pages ([protocol v1](extraction-acceptance-protocol.md) §1). Scanned sets will show every in-contract quantity as missed or unresolved under v1. They are still needed: E2 reports raw recall per category, and the research report expects scanned sheets to be harder.

### 1.2 Each set must contain

- [ ] A real building that was built or tendered in India (not a training exercise or a sample from a template site).
- [ ] Architectural floor plans of every floor, plus at least one section and the elevations.
- [ ] A title block with project name, sheet number, scale and revision on each sheet.
- [ ] At least one schedule (door/window, finishes or areas), or room tags with printed sizes.
- [ ] Legible dimensions. **Assumption:** printed text at least about 1.4 mm high, the v1 input-contract floor for vector pages.
- [ ] Preferably structural drawings (foundation, column and beam layouts). Without them, RCC items will be `out_of_scope`. Record which is the case.
- [ ] Usage permission in writing (§1.4).

### 1.3 Exclude

- Any drawing the extractor has already been run on, or that was used in development: Set B (`af382dca…f9db5`, [protocol v1](extraction-acceptance-protocol.md) §3) and the two drawings in [benchmark-inputs/external-20261013/INPUTS.md](../../benchmark-inputs/external-20261013/INPUTS.md). Compare the SHA-256 of each new file against these before accepting it.
- Drawings with a "must not be copied or reproduced" notice, unless the written permission names this use.
- Sets that mix revisions without a clear current revision.

### 1.4 Permission wording (draft, Assumption: to be reviewed by the PO's legal adviser before use)

> I, **[name]**, **[role]** at **[organisation]**, am authorised to share the drawing set **[project / set description]**, comprising **[n]** files, with **[Cunstruct legal entity]**.
>
> I permit **[Cunstruct legal entity]** to:
> (a) store these files privately, outside any public or shared code repository;
> (b) give them to quantity surveyors engaged under confidentiality to prepare measurement sheets;
> (c) run software on them and compare the results with those measurement sheets;
> (d) publish aggregate accuracy results that do not reproduce the drawings and do not identify the project, the client or the site [**unless I tick here: ☐ the project may be named**].
>
> The drawings will not be published, sold or used to train any model offered to third parties [**delete if a broader use is agreed**]. I may withdraw this permission in writing; the files and derived measurement sheets will then be deleted within **[30]** days, except aggregate results already published.
>
> Signed / date / contact.

Record the signed permission in the set's `permission/` folder (§2) and its status in the register (§3).

---

## 2. Storage and hashing

**Rule:** benchmark drawings and anything that reproduces their content are never committed ([BENCHMARK-EXECUTION-PLAN.md](BENCHMARK-EXECUTION-PLAN.md) §4, [.gitignore](../../.gitignore)).

Layout, one folder per set:

```
benchmark-inputs/E1/
  INPUTS.md                  public register (§3), may be committed
  REGISTER.local.md          full register (§3), never committed
  S01/
    drawings/                as received, never edited
    permission/              signed permission
    SHA256SUMS               sha256sum of every file in drawings/
    engine-output/           extractor JSON + its SHA-256, written BEFORE any QS file is opened
    qs-a/  qs-b/             QS deliverables, as received
    gold/                    adjudicated reference + disagreement log
    contract-tags.json       {lineId: "in" | "out"}, the format read by the scoring driver
```

> **Gap to fix before intake (confirmed 17 Oct 2026 with `git check-ignore`).** `.gitignore` covers only `benchmark-inputs/**/*.pdf` and `benchmark-inputs/**/engine-output/drawing-*`. These are **not** ignored: `.PDF` (upper case), `.dwg`, `.tif`, `.jpg`, `.xlsx`, `.json`, and any file in `qs-a/`, `qs-b/` or `gold/`. Until `.gitignore` is extended, or the folder is kept outside the checkout, run `git status --porcelain benchmark-inputs/` before every commit and stop if anything under `E1/` is listed.

Hashing on receipt:

```bash
cd benchmark-inputs/E1/S01
sha256sum drawings/* > SHA256SUMS      # record once, on receipt
sha256sum -c SHA256SUMS                 # re-run before every use; stop on any FAILED
```

The `drawing.sha256` in each reference file is the hash of the file it measures. If a set has several files, each QS deliverable is per file, or the set is first combined into one PDF and that PDF is hashed. **Assumption:** prefer one combined PDF per set, because the reference format takes one `drawing.sha256`.

**Order (Rule, [protocol v1](extraction-acceptance-protocol.md) §2–§4):** run the extractor unchanged and hash its output **before** any QS file for that set is opened. QS files may be received and hashed without being opened.

---

## 3. Input register template

Keep two files.

- The **public register** follows the precedent of [benchmark-inputs/external-20261013/INPUTS.md](../../benchmark-inputs/external-20261013/INPUTS.md). It may be committed as `benchmark-inputs/E1/INPUTS.md`. It holds nothing that identifies the project, client or site, unless the permission allows it.
- The **local register** (`benchmark-inputs/E1/REGISTER.local.md`) holds everything else and is never committed.

**Public register**

| Set | Typology | Vector / scanned | Pages | File | SHA-256 | Permission | Set A eligible | Gold SHA-256 | Status |
|---|---|---|---|---|---|---|---|---|---|
| S01 | residential | vector | | `S01.pdf` | | Y / pending | Y / N | | received / QS out / adjudicated / tagged |

**Local register (one column per set)**

| Field | S01 |
|---|---|
| Source organisation, contact | |
| Permission: signed by, date, scope, may the project be named? | |
| Received: date, by whom | |
| Hash checked against the excluded drawings (§1.3) | |
| Structural drawings included? Sheet list | |
| Engine output: SHA-256, date, working-tree commit SHA | |
| QS-A: name, date sent, date returned, file SHA-256s, valid? | |
| QS-B: name, date sent, date returned, file SHA-256s, valid? | |
| Adjudicator, date, disagreement-log SHA-256 | |
| Contract tags: by, date, checked by | |
| Notes | |

---

## 4. QS engagement

### 4.1 Selecting the two QS (Assumption: proposed criteria)

- At least 5 years of measuring Indian building work under IS 1200, shown by two sample measurement sheets (redacted).
- From different firms, not related to each other, and not employees or contractors of Cunstruct.
- Never shown any Cunstruct screen, export, report or repository file.
- Each signs a confidentiality and independence declaration (§4.3) before receiving drawings.

### 4.2 What each QS receives (Rule)

Exactly: the drawing set, [reference-boq-handoff.md](reference-boq-handoff.md), [reference-boq-spec.md](reference-boq-spec.md), [reference-boq-template.json](reference-boq-template.json), and the cover sheet in §4.3. Fill the `<…>` placeholders first. Nothing else from `docs/benchmarks/` is sent, **including this kit**.

### 4.3 Cover sheet (send this text; fill the brackets)

> **Independent measurement — set [S01]**
>
> **Drawing:** [file name], [n] pages, SHA-256 [64 hex]. Check it with `sha256sum`; if it differs, stop and tell us.
>
> **Deliverables, due [date]:**
> 1. **Measurement sheet** (Excel). One row per measurement: item, location / grid, drawing page, No × L × B × D, deductions, quantity, unit, and the IS 1200 part and clause you applied. Keep your own working layout if you prefer; these columns must be present.
> 2. **Reference BOQ** (JSON or a spreadsheet with the same columns) in the format of the enclosed template and specification, with one line per measured item, carried from your measurement sheet. `measurementRule` names the measurement-sheet rows the line came from.
> 3. A list of anything you could not measure, with the reason, as `ambiguous`, `unmeasurable` or `out_of_scope` lines (no estimated figures).
>
> **Scope:** [all pages / list]. Measurement conventions: as in the enclosed brief for room floor areas and printed counts. For all other items, IS 1200 as you normally apply it, using printed dimensions. If a figure can only be obtained by scaling the drawing, mark it `ambiguous` and say so.
>
> **Independence:** work alone. Do not discuss this drawing with anyone else measuring it, and do not look at any software output for it. Confirm by setting `preparedWithoutCunstructOutput: true`. If that is not true, tell us; the work will still be paid.
>
> **Confidentiality:** the drawings belong to [owner]. Do not copy, share or keep them after delivery. Delete them, and tell us, within [7] days of acceptance.
>
> **Fee:** ₹[ ] per set, paid on delivery of files that pass the format check. One round of format corrections is included. Our questions about content are answered from the drawing only.

### 4.4 Effort and cost (Assumption)

The only price evidence in the research is **vendor and listing evidence, not a survey**. The research report (`reports/Cunstruct redesign first principles.md`, a local working file not in Git; section "One person, one job") cites outsourced building BOQs at about **₹8,000–10,000 and 1–5 days**, from a [Freelancer listing](https://www.freelancer.de/projects/construction-management/commercial-building-boq-estimate) (average bid about ₹8,638, 3–5-day windows) and a [constructionestimatorindia vendor claim](https://constructionestimatorindia.com/?p=18104) (from ₹10,000, "usually within 1–2 days", price varies with area, floors, MEP and rate analysis).

This engagement asks for more than a typical freelance BOQ: per-room lines, evidence boxes and a strict file format. **The uplift is unknown.** Get at least three written quotes on one pilot set before committing.

| Planning figure (listing prices applied unchanged) | 10 sets | 20 sets |
|---|---|---|
| Two QS per set at ₹8,000–10,000 each | ₹1.6–2.0 lakh | ₹3.2–4.0 lakh |
| Adjudication, budgeted as a third engagement at the same rate until quoted | ₹0.8–1.0 lakh | ₹1.6–2.0 lakh |
| **Total before uplift and taxes** | **₹2.4–3.0 lakh** | **₹4.8–6.0 lakh** |
| Calendar time per set (QS work in parallel) | 1–5 days of QS work, plus adjudication and tagging (internal time not estimated) | |

---

## 5. Receiving a QS deliverable

1. Hash the files on receipt and record them in the register. **Do not open them** until the set's engine output is hashed (§2).
2. Validate the JSON with `validateReferenceBoq` against the drawing SHA-256 ([boqReference.ts](../../src/lib/e2e/boqReference.ts)). An invalid file goes back for format correction only. Values are never edited by us.
3. If a spreadsheet was supplied, transcribe it to JSON without changing any value, and have a second person check the transcription against the spreadsheet ([reference-boq-handoff.md](reference-boq-handoff.md), "Format").
4. Spot-check that each JSON line traces to measurement-sheet rows (`measurementRule`).

---

## 6. Adjudication: two sheets into one gold standard

The adjudicator works from the drawing and the two measurement sheets only, with no Cunstruct output. The gold reference is a new `cunstruct.reference-boq.v1` file: `preparedBy` = the adjudicator, `preparedWithoutCunstructOutput: true`.

1. **Pair lines.** Pair QS-A and QS-B lines by item, floor, page and evidence box, using the same rules as the scorer ([reference-boq-spec.md](reference-boq-spec.md) §6.2). Do not pair by quantity.
2. **Classify each pair or orphan:**

| Case | Gold line |
|---|---|
| Same status `measured`, quantities within the default tolerance (counts exact; areas ±1 % or 0.05 m²; other units ±1 %) | Re-check the arithmetic of both sheets. Take QS-A's figure if both are arithmetically correct (**Assumption:** a fixed choice, so that nobody picks the "better" number). |
| Same status, quantities outside tolerance | The adjudicator re-measures from the drawing and adopts the figure whose measurement-sheet rows match the drawing. If neither matches, the adjudicator writes their own rows. **Never average.** |
| Status differs (e.g. `measured` vs `ambiguous`) | The adjudicator decides from the drawing. If it is still not defensible, the gold line is `ambiguous`, with a note. No quantity is invented. |
| Line in one sheet only | The adjudicator checks the drawing. If the item exists, it goes into gold, and the other sheet's omission is logged. If not, it is excluded and the false inclusion is logged. |
| Different granularity (per-room vs per-floor total) | Gold uses one line per room instance (spec §2). Totals are separate lines. |

3. **Aliases.** The gold line takes the union of both QS's aliases. No alias is added after any Cunstruct output for the set has been seen.
4. **Disagreement log** (`gold/disagreements.csv`). One row per case that was not "within tolerance":

| Gold id | QS-A id | QS-B id | Case | QS-A value / status | QS-B value / status | Gold value / status | Reason (drawing page, rows) | Adjudicator | Date |
|---|---|---|---|---|---|---|---|---|---|

5. **Report human agreement per set:** lines paired; within tolerance; outside tolerance; status disagreements; one-sided lines. Report these as counts. This is the human-versus-human baseline that E2's machine figures sit beside.
6. **Freeze.** Hash the gold file, record it in the register, and never edit it after any score for that set has been seen (Rule, [reference-boq-handoff.md](reference-boq-handoff.md), "What happens next").

---

## 7. In / out-of-contract tagging

**Rule ([protocol v1](extraction-acceptance-protocol.md) §3):** the protocol owner tags every **measured** gold line from protocol §1 and the drawing alone, before scoring and without extractor output. The scoring driver refuses G3 if any measured line is untagged ([score-set-a.test.ts](../../scripts/benchmark/score-set-a.test.ts)).

For each measured gold line, ask: *is its quantity printed on the drawing in one of the §1 forms?*

| §1 form | Tag |
|---|---|
| An explicit QTY / NO. column in a schedule | `in` |
| A printed "N No." | `in` |
| A printed total row whose parts sum to its printed sum | `in` |
| A room tag whose printed area equals its printed L × W | `in` |
| A finish total built only from such areas | `in` |
| Anything else: scaled, dimension chains, symbol counts, IS 1200 deductions, any page of a scanned set (raster pages are refused) | `out` |

Write `contract-tags.json` as `{ "<gold line id>": "in" | "out" }`. Record who tagged it and when. Have a second person check 10 % of the lines, or all of them if the set has fewer than 50 measured lines (**Assumption**).

---

## 8. Per-set checklist (E1 is done when every row is ticked for 10–20 sets)

- [ ] Permission signed and filed; permission status recorded in the register
- [ ] SHA-256 recorded; not one of the excluded hashes
- [ ] Engine output saved and hashed before any QS file was opened
- [ ] QS-A and QS-B delivered; both pass `validateReferenceBoq`; independence declared
- [ ] Gold reference adjudicated, validated, hashed; disagreement log and agreement counts filed
- [ ] Contract tags written and checked
- [ ] `git status` shows nothing under `benchmark-inputs/E1/` except, if chosen, the public register `INPUTS.md`
