// AI API PANEL — the normal-user drawing-analysis generation flow.
//
// Deliberately simple: file counts, which files are new vs already analysed,
// and two buttons. No model names, no token counts, no pricing, no provider
// details, no contract/version numbers — those only ever appear in the
// collapsible "Internal (admin)" section, and only when BOTH the
// presentation flag is on AND the server itself confirmed this caller is an
// admin (an `internal` block is present in the response). The flag never
// unlocks anything by itself.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { fetchPreflight, generateAnalysis, showInternalAiControls, type PreflightFile } from "@/lib/ai/analysisClient";

const UNFILED = "Unfiled";

/** Group new + already-analysed files by folder for "Review files" — purely
 *  a display grouping (folder is never part of AI identity/cost protection).
 *  Sorted so Unfiled sorts last, folders alphabetically, files alphabetically
 *  within a folder — stable regardless of the order the server returned them in. */
function groupByFolder(willSend: PreflightFile[], alreadyAnalysed: PreflightFile[]) {
  type Row = { documentId: string; filename: string; status: "NEW" | "ANALYSED" };
  const byFolder = new Map<string, Row[]>();
  const add = (f: PreflightFile, status: Row["status"]) => {
    const key = f.folderPath.length ? f.folderPath.join(" / ") : UNFILED;
    const rows = byFolder.get(key) ?? [];
    rows.push({ documentId: f.documentId, filename: f.filename, status });
    byFolder.set(key, rows);
  };
  willSend.forEach((f) => add(f, "NEW"));
  alreadyAnalysed.forEach((f) => add(f, "ANALYSED"));
  return [...byFolder.entries()]
    .sort(([a], [b]) => (a === UNFILED ? 1 : b === UNFILED ? -1 : a.localeCompare(b)))
    .map(([folder, rows]) => [folder, rows.sort((a, b) => a.filename.localeCompare(b.filename))] as const);
}

export default function AiApiPanel({
  projectId, boqId, onGenerated,
}: {
  projectId: string;
  boqId: string;
  onGenerated: (runId: string) => void | Promise<void>;
}) {
  const qc = useQueryClient();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [forceReanalyse, setForceReanalyse] = useState(false);
  const showInternal = showInternalAiControls();

  const preflightKey = ["ai-preflight", projectId, boqId, forceReanalyse] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: preflightKey,
    queryFn: () => fetchPreflight({ projectId, boqId, forceReanalyse }),
  });

  const generateMutation = useMutation({
    mutationFn: () => generateAnalysis({ projectId, boqId, forceReanalyse }),
    onSuccess: async (res) => {
      if (!res.ok) { toast.error(res.error ?? "Analysis failed"); return; }
      if (res.generated === 0) {
        toast.info(res.message ?? "Nothing new to analyse.");
        if (res.allAlreadyAnalysed && (res.latestRunId ?? data?.preflight?.latestRunId)) {
          await onGenerated((res.latestRunId ?? data!.preflight!.latestRunId)!);
        }
        return;
      }
      if (res.skipped?.length) res.skipped.forEach((s) => toast.warning(`${s.filename}: ${s.reason}`));
      await onGenerated(res.runId!);
      qc.invalidateQueries({ queryKey: preflightKey });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Analysis failed"),
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking project files…</div>;
  }
  if (error || !data?.ok || !data.preflight) {
    return <div className="text-sm text-red-600">{data?.error ?? (error instanceof Error ? error.message : "Could not load AI analysis status.")}</div>;
  }
  const p = data.preflight;

  return (
    <div className="space-y-3">
      <div className="text-sm space-y-1">
        <div>{p.totalProjectFiles} file{p.totalProjectFiles === 1 ? "" : "s"} in this project · {p.alreadyAnalysedCount} already analysed · <b>{p.newFilesCount} new</b></div>
        {p.duplicateFilesSkipped > 0 && (
          <div className="text-xs text-muted-foreground">{p.duplicateFilesSkipped} duplicate file{p.duplicateFilesSkipped === 1 ? "" : "s"} (identical content already counted once).</div>
        )}
        {p.inFlightCount > 0 && <div className="text-xs text-amber-700">{p.inFlightCount} file{p.inFlightCount === 1 ? "" : "s"} currently being analysed elsewhere.</div>}
        <div className="text-xs text-muted-foreground">
          Source completeness: files uploaded to this project are covered; whether every drawing for the project has been uploaded cannot be determined automatically.
        </div>
      </div>

      <button type="button" className="text-xs text-primary flex items-center gap-1" onClick={() => setReviewOpen((v) => !v)}>
        {reviewOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} Review files
      </button>
      {reviewOpen && (
        <div className="text-xs border rounded p-2 space-y-3 max-h-64 overflow-auto">
          {groupByFolder(p.willSendFiles, p.alreadyAnalysedFiles).map(([folder, rows]) => (
            <div key={folder}>
              <div className="font-medium mb-1">{folder}</div>
              {rows.map((r) => (
                <div key={r.documentId} className={r.status === "ANALYSED" ? "text-muted-foreground" : ""}>
                  {r.status === "ANALYSED" ? "✓" : "•"} {r.filename}
                  {r.status === "NEW" && <span className="text-primary font-medium"> — NEW</span>}
                  {r.status === "ANALYSED" && " — already analysed"}
                </div>
              ))}
            </div>
          ))}
          {p.totalEligibleDrawingFiles === 0 && <div className="text-muted-foreground">No PDF drawings uploaded to this project yet.</div>}
        </div>
      )}

      {showInternal && data.internal && (
        <Card className="bg-muted/40"><CardContent className="p-3 space-y-2 text-xs">
          <div className="font-medium">Internal (admin)</div>
          <div>Provider: {data.internal.provider} · Model: {data.internal.model}</div>
          <div>Contract version: {data.internal.contractVersion}</div>
          <div>
            Estimated cost: ${data.internal.estimatedCost.lowUsd.toFixed(4)}–${data.internal.estimatedCost.highUsd.toFixed(4)}{" "}
            <span className="text-muted-foreground">
              (a range, not exact — output tokens and OpenAI's page-image rendering are not known until generation
              {data.internal.estimatedCost.basis === "mixed" ? "; one or more files used a fallback estimate" : ""})
            </span>
          </div>
          <label className="flex items-center gap-2">
            <Switch checked={forceReanalyse} onCheckedChange={setForceReanalyse} />
            Force re-analyse (resend files already analysed under this contract)
          </label>
        </CardContent></Card>
      )}

      {(() => {
        const nothingNew = p.newFilesCount === 0 && !forceReanalyse;
        const canOpenExisting = nothingNew && !!p.latestRunId;
        const disabled = generateMutation.isPending || p.totalEligibleDrawingFiles === 0 || (nothingNew && !canOpenExisting);
        return (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => (canOpenExisting ? onGenerated(p.latestRunId!) : generateMutation.mutate())}
            >
              {generateMutation.isPending ? "Generating…" : canOpenExisting ? "Open existing analysis" : "Generate analysis"}
            </Button>
            <span className="text-xs text-muted-foreground">Only new, not-yet-analysed files are sent.</span>
          </div>
        );
      })()}
    </div>
  );
}
