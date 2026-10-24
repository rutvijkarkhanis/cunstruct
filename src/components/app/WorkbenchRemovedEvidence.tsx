// WORKBENCH PREVIEW — Check: drawing-review quantities that were verified or
// corrected but whose BOQ line has since been removed (lib/app/removedEvidence:
// from the change history, never inferred from absence). States what is
// missing from the export and how to bring it back. Read-only. Loaded only in
// builds with the preview (ProjectExport imports it behind the gate).
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { boqEvidenceKey, loadBoqEvidenceItems } from "@/lib/lineEvidence";
import { loadRemovals, removedReviewedItems } from "@/lib/app/removedEvidence";
import type { AppBoqLine } from "@/lib/app/boqLines";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function WorkbenchRemovedEvidence({ boqId, lines, reviewHref, boqHref }: {
  boqId: string; lines: AppBoqLine[]; reviewHref: string; boqHref: string;
}) {
  const itemsQ = useQuery({ queryKey: boqEvidenceKey(boqId), queryFn: () => loadBoqEvidenceItems(boqId) });
  const removalsQ = useQuery({ queryKey: ["boq-line-removals", boqId], queryFn: () => loadRemovals(boqId) });
  if (itemsQ.isError || removalsQ.isError) {
    return <p role="note" className="text-sm text-muted-foreground">Could not check whether reviewed quantities were removed from this BOQ.</p>;
  }
  if (!itemsQ.data || !removalsQ.data) return null;
  const missing = removedReviewedItems(itemsQ.data, lines, removalsQ.data);
  if (!missing.length) return null;
  return (
    <section aria-label="Reviewed quantities removed from the BOQ" className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium">
          {missing.length} reviewed quantit{missing.length === 1 ? "y is" : "ies are"} no longer in this BOQ: {missing.length === 1 ? "its line was" : "their lines were"} removed after the drawing review.
          The export does not include {missing.length === 1 ? "it" : "them"}.
        </p>
        <ul className="list-disc pl-5">
          {missing.map((m) => (
            <li key={m.key}>“{m.key}” {m.item} — {m.decision === "EDITED" ? "corrected" : "verified"} on the drawings; line{m.description ? ` “${m.description.slice(0, 60)}”` : ""} removed {day(m.removedAt)}</li>
          ))}
        </ul>
        <p>
          To bring {missing.length === 1 ? "it" : "them"} back, <Link className="underline" to={reviewHref}>apply the review again</Link> (each is added back as a reviewed line),
          or <Link className="underline" to={boqHref}>add the line in the BOQ</Link>. If the removal was intended, nothing needs doing.
        </p>
      </div>
    </section>
  );
}
