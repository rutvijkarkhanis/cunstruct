# Locked tender BoQ export (preview only)

Owner-only engineering preview, plan of record v1.2 §5B, derived from **B8**. It is tested on a **synthetic** tender workbook built in `tenderExport.test.ts`. No real department file has been round-tripped, so this is **not** B8's acceptance, which needs a real tender file.

## API

```ts
const read = await readTenderWorkbook(bytes, { columnMaps?, sheets? });
const mapping = mapLinesToTender(read, lines);                 // CunstructLine[]
const fill = fillTenderRates(read, mapping, { gapMode: "blank" | "zero" });
const report = checkTenderConsistency(read, mapping);
const out = await writeTenderWorkbook(read);                   // .xlsx bytes
```

- **Reader.** Finds the item table by its headings (item no, description, unit, qty, rate; amount optional) in the first 30 rows of each sheet. A layout the detector misses can be given as a per-sheet `columnMaps` entry. Section headings are rows with a label and no unit. Total rows are labelled total, sub-total, carried to abstract and the like.
- **Mapper.** Matches the tender item number first. Failing that, it needs an **exact** description match (case and whitespace only) with the same unit (`cum` = `m3`, `sqm` = `m2`). There is no fuzzy matching. A line that fits several items, or an item with several lines, becomes a gap: no rate is ever carried to a different item. A line with no rate is a gap.
- **Writer.** Writes **rates only**, into empty rate cells. It never writes descriptions, units, quantities, amounts or totals. A rate cell that already holds a value or a formula is left alone and reported. A gap stays blank, or gets 0 if `gapMode` is `"zero"`, which is a per-tender setting. The writer sets `fullCalcOnLoad`, so the spreadsheet recalculates its formulas when opened.
- **Consistency check.** Formulas are not evaluated (see below). Instead each one is checked structurally:
  - an amount cell must be this row's qty × rate (one `ROUND` wrapper is allowed);
  - a total must cover exactly its section's item rows;
  - a sheet total may instead add up exactly the section totals;
  - an abstract sheet's reference into an item sheet must point at a total row.

  Literal amounts and totals are compared with the values computed from the rates. Each matched line is also compared with Cunstruct's own quantity and amount. A pending or unavailable line is listed as not compared and is never priced.

## What is preserved

The round-trip test checks every cell of every sheet before and after filling: values, formulas, fonts, number formats and merged ranges. It also checks the sheet order, the sheet protection (its password hash and salt) and other sheets such as an abstract and notes. Only the rate cells written differ.

## What exceljs 4.4.0 cannot preserve, or does not evaluate

These are the documented limits of the library, not tested here. **Check them on the first real department file** before relying on the output.

- **Formulas:** they are not calculated. Cached results in the file are stale until the spreadsheet recalculates; the writer requests recalculation on open.
- **Unsupported content** may be dropped or simplified when written back: charts, pivot tables, slicers, embedded OLE objects, form controls and VBA macros. `.xlsm` files are not supported. Some conditional-formatting and data-validation variants, and some theme or rich-text details, may also be affected.
- **File formats:** only `.xlsx` is read. Older `.xls` (BIFF) files are not supported.
- **Protected sheets** are rewritten with their existing protection. Rates are written through the library, not through the spreadsheet's lock, so it is up to the department whether the rate column was meant to be unlocked.
- **File size and order:** the byte layout of the file is not identical. Cell content and structure are; the ZIP parts are re-serialised.
