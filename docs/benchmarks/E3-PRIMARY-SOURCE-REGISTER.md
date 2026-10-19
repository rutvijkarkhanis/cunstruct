# E3 — Primary-Source Register (BIS IS 1200, CPWD DSR 2023, GST, cost index, portal blank-vs-zero)

| Field | Value |
|---|---|
| Plan item | E3 — primary-source verification (plan of record v1.0) |
| Register status | **E3 NOT DONE.** As of 2026-10-19 the DSR part (topics 2–4) is confirmed from CPWD DSR 2023 Vol. 1. IS 1200 (topic 1) and blank-versus-zero (topic 5) remain open. |
| Compiled | 2026-10-17; DSR 2023 Vol. 1 pass 2026-10-19 |
| Compiled from | Cloud agent session; network access through an allow-list proxy |
| Primary sources read | 2026-10-17: **none**, because every primary host was unreachable (see §0). 2026-10-19: **CPWD, *Delhi Schedule of Rates 2023*, Vol. 1**, a scanned copy supplied by the owner (see §2.0). |

E3 frozen acceptance test (plan of record v1.0): *"BIS IS 1200 texts obtained and the deduction rules confirmed. DSR 2023 volume count, rate basis date, GST treatment and cost-index values confirmed from CPWD documents. Blank-versus-zero rules documented for each target tender portal."* Required evidence: *"Source register with document references."*

This file is that register. It records what was attempted, what could not be reached, and the exact documents still needed. It records search-result leads as **leads only**. A lead is not verification.

## Status summary

| # | Topic | Status | Why |
|---|---|---|---|
| 1 | BIS IS 1200 parts, editions, deduction rules | **DEFERRED (owner decision, 20 Oct 2026)** | The owner decided to skip deductions for now. No IS 1200 text has been read, so deduction rules stay **unconfirmed** and no deduction may be presented as rule-verified. Earlier status: BLOCKED (hosts unreachable, §0) |
| 2 | CPWD DSR 2023: volumes, titles, rate basis date, cost-index method | **CONFIRMED (Vol. 1 and Vol. 2)** | Two volumes, rate basis April 2023 / 01.04.2023, and sub-heads 1–12 in Vol. 1 with 13–26 in Vol. 2 (§2.1, §2.6). |
| 3 | GST treatment in DSR 2023 rates | **CONFIRMED (Vol. 1)** | Item rates include GST @18% (preface §6.2, p. 5). Basic rates exclude GST, contractor's profit and overheads (pp. 14, 18). **The app added GST again on DSR rates; see §3.1.** |
| 4 | Cost-index values applicable to DSR 2023 | **PARTLY CONFIRMED** | DSR 2023 is itself at cost index 107 against PAR 2021 = 100 as on 01.04.2021 (preface ¶3, p. 5). Location cost indices relative to DSR 2023 (for example for Srikakulam) are **not** in this volume and remain open. |
| 5 | Blank-versus-zero rules (CPPP, GeM, state portals) | **BLOCKED** | eprocure.gov.in, gem.gov.in and mahatenders.gov.in unreachable. One tender-specific lead (USOF) was found in search results only. |
| — | Repo/database DSR seed cross-check | **DONE for sub-heads 2–26** | Every seed item was checked against Vol. 1 (§2.5) and Vol. 2 (§2.6). 2,702 rates match; 19 seed rows have a wrong rate, wrong unit or are a parse artefact; 366 printed items are missing; 36 Vol. 1 items are on pages blank in the scan. |

Verified primary-source facts in this register: **0** on 2026-10-17. On 2026-10-19 the facts in §2.1, §3.1 and §4.1 were added, each with its page reference.

---

## 0. Access log (what was tried, from this environment, on 2026-10-17)

Two tools were used, and neither could read a primary source:

- **`curl` through the agent proxy.** Every host below returned `CONNECT tunnel failed, response 403`, meaning the allow-list refused it. As a control, `pypi.org` returned `200` and `www.google.com` returned `403`, so the proxy was working and the hosts were simply outside the allow-list.
- **WebFetch.** Every URL below failed with `getaddrinfo ENOTFOUND <host>`. A control fetch of `en.wikipedia.org` also failed with `ENOTFOUND`, so WebFetch had no external DNS at all in this session.

**WebSearch** worked, but it returns only titles, URLs and a model-written summary. It does not return the document text, so nothing it returned counts as having read a document.

