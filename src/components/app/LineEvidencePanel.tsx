// Where a BOQ line's quantity came from: its review item's decision, the
// extracted and reviewed values, the calculation the analysis stored, the
// reviewer's notes, and the recorded region on the drawing. Read-only; built
// from lib/lineEvidence (stable key link, stored evidence only).
import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import type { LineEvidence } from "@/lib/lineEvidence";

const DECISION: Record<string, string> = { VERIFIED: "Verified in review", EDITED: "Corrected in review" };
const q = (qty: number | null | undefined, unit: string | null | undefined) =>
  qty == null ? "Pending" : `${qty.toLocaleString("en-IN", { maximumFractionDigits: 4 })} ${unit ?? ""}`.trim();

export default function LineEvidencePanel({ e, regionHref }: { e: LineEvidence; regionHref: string | null }) {
  return (
    <div className="space-y-1.5 text-sm" aria-label={`Evidence for ${e.itemName}`} role="group">
      <p>
        <span className="font-medium">{DECISION[e.decision] ?? e.decision}</span> — review item “{e.itemName}” ({e.itemKey}).
        {" "}Extracted {q(e.extracted.qty, e.extracted.unit)}
        {e.corrected ? `, corrected to ${q(e.corrected.qty, e.corrected.unit ?? e.extracted.unit)}` : ""}.
      </p>
      {e.changedSinceReview && (
        <p className="text-amber-800 dark:text-amber-300">The line no longer holds the reviewed value ({q(e.reviewed.qty, e.reviewed.unit)}) — it was changed after review.</p>
      )}
      {e.calculation?.expression && <p>Calculation: <span className="font-mono text-xs">{e.calculation.expression}</span></p>}
      {e.calculation?.statedText && <p>As stated by the analysis: “{e.calculation.statedText}”</p>}
      {e.calculation?.advisory && <p className="text-xs text-muted-foreground">{e.calculation.advisory}</p>}
      {!e.calculation && <p className="text-xs text-muted-foreground">No calculation was recorded for this quantity.</p>}
      {(e.dimension || e.specification) && (
        <p className="text-xs">{[e.dimension && `Dimension: ${e.dimension}`, e.specification && `Specification: ${e.specification}`].filter(Boolean).join(" · ")}</p>
      )}
      {e.reviewNote && <p className="text-xs">Reviewer note: “{e.reviewNote}”</p>}
      {e.reviewerNotes && <p className="text-xs">Reviewer correction note: “{e.reviewerNotes}”</p>}
      {e.documentMismatch && <p className="text-xs text-amber-800 dark:text-amber-300">The line cites a different drawing than its review item.</p>}
      <p className="text-xs">
        {regionHref && e.boxes.length > 0 ? (
          <Link to={regionHref} className="inline-flex items-center gap-1 underline">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />Show the measured region on {e.documentName ?? "the drawing"}{e.page ? `, p.${e.page}` : ""}
          </Link>
        ) : e.documentName ? (
          <span className="text-muted-foreground">{e.documentName}{e.page ? `, p.${e.page}` : ""} — no region recorded</span>
        ) : <span className="text-muted-foreground">No drawing recorded for this review item.</span>}
      </p>
    </div>
  );
}
