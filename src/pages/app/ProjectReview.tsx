// Step B — Review quantities. Where the selected BOQ's drawing review stands,
// from its saved review decisions, why Apply is (or is not) blocked, and the
// way into the review screen — which brings the user back here. Nothing here
// writes; reviewing and applying happen in the review screen, unchanged.
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { useProjectShell } from "@/components/app/projectShellContext";
import { useSelectedBoq } from "@/components/app/useSelectedBoq";
import { useBoqJourney } from "@/components/app/useBoqJourney";
import BoqPicker from "@/components/app/BoqPicker";
import ApplyReceiptNote from "@/components/app/ApplyReceiptNote";
import { manageBoqsPath, reviewWorkstationPath } from "@/lib/app/journey";
import { loadReceipt } from "@/lib/review/applyReceipt";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function Count({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={tone === "warn" && value ? "text-lg font-semibold text-amber-800 dark:text-amber-300" : "text-lg font-semibold"}>{value}</dd>
    </div>
  );
}

const PRIMARY = "inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90";

export default function ProjectReview() {
  const { projectId } = useProjectShell();
  const { pathname, search } = useLocation();
  const sel = useSelectedBoq(projectId);
  const boqId = sel.selected?.id ?? null;
  const j = useBoqJourney(projectId, boqId, sel.boqs.length > 0);

  if (sel.loading) return <div role="status" aria-label="Loading review"><Skeleton className="h-40 w-full" /></div>;
  if (sel.error) return <div role="alert" className="rounded-md border p-4 text-sm">Could not load this project's BOQs.</div>;
  if (!sel.selected) {
    return (
      <div className="rounded-md border p-8 text-center space-y-2">
        <h2 className="font-semibold">No BOQ to review into yet</h2>
        <p className="text-sm text-muted-foreground">
          Reviewed quantities are applied to a BOQ. <Link to={manageBoqsPath(projectId, `${pathname}${search}`)} className="underline">Create a BOQ</Link> for this project first.
        </p>
      </div>
    );
  }

  // The review screen returns here (same BOQ) via its back button.
  // Always the BOQ shown here — never a stale or foreign ?boq= from the link.
  const here = `${pathname}?boq=${encodeURIComponent(sel.selected.id)}`;
  const workstation = reviewWorkstationPath(projectId, sel.selected.id, here);
  const r = j.review;
  // Applied already, for this same analysis, in this tab (the review screen's
  // receipt) — the button then does not suggest applying again.
  const appliedThisRun = r?.kind === "run" && loadReceipt(sel.selected.id)?.runId === r.runId;

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold mr-auto">Review quantities</h2>
        <BoqPicker boqs={sel.boqs} value={sel.selected.id} onChange={sel.select} />
      </div>
      {sel.requestedMissing && (
        <p role="note" className="text-sm text-muted-foreground">The BOQ in this link is not part of this project; showing “{sel.selected.name}”.</p>
      )}
      <p className="text-sm text-muted-foreground max-w-3xl">
        Each quantity found on the drawings is checked before it reaches the BOQ: verify it, correct it, flag it or mark it pending.
        When every item has a decision, apply the verified and corrected items to the BOQ from the review screen.
      </p>

      {j.loading ? (
        <div role="status" aria-label="Loading review state"><Skeleton className="h-28 w-full" /></div>
      ) : j.error || !r ? (
        <div role="alert" className="rounded-md border p-4 text-sm space-y-2">
          <p>Could not load the review state of this BOQ.</p>
          <Button size="sm" variant="outline" onClick={j.retry}>Retry</Button>
        </div>
      ) : r.kind === "none" ? (
        <section className="rounded-md border bg-card p-4 space-y-3">
          <p className="text-sm">No drawing analysis has been loaded for “{sel.selected.name}” yet. Start the review to load one from the project drawings.</p>
          <Link to={workstation} className={PRIMARY}>Start review <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </section>
      ) : (
        <section aria-labelledby="rv-state" className="rounded-md border bg-card p-4 space-y-3">
          <h3 id="rv-state" className="sr-only">Review decisions</h3>
          <dl className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <Count label="Need a decision" value={r.summary.remaining} tone="warn" />
            <Count label="Verified" value={r.summary.verified} />
            <Count label="Corrected" value={r.summary.edited} />
            <Count label="Flagged" value={r.summary.flagged} tone="warn" />
            <Count label="Marked pending" value={r.summary.markedPending} tone="warn" />
            <Count label="Total items" value={r.summary.total} />
          </dl>
          {r.summary.remaining > 0 ? (
            <div role="note" className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <p>
                <span className="font-medium">Apply is blocked:</span> {r.summary.remaining} item{r.summary.remaining === 1 ? " still needs" : "s still need"} a decision.
                The review screen opens on the items that still need one.
              </p>
            </div>
          ) : (
            <div role="note" className="flex gap-2 rounded-md border px-3 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <p>
                Every item has a decision, so the verified and corrected items can be applied to the BOQ.
                {r.summary.flagged + r.summary.markedPending > 0 && ` ${r.summary.flagged + r.summary.markedPending} flagged or pending item${r.summary.flagged + r.summary.markedPending === 1 ? "" : "s"} will stay out of the BOQ until resolved.`}
                {" "}Before applying, the review screen also checks that the drawings have not changed since they were analysed.
              </p>
            </div>
          )}
          <Link to={workstation} className={PRIMARY}>
            {r.summary.remaining > 0 ? "Continue review" : appliedThisRun ? "Open review" : "Open review to apply"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      )}

      <ApplyReceiptNote projectId={projectId} boqId={sel.selected.id} currentRunId={r?.kind === "run" ? r.runId : null} here="review" />
    </div>
  );
}