| Host | Method | Result | Recorded as |
|---|---|---|---|
| cpwd.gov.in | curl / WebFetch | 403 CONNECT / ENOTFOUND | BLOCKED: host not reachable from this environment |
| www.cpwd.gov.in | curl | 403 CONNECT | BLOCKED: host not reachable from this environment |
| www.bis.gov.in | curl | 403 CONNECT | BLOCKED: host not reachable from this environment |
| services.bis.gov.in | curl / WebFetch | 403 CONNECT / ENOTFOUND | BLOCKED: host not reachable from this environment |
| standardsbis.bsbedge.com | curl | 403 CONNECT | BLOCKED: host not reachable from this environment |
| law.resource.org | curl / WebFetch | 403 CONNECT / ENOTFOUND | BLOCKED: host not reachable from this environment |
| archive.org | curl | 403 CONNECT | BLOCKED: host not reachable from this environment |
| indianrailways.gov.in | curl / WebFetch | 403 CONNECT / ENOTFOUND | BLOCKED: host not reachable from this environment |
| eprocure.gov.in | curl / WebFetch | 403 CONNECT / ENOTFOUND | BLOCKED: host not reachable from this environment |
| gem.gov.in | curl / WebFetch | 403 CONNECT / ENOTFOUND | BLOCKED: host not reachable from this environment |
| mahatenders.gov.in | curl | 403 CONNECT | BLOCKED: host not reachable from this environment |
| usof.gov.in | WebFetch | ENOTFOUND | BLOCKED: host not reachable from this environment |
| bis.gov.in | curl (retry, 17 Oct 2026) | 403 CONNECT (proxy policy) | BLOCKED: host not reachable from this environment |
| www.services.bis.gov.in | curl (retry, 17 Oct 2026) | 403 CONNECT (proxy policy) | BLOCKED: host not reachable from this environment |
| etenders.gov.in | curl (retry, 17 Oct 2026) | 403 CONNECT (proxy policy) | BLOCKED: host not reachable from this environment |
| assets-bg.gem.gov.in | curl (retry, 17 Oct 2026) | 403 CONNECT (proxy policy) | BLOCKED: host not reachable from this environment |
| cpwd.nic.in | curl (retry, 17 Oct 2026) | 403 CONNECT (proxy policy) | BLOCKED: host not reachable from this environment |
| cpwd.gov.in, law.resource.org | WebFetch (retry, 17 Oct 2026) | ENOTFOUND (no DNS for WebFetch) | BLOCKED: host not reachable from this environment |

**Fetched vs found:** no URL in this register was fetched successfully. Every URL in the "Leads" tables was **found in search results only** and has not been opened or read. Nothing was purchased, no account was created, and no attempt was made to get around the proxy.

---

## 1. BIS IS 1200 — Method of measurement of building and civil engineering works

### 1.1 Verified facts (primary source seen)

None. No IS 1200 text was obtained.

### 1.2 Interpretations

- **Parts Cunstruct needs.** These are the parts that match the work scope of the BOQ engine and the DSR chapters already seeded. The titles are the commonly used part titles and still need confirming against BIS:
  - Pt 1 Earthwork
  - Pt 2 Concrete work
  - Pt 3 Brickwork
  - Pt 4 Stone masonry
  - Pt 5 Formwork
  - Pt 8 Steel work and iron work
  - Pt 9 Roof covering
  - Pt 11 Paving, floor finishes, dado and skirting
  - Pt 12 Plastering and pointing
  - Pt 13 Whitewashing, colour washing, distempering and painting
  - Pt 14 Glazing
  - Pt 15 Painting, polishing, varnishing
  - Pt 16 Laying of water and sewer lines
  - Pt 18 Demolition and dismantling
  - Pt 19 Water supply, plumbing and drains
  - Pt 21 Woodwork and joinery
  - Pt 22 Materials
  - Pt 23 Piling
  - Pt 28 Damp-proofing / waterproofing
- **Opening-deduction thresholds.** The masonry, plastering and painting deduction thresholds that drive BOQ quantities are the most important unknown for Cunstruct.
  - Search results attribute a 0.1 m² opening threshold to IS 1200 Pt 3 (brickwork). This is **unverified**.
  - Deduction rules for plastering (Pt 12) and painting (Pt 13/15) are commonly said to differ from the masonry rule. This register does not state any value for them.
- **Unclear editions.** Search results conflict on current editions: Pt 1 is shown as both 1992 and 2025, Pt 5 as both 2013 and 2025, and Pt 27 as both 1992 and 2013. The current edition of each part must come from the BIS catalogue, not from a summary.

### 1.3 Unresolved / BLOCKED (exact missing sources)

| Missing document | Needed for | Where to obtain |
|---|---|---|
| IS 1200 (Part 1), current edition (1992 or a 2025 revision; unresolved) — Earthwork | Earthwork measurement and deduction rules | BIS (standardsbis.bsbedge.com / services.bis.gov.in "Know your standards"); law.resource.org for pre-2013 editions |
| IS 1200 (Part 2), current edition — Concrete work | Concrete and RCC deductions (openings, embedded items) | same |
| IS 1200 (Part 3), current edition — Brickwork | Opening deduction threshold (lead: 0.1 m², unverified) | same |
| IS 1200 (Part 4), current edition — Stone masonry | Masonry deductions | same |
| IS 1200 (Part 5), current edition (2013 or 2025; unresolved) — Formwork | Formwork area rules | same |
| IS 1200 (Part 8), current edition — Steel work and iron work | Reinforcement measurement (weight basis, laps, chairs) | same |
| IS 1200 (Part 11), current edition — Paving, floor finishes, dado and skirting | Flooring deductions | same |
| IS 1200 (Part 12), current edition — Plastering and pointing | Plaster opening deductions | same |
| IS 1200 (Parts 13 and 15), current editions — Whitewashing / painting | Painting deductions and coefficients | same |
| IS 1200 (Part 21), current edition — Woodwork and joinery | Doors and windows | same |
| IS 1200 (Part 28), current edition — waterproofing / damp-proofing (title to be confirmed) | Waterproofing | same |

