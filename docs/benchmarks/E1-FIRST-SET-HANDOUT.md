# First benchmark set: handout for owners, surveyors and the intake person

> **Status: DRAFT. Nothing has been sent and no set has been received.**
> - Parts 2 and 4 (the permission letter and the surveyor brief) need the PO's legal adviser and the PO's written approval before they are sent.
> - Fill every `[bracket]` before use.
> - Sending this handout does **not** move plan item E1 forward. E1 moves only when a set passes the intake check in Part 9.

**Who this is for.** Read only your own part; you do not need anything else from the repository.

| Reader | Part |
|---|---|
| Owner of the drawings (developer, client, department or architect) | 1, 2, 3, 5 |
| Quantity surveyor A or B (measures the set) | 4A, 5 |
| Adjudicator (a third, independent quantity surveyor) | 4B, 5 |
| Cunstruct intake person (receives, files and checks everything) | all, especially 6–9 |

**What we are doing, in one paragraph.** Cunstruct is software that reads quantities (areas, counts, lengths) from building drawings. To find out how accurate it really is, we need real drawing sets, measured by people. For each set, two quantity surveyors measure it separately. A third surveyor resolves their differences and produces the agreed ("gold") result. Only then do we compare the software with that gold result. The plan needs 10–20 such sets; this handout is for the first.

---

## Part 1. Message to the drawing owner

Send by email, or by WhatsApp **to one person directly** (never a group). Do not attach drawings or ask for them in this first message.

**Email**

> **Subject: Permission to use one drawing set for an accuracy test**
>
> Dear [name],
>
> I am [your name] from [Cunstruct legal entity]. We are testing how accurately our software measures quantities from building drawings, and would like to ask permission to use the drawings of **[project / building, as you know it]**.
>
> What it involves for you:
> - one PDF drawing set (the architectural plans, sections and elevations, and any schedules) as issued;
> - signing a one-page permission letter, which I attach. It limits use to this test, keeps the drawings private, and lets you withdraw at any time.
>
> What we would publish: only overall accuracy figures. Your drawings, the project, the client and the site would not be shown or named unless you say so.
>
> If you are willing, I will call you to answer any questions before you send anything. If you are not the right person to grant this, could you tell me who is?
>
> Thank you,
> [name, role, phone, Cunstruct legal entity]

**WhatsApp (short)**

> Hello [name], this is [your name] from [Cunstruct legal entity]. We're testing how accurately our software measures quantities from building drawings, and would like your permission to use the drawing set for [project]. It stays private, only overall accuracy figures are ever published, and you can withdraw at any time. May I send you the one-page permission letter and call you for 10 minutes? Please don't send any drawings on WhatsApp.

---

## Part 2. What the owner provides, and what they permit

**Provide**
1. The drawing set **as issued**: every architectural floor plan (every floor), at least one section, the elevations, and any schedules (doors and windows, finishes, areas). Structural drawings are welcome but optional.
2. **One current revision** of each sheet; no superseded sheets mixed in.
3. The signed permission letter below.
4. Confirmation that the drawings show a real building in India that was built or tendered.

**Permission letter (wording carried over unchanged from the pilot package; LEGAL REVIEW REQUIRED)**

