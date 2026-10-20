# DAR 2023 vs seed `dsr_coefficient`: verification summary

This was a read-only check. Nothing in the repo or database was changed.
- **Seed:** `supabase/migrations/20260731002000_dar_coefficients.sql`. Parsed 8,930 rows, 2,318 item codes, 0 unparsable lines.
- **Source:** CPWD DAR 2023 Vol I (992 pp) and Vol II (1,149 pp), dated 14.09.2023.
- **Pages:** `dar_page` is the PDF page index (`v1p165` = Vol I, PDF page 165), not the printed page number.
- **Scripts:** `.../scratchpad/dar-work/` (`parse_dar.py`, `post.py`, `seed.py`, `compare.py`, `ocrnorm.py`).
- **Row-level output:** `.../scratchpad/dar-check.csv`. It has 14,273 rows: 8,930 seed rows, followed by DAR rows that the seed lacks.

## 1. How the DAR text was parsed, and how far it can be trusted

- **Analyses parsed:** 3,149 analyses with an item code and 3,085 distinct codes.
  - 2,922 come from the text layer.
  - 227 come from OCR (see the next point).
- **Vol II, PDF pp 353–471 (all of Chapter 17, Sanitary installations) have no text layer.** They are images only. I rendered them at 300 dpi and ran OCR with tesseract 5.3.4, so every Chapter 17 result is flagged `ocr_source`.
- **Row arithmetic (quantity × rate = amount):**
  - Text-layer rows: 19,020 of 19,030 resource rows pass. The 10 failures are DAR printing quirks such as rounded quantities.
  - OCR rows: 954 of 1,013 pass.
- **Unparsed rows:** 2 in the text layer, 31 in OCR.
- **Reconciliation:** in 2,878 of 3,065 analyses, the row amounts add up to TOTAL W/X. The rest mostly contain lines with an amount but no resource code, such as "Add 30 % for fittings", which are not resource rows.
- **Final "Say" rate vs DSR 2023 rate (`dsr_item.json`):** I checked every analysis, not a sample.
  - 2,707 of 2,731 analyses that have both a Say and a DSR rate agree within ±0.01 (99.1 %).
  - Text layer: 2,491 of 2,511.
  - OCR Chapter 17: 216 of 220.
- **Analysed quantity:** taken as (Cost of N units) ÷ (Cost of 1 unit) from each analysis's trailer. This also handles bases like "3 trips of 8 cum" (= 24), "one quintal → 1 kg" (= 100) and "10 cudm → 1 cum" (= 0.01).

## 2. Convention: the seed stores the raw analysed quantity, not a per-unit quantity

Among the 7,868 seed rows that match DAR by resource code:
- 5,582 come from analyses whose analysed quantity is not 1.
- All of them equal the raw DAR quantity.
- None equals the per-unit value. The `match_per_unit` status count is 0.

The schema comment (`qty -- consumption per 1 unit of the item`) and `src/lib/boqExplode.ts` both treat `qty` as per-unit. The seed contradicts that.

Visually confirmed examples:
- **2.1.1:** Beldar 6.80 is for 100 sqm (v1p102). The seed has 6.80, so it is 100× too high per sqm.
- **2.8.1:** Excavator 0.12 day is for 10 cum (v1p106).
- **14.88:** felt 66 sqm is for 30 sqm (v2p152).
- **5.22.6:** steel 1.05 quintal is for 1 quintal (v1p284), and the DSR rate 107.85 is per kg (v1p285).
- **7.12.1.1:** analysed for 10 cudm (0.01 cum) while the Say is per cum (v1p379). Raw seed quantities here are 100× too low.

Scale of the problem:
- 1,411 seed item codes have an analysed quantity other than 1. The commonest bases are 10 (675 codes), 100 (108), 5, 30, 2.16, 300, 50, 216 and 0.01.
- The per-unit value is given in the CSV `note` ("per 1 <unit>: x").

## 3. Status counts (seed rows, first token of `status`)