Some of these texts may be paid on the BIS store. If so, they need a human with a BIS store account to buy them, or library access. Neither was attempted.

### 1.4 Leads (found in search results only; NOT fetched; NOT verification)

| Source | Type | URL | What it claims |
|---|---|---|---|
| BIS — index PDF on services.bis.gov.in | Primary (unread) | https://services.bis.gov.in/tmp/17410_22112024171414_6.pdf | According to the search summary, an index of IS 1200 parts with revision years. Fetch failed (ENOTFOUND). |
| BIS "Know your standards" detail pages | Primary (unread) | https://www.services.bis.gov.in/php/BIS_2.0/bisconnect/knowyourstandards/Indian_standards/isdetails/NjY0ODY= (one of several in the results) | Catalogue entries for individual IS 1200 parts. Not opened. |
| Public.Resource.Org — CED 44 manifest | Free mirror of BIS texts (unread) | https://law.resource.org/pub/in/bis/manifest.ced.44.html | Listing of CED 44 (measurement) standards. Host blocked. |
| infralens.in IS 1200 Pt 3 page | **Secondary** | https://www.infralens.in/code/IS-1200-Part-3-2000 | Openings up to 0.1 m² not deducted, larger ones deducted (as summarised by search). |
| GATE 2017 CE question (civil.gateoverflow.in) | **Secondary** | https://civil.gateoverflow.in/1348/gate2017-ce-2-33 | Treats "no deduction for openings up to 0.1 m²" in brickwork as settled. |
| NPTEL slide | **Secondary** | https://archive.nptel.ac.in/content/storage2/courses/105103093/modules/partiii/m3/slides/slide3.htm | Lists IS 1200 parts (e.g. Pt 28, 1992). |

---

## 2. CPWD Delhi Schedule of Rates (DSR) 2023

### 2.0 Source document (owner-supplied, 2026-10-19)

| Field | Value |
|---|---|
| Document | CPWD, *Delhi Schedule of Rates 2023*, Vol. 1 (Sub-heads 0–12), published by the Director General, CPWD, Nirman Bhawan, New Delhi |
| Copy | Scanned images without a text layer (PDF producer: iLovePDF), split into two files. Uploaded by the owner to Supabase Storage, bucket `project-drawings`, at the bucket root |
| Object 1 | `DSR Vol. 1-1-100.pdf`: pages 1–100, 30,526,249 bytes, SHA-256 `b2329b0396a1aca2bf69a74b8a76a75bc2bfbfe4d7ca04d856c14108837c99af` |
| Object 2 | `DSR Vol. 1-101-225.pdf`: pages 101–225, 33,585,193 bytes, SHA-256 `58cc91744e56863075ad4fee97afd458edb704104a428a63e04ad366054b67b8` |
| How it was read | OCR (tesseract 5.3.4, 300 dpi) of all 225 pages. Quoted facts were checked against the OCR text; the one rate disagreement was also checked on the page image |
| Page numbers below | Page *N* of the combined 225-page scan: object 1 page *N*, or object 2 page *N* − 100 |

### 2.1 Verified facts (primary source seen)

| Fact | Source text (OCR, as printed) | Page |
|---|---|---|
| **Two volumes** | "DSR 2023 is bilingual in two volumes. In case of any discrepancy between English and Hindi versions, the English version will prevail." (preface §6.1) | 5 |
| Vol. 1 covers sub-heads 0–12 | Contents: "A. BASIC RATES 0.1 Hire charges of plants & machinery, 0.2 Labour, 0.3 Materials"; "B. SUB-HEADS 1. Carriage of Materials … 12. Roofing"; "Note: For Sub Heads 13 to 26 refer Vol. 2" | 8 |
| **Rate basis date** | "DSR 2023 is based on the prevailing market rates of materials in Delhi during the month of April 2023. The labour rates adopted are as per minimum rate of wages applicable with effect from 01.04.2023 issued by Chief Labour Commissioner, Govt. of India / Commissioner (Labour), Govt. of Delhi, whichever is higher." (preface ¶2) | 5 |
| Basic-rate tables dated | Column header "Basic Rate as on or just before 01.04.2023" | 14–18 |
| Rates are indicative | "The rates taken in Delhi Schedule of Rates 2023 are indicative and actual rates shall be governed by the …" | 3 |
| Edition history | Previous edition 2021. 2023 revision made for: the two-yearly revision in the CPWD Manual, correction slips No. 1–21, and "Revision of GST rates on works from 12% to 18% w.e.f 18.07.2022" (foreword) | 4 |
| Companion specification | "This DSR 2023 shall be read along with CPWD Specifications 2019 Vol.-I & I[I] with up to date correction slips." (preface ¶5; OCR reads "I & I", most likely "I & II") | 5 |
| Non-scheduled items | "The technical sanctioning authority may decide rates of non-scheduled items judiciously, based on market rates without adding cost index." (preface ¶4) | 5 |
| Price | "Rs. 1400/- (for both volumes)" | 3 |

These facts supersede the interpretations in §2.2 where they overlap: the volume count is **two**, and the rate basis is **April 2023 / 01.04.2023**.

