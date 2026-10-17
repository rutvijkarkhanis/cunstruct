// User-facing labels for the project journey (src/pages/app). Pure, so the
// rules are unit-tested rather than re-derived in each screen.
import { DRAWING_REVIEW_SECTION } from "@/lib/applyFinding";

/** Shown for a BOQ line with no trade/section assigned. Covers the internal
 *  section Apply files new review lines under (DRAWING_REVIEW_SECTION), which
 *  is a storage detail, not a trade a user should see. */
export const UNASSIGNED_SECTION_LABEL = "Unassigned";

export function sectionLabel(section: string | null | undefined): string {
  const s = (section ?? "").trim();
  if (!s || s === DRAWING_REVIEW_SECTION) return UNASSIGNED_SECTION_LABEL;
  return s;
}

/** A document revision label for display. Stored labels already carry the
 *  prefix ("Rev A" — see useDocumentManagement), but a hand-entered one may
 *  not ("B"); either way exactly one "Rev" is shown, never "Rev Rev A". */
export function revisionLabel(label: string | null | undefined): string | null {
  const s = (label ?? "").trim();
  if (!s) return null;
  return /^rev(\b|[\s.\-_:]|(?=\d))/i.test(s) ? s.replace(/^rev[\s.\-_:]*/i, "Rev ") : `Rev ${s}`;
}
