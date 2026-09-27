// DOCUMENT LOCATION EXTRACTION — the document-level entry point for the
// Phase 4 LOCATION contract. LOCATION is document-level, not BOQ-level (it
// extracts observations from one drawing, independent of any BOQ), so this
// lives on the Documents page rather than inside BOQ Review.
//
// Reuses the EXISTING generateAnalysis()/ai-analysis endpoint verbatim — no
// second client, no duplicated prompt/schema/parser/persistence. The only
// thing this file adds is a document-scoped UI: `documentIds` is always
// exactly one id (this document's), and `boqId` is omitted (null) since this
// entry point has no BOQ context — analysis_run.boq_id already supports that.
//
// Gated identically to the old BOQ-level control it replaces: the
// presentation flag (showInternalAiControls) never unlocks anything by
// itself — the server independently confirms admin via the `internal` block
// on the preflight response before this renders anything.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { fetchPreflight, generateAnalysis, showInternalAiControls } from "@/lib/ai/analysisClient";
import DocumentLocationObservations from "./DocumentLocationObservations";

export default function DocumentLocationExtraction({
  projectId, documentId,
}: {
  projectId: string;
  documentId: string;
}) {
  const qc = useQueryClient();
  const showInternal = showInternalAiControls();

  // One admin-check query per project, shared (via this exact query key)
  // across every document row on the page — React Query dedupes concurrent
  // calls with the same key to a single network request, so this never fires
  // once per row. `enabled: showInternal` skips the request entirely for a
  // normal user rather than relying on the flag to hide the result.
  const { data } = useQuery({
    queryKey: ["location-admin-check", projectId],
    queryFn: () => fetchPreflight({ projectId, boqId: null, mode: "LOCATION" }),
    enabled: showInternal,
  });
  const isAdmin = !!data?.internal;

  const mutation = useMutation({
    mutationFn: () => generateAnalysis({ projectId, boqId: null, documentIds: [documentId], mode: "LOCATION" }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "LOCATION extraction failed"),
    // Refresh the observation inspector below — without this, a click here
    // would update the toast/result line but leave the inspector showing
    // stale (possibly "never run") state until an unrelated page reload.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["location-run-state", projectId, documentId] }),
  });

  if (!showInternal || !isAdmin) return null;

  return (
    <div className="mt-2 pl-7 pt-2 border-t text-xs space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="font-medium">Document Analysis</span>
        <Badge variant="outline" className="text-[10px]">Internal</Badge>
      </div>
      <div className="text-muted-foreground">
        LOCATION extraction — extract location observations from this document. One document
        only. Creates LOCATION observations. Does not modify BOQ lines.
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Running…" : "Run LOCATION extraction"}
        </Button>
        {mutation.isSuccess && (() => {
          const res = mutation.data;
          if (!res.ok) {
            return <span className="text-red-600">LOCATION extraction failed — {res.error ?? "unknown error"}</span>;
          }
          // generated === 0 means nothing was actually sent to the extractor
          // this click (already analysed under this exact contract, or
          // currently being processed elsewhere) — never the same thing as
          // "ran and genuinely found nothing" (observationCount === 0 below).
          if (res.generated === 0) {
            return <span className="text-muted-foreground">{res.message ?? "Nothing new to analyse."}</span>;
          }
          if ((res.observationCount ?? 0) === 0) {
            return <span className="text-emerald-700">LOCATION extraction complete — no observations found</span>;
          }
          return <span className="text-emerald-700">LOCATION extraction complete — {res.observationCount} observation(s) persisted</span>;
        })()}
      </div>

      <DocumentLocationObservations projectId={projectId} documentId={documentId} />
    </div>
  );
}
