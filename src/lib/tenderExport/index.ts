// Locked tender BoQ export — owner-only engineering preview (plan v1.2 §5B,
// derived from B8). PREVIEW ONLY: tested on a synthetic tender workbook; no real
// department file has been round-tripped, so this is not B8's acceptance.
//
//   const read = await readTenderWorkbook(bytes);              // find the item table(s)
//   const mapping = mapLinesToTender(read, lines);             // item no, then exact description + unit
//   const fill = fillTenderRates(read, mapping, { gapMode });  // rates only; gaps blank or 0
//   const report = checkTenderConsistency(read, mapping);      // amounts, totals, abstracts, Cunstruct
//   const out = await writeTenderWorkbook(read);               // .xlsx bytes
//
// What exceljs preserves and what it does not: see README.md in this folder.
export { readTenderWorkbook, writeTenderWorkbook, type ReadOptions } from "./reader";
export { mapLinesToTender } from "./mapper";
export { fillTenderRates } from "./writer";
export { checkTenderConsistency } from "./consistency";
export * from "./types";
