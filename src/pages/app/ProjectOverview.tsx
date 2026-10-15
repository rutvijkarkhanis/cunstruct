// Step 1 — Overview: where this project stands, from real rows only. Every
// figure links to the step that changes it; nothing here writes.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, FileText, ListChecks } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectBoqs } from "@/hooks/useProjectBoqs";
import { loadProjectDrawings } from "@/lib/review/drawingStorage";
import { latestRunForBoq, loadReviewItems } from "@/lib/review/reviewStore";
import { EMPTY_STATS, nextStep, statsByBoq, type NextStep, type OverviewLine } from "@/lib/app/overview";
import { useProjectShell } from "@/components/app/projectShellContext";
import { Skeleton } from "@/components/ui/skeleton";

const LINE_COLS = "boq_id, qty, quantity_status, dsr_rate, custom_rate, included, source_document_id";
const LINE_COLS_BASE = "boq_id, qty, dsr_rate, custom_rate, included";

async function loadOverviewLines(boqIds: string[]): Promise<OverviewLine[]> {
  if (!boqIds.length) return [];
  let r = await supabase.from("boq_line").select(LINE_COLS).in("boq_id", boqIds);
  // Same stale-schema fallback as the BOQ builder: older deployments lack the
  // provenance columns; lines are still counted, never dropped.
  if (r.error && /quantity_status|source_document_id|schema cache|does not exist/i.test(r.error.message)) {
    r = await supabase.from("boq_line").select(LINE_COLS_BASE).in("boq_id", boqIds);
  }
  if (r.error) throw r.error;
  return (r.data ?? []) as OverviewLine[];
}

/** Review items of each BOQ's latest analysis not yet verified or edited — the
 *  same rule the BOQ builder states on its exports. */
async function loadUnfinishedReview(boqIds: string[]): Promise<Map<string, number>> {
  const entries = await Promise.all(boqIds.map(async (id) => {
    const run = await latestRunForBoq(id);
    if (!run) return [id, 0] as const;
    const items = await loadReviewItems(run.id);
    return [id, items.filter((it) => it.reviewStatus !== "VERIFIED" && it.reviewStatus !== "EDITED").length] as const;
  }));
  return new Map(entries);
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warn" }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={tone === "warn" ? "text-lg font-semibold break-words text-amber-800 dark:text-amber-300" : "text-lg font-semibold break-words"}>{value}</dd>
    </div>
  );
}

