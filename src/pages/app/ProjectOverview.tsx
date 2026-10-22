// Step 1 — Overview: where this project stands, from real rows only. The next
// step and the Quantity BOQ stages (A–E) come from lib/app/journey for the
// selected BOQ; every figure links to the step that changes it. Nothing here
// writes.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, ListChecks, Route as RouteIcon } from "lucide-react";
import { db } from "@/lib/untypedDb";
import { useProjectBoqs } from "@/hooks/useProjectBoqs";
import { loadProjectDrawings } from "@/lib/review/drawingStorage";
import { EMPTY_STATS, statsByBoq, type OverviewLine } from "@/lib/app/overview";
import { journeyPath, nextStage, type ReviewState } from "@/lib/app/journey";
import { useProjectShell } from "@/components/app/projectShellContext";
import { useSelectedBoq } from "@/components/app/useSelectedBoq";
import { loadReviewState, useBoqJourney } from "@/components/app/useBoqJourney";
import { QuantityStages, StageAction } from "@/components/app/Journey";
import BoqPicker from "@/components/app/BoqPicker";
import { Skeleton } from "@/components/ui/skeleton";
import { useStepLink } from "@/components/app/useStepLink";
import { Button } from "@/components/ui/button";

const LINE_COLS = "boq_id, qty, quantity_status, basis, dsr_rate, custom_rate, included, source_document_id";
const LINE_COLS_BASE = "boq_id, qty, dsr_rate, custom_rate, included";

async function loadOverviewLines(boqIds: string[]): Promise<OverviewLine[]> {
  if (!boqIds.length) return [];
  let r = await db.from("boq_line").select(LINE_COLS).in("boq_id", boqIds);
  // Same stale-schema fallback as the BOQ builder: older deployments lack the
  // provenance columns; lines are still counted, never dropped.
  if (r.error && /quantity_status|\bbasis\b|source_document_id|schema cache|does not exist/i.test(r.error.message)) {
    r = await db.from("boq_line").select(LINE_COLS_BASE).in("boq_id", boqIds);
  }
  if (r.error) throw r.error;
  return (r.data ?? []) as OverviewLine[];
}

/** Each BOQ's latest analysis review state (see loadReviewState). */
async function loadReviewStates(boqIds: string[]): Promise<Map<string, ReviewState>> {
  return new Map(await Promise.all(boqIds.map(async (id) => [id, await loadReviewState(id)] as const)));
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warn" }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={tone === "warn" ? "text-lg font-semibold break-words text-amber-800 dark:text-amber-300" : "text-lg font-semibold break-words"}>{value}</dd>
    </div>
  );
}

export default function ProjectOverview() {
  const { projectId, project } = useProjectShell();
  const step = useStepLink();
  const drawingsQ = useQuery({ queryKey: ["boq-drawings", projectId], queryFn: () => loadProjectDrawings(projectId) });
  const boqsQ = useProjectBoqs(projectId);
  const sel = useSelectedBoq(projectId);
  const journey = useBoqJourney(projectId, sel.selected?.id ?? null, (boqsQ.data ?? []).length > 0);
  const boqIds = (boqsQ.data ?? []).map((b) => b.id);
  const linesQ = useQuery({
    queryKey: ["app-overview-lines", projectId, boqIds],
    enabled: boqsQ.isSuccess,
    queryFn: () => loadOverviewLines(boqIds),
  });
  const reviewQ = useQuery({
    queryKey: ["app-overview-review", projectId, boqIds],
    enabled: boqsQ.isSuccess,
    queryFn: () => loadReviewStates(boqIds),
  });

  const loading = drawingsQ.isLoading || boqsQ.isLoading || linesQ.isLoading || reviewQ.isLoading || sel.loading || journey.loading;
  const failed = drawingsQ.isError || boqsQ.isError || linesQ.isError || reviewQ.isError || journey.error;
  const drawings = drawingsQ.data ?? [];
  const stats = statsByBoq(linesQ.data ?? []);
  const reviews = reviewQ.data ?? new Map<string, ReviewState>();
  const withoutFile = drawings.filter((d) => !d.filePath).length;
  const next = nextStage(journey.stages);

  return (
    <div className="space-y-5">
      <h2 className="sr-only">Overview</h2>
      {loading ? (
        <div role="status" aria-label="Loading overview" className="space-y-3">
          <Skeleton className="h-16 w-full" /><Skeleton className="h-28 w-full" />
        </div>
      ) : failed ? (
        <div role="alert" className="rounded-md border p-4 text-sm space-y-2">
          <p>Could not load this project's drawings or BOQs, so its progress is not shown. Nothing has been changed.</p>
          <Button size="sm" variant="outline" onClick={() => { void drawingsQ.refetch(); void boqsQ.refetch(); void linesQ.refetch(); void reviewQ.refetch(); journey.retry(); }}>Retry</Button>
        </div>
      ) : (
        <>
          {sel.requestedMissing && sel.selected && (
            <p role="note" className="text-sm text-muted-foreground">The BOQ in this link is not part of this project; showing “{sel.selected.name}”.</p>
          )}
          {next && (
            <section aria-labelledby="next-step" className="rounded-md border bg-card p-4 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <h2 id="next-step" className="text-sm font-semibold">Next step: {next.title}</h2>
                <p className="text-sm text-muted-foreground">{next.summary}</p>
              </div>
              <StageAction stage={next} primary />
            </section>
          )}

          <section aria-labelledby="ov-progress" className="rounded-md border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="ov-progress" className="text-sm font-semibold inline-flex items-center gap-1.5">
                <RouteIcon className="h-4 w-4" aria-hidden="true" />Quantity BOQ progress{sel.selected ? ` — ${sel.selected.name}` : ""}
              </h2>
              {sel.selected && sel.boqs.length > 1 && <BoqPicker boqs={sel.boqs} value={sel.selected.id} onChange={sel.select} />}
            </div>
            <p className="text-xs text-muted-foreground mt-1">From saved drawings, review decisions and BOQ lines. Rates are not required here — they belong to the Pricing phase.</p>
            <QuantityStages stages={journey.stages} nextKey={next?.key ?? null} />
          </section>

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
                  const rv = reviews.get(b.id);
                  const open = rv?.kind === "run" ? rv.summary.remaining : 0;
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
                        <Stat label="Priced" value={s.complete} />
                        <Stat label="Pending quantity" value={s.pendingQty} tone={s.pendingQty ? "warn" : undefined} />
                        <Stat label="No rate" value={s.unpriced} tone={s.unpriced ? "warn" : undefined} />
                        <Stat label="Need a review decision" value={open} tone={open ? "warn" : undefined} />
                      </dl>
                      {open > 0 && (
                        <p className="text-xs text-amber-800 dark:text-amber-300 inline-flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                          {open} review item{open === 1 ? " needs" : "s need"} a decision; Apply is blocked until then — <Link className="underline" to={step(journeyPath(projectId, "review", b.id))}>review quantities</Link>
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
