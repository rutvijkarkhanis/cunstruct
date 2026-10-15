// Drawing coverage: the document's LOCATION observations measured against the
// spaces its own drawing text labels. Read-only — it computes, displays and
// can copy draft quantities for the existing analysis import; it never writes
// a BOQ line, rate or quantity.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadDocumentDrawingText } from "@/lib/review/drawingTextLoader";
import { analyseDrawingCoverage } from "@/lib/review/drawingCoverage";
import { toAnalysisPayload } from "@/lib/review/measuredQuantities";
import type { LocationObservation } from "@/lib/review/locationObservations";
import type { ReconciledRoom } from "@/lib/review/roomDimensionReconciliation";

export default function DrawingCoveragePanel({ documentId, observations }: { documentId: string; observations: LocationObservation[] }) {
  const [requested, setRequested] = useState(false);
  const { data, error, isFetching } = useQuery({
    queryKey: ["drawing-coverage", documentId, observations.map((o) => o.id).join(",")],
    queryFn: async () => analyseDrawingCoverage(await loadDocumentDrawingText(documentId), observations),
    enabled: requested,
    staleTime: Infinity,
    retry: false,
  });

  if (!requested) {
    return (
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRequested(true)}>
        Check coverage against the drawing
      </Button>
    );
  }
  if (isFetching) return <div className="text-muted-foreground">Reading the drawing's text…</div>;
  if (error) return <div className="text-red-600">Coverage check failed — {error instanceof Error ? error.message : "unknown error"}</div>;
  if (!data) return null;

  const { report, quantities } = data;
  const ready = quantities.filter((q) => q.status === "ready");
  const { conflicts } = report;
  const duplicates = report.observations.filter((o) => o.outcome.status === "duplicate");
  const notFound = report.observations.filter((o) => o.outcome.status === "not_in_inventory" || o.outcome.status === "unresolved");

  const copyDrafts = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(toAnalysisPayload(quantities), null, 2));
      toast.success(`Copied ${quantities.length} draft item(s) (${ready.length} measured) as analysis JSON`);
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  };

  return (
    <div className="space-y-1.5" data-testid="drawing-coverage">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium">Drawing coverage</span>
        <Badge variant="outline" className="text-[10px]">{report.status === "unavailable" ? "Unavailable" : "Provisional"}</Badge>
        <Badge variant="outline" className="text-[10px]">Read-only</Badge>
      </div>

      {report.status === "unavailable" ? (
        <div className="text-muted-foreground">This drawing has no text layer, so its spaces can't be listed. Coverage is unknown.</div>
      ) : (
        <>
          <div>
            The drawing text labels <b>{report.spaces.total}</b> space{report.spaces.total === 1 ? "" : "s"} on{" "}
            {report.pages.map((p) => `p.${p.page}${p.floor ? ` (${p.floor})` : ""}`).join(", ")}.
            This analysis observed <b>{report.observed.count}</b> of them
            {" "}(rooms {report.observed.byClass.room.observed} of {report.observed.byClass.room.of}).
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
            <span>{report.spaces.dimensioned.length} with a printed size</span>
            <span>{report.spaces.noDimension.length} without</span>
            <span className={report.spaces.ambiguous.length ? "text-amber-700" : ""}>{report.spaces.ambiguous.length} ambiguous</span>
            <span className={report.unmatchedDimensions.length ? "text-amber-700" : ""}>{report.unmatchedDimensions.length} unmatched sizes</span>
            <span className={conflicts.floorLabels.length ? "text-amber-700" : ""}>{conflicts.floorLabels.length} floor-label conflicts</span>
            <span className={conflicts.dimensions.length ? "text-red-600" : ""}>{conflicts.dimensions.length} size conflicts</span>
            <span className={duplicates.length ? "text-amber-700" : ""}>{duplicates.length} duplicates</span>
            <span>{report.rejectionsKnown ? `${report.rejected.length} rejected by the parser` : "parser rejections unknown"}</span>
          </div>

          <Section title={`Not observed by the analysis (${report.notObserved.length})`} rooms={report.notObserved} />
          {report.spaces.ambiguous.length > 0 && <Section title={`Ambiguous size (${report.spaces.ambiguous.length})`} rooms={report.spaces.ambiguous} showReason />}
          {report.unmatchedDimensions.length > 0 && (
            <Details title={`Sizes not assigned to any space (${report.unmatchedDimensions.length})`}>
              {report.unmatchedDimensions.map((u) => <li key={u.candidateId}>p.{u.page} {u.text} — {u.reason}</li>)}
            </Details>
          )}
          {(conflicts.floorLabels.length > 0 || conflicts.dimensions.length > 0 || conflicts.pageFloors.length > 0) && (
            <Details title="Conflicts with the drawing">
              {conflicts.pageFloors.map((c) => <li key={`pf${c.page}`}>p.{c.page} has several sheet titles: {c.floors.join(", ")}</li>)}
              {conflicts.floorLabels.map((c) => <li key={`fl${c.observationIndex}`}>{c.label} (p.{c.page}): observed floor "{c.observedFloor}", sheet says {c.drawingFloor}</li>)}
              {conflicts.dimensions.map((c) => <li key={`d${c.observationIndex}`}>{c.label} (p.{c.page}): observed {c.observedDimension}, drawing prints {c.drawingDimension}</li>)}
            </Details>
          )}
          {(notFound.length > 0 || duplicates.length > 0) && (
            <Details title={`Observations not placed on the drawing (${notFound.length + duplicates.length})`}>
              {[...notFound, ...duplicates].map((o) => (
                <li key={o.index}>{o.mark ?? o.observationType}{o.page ? ` (p.${o.page})` : ""} — {"reason" in o.outcome ? o.outcome.reason : ""}</li>
              ))}
            </Details>
          )}
          <Details title={`Floor areas ready for review (${ready.length}) — drafts, not BOQ lines`}>
            {ready.map((q) => (
              <li key={q.key}>{q.description}: {q.provenance.dimension?.text} = {q.quantity} {q.unit}</li>
            ))}
            {ready.length === 0 && <li>None — no space has a confidently matched printed size.</li>}
          </Details>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={copyDrafts}>Copy drafts as analysis JSON</Button>
            <span className="text-muted-foreground">Pending spaces are included with no quantity. Import them for review; nothing is applied here.</span>
          </div>
        </>
      )}
      <ul className="list-disc pl-4 text-muted-foreground">
        {report.provisionalReasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
    </div>
  );
}

function Details({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="border rounded px-2 py-1">
      <summary className="cursor-pointer">{title}</summary>
      <ul className="list-disc pl-4 mt-1 space-y-0.5">{children}</ul>
    </details>
  );
}

function Section({ title, rooms, showReason }: { title: string; rooms: ReconciledRoom[]; showReason?: boolean }) {
  return (
    <Details title={title}>
      {rooms.map((r) => (
        <li key={r.candidateId}>
          {r.label} · {r.floor ?? `p.${r.page}`}{r.dimension ? ` · ${r.dimension.text}` : ""}
          {showReason ? ` — ${r.reason}` : ""}
        </li>
      ))}
    </Details>
  );
}