### 2.5 Item-level check of the DSR seed against Vol. 1 (sub-heads 2–12)

The seed is in `dsr_item` (DSR 2023) and in `supabase/migrations/20260731001000_dsr_seed_civil.sql`; the two are identical row for row. It has 1,113 items in sub-heads 2–12.

**How the check was done.** Each item was looked up in the OCR text of Vol. 1. Every item OCR could not settle was then read from 300-dpi page renders by eye. Results per item are in `docs/benchmarks/e3/dsr2023-vol1-item-check.csv`.

| Result | Items |
|---|---|
| Rate matches the printed rate | **1,075** |
| Rate differs | **1**: **6.44** brick edging, printed **₹59.45 per metre**, seed ₹60.85 (p. 141, checked on the page image) |
| Line printed without code or rate | 1: **6.25** "Extra for laying brick work in or under foul position", printed with unit cum and no rate, so the seed's ₹467.55 cannot be checked (p. 139) |
| Unresolved, because the source page is blank in the uploaded copy | **36**: pp. 157–158 (9.1.1–9.6.1), p. 174 (9.122–9.123A), p. 180 (9.146, 9.147) and p. 224 (12.65.x, 12.66.x). These pages hold no image in the PDF (checked with `pdfimages`) |
| Printed in Vol. 1 but **missing from the seed** | **104**, listed in `docs/benchmarks/e3/dsr2023-vol1-missing-items.json` |

**Unit wording.** Three items match on rate but word the unit differently. 6.24 and 7.34 are printed "cum per metre depth" and 12.33 "sqm per metre height"; the seed has "metre" for all three.

**The 104 missing items.** These include:
- **Whole sub-item families where the seed kept only the first sub-item:**
  - 9.147 uPVC windows/doors: 54 sub-items
  - 11.41A: 14
  - 4.20A: 7
  - 5.22A: 5
- **Standalone items:** 3.18, 4.9A, 4.9B, 4.12, 4.15, 4.18, 5.10.1–5.10.4, 5.28, 5.33A.x, 5.49, 7.22, 8.32, 9.115, 9.161, 9.172, 10.22 and 2.25(a).
- **Percentage extras** (2.24.1, 2.24.2, 5.9.14): rates expressed as a percentage, not money.

Any items printed on the blank pages are unknown.

**Sub-head 1 (Carriage of Materials).** It is absent from the seed entirely. Vol. 1 pp. 94–99 print 77 priced rows, most of them with distance-band rates.

**Status.** The seed is accurate where it has an item: 1,075 of the 1,076 checkable rates match. It is incomplete, however, and one rate is wrong.
- **Corrections not applied.** Fixing it means a data migration to production, which needs the owner's explicit approval (plan v1.2 §7.3). No correction has been applied.
- **Still to come.** The 36 unresolved items need a complete copy of pp. 157–158, 174, 180 and 224. Sub-heads 13–26 need Vol. 2.

### 2.6 Item-level check of the DSR seed against Vol. 2 (sub-heads 13–26)

**Source.** CPWD, *Delhi Schedule of Rates 2023*, Vol. 2. A 226-page scan supplied by the owner on 2026-10-19 as `project-drawings/DSR Vol 2.pdf` (37,511,705 bytes, SHA-256 `aa292c6019c8c79c83113526b39f66cf1aa741bf46f375b8c26c4176a91e1170`). Its foreword and preface (pp. 4–5) repeat Vol. 1's basis facts word for word: two volumes, April 2023 / 01.04.2023, GST @18% incorporated in all items, and cost index 107. Vol. 2 reads clearly "CPWD Specifications 2019 Vol.-I & II".

**Coverage.** All 1,645 seed items in sub-heads 13–26 were checked. Rate pages are pp. 14–177 (printed pp. 217–380), with continuous page numbers. The 23 blank pages are section breaks, so no rate page is missing. Pp. 178–225 are appendices of cement and bitumen consumption coefficients, not rates. Results per item are in `docs/benchmarks/e3/dsr2023-vol2-item-check.csv`.

| Result | Items |
|---|---|
| Rate matches the printed rate | **1,627** |
| **Wrong rate in the seed** | **5**, each checked on the page image: 13.67.1 (printed 233.80, seed 236.10, p. 19); **13.114 (printed 1,192.30, seed 138.10, p. 22)**; 13.116 (3,049.85 vs 1,360.45, p. 23); 14.78 (422.70 vs 84.85, p. 31); 26.42.1 (3,580.65 vs 3,903.35, p. 162) |
| **Seed holds an appendix coefficient instead of the rate** | **8**: 26.53 (2,604.30 vs 0.72); 26.73.1.1, .3 and .5 (1,287.25, 1,822.60 and 2,717.10 vs 0.36, 0.54 and 0.84); 26.74.1–.4 (20,928.70, 245.65, 450.40 and 573.20 vs 3.70, 0.30, 0.55 and 0.70); pp. 166–170 |
| **Seed row is a parse artefact** | **1**: 26.82, printed sqm 2,293.30; the seed has unit "No" and rate 16.25, with a description taken from the appendix (p. 172) |
| **Rate right, unit wrong** | **4**: 15.15.1, 15.16.1, 15.20 and 15.21 are printed as "per metre span / height" units; the seed has "metre" (p. 37) |
| Printed but **missing from the seed** | **262**, listed in `docs/benchmarks/e3/dsr2023-vol2-missing-items.json`. Mostly water-supply fittings in sub-head 18 (163), plus sub-head 26 (55) and pile load tests in 20.6–20.9 |

