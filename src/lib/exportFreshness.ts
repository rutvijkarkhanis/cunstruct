// Exports are built from the lines this screen loaded. Another editor may
// have saved since. A CSV is built from a fresh read (a download needs no
// pop-up, so waiting is safe). A PDF opens a window, which browsers only allow
// straight from the click. Where the caller uses boqDsrDocument's
// openQuoteWindow (the project journey's Export step), the tab is opened from
// the click showing "reading the latest saved BOQ", the lines are re-read,
// and the document is built from that fresh read — or, if the read fails, the
// tab says no document was produced (PDF_REREAD_FAILED_MESSAGE). Callers still
// using openDsrQuote build from the loaded lines and re-read just after: if
// they differ, the person is told the PDF may be out of date
// (STALE_PDF_MESSAGE) rather than it silently omitting a saved change.

/** True when two reads of a BOQ's lines differ in anything an export prints. */
export function linesChanged(a: readonly unknown[], b: readonly unknown[]): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export const STALE_PDF_MESSAGE = "This BOQ was changed by someone else while you exported — the PDF may not include the latest change. Export again to include it.";

/** Shown (in the tab and as a toast) when the re-read before building a PDF fails. */
export const PDF_REREAD_FAILED_MESSAGE = "Could not re-read the BOQ lines, so no PDF was produced (it could have missed a saved change). Close this tab and try again.";