| status | rows | meaning |
|---|---|---|
| match | 7,868 | Resource code and quantity are found in the item's own DAR analysis. The quantity equals the raw DAR quantity. |
| misattributed | 634 (273 items) | The row belongs to a different analysis: 534 to the following analysis, 6 to the preceding one, and 94 to analyses that cite this item as a sub-analysis (or the analysis right after one). The CSV note names the source analysis and page. |
| parent_heading_code | 278 (52 codes) | The seed code is only a heading in DAR (5.22A, 10.5, 18.6A …). The rows come from its sub-items (5.22A.1…6, 10.5.1/2, 18.6A.1…7). |
| not_in_dar_item | 73 (42 items) | Not found in the item's own analysis or its neighbours. The note lists where that code+quantity occurs elsewhere, if anywhere. |
| item_not_in_dar | 71 (27 codes) | There is no DAR analysis with this code. Some codes look misparsed (12.00, 4.500, 5.300, 9.08, 14.02, 4.50, 2.78…). |
| qty_mismatch | 6 | The resource is in the item's analysis with a different quantity. |

Flags on seed rows:
- `qty_is_per_analysed_qty`: 5,582
- `kind_plant_as_material`: 312
- `kind_labour_as_material`: 243
- `ocr_source`: 501
- `in_secondary_analysis`: 11 (matched in a second analysis with the same code: 5.48Z, 26.42.2)
- `product_id_malformed`: 5 (`'114'`, `'128'`, `'100'` without the leading zero; one `'242'` whose resource text is a page header)
- `unit_diff`: 1 (an OCR artefact)

The seed has no rows of kind `plant` at all.

DAR rows missing from the seed (excluding L.S. sundries 9999/9988 and zero-rate "Carriage of …" rows):

| status | rows |
|---|---|
| dar_row_missing_in_seed | 2,190 rows in seed items: 1,126 material, 816 labour, 248 plant |
| dar_sub_analysis_ref_missing | 766 rows in 493 seed items |
| dar_item_missing_in_seed | 2,387 rows. 583 DAR-analysed DSR items have no seed rows at all. Includes 417 sub-analysis references. |

- **Most common sub-analysis references the seed drops:** mortars 3.9 (77), 3.8 (51), 3.11 (34), 3.3 (24); concrete 4.1.3 (35); 18.23; 13.9.1; 13.50.3.
- **Missing material rows by DAR unit:** 100 Nos 292, kilogram 186, 10 Nos 151, 10 cudm 132, 1000 Nos 53, cum 55. The seed contains no rows in units "100 Nos", "10 Nos", "1000 Nos", "10 cudm" or "kilogram". Rows in those units were dropped everywhere: bricks, screws, stone blocks, steel sections.

## 4. Error classes, with visually checked examples (rendered with pdftoppm and viewed)

1. **Raw analysed quantity stored as per-unit.** 2.1.1 (v1p102), 2.8.1 (v1p106), 5.22.6 (v1p284–285), 14.88 (v2p152), 7.12.1.1 (v1p379).
2. **Misattributed: rows from an analysis that cites the item.**
   - **4.1.3:** the seed's 0296 12.5 mm aggregate 0.67, 0123 and 0124 brick-layer masons 0.40 come from **4.10** (DPC, v1p199). 4.10 cites "Rate as per item no 4.1.3" for 0.40 cum and then lists those rows. They are not in 4.1.3's own analysis (v1p165). The seed's other 8 rows for 4.1.3 match v1p165 exactly.
   - **6.12.1:** the seed's bitumen felt 1.20, Mason 1st and 2nd 0.12 and Beldar 0.06 come from 6.7 (v1p338), which cites 6.12.1. Its Coolie 1.76 and Bhisti 0.36 come from 6.8 (v1p338). The real 6.12.1 (v1p342) has Mason 0.45/0.45, Coolie 1.55, Bhisti 0.70, bricks 0.565 thousand and mortar 3.8 at 0.28 cum, and those rows are absent from the seed.
3. **Misattributed: rows bleeding from the next analysis.**
   - 9.153 holds 9.154's rows (dash fastener 20, Fitter 0.40, Blacksmith 0.53, Beldar 1.23, Bandhani 0.06; v1p727–728).
   - 5.23 holds 5.24's rows (v1p289–290).
   - 26.65 holds 26.67's rows (v2p1085/1087).
   - 9.146 holds dozens of rows from the 55 window-size analyses of 9.147A.
   - 2.25 holds 2.25(a)'s rows (excavator, royalty).
4. **DAR rows missing from the seed.**
   - 2.8.1: 0018 loader hire 0.12 day (v1p106).
   - 4.1.3: 0002 concrete mixer hire 0.07 day (v1p165).
   - 6.1.2: 2602 bricks 0.494 thousand per cum (v1p332).
   - 2.4: 0003 road-roller hire 0.008 day (v1p103).
   - 26.96.1: 8996 uPVC wallform 230.68 kg (text).