**Description text.** Thirteen seed descriptions carry page-footer or appendix text, for example 15.60, 16.96 and 18.105.3. Their rates are unaffected.

**Use in saved BOQs.** As of 2026-10-20, none of the 27 BOQs uses any item with a wrong rate or unit, whether from Vol. 1 or Vol. 2. The wrong rates would only affect new BOQs.

**Status.** No correction has been applied. Corrections are a production data change and need the owner's approval (plan v1.2 §7.3).

### 2.2 Interpretations

- **Volume count.** Search summaries describe the Railway Board letter of 03.07.2025 as referring to "CPWD DSR-2023 (Vol. I, Vol. II)". This is consistent with the repo seed header "DSR Civil (Vol 1+2)". It is **unverified**, because the letter was not read.
  - A secondary site (infralens) reportedly says four volumes. That may count the Analysis of Rates volumes or E&M separately.
  - The civil DSR volume count stays **unresolved** until the CPWD title pages are read.
- **Rate basis date.** The repo seed header says "rates as on 01.04.2023". This register has **not** confirmed that date from a CPWD document. By analogy, search summaries say DSR 2021 was based on market rates as of 01.04.2021, which is consistent with but not proof of a 01.04.2023 basis for 2023.
- **Cost-index method.** Search summaries of the Railway Board letter say DSR 2023 applies "all over India with suitable factor called 'Building Cost Index'". The same summaries say zones adopt the CPWD zonal index or derive one from Plinth Area Rates 2023 Annexure-IV. This is **unverified**.

### 2.3 Unresolved / BLOCKED (exact missing sources)

| Missing document | Needed for | Where to obtain |
|---|---|---|
| CPWD, *Delhi Schedule of Rates 2023*, Vol. I (Civil) — title page, preface, general notes | Volume count and titles, rate basis date, rate build-up, GST note | https://www.cpwd.gov.in/Documents/cpwd_publication.aspx (URL from search summary; not fetched) |
| CPWD, *Delhi Schedule of Rates 2023*, Vol. II (Civil) — title page, preface | Volume count; confirm chapters 2–26 split between volumes | same |
| CPWD, *Delhi Analysis of Rates 2023* (volumes and count unknown) | Rate build-up (overheads/profit) and tax treatment | same |
| Railway Board letter dated 03.07.2025, "Adoption of CPWD Delhi Schedule of Rates-2023" | Second, official confirmation of volume count and cost-index method | https://indianrailways.gov.in/railwayboard/uploads/directorate/civil_engg/2025/2025_07_03%20Adoption%20of%20CPWD%20Delhi%20Schedule%20of%20Rates-2023%20(2).pdf (found in search; not fetched) |

### 2.4 Leads (found in search results only; NOT fetched; NOT verification)

| Source | Type | URL | What it claims |
|---|---|---|---|
| Railway Board (Ministry of Railways), letter 03.07.2025 | Primary, issued by a Government of India body but not CPWD (unread) | URL in §2.3 | DSR-2023 Vol. I and Vol. II published by CPWD HQ New Delhi; applied with "Building Cost Index"; zones adopt the CPWD zonal index or derive it from PAR-2023 Annexure-IV. |
| infralens.in DSR 2023 guide | **Secondary** | https://infralens.in/knowledge/dsr-2023-complete-guide-civil-em-walkthrough | Volume structure; flat 15% contractor profit and overhead. Reportedly says cpwd.gov.in has an invalid SSL certificate. |
| infralens.in CPWD SOR page | **Secondary** | https://infralens.in/sor/cpwd | Lists DSR Civil 2023 Vol 1 and 2. |

---

## 3. GST treatment in DSR 2023 rates

### 3.1 Verified facts (primary source seen)

| Fact | Source text (OCR, as printed) | Page |
|---|---|---|
| **DSR 2023 item rates include GST @18%** | "The effect of GST @18% on works contract has been incorporated in all items." (preface §6.2) | 5 |
| GST rate on works | "Revision of GST rates on works from 12% to 18% w.e.f 18.07.2022." (foreword) | 4 |
| **Basic rates exclude GST, profit and overheads** | "Note: These rates are exclusive of GST, contractor's profit and over heads etc." (basic rates, plant and machinery); the materials and labour tables carry the same note | 14, 18, 20 |

**What this means for Cunstruct.** Rates taken from `dsr_item` (DSR item rates) already include GST @18%.

- **The defect.** The app's BOQ document and its defaults treated every rate as excluding GST, and added GST at a default of 18% to the whole works total. All 27 BOQs in the database use that default, so every DSR-priced line was charged GST twice.
- **The fix** is tracked in the PR "fix: DSR 2023 rates include GST" (see the evidence log). GST is added only to lines priced at the estimator's own rate or a catalogue price.

