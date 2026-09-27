// DOCUMENT LOCATION OBSERVATIONS — read-only inspector answering "what did
// Cunstruct actually extract from this document?" A count alone can't
// validate an extraction; this distinguishes the four states that a bare
// "0 observation(s) persisted" collapsed into one ambiguous green message:
//
//   A. never run       — no analysis_run_source row for this document/mode
//   B. ran, found none — status SUCCEEDED, zero analysis_observation rows
//   C. ran, found some — status SUCCEEDED, observations listed below
//   D. failed          — status FAILED, with the stored error
//
// Read-only: this component and locationObservations.ts together have no
// write path at all. These are LOCATION observations, extracted
// independently of any BOQ — never BOQ lines, and nothing here can create
// or modify one.
//
// Rendered only from inside DocumentLocationExtraction's already-admin-gated
// block — never re-derives admin status itself, to avoid a second preflight
// call for the same check.
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  latestLocationRunForDocument, loadLocationObservations, type LocationObservation,
} from "@/lib/review/locationObservations";

export default function DocumentLocationObservations({
  projectId, documentId,
}: {
  projectId: string;
  documentId: string;
}) {
  const { data: run } = useQuery({
    queryKey: ["location-run-state", projectId, documentId],
    queryFn: () => latestLocationRunForDocument(projectId, documentId),
  });

  const { data: observations } = useQuery({
    queryKey: ["location-observations", projectId, documentId, run?.runId],
    queryFn: () => loadLocationObservations(run!.runId!),
    enabled: !!run && run.status === "SUCCEEDED" && !!run.runId,
  });

  if (!run) return null; // still loading the run state itself — no flash of "never run"

  return (
    <div className="mt-3 pt-2 border-t space-y-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">LOCATION observations</span>
        <Badge variant="outline" className="text-[10px]">Not BOQ lines</Badge>
      </div>

      {run.status === "NOT_RUN" && (
        <div className="text-muted-foreground">LOCATION extraction has not been run for this document.</div>
      )}

      {run.status === "PROCESSING" && (
        <div className="text-amber-700">LOCATION extraction is currently running…</div>
      )}

      {run.status === "FAILED" && (
        <div className="text-red-600">
          LOCATION extraction failed{run.error ? ` — ${run.error}` : ""}.
          {run.completedAt && <span className="text-muted-foreground"> ({new Date(run.completedAt).toLocaleString()})</span>}
        </div>
      )}

      {run.status === "SUCCEEDED" && observations !== undefined && observations.length === 0 && (
        <div className="text-muted-foreground">
          <div>No LOCATION observations were found in this document.</div>
          {run.completedAt && (
            <div>Extraction completed {new Date(run.completedAt).toLocaleString()} — 0 observations persisted.</div>
          )}
        </div>
      )}

      {run.status === "SUCCEEDED" && observations !== undefined && observations.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-muted-foreground">
            {observations.length} LOCATION observation{observations.length === 1 ? "" : "s"} extracted from this
            document, independent of any BOQ.
          </div>
          {observations.map((o) => <ObservationRow key={o.id} obs={o} />)}
        </div>
      )}
    </div>
  );
}

function ObservationRow({ obs }: { obs: LocationObservation }) {
  const { attributes, evidence } = obs;
  const attributeParts = [attributes.dimension, attributes.specification, attributes.material].filter(Boolean);
  return (
    <div className="border rounded p-2 space-y-0.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[10px]">{obs.observationType.replace(/_/g, " ")}</Badge>
        {obs.mark && <span className="font-medium">{obs.mark}</span>}
        {obs.scopeHint && <span className="text-muted-foreground">· {obs.scopeHint}</span>}
        {evidence.page != null && <span className="text-muted-foreground">· p.{evidence.page}</span>}
        <Badge variant="outline" className="text-[10px] ml-auto">{obs.evidenceCompleteness}</Badge>
      </div>
      {obs.locationText && <div className="text-muted-foreground">{obs.locationText}</div>}
      {attributeParts.length > 0 && <div className="text-muted-foreground">{attributeParts.join(" · ")}</div>}
    </div>
  );
}