> **Request to use one drawing set for an independent accuracy test**
>
> [Cunstruct legal entity] is testing how accurately its software reads quantities from construction drawings. We would like your permission to use one drawing set: **[project / set description, number of files]**.
>
> **1. What we would do with the drawings**
> (a) Store them privately, encrypted at rest, outside any public or shared code repository. Access is limited to [named people].
> (b) Run our software on them once.
> (c) Give them to three independent quantity surveyors (two measurers and one adjudicator), each bound by a written confidentiality and deletion agreement. They would prepare measurement sheets and a reference bill of quantities.
> (d) Compare our software's results with the surveyors' results.
>
> **2. What we would publish:** aggregate accuracy figures only. These would not reproduce the drawings and would not identify the project, the client or the site, unless you tick here: ☐ the project may be named.
>
> **3. What we would not do:** publish, sell, sublicense or otherwise share the drawings or the measurement sheets made from them; use them for any purpose other than this test; or use them to train any model offered to third parties [**delete if a broader use is agreed**].
>
> **4. Retention and deletion**
> - We would keep the files and the measurement sheets for **[period]** for audit.
> - The surveyors must delete their copies within **[7]** days of delivery and confirm this in writing.
> - You may withdraw permission in writing at any time. We would then delete the files and everything made from them within **[30]** days, except aggregate figures already published.
>
> **5. Your confirmation**
> - You are authorised to grant this permission.
> - The drawings are of a real building in India.
> - To your knowledge, the set has not previously been given to [Cunstruct legal entity] or processed by its software.
>
> Signed: ____________  Name / role / organisation: ____________  Date: ________  Contact: ____________

The legal adviser must confirm: the legal entity name; the retention period; deletion timelines; Digital Personal Data Protection Act 2023 implications if personal data appears on the drawings; whether the authority confirmation is sufficient; the model-training clause.

---

## Part 3. Acceptable formats, and keeping the originals untouched

| Format | Accepted? |
|---|---|
| PDF exported from CAD (text can be selected) | **Yes: preferred.** The first set must be this kind ("vector"). |
| Scanned PDF or image files | Yes for later sets (the plan needs some), **not** for the first set. |
| CAD files only (DWG / DXF) | Ask the owner for PDFs plotted from them. We do not convert files ourselves: any file we create is no longer the owner's original. |
| Photos of printed sheets | No. |

**Originals are never edited.** The intake person:
1. saves every received file unchanged in `received/`;
2. records its SHA-256 fingerprint immediately (Part 9, step 2), before opening it;
3. if the set came as several PDFs, makes **one** combined PDF for measuring and scoring, by joining the pages in sheet-list order without re-rendering (for example `qpdf --empty --pages received/*.pdf -- drawings/S01.pdf`, files listed in sheet order), and records that file's fingerprint too.

Everyone (both surveyors, the adjudicator and the software) measures **the same combined PDF**, identified by its fingerprint.

---

## Part 4A. Brief for quantity surveyor A and quantity surveyor B