5. **Sub-analysis references dropped.**
   - 6.1.2 → 3.11 cement mortar 1:6, 0.25 cum per cum (v1p332).
   - 6.12.1 → 3.8, 0.28 cum (v1p342).
   - 6.44 → 3.4, 0.036 cum (v1p367).
   - 4.10 → 4.1.3, 0.40 cum (v1p199).

   **6.1.2 in the seed therefore has labour only.** All 4 labour rows match v1p332. The bricks (0.494 thousand) and the mortar (0.25 cum of item 3.11) are absent. The mortar's own cement and sand sit in analysis 3.11 and would need to be expanded through it.
6. **Plant tagged `material`.**
   - 2.2.1 excavator, dozer, grader, roller and tanker (v1p102, under MACHINERY).
   - 2.8.1 0020 excavator (v1p106).
   - 4.1.3 0012 vibrator (v1p165; DAR lists it under LABOUR, but it is equipment hire).
   - 312 rows in total, all with resource codes 0001–0092.
7. **Labour tagged `material`.**
   - 2.4 Chowkidar (v1p103, under LABOUR).
   - 9.154 Bandhani (v1p728).
   - 7.12.1.1 Bandhani (v1p379).
   - 243 rows, codes 01xx: Bandhani, Chowkidar, Glazier, Sewerman, Security guard and others.
8. **Quantity mismatch.**
   - 14.88 Beldar: seed 0.18, DAR 3.24 (v2p152).
   - 9.80 Carpenter 1st class: seed 1.30, DAR 0.14 (v1p581). The seed's other 9.80 rows (glass, kiln seasoning, etc.) are not in 9.80 at all.
   - 16.90 Coolie: seed 0.48, DAR 2.000 (v2p346).
   - Unverified visually: 18.23 Fitter 2.00 vs 0.17 and Beldar 10.50 vs 1.33; 14.16.2.2 Bandhani 6.30 vs 10.00.
9. **Not in the item's analysis.** 1.1.18 Coolie 736.00 (v1p94). The analysis has truck hire, Beldar 6.00 and diesel only. 736.00 is the Coolie daily *rate*, not a quantity. 1.2.10 Beldar/Coolie 736.00 have the same pattern.
10. **Parent heading code.**
    - 5.22A (v1p285): DAR analyses only 5.22A.1–6. The seed mixes MS bars, hard-drawn wire and fabric under one code.
    - 10.5 (10.5.1/10.5.2, v1p753–754).
    - 18.6A (18.6A.1–7).
11. **Unit basis.** 5.22.6 is analysed per quintal, but the DSR item is per kg (v1p284–285). The seed gives 1.05 quintal against a per-kg item, i.e. 105× when exploded per kg. 9.154 is analysed per 58.35 kg; 1.1.18 per 24 cum.

## 5. DAR Say vs `dsr_item.json` mismatches (24 analyses)

**Likely errors in the DSR seed**, where the DSR value is implausible and the DAR value is coherent:

| item | DSR rate | DAR Say | page |
|---|---|---|---|
| 26.73.1.1 | 0.36 | 1287.25/metre | v2p1091–1092, visually confirmed |
| 26.73.1.3 | 0.54 | 1822.60 | v2p1092 |
| 26.73.1.5 | 0.84 | 2717.10 | v2p1093 |
| 26.74.1 | 3.7 | 20928.70 | v2p1104 |
| 26.74.2 | 0.3 | 245.65 | v2p1105 |
| 26.74.3 | 0.55 | 450.40 | v2p1105 |
| 26.74.4 | 0.7 | 573.20 | v2p1106 |
| 26.53 | 0.72 | 2604.30 | v2p1077 |
| 26.82 | 16.25/"No" | 2293.30/sqm | v2p1114 |

For 26.82, the DSR description contains bled-in text from item 22.20.1.

**DAR internal inconsistency.** 9.134.1.2.2 (v1p645): "Cost of 1 sqm" is 3964.53, but the printed Say is 3764.55. DSR has 3964.55, which is consistent with the cost.

**Real differences** (DAR value confirmed visually unless noted):