function NextStepCard({ step, projectId }: { step: NextStep; projectId: string }) {
  const boqLink = (path: string, boqId: string) => `${path}?boq=${encodeURIComponent(boqId)}`;
  const content: { text: string; to: string; cta: string } = (() => {
    switch (step.kind) {
      case "upload_drawings": return { text: "No drawings yet. Upload the project drawings to begin.", to: "../drawings", cta: "Go to Drawings" };
      case "create_boq": return { text: "No BOQ yet. Create one for this project in the Ops console.", to: `/ops/projects/${projectId}/boqs/manage`, cta: "Create a BOQ" };
      case "finish_review": return { text: `${step.count} drawing review item${step.count === 1 ? " is" : "s are"} not finished. Apply stays blocked until review is complete.`, to: `/ops/projects/${projectId}/boqs/${step.boqId}/review`, cta: "Continue review" };
      case "resolve_pending": return { text: `${step.count} BOQ line${step.count === 1 ? " has" : "s have"} a pending quantity.`, to: boqLink("../boq", step.boqId), cta: "Open BOQ" };
      case "export": return { text: "No pending quantities or unfinished review. The BOQ is ready to export.", to: boqLink("../export", step.boqId), cta: "Export" };
    }
  })();
  return (
    <section aria-labelledby="next-step" className="rounded-md border bg-card p-4 flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <h2 id="next-step" className="text-sm font-semibold">Next step</h2>
        <p className="text-sm text-muted-foreground">{content.text}</p>
      </div>
      <Link to={content.to} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        {content.cta} <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

export default function ProjectOverview() {
  const { projectId, project } = useProjectShell();
  const drawingsQ = useQuery({ queryKey: ["app-overview-drawings", projectId], queryFn: () => loadProjectDrawings(projectId) });
  const boqsQ = useProjectBoqs(projectId);
  const boqIds = (boqsQ.data ?? []).map((b) => b.id);
  const linesQ = useQuery({
    queryKey: ["app-overview-lines", projectId, boqIds],
    enabled: boqsQ.isSuccess,
    queryFn: () => loadOverviewLines(boqIds),
  });
  const reviewQ = useQuery({
    queryKey: ["app-overview-review", projectId, boqIds],
    enabled: boqsQ.isSuccess,
    queryFn: () => loadUnfinishedReview(boqIds),
  });

  const loading = drawingsQ.isLoading || boqsQ.isLoading || linesQ.isLoading || reviewQ.isLoading;
  const failed = drawingsQ.isError || boqsQ.isError || linesQ.isError || reviewQ.isError;
  const drawings = drawingsQ.data ?? [];
  const stats = statsByBoq(linesQ.data ?? []);
  const unfinished = reviewQ.data ?? new Map<string, number>();
  const withoutFile = drawings.filter((d) => !d.filePath).length;

  return (
    <div className="space-y-5">
      <h2 className="sr-only">Overview</h2>
      {loading ? (
        <div role="status" aria-label="Loading overview" className="space-y-3">
          <Skeleton className="h-16 w-full" /><Skeleton className="h-28 w-full" />
        </div>
      ) : failed ? (
        <div role="alert" className="rounded-md border p-4 text-sm">Could not load this project's drawings or BOQs. Reload to try again.</div>
      ) : (
        <>
          <NextStepCard projectId={projectId} step={nextStep({ drawingCount: drawings.length, boqIds, stats, unfinishedReview: unfinished })} />

          <section aria-labelledby="ov-project" className="rounded-md border bg-card p-4">
            <h2 id="ov-project" className="text-sm font-semibold mb-2">Project</h2>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Client" value={project.client_name || "—"} />
              <Stat label="Location" value={project.location || "—"} />
              <Stat label="Built-up area" value={project.area_sqft ? `${project.area_sqft.toLocaleString("en-IN")} sq ft` : "—"} />
              <Stat label="Floors" value={project.floors ?? "—"} />
            </dl>
          </section>

          <section aria-labelledby="ov-drawings" className="rounded-md border bg-card p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h2 id="ov-drawings" className="text-sm font-semibold inline-flex items-center gap-1.5"><FileText className="h-4 w-4" aria-hidden="true" />Drawings</h2>
              <Link to="../drawings" className="text-sm underline">Open drawings</Link>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="Documents" value={drawings.length} />
              <Stat label="Without a file" value={withoutFile} tone={withoutFile ? "warn" : undefined} />
            </dl>
          </section>

          <section aria-labelledby="ov-boqs" className="rounded-md border bg-card p-4">
            <h2 id="ov-boqs" className="text-sm font-semibold mb-2 inline-flex items-center gap-1.5"><ListChecks className="h-4 w-4" aria-hidden="true" />BOQs</h2>
            {!boqIds.length ? (
              <p className="text-sm text-muted-foreground">No BOQs yet.</p>
            ) : (
              <ul className="divide-y">
                {(boqsQ.data ?? []).map((b) => {
                  const s = stats.get(b.id) ?? EMPTY_STATS;
                  const open = unfinished.get(b.id) ?? 0;
                  return (
                    <li key={b.id} className="py-3 space-y-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium break-words min-w-0">{b.name}</span>
                        <span className="flex gap-3 text-sm">
                          <Link to={`../boq?boq=${encodeURIComponent(b.id)}`} className="underline">Open BOQ</Link>
                          <Link to={`../export?boq=${encodeURIComponent(b.id)}`} className="underline">Export</Link>
                        </span>
                      </div>
                      <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        <Stat label="Included lines" value={s.included} />
                        <Stat label="Complete" value={s.complete} />
                        <Stat label="Pending quantity" value={s.pendingQty} tone={s.pendingQty ? "warn" : undefined} />
                        <Stat label="No rate" value={s.unpriced} tone={s.unpriced ? "warn" : undefined} />
                        <Stat label="Review not finished" value={open} tone={open ? "warn" : undefined} />
                      </dl>
                      {open > 0 && (
                        <p className="text-xs text-amber-800 dark:text-amber-300 inline-flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                          {open} review item{open === 1 ? "" : "s"} not verified — <Link className="underline" to={`/ops/projects/${projectId}/boqs/${b.id}/review`}>continue review</Link>
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