*(Wording from the pilot package's quotation brief; PO approval required before sending. Send A and B their briefs and drawings separately, never in the same email or chat.)*

**Your role.** You are one of two surveyors who measure this drawing set **independently**. A third surveyor will compare your work with the other surveyor's. You will not see their work, and they will not see yours.

**Independence (strict)**
- Work alone. Do not discuss the drawings with anyone else measuring them, and do not ask who they are.
- Do not view any software output for these drawings.
- Declare any relationship with the other parties or with us.
- Deliver your files **only** to the Cunstruct intake person named below, by the secure route in Part 5.

**Scope:** every page of the set. Items that need documents not in the set (specifications, BBS, services drawings) are listed as out of scope, with no figure.

**Confidentiality:** use the drawings only for this work; do not copy or share them.

**Deliverable 1: complete IS 1200 measurement sheet** (Excel), for every in-scope item. Name the file with the word `measurement`, for example `measurement-sheet.xlsx`.
- **Columns:** item · location / grid · drawing page and reference · No · L · B · D · deductions · quantity · unit · measurement rule applied · IS 1200 part and clause · scaled? (yes/no) · for scaled rows, the drawing reference, scale used and method.
- **Scaling** is allowed when necessary, but every scaled row must be marked.
- **Uncertain quantities:** a quantity that cannot be established defensibly is marked ambiguous or unmeasurable, with its reason. No estimates.

**Deliverable 2: reference BOQ** in our format (JSON or the spreadsheet template we send, following the enclosed brief **exactly**). This is a separate document; it never replaces the measurement sheet.
- **Room floor areas:** gross, from the printed L × W, with no deductions and no scaling.
- **Counts:** as printed.
- **Other items:** measured from printed dimensions only, each with its own measurement rule.
- **Items only obtainable by scaling:** listed as unmeasurable, never given a figure.

**Also send** a signed independence declaration, and, within **[7]** days of acceptance, a signed confirmation that you have deleted all copies.

**Corrections:** one round of **format** corrections is included, within **[3]** working days of our notice. Questions about **content** are answered from the drawing only. We never edit your figures.

## Part 4B. Brief for the adjudicator

**Your role.** You are an independent third surveyor. You receive the combined drawing PDF and the two surveyors' deliverables, and nothing else: no software output, ever.

**Deliverable 1: adjudicated IS 1200 measurement sheet** (file name containing `measurement`), with every column of Part 4A, and its own **disagreement log** (file name containing `disagreement`, CSV), one row per item where A and B differed, with your decision and reason (drawing page and rows).

**Deliverable 2: gold reference BOQ** in our format, prepared by you, with `preparedBy` set to your name, and its own disagreement log. Rules:

| A and B… | Gold line |
|---|---|
| agree within tolerance (counts exact; areas ±1 % or 0.05 m²; other units ±1 %) | Re-check both. Take A's figure if both are arithmetically correct. |
| differ beyond tolerance | Re-measure from the drawing; adopt the figure whose rows match the drawing, or write your own rows. **Never average.** |
| disagree on status (measured vs ambiguous) | Decide from the drawing; if still not defensible, the line is ambiguous with a note. No invented quantity. |
| one lists an item the other missed | Check the drawing; include it if it exists and log the omission, otherwise exclude it and log the false inclusion. |

No measured gold line may rest on a scaled measurement. Also report the counts: lines paired; within tolerance; outside tolerance; status disagreements; one-sided lines.

---

## Part 5. Sending and storing files securely (everyone)

- **Never** post drawings, measurement sheets or BOQs in a WhatsApp group, a public link, or a shared folder anyone can open.
- Send files only to the named Cunstruct intake person: **[name, email]**, using **[the agreed private, access-controlled link or encrypted archive; password shared by phone, not in the same message]**.
- Surveyors delete their copies within **[7]** days of acceptance and confirm in writing.
- Cunstruct stores every file of the set on an encrypted disk, in `benchmark-inputs/E1/<set>/`. Git is set to ignore that folder, so it can never be committed (checked by `scripts/benchmark/input-ignores.test.ts`). Personal details (names, phone numbers, emails) live only in the local register `benchmark-inputs/E1/REGISTER.local.md`, also ignored.

---

## Part 6. Contract-scope tags and signed-off steps

**Tags.** After the gold BOQ arrives, and before any scoring, the protocol owner tags every **measured** gold line, using only the drawing:
- `in` if its quantity is printed on the drawing in one of these forms: an explicit QTY / NO. column in a schedule; a printed "N No."; a printed total whose parts add up; a room tag whose printed area equals its printed L × W; a finish total built only from such areas;
- `out` for anything else (scaled, dimension chains, symbol counts, IS 1200 deductions, any page of a scanned set).

They are written to `contract-tags.json` as `{ "<gold line id>": "in" | "out" }`. A second person checks 10 % of lines, or all of them if there are fewer than 50.

**Signed-off steps.** Five steps cannot be proved from the files, so a named person confirms each, with a date, in `set.json`. Confirm a step only when it actually happened:

| Key in `set.json` | Confirms |
|---|---|
| `notAnExcludedDrawing` | The drawing is not one the software has already seen, **in any file form**: project name, title blocks and sheet numbers compared with every excluded project, and provenance plus developer declarations recorded (pilot package §A4.3, §A4.5). The automatic fingerprint check catches exact copies only; a re-saved or re-exported copy has a different fingerprint |
| `engineOutputBeforeQsOpened` | The software ran on the PDF and its output was saved and fingerprinted **before** any surveyor file was opened |
| `qsSheetsComplete` | Both measurement sheets passed the completeness check (every required column; every in-scope item measured or explained; every scaled row marked) |
| `noMeasuredLineOnScaledRow` | No measured line in either surveyor's BOQ, or in gold, rests on a scaled row |
| `contractTagsChecked` | The second person checked the tags |

---

## Part 7. Handover checklist (intake person)

- [ ] Owner agreed; permission letter signed, by an authorised person, filed in `permission/`
- [ ] Files received by the secure route; originals in `received/`, fingerprints recorded on receipt
- [ ] Exclusion check passed (the pilot package §A4: not a drawing the software has already seen)
- [ ] One combined PDF in `drawings/`, fingerprint in `SHA256SUMS`
- [ ] Software run on that PDF; output and its fingerprint saved **before** any surveyor file is opened
- [ ] Surveyor A: measurement sheet + reference BOQ + independence declaration received, fingerprinted, left unedited
- [ ] Surveyor B: the same
- [ ] Adjudicator: adjudicated measurement sheet + log; gold BOQ + log; agreement counts
- [ ] Contract tags written and second-checked
- [ ] `set.json` filled, with the five signed-off steps
- [ ] Intake check reports the set **complete** (Part 9, step 8)
- [ ] Deletion confirmations received from all three surveyors

---

## Part 8. Folder layout the intake check expects

```
benchmark-inputs/E1/                 never committed (except an optional public INPUTS.md)
  REGISTER.local.md                  names, contacts, dates — never committed
  S01/
    set.json                         register row + the five signed-off steps (example below)
    received/                        every file exactly as received (not read by the check)
    drawings/S01.pdf                 exactly ONE file: the combined PDF everyone measures
    SHA256SUMS                       "<sha256>  drawings/S01.pdf" (+ lines for received/ files)
    permission/                      the signed permission letter (at least one file)
    engine-output/analysis.json      software output, exactly one .json
    engine-output/analysis.json.sha256   its fingerprint, written when it is produced
    qs-a/measurement-sheet.xlsx      name contains "measurement"
    qs-a/reference-boq.json          exactly one valid reference BOQ
    qs-a/declaration.pdf
    qs-b/…                           same as qs-a, by a different person
    adjudication/adjudicated-measurement-sheet.xlsx
    adjudication/disagreements.csv
    gold/reference-boq.json          exactly one valid reference BOQ, preparedBy = the adjudicator
    gold/disagreements.csv
    contract-tags.json               every measured gold line: "in" or "out"
    review/decisions.json            optional: a reviewer's decisions for the human-corrected run
```

`set.json` (fill only what is true):

```json
{
  "schema_version": "cunstruct.e1-set.v1",
  "id": "S01",
  "typology": "residential",
  "modality": "vector",
  "setAEligible": true,
  "permission": { "status": "signed", "signedBy": "[name, role]", "date": "YYYY-MM-DD" },
  "attestations": {
    "notAnExcludedDrawing": { "by": "[name]", "date": "YYYY-MM-DD" },
    "engineOutputBeforeQsOpened": { "by": "[name]", "date": "YYYY-MM-DD" },
    "qsSheetsComplete": { "by": "[name]", "date": "YYYY-MM-DD" },
    "noMeasuredLineOnScaledRow": { "by": "[name]", "date": "YYYY-MM-DD" },
    "contractTagsChecked": { "by": "[second person]", "date": "YYYY-MM-DD" }
  }
}
```

`typology` is `residential`, `commercial` or `institutional`; `modality` is `vector` or `scanned`; `setAEligible` is `true` only if the set has a schedule with an explicit QTY / NO. column **and** room tags printing both area and L × W.

---

## Part 9. Processing the first set, step by step (intake person)

Run from the repository root. Replace `S01` with the set's id.

**Prerequisites (once per machine):** Node dependencies (`npm ci`); Python 3 with `numpy` and `Pillow`; `poppler-utils` (`pdfinfo`, `pdftoppm`, `pdfimages`) and `tesseract` (the extractor's own requirements, stated in `scripts/drawing-ocr/drawing_ocr.py`); `qpdf` only if a set must be combined from several PDFs. Without `tesseract`, step 5 fails with `No such file or directory: 'tesseract'`.

**Naming:** set folders are `S01`, `S02` … Only folders named that way are treated as sets; anything else under `benchmark-inputs/E1/` (for example `e1-out/`, acquisition notes) is listed as ignored. Keep the local exclusion register at `benchmark-inputs/E1/EXCLUSION-HASHES.local.md`: the intake check excludes every full SHA-256 written in it, as well as the excluded drawings recorded in the repository (pilot package §A5, X1, X2, X7–X11, and Set B by its recorded prefix and suffix).

1. **Create the folder** `benchmark-inputs/E1/S01/` with the subfolders of Part 8.
2. **On receipt, before opening anything:** save the files in `received/`, then
   `cd benchmark-inputs/E1/S01 && sha256sum received/* >> SHA256SUMS`.
3. **Exclusion check:** compare those fingerprints with the pilot package §A4–§A5 register. Stop if any matches, or if any applicable entry is unresolved. The intake check (step 8) repeats the fingerprint part automatically for the combined PDF, but a fingerprint matches **exact copies only**. The project-name, title-block and provenance checks (§A4.3, §A4.5) are manual, and the set stays incomplete until a person signs `notAnExcludedDrawing` in `set.json`.
4. **Combined PDF:** create `drawings/S01.pdf` (Part 3), then `sha256sum drawings/S01.pdf >> SHA256SUMS`. Re-check later with `sha256sum -c SHA256SUMS`.
5. **Run the software, before any surveyor file is opened** (unchanged extractor, protocol v1 §2–§4):
   ```bash
   python3 scripts/drawing-ocr/drawing_ocr.py benchmark-inputs/E1/S01/drawings/S01.pdf \
     --out benchmark-inputs/E1/S01/engine-output/analysis.json
   (cd benchmark-inputs/E1/S01/engine-output && sha256sum analysis.json > analysis.json.sha256)
   ```
   Then record `engineOutputBeforeQsOpened` in `set.json`.
6. **Send** the combined PDF to surveyors A and B separately (Part 4A). On delivery, fingerprint their files on receipt and file them unedited in `qs-a/` and `qs-b/`. Send both deliverables and the PDF to the adjudicator (Part 4B); file the results in `adjudication/` and `gold/`.
7. **Tag** the gold lines and record the signed-off steps (Part 6).
8. **Intake check** (writes `e1-intake.json`; scores nothing):
   ```bash
   BENCH_E1_ROOT=benchmark-inputs/E1 BENCH_OUT=benchmark-inputs/E1/e1-out BENCH_E1_CHECK_ONLY=1 \
     npx vitest run --config scripts/benchmark/vitest.bench.config.ts score-set-a
   ```
   Each failing check is printed with its reason. Fix the filing, or send it back to whoever owns that step. **Never edit a surveyor's figures.**
9. **Score (E2)** once the set is complete. Only complete sets are scored, each against its gold BOQ; incomplete sets are refused:
   ```bash
   BENCH_E1_ROOT=benchmark-inputs/E1 BENCH_OUT=benchmark-inputs/E1/e1-out \
     npx vitest run --config scripts/benchmark/vitest.bench.config.ts score-set-a
   ```
   Outputs per set: `gates.json`, `metrics.json`, `g5-worksheet.json` (fill G5 by hand), plus `summary.json`. Record the repository commit you ran (`git rev-parse HEAD`) next to them.
10. **Update** [EVIDENCE-STATUS.md](../EVIDENCE-STATUS.md) with counts and fingerprints only (no names, no figures from the drawings). E1 is DONE only when 10–20 sets are complete and spread as the plan requires; E2 only when every set is scored.