**Still not confirmed: contractor's profit and overheads.** Vol. 1 does **not** state whether DSR *item* rates include contractor's profit and overheads; only the *basic* rates are stated to exclude them. Whether the app's default overhead line (15%) also double-counts needs the Delhi Analysis of Rates 2023, and stays open until then.

### 3.2 Interpretations

- **No lead.** None of the search results states whether DSR 2023 rates are inclusive or exclusive of GST, and no CPWD GST circular was found.
- **Not a DSR statement.** One tender format (IPR, nsd.ipr.res.in) says quoted rates include GST. That is a single tender's condition, not a DSR statement, and must not be used as one.
- **Pending confirmation.** Cunstruct must not treat seeded DSR rates as either GST-inclusive or GST-exclusive until this is confirmed.

### 3.3 Unresolved / BLOCKED

| Missing document | Needed for |
|---|---|
| DSR 2023 Vol. I general notes / preface (paragraph on taxes) | Whether rates include GST |
| Any CPWD office memorandum or circular on GST in DSR rates or in the Analysis of Rates 2023 (number and date unknown) | Official GST treatment and any adjustment rule |
| Delhi Analysis of Rates 2023 — overhead / tax line in the rate build-up | Whether GST sits inside the analysed rate |

### 3.4 Leads (search results only; NOT fetched)

| Source | Type | URL | What it claims |
|---|---|---|---|
| IPR tender format PR-06-2023 | Tender-specific, not a DSR source | https://nsd.ipr.res.in/documents/IPRTNCIVIL-PR062023_PB-AugWorkshop-PR-06-2023-Format.pdf | "rates quoted shall include all taxes including GST" (as summarised by search; applies to that tender only). |

---

## 4. Cost-index values applicable to DSR 2023

### 4.1 Verified facts (primary source seen)

| Fact | Source text (OCR, as printed) | Page |
|---|---|---|
| DSR 2023's own cost-index level | "The cost index for DSR 2023 is 107 with reference to CPWD Delhi Plinth Area Rates 2021, having base 100 as on 01.04.2021" (preface ¶3) | 5 |
| No cost index on non-scheduled items | Rates of non-scheduled items are decided "based on market rates without adding cost index" (preface ¶4) | 5 |

**What 107 is.** The value 107 states where DSR 2023 sits relative to PAR 2021. It is **not** an index to add to DSR rates.

**What is still missing.** The *location* cost index that adjusts DSR 2023 rates for a place outside Delhi (for example Srikakulam, Andhra Pradesh) is published separately by CPWD and is **not** in Vol. 1. The app's default `_cost_index_pct` of 0% is therefore the correct "no location adjustment" default, but no location value is confirmed.

### 4.2 Interpretations

- **Base convention.** A search summary says DSR 2021 used a cost index of 105 relative to CPWD Delhi Plinth Area Rates 2020 (base 100 as on 01.04.2020). That points to a "PAR base = 100" convention. It concerns DSR 2021, is unverified, and gives no DSR 2023 value.
- **What to record once reachable.** Indices are reportedly issued per location and revised periodically. For each location, the register should hold the circular number, its date, the base, the index value and the effective date.

### 4.3 Unresolved / BLOCKED

| Missing document | Needed for |
|---|---|
| CPWD cost-index circular(s) for DSR 2023 / PAR 2023 (numbers and dates unknown; on cpwd.gov.in) | Index values, locations, effective dates |
| CPWD *Plinth Area Rates 2023*, Annexure-IV (named in the Railway Board letter summary) | Zonal Building Cost Index derivation |

---

## 5. Blank-versus-zero rules for target tender portals

### 5.1 Verified facts (primary source seen)

None.

### 5.2 Interpretations

- **CPPP (eprocure.gov.in).** No portal-level document was found that defines how the BoQ macro sheet treats blank and zero cells. Search summaries suggest the rule sits in each tender's own "Instructions for BoQ" and corrigenda, not in a portal-wide rule. That would mean the blank-vs-zero meaning has to be captured **per tender**.
- **USOF lead (tender-specific).** One tender's BoQ instructions reportedly say to leave the rate blank for units not bid, and not to enter zero. That makes blank mean "not bid" and zero a quoted price of nil. The document was not read.
- **GeM and state portals.** No leads found. Nothing is recorded.

### 5.3 Unresolved / BLOCKED

| Missing document | Portal | Needed for |
|---|---|---|
| CPPP bidder manual / "BoQ instructions" help document (eprocure.gov.in help section; document name and version unknown) | CPPP | Portal-default macro behaviour for blank vs 0 |
| Standard CPWD e-tender BoQ "Instructions" sheet (embedded in the .xls BoQ template) | CPPP (CPWD tenders) | What a blank or 0 rate / quantity does to the total and to validation |
| GeM bid / BoQ bid seller instructions (document name unknown) | GeM | Same question; first confirm whether GeM BoQ bids are in scope at all |
| State e-procurement (e.g. mahatenders.gov.in, NIC GePNIC) bidder manual | State portals | Same question; target states must first be named in the plan |

### 5.4 Leads (search results only; NOT fetched)

