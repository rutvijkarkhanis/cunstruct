// Drawing processing on the Drawings screen: where the uploaded drawings
// stand, and the one explicit way to analyse them.
//
//   1. Server processing (projects.ai_processing_enabled). Off by default for
//      a project; drawings cannot be fingerprinted or analysed until the
//      person turns it on here. It is never turned on automatically.
//   2. Fingerprints (free, no AI): computed through the existing preflight as
//      soon as processing is on, and on Retry.
//   3. Analyze drawings: opens the existing Analyze Project panel
//      (WorkspaceAnalyzePanel). The paid AI call happens only when the person
//      assigns disciplines and presses its Analyze Project button. Its results
//      open the existing review screen; nothing reaches a BOQ without review.
import { lazy, Suspense, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { allowServerProcessing } from "@/lib/app/draftProject";
import { computeDrawingFingerprints } from "@/lib/app/drawingFingerprints";
import { journeyPath, reviewWorkstationPath } from "@/lib/app/journey";
import type { WorkspaceMode } from "@/lib/review/workspaceState";

const WorkspaceAnalyzePanel = lazy(() => import("@/components/ops/workspace/WorkspaceAnalyzePanel"));

export default function DrawingProcessingPanel({ projectId, drawingCount }: { projectId: string; drawingCount: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [allowing, setAllowing] = useState(false);
  const [allowError, setAllowError] = useState<string | null>(null);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);

  const projQ = useQuery({
    queryKey: ["project-processing", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id, ai_processing_enabled").eq("id", projectId).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Project not found");
      return data as { id: string; ai_processing_enabled: boolean };
    },
  });
  const enabled = projQ.data?.ai_processing_enabled === true;
  const fpQ = useQuery({
    queryKey: ["drawing-fingerprints", projectId, drawingCount],
    enabled: enabled && drawingCount > 0,
    retry: false,
    queryFn: () => computeDrawingFingerprints(projectId),
  });

  if (drawingCount === 0) return null;

  const allow = async () => {
    setAllowing(true);
    setAllowError(null);
    try {
      await allowServerProcessing(projectId);
      await qc.invalidateQueries({ queryKey: ["project-processing", projectId] });
    } catch (e) {
      setAllowError(e instanceof Error ? e.message : String(e));
    } finally { setAllowing(false); }
  };

  const here = `${pathname}${search}`;
  const onEnterMode = (mode: WorkspaceMode, boqId?: string) => {
    if (mode === "review" && boqId) navigate(reviewWorkstationPath(projectId, boqId, here));
    else navigate(journeyPath(projectId, "boq", boqId ?? null));
  };

  return (
    <section aria-labelledby="drawing-processing" className="rounded-md border bg-card p-3 space-y-2 text-sm">
      <h3 id="drawing-processing" className="font-semibold">Drawing processing</h3>
      {projQ.isLoading ? (
        <p role="status" className="text-muted-foreground">Checking this project's processing setting…</p>
      ) : projQ.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2">
          <span>Could not read this project's processing setting.</span>
          <Button size="sm" variant="outline" onClick={() => projQ.refetch()}>Retry</Button>
        </div>
      ) : !enabled ? (
        <div className="space-y-2">
          <p>
            Server processing is off for this project. It is needed to fingerprint the drawings (free, no AI) and to analyse
            them with AI. Turning it on runs no analysis by itself.
          </p>
          <Button size="sm" onClick={() => void allow()} disabled={allowing}>
            {allowing && <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden="true" />}Allow server processing for this project
          </Button>
          {allowError && <p role="alert" className="text-destructive">{allowError}</p>}
        </div>
      ) : fpQ.isLoading ? (
        <p role="status" className="text-muted-foreground">Computing drawing fingerprints (no AI)…</p>
      ) : fpQ.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-destructive">
          <span>{fpQ.error instanceof Error ? fpQ.error.message : "Fingerprinting failed."}</span>
          <Button size="sm" variant="outline" onClick={() => fpQ.refetch()}>Retry fingerprints</Button>
        </div>
      ) : fpQ.data ? (
        <p role="status">
          Fingerprinted {fpQ.data.fingerprinted} of {drawingCount} drawing{drawingCount === 1 ? "" : "s"}.
          {fpQ.data.fingerprinted < drawingCount && (
            <> {drawingCount - fpQ.data.fingerprinted} could not be read from storage yet. <button type="button" className="underline" onClick={() => fpQ.refetch()}>Retry</button></>
          )}
        </p>
      ) : null}

      {!analyzeOpen ? (
        <div className="space-y-1">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!enabled} onClick={() => setAnalyzeOpen(true)}>
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Analyze drawings
          </Button>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? "Opens the analysis step. AI analysis is a paid call and runs only when you start it there."
              : "Allow server processing first."}
          </p>
        </div>
      ) : (
        <div className="space-y-2 border-t pt-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-muted-foreground max-w-prose">
              Choose each drawing's discipline, then press Analyze Project to run the AI analysis (a paid call). Its
              quantities go to review: none reaches the BOQ until you verify or correct it. Drawing types and scales are
              not detected automatically; check them in review.
            </p>
            <Button size="sm" variant="ghost" onClick={() => setAnalyzeOpen(false)}>Close</Button>
          </div>
          <Suspense fallback={<p role="status" className="text-muted-foreground">Loading the analysis step…</p>}>
            <WorkspaceAnalyzePanel projectId={projectId} onEnterMode={onEnterMode} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