| item | DAR Say | DSR | note |
|---|---|---|---|
| 6.44 | 59.45 | 60.85 | v1p367. This analysis uses older labour rates (749/645/714). |
| 13.114 | 1192.30 | 138.10 | v2p92 |
| 13.116 | 3049.85 | 1360.45 | Text only |

**Unresolved, possibly my parser** (component analyses sharing a code, or OCR header misreads): 14.78, 26.42.1, 26.42.2, 26.48, 10.16.1, 13.61.1, 17.10.2.2, 17.38.2.2, 17.52.1.2, 17.60.1.2. For the Chapter 17 items, the DAR Say equals the DSR rate of sub-code .3, which points to a missed OCR header.

**Coverage gaps in the DSR seed.** 357 DAR analysis codes are not in `dsr_item.json`. Many are sub-items whose heading in `dsr_item.json` carries the .1 sub-item's rate:
- 18.6A = 315.50 = DAR 18.6A.1
- 5.22A = 107.10 = 5.22A.1
- 9.147 = DAR 9.147A first size

Missing sub-items include 18.6A.2–7, 18.70.*, 18.80–83.*, 18.85A–102A.*, 26.73.*.even and 26.73.2/3.*.

## 6. What makes the seed unsafe for procurement (material quantities)

1. **Wrong basis.** The seed stores the raw analysed quantity, but the consumer multiplies it as if it were per 1 DSR unit. 1,411 of 2,318 items are off by their analysis basis: usually ×10 or ×100 too high, sometimes too low (×0.01 for cudm items).
   - Of 3,115 genuine material rows (resource code ≥ 0200) that match DAR, only 1,078 have basis 1.
   - The analysed quantity is not stored anywhere in the seed, so it cannot be corrected downstream.
2. **Whole material classes are missing.**
   - Every DAR row in units 100 Nos / 10 Nos / 1000 Nos / 10 cudm / kilogram is absent: bricks, fasteners, stone, steel sections.
   - Mortars and concretes cited as sub-analyses (766 references) are dropped. Masonry, plaster and DPC items therefore carry no cement or sand.
   - 1,017 of 2,318 seed items lack at least one DAR material row or sub-analysis reference.
3. **Wrong item.** 634 rows (495 of them material) are attached to the wrong item, and 278 rows sit under heading codes. Examples: 4.1.3 (concrete) gains a 12.5 mm aggregate row; 9.153 (lock) gains a 20-fastener row.
4. **No DAR analysis exists in this source.** 583 DAR-analysed DSR items have no coefficients in the seed, and 71 seed rows have item codes with no DAR analysis.
5. **Wrong kind.** 312 plant-hire rows and 243 labour rows are tagged `material`, so they would appear in a material procurement list.
6. **Bad values.** Some seed quantities are not quantities at all (1.1.18 and 1.2.10 Coolie/Beldar 736.00 = the daily rate), and one resource field is a page header (5.12A, `'242'`).
7. **Only 446 of 2,318 seed items are fully clean:** every row matches, basis is 1, and nothing is missing, including labour and plant.

Two more points for consumers, not seed defects as such:
- DAR repeats a resource code within one analysis (for example 7.12.1.1 has Coolie three times, v1p379), so consumers must sum per code.
- Negative deduction rows exist (4.10 has 0295 at −0.67), and the seed contains none.

## 7. Limitations

- **Chapter 17 is OCR-based.** 31 OCR rows did not parse and 59 fail the arithmetic check. Chapter 17 rows reported `not_in_dar_item` (17 rows) may be OCR misses, not seed errors.
- **Neighbour and reference attribution is heuristic.** It matches resource code and exact quantity in adjacent analyses, or in analyses that cite the item. Where only one common labour row matched, I did not call it misattributed.
- **The `not_in_dar_item` notes are hints only.** They list where that code+quantity occurs anywhere, so they suggest a source but do not prove it.
- **What I left out of the missing-rows list:** L.S. sundries (9999/9988) and zero-rate carriage rows. They are counted in `dar-work/check.json`, not listed in the CSV.
- **Sub-analyses inside items are kept as separate keys.** Five analyses inside items, coded `<item>#SubAR-n`, and the 55 window-size variants of 9.147A, are kept separate from the main item analysis.

**Highest-priority next step:** decide how the seed should be regenerated. The options are: store the analysed quantity (or divide by it) so `qty` is truly per DSR unit; capture the dropped units; and expand mortar and concrete sub-analyses. After that, re-run `dar-work/compare.py` against the regenerated seed before any procurement use.