| Source | Type | URL | What it claims |
|---|---|---|---|
| USOF, "Instructions for BoQ" 22.03.2021 | Tender-specific primary (unread) | https://usof.gov.in/upload/all_projects_documents/LWE/LWE_phase_2/Tender/Instructions_for_BoQ22032021.pdf | Leave quoted rate "Blank" for units not bid; do not put "zero". |
| CAG corrigendum (outsourcing tender) | Tender-specific (unread) | https://cag.gov.in/uploads/tenders/Corrigendum_Outsourcing_the_Departmental_Examinations.pdf | Revised BoQ template on CPP Portal; rate column exclusive of taxes for that tender. |
| IPR tender Section D | Tender-specific (unread) | https://www.ipr.res.in/documents/IPR_TN_PUR_TPT_ET_21_22_021_Updated-Section-D.pdf | Sample BoQ output shows "0.00 INR Zero Only" for a zero line. |
| tender18.com blog | **Secondary** | https://tender18.com/blog-details/How-to-Prepare-a-BOQ-for-Government-Tender-Bidding | Government BoQs are macro-enabled Excel; editing the template can cause rejection. |

---

## 6. Repo cross-check — DSR seed

File: [`supabase/migrations/20260731001000_dsr_seed_civil.sql`](../../supabase/migrations/20260731001000_dsr_seed_civil.sql) (inspected, not modified).

### 6.1 What the seed says about itself

| Attribute | Seed value | Source within the repo |
|---|---|---|
| Header line 1 | `-- DSR Civil (Vol 1+2), chapters 2-26. Auto-extracted from uploaded CPWD DSR PDFs; rates as on 01.04.2023.` | seed line 1 |
| Header line 2 | `-- Billable items only; each carries full parent-stitched description. Idempotent.` | seed line 2 |
| `source` / `rate_year` | `'DSR'` / `'2023'` on every row | all rows |
| Row count | 2,758 rows, all `billable = true` | `grep -c "^('DSR'"` on the file |
| Chapters | 25 chapters, 2.0 Earthwork through 26.0 New Technologies (no chapter 1) | distinct `chapter` values |
| Extraction tools | [`scripts/extract_dsr_mupdf.py`](../../scripts/extract_dsr_mupdf.py) (docstring: "CPWD DSR Vol-1 (Civil) PDFs") and [`scripts/extract_dsr.py`](../../scripts/extract_dsr.py) | script headers |
| Source PDF provenance | "uploaded CPWD DSR PDFs". No file name, hash, CPWD URL or download date is recorded in the seed. | seed line 1 |

### 6.2 Agreement with register findings

| Claim in seed | Register finding | Agreement |
|---|---|---|
| Two civil volumes ("Vol 1+2") | Unverified. Only a search-summary lead (Railway Board letter) says Vol. I and Vol. II. | **Cannot confirm** (consistent with the lead) |
| Rate basis "as on 01.04.2023" | Not confirmed from any CPWD document | **Cannot confirm** |
| 2,758 billable items, chapters 2–26 | No CPWD item count obtained | **Cannot confirm** |
| GST inclusion | Seed is silent | **Gap in seed and register** |
| Cost index | Seed stores Delhi base rates only, with no index field or value | **Gap**: cost-index handling is unrecorded |

**Seed provenance gap.** The seed names no specific source document (file name, hash, CPWD URL, edition or corrigendum level), so it cannot be traced to a primary document. This is noted here only; the seed is unchanged.

---

## 7. What would move each topic forward

1. **Allow-list the hosts.** Add these to the environment's network allow-list: cpwd.gov.in, www.cpwd.gov.in, services.bis.gov.in, standardsbis.bsbedge.com, law.resource.org, indianrailways.gov.in, eprocure.gov.in, gem.gov.in. Alternatively, fetch the documents listed in §§1.3, 2.3, 3.3, 4.3 and 5.3 from a machine with normal internet access and add them to the repo or storage with their source URL and download date.
2. **Purchase decision for BIS texts.** For IS 1200 parts not on law.resource.org (post-2013 revisions in particular), a human must decide whether to buy them from the BIS store. No purchase was made.
3. **Name the target state portals.** Name them in the plan so §5 has a finite list to check.

---

## 8. Pass 2 (2026-10-17): uPVC door and window measurement and pricing

Scope: the sources the PO named for uPVC openings. No other trade.

### 8.1 Named official sources and access status

| ID | Source (issuer · type) | URL | Version / date (as named; not confirmed) | Accessed? | Status |
|---|---|---|---|---|---|
| E3-U1 | CPWD · Specifications 2019, Correction Slip No. 17 (clauses 9.28.14 and 9.28.15, uPVC doors and windows: measurement and payment) | `https://cpwd.gov.in/WriteReadData/speci_materials_cir/54610.pdf` | 06 May 2022 | **No.** curl through the proxy: exit 56, CONNECT refused. WebFetch: `ENOTFOUND cpwd.gov.in` | **BLOCKED.** No clause text inspected. |
| E3-U2 | CPWD · Delhi Analysis of Rates 2023, Civil, Vol. I (item 9.147 and sub-items) | `https://cpwd.gov.in/Publication/CPWD_DAR_Vol_I_14092023-Civil.pdf` | file name indicates 14 Sep 2023 (unconfirmed) | **No.** Same failure | **BLOCKED** |
| E3-U3 | CPWD · DSR/DAR 2023 correction slip | `https://www.cpwd.gov.in/WriteReadData/dar/62530.pdf` | unknown | **No.** Same failure | **BLOCKED.** Which items it modifies is unknown. |
| E3-U4 | BIS · Indian Standards catalogue (IS 1200 parts) | `https://standards.bis.gov.in/` | — | **No.** curl exit 56 | **BLOCKED.** Not even catalogue metadata was seen. |

