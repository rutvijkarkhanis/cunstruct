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

// An export's totals come from the BOQ's commercial settings (boq.spec:
// contingency, overheads, cess, GST) as well as its lines, so both are re-read
// before an export is built. When a read fails, the message names that read.
export type RereadFailure = "lines" | "settings" | "both";

/** Re-reads lines and settings together; on failure, says which read failed. Reads only. */
export async function rereadForExport<L, S>(readLines: () => Promise<L>, readSettings: () => Promise<S>):
  Promise<{ ok: true; lines: L; settings: S } | { ok: false; failed: RereadFailure }> {
  const [l, s] = await Promise.allSettled([readLines(), readSettings()]);
  if (l.status === "fulfilled" && s.status === "fulfilled") return { ok: true, lines: l.value, settings: s.value };
  return { ok: false, failed: l.status === "rejected" && s.status === "rejected" ? "both" : l.status === "rejected" ? "lines" : "settings" };
}

const SETTINGS = "the BOQ's commercial settings (contingency, overheads, cess, GST)";

/** The message for a failed re-read: the lines-only wording is unchanged. */
export function rereadFailedMessage(failed: RereadFailure, kind: "pdf" | "csv"): string {
  if (kind === "pdf" && failed === "lines") return PDF_REREAD_FAILED_MESSAGE;
  const what = failed === "lines" ? "the BOQ lines" : failed === "settings" ? SETTINGS : `the BOQ lines or ${SETTINGS}`;
  return kind === "pdf"
    ? `Could not re-read ${what}, so no PDF was produced (it could have missed a saved change). Close this tab and try again.`
    : `Could not re-read ${what}, so nothing was exported. Try again.`;
}
