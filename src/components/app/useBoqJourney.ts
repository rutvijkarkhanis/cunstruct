// The persisted state behind the Quantity BOQ journey for one BOQ: drawings,
// the latest analysis's review decisions, and the BOQ's lines. Reuses the
// query keys and loaders the Drawings, BOQ and Export steps already use, so
// every step reads the same rows. A failed read is an error — never shown as
// "no analysis" or "no lines".
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/untypedDb";
import { loadProjectDrawings } from "@/lib/review/drawingStorage";
import { loadReviewItems } from "@/lib/review/reviewStore";
import { reviewSummary } from "@/lib/review/reviewQueue";
import { appBoqLinesKey, loadAppBoqLines } from "@/lib/app/boqLines";
import { boqTotals } from "@/lib/app/boqTable";
import { journeyStages, type ReviewState } from "@/lib/app/journey";

/** The BOQ's latest analysis run's review state. Unlike reviewStore's
 *  latestRunForBoq (which reads a failure as "no run"), a failed read throws. */
export async function loadReviewState(boqId: string): Promise<ReviewState> {
  const { data, error } = await db.from("analysis_run").select("id, created_at").eq("boq_id", boqId)
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  const run = (data as { id: string }[] | null)?.[0];
  if (!run) return { kind: "none" };
  return { kind: "run", runId: run.id, summary: reviewSummary(await loadReviewItems(run.id)) };
}
export const reviewStateKey = (boqId: string | null) => ["app-journey-review", boqId] as const;

/** `pricing`: rates are entered on this BOQ (see lib/app/journey JourneyInput). */
export function useBoqJourney(projectId: string, boqId: string | null, hasBoqs: boolean, pricing = false) {
  const drawingsQ = useQuery({ queryKey: ["boq-drawings", projectId], queryFn: () => loadProjectDrawings(projectId) });
  const reviewQ = useQuery({ queryKey: reviewStateKey(boqId), enabled: !!boqId, queryFn: () => loadReviewState(boqId!) });
  const linesQ = useQuery({ queryKey: appBoqLinesKey(boqId), enabled: !!boqId, queryFn: () => loadAppBoqLines(boqId!) });

  const drawings = drawingsQ.data ?? [];
  const lines = linesQ.data ?? [];
  const loading = drawingsQ.isLoading || (!!boqId && (reviewQ.isLoading || linesQ.isLoading));
  const error = drawingsQ.isError || reviewQ.isError || linesQ.isError;
  const totals = boqId && linesQ.isSuccess ? boqTotals(lines) : null;
  const stages = loading || error ? [] : journeyStages({
    projectId, boqId: hasBoqs ? boqId : null,
    drawingCount: drawings.length, drawingsWithoutFile: drawings.filter((d) => !d.filePath).length,
    review: boqId ? reviewQ.data ?? null : null, totals, lineCount: lines.length, pricing,
  });
  return { stages, loading, error, review: reviewQ.data ?? null, totals, retry: () => { drawingsQ.refetch(); reviewQ.refetch(); linesQ.refetch(); } };
}