Search on 17 Oct 2026 returned no text of E3-U1 or E3-U3. The results were third-party tenders that cite "CPWD specification" for uPVC windows (for example [IIM Udaipur uPVC specification](https://www.iimu.ac.in/../upload_data/Tender/TechnicalspecificationsforuPVCwindows.pdf)) and a BIS preliminary draft for uPVC framed doors and windows (August 2024, `services.bis.gov.in`, not opened). These are **leads only** and establish no rule.

### 8.2 What Cunstruct's own DSR seed contains (repository fact, NOT official verification)

Source: `supabase/migrations/20260731001000_dsr_seed_civil.sql` on `main` (`6206e8c`), SHA-256 `be97440c81c6fef5170f9179ca3e34e118ed03e392bf2cabd00de0a7bdbe1d0c`.
- **Header:** "DSR Civil (Vol 1+2), chapters 2-26. Auto-extracted from uploaded CPWD DSR PDFs; rates as on 01.04.2023."
- **Correction slips:** no correction-slip version is recorded, so whether any correction slip is applied is **unknown**.

| Item | Unit | Seed rate (₹) | What the seed text says | Consequence for measurement or pricing (seed only) |
|---|---|---|---|---|
| 9.147 | sqm | 8,298.85 | "factory made uPVC glazed/wire mesh windows/ doors comprising of … frame, sash and mullion/coupler … in any shape, colour and design …". Includes: "Wire mesh / Glazing … shall be paid separately". Gives minimum wall thickness by **Series R1 and R2** and **Series R3 and R4**. Ends with the embedded sub-item text **9.147.A1** "Two track two panels sliding window …" / **9.147.A1.1** "Using R2 series … (Height upto 1.2 metre)" | One assembly item **per square metre**. **Glazing and wire mesh are separate items.** Selecting a rate needs the opening type, profile series and height band. **The seed holds no other 9.147 sub-item**, so whether ₹8,298.85 is the rate of 9.147.A1.1 alone, or of anything else, is **unverified** |
| 9.117.1, 9.117.2, 9.143 | metre | 270.20 / 331.35 / 623.00 | uPVC **door frame** of extruded sections | Frames are separate, **per-metre** items: not an opening assembly |
| 9.118.1–3 | sqm | 2,969.25 / 3,253.80 / 3,068.85 | PVC **door shutters** "to existing door frames" | Shutters are separate **per-sqm** items |
| 9.148.1–5, 9.149–9.153 | each | 115.80 – 624.60 | Hinges, handles, locks and rollers for uPVC windows and doors | Hardware **accessories** are separate **per-each** items |

### 8.3 Rule status for this pass

| Rule asked for | Status | Why |
|---|---|---|
| Units and dimension booking for uPVC openings | **Unresolved** | E3-U1 not inspected. The seed's units (sqm / metre / each) are not a measurement rule. |
| Outer-frame dimensions and area rounding | **Unresolved** | E3-U1 not inspected. No other source seen. |
| Glazing, wire mesh and hardware: included or separate | **Seed text only, unverified officially** | The seed 9.147 text says glazing and wire mesh "shall be paid separately", and hardware exists as separate seed items. The official DSR/DAR text and any correction slip have not been inspected. |
| Assembly vs frame, sash, mullion and accessory items | **Seed text only, unverified officially** | 9.147 is an assembly; 9.117/9.143 frames, 9.118 shutters and 9.148–9.153 hardware are separate seed items. |
| Profile series and configuration needed to choose a 9.147 rate | **Seed text only, and incomplete** | The seed names Series R1–R4 and only one sub-item (A1.1). The full sub-item list is in E3-U2 (not inspected). |
| Woodwork and joinery measurement (IS 1200) | **Unresolved** | E3-U4 and the IS 1200 texts were not accessible. |
| Rate and correction history for every cited rate | **Unresolved** | E3-U3 not inspected. The seed records no correction status. |

**Applicability:** CPWD specifications and DSR/DAR rates bind CPWD works and contracts that adopt them. They are not universally binding on private projects.

### 8.4 To resolve

Either of these would resolve every row above:
- Allow `cpwd.gov.in`, `www.cpwd.gov.in` and `standards.bis.gov.in` in this environment's network policy.
- Place copies of E3-U1, E3-U2 and E3-U3, and the relevant IS 1200 parts, under the git-ignored `benchmark-inputs/E3/`.

## Checks performed on this register

- **No fetched URLs.** Every URL here was found in search results or comes from the repo. None was fetched successfully; the failed attempts are logged in §0.
- **Relative links.** The links in §6 (`../../supabase/migrations/...`, `../../scripts/...`) resolve from `docs/benchmarks/`.
- **No invented content.** No clause numbers, quotes, index values or GST positions are given as verified. The short quotes in the lead tables are labelled as search-summary text, not text read from the document.
- **Not DONE.** E3 is not declared DONE.
