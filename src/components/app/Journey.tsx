// Journey UI shared by the project shell and its steps: the BOQ phases (only
// Quantity is available), the Quantity BOQ stages with their real status, and
// the previous/next step links. Presentational only — every status comes from
// lib/app/journey, which reads persisted rows.
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, AlertTriangle, ExternalLink } from "lucide-react";
import { BOQ_PHASES, STAGE_STEP, type JourneyStage, type StageDetail, type StageKey, type StageStatus } from "@/lib/app/journey";
import { useSelectedBoq } from "./useSelectedBoq";
import { useBoqJourney } from "./useBoqJourney";
import { useStepLink } from "./useStepLink";
import { cn } from "@/lib/utils";

/** The BOQ lifecycle: Quantity is the current phase; later phases are named
 *  with their purpose and marked unavailable — no links, no buttons. */
export function BoqPhases() {
  const current = BOQ_PHASES.find((p) => p.availability === "current")!;
  return (
    <details className="mt-1 text-xs text-muted-foreground group">
      <summary className="cursor-pointer select-none inline-flex items-center gap-1 hover:text-foreground">
        Phase: <span className="font-medium text-foreground">{current.name}</span> — {current.question}
        <span className="underline ml-1">About BOQ phases</span>
      </summary>
      <ol aria-label="BOQ phases" className="mt-2 mb-1 grid gap-1.5 sm:grid-cols-5">
        {BOQ_PHASES.map((p, i) => (
          <li key={p.key} aria-current={p.availability === "current" ? "step" : undefined}
            className={cn("rounded-md border p-2 min-w-0", p.availability === "current" ? "border-primary bg-primary/5 text-foreground" : "opacity-80")}>
            <div className="font-medium text-foreground">{i + 1}. {p.name}</div>
            <div className="text-[11px] uppercase tracking-wide mt-0.5">
              {p.availability === "current" ? "Current phase" : p.availability === "planned" ? "Not available yet" : "Later"}
            </div>
            <p className="mt-1">{p.question}</p>
            <p className="mt-1">{p.note}</p>
          </li>
        ))}
      </ol>
      <p>Every phase works on the same project and the same BOQ items, so a quantity you confirm now is the one later phases build on. A line can have its quantity confirmed while its specification and rate are still open.</p>
    </details>
  );
}

const STATUS_LABEL: Record<StageStatus, string> = { done: "Done", todo: "To do", attention: "Needs attention", not_started: "Not started" };
function StatusIcon({ status }: { status: StageStatus }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />;
  if (status === "attention") return <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />;
  return <Circle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
}

export function StageAction({ stage, primary }: { stage: JourneyStage; primary?: boolean }) {
  const step = useStepLink();
  if (!stage.action) return null;
  const cls = primary
    ? "inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
    : "inline-flex items-center gap-1 text-sm underline";
  return (
    <Link to={step(stage.action.to)} className={cls}>
      {stage.action.label}
      {stage.action.external ? <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> : primary ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : null}
    </Link>
  );
}

/** Stages A–E for one BOQ, each with what it is for, where it stands and one action. */
export function QuantityStages({ stages, nextKey }: { stages: JourneyStage[]; nextKey: string | null }) {
  return (
    <ol aria-label="Quantity BOQ stages" className="divide-y">
      {stages.map((s, i) => (
        <li key={s.key} className="py-3 flex flex-wrap items-start gap-3" aria-current={s.key === nextKey ? "step" : undefined}>
          <span className="mt-0.5"><StatusIcon status={s.status} /></span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h3 className="text-sm font-semibold">{String.fromCharCode(65 + i)}. {s.title}</h3>
              <span className="text-xs text-muted-foreground">{STATUS_LABEL[s.status]}{s.key === nextKey ? " · next" : ""}</span>
            </div>
            <p className="text-xs text-muted-foreground">{s.goal}</p>
            <p className="text-sm">{s.summary}</p>
            {s.detail.length > 0 && <ul className="text-xs text-muted-foreground list-disc pl-4">{s.detail.map((d) => <li key={d.text}><DetailText d={d} /></li>)}</ul>}
          </div>
          <StageAction stage={s} />
        </li>
      ))}
    </ol>
  );
}

function DetailText({ d }: { d: StageDetail }) {
  const step = useStepLink();
  return d.to ? <Link to={step(d.to)} className="underline">{d.text}</Link> : <>{d.text}</>;
}

/** Where the current step stands, from the same stage model as the Overview:
 *  done → the next step as the primary action; otherwise what is still open
 *  here, each linked to where it is resolved. Says nothing while loading or
 *  when it cannot load (the step itself reports that). */
export function StepStatus({ projectId, stage, next }: { projectId: string; stage: StageKey; next: { label: string; to: string } | null }) {
  const sel = useSelectedBoq(projectId);
  const j = useBoqJourney(projectId, sel.selected?.id ?? null, sel.boqs.length > 0);
  const s = j.stages.find((x) => x.key === stage);
  if (sel.loading || j.loading || !s) return null;
  if (s.status === "done") {
    return (
      <div role="status" aria-label="Step status" className="mb-4 rounded-md border bg-card px-3 py-2 flex flex-wrap items-center gap-3 text-sm">
        <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
        <p className="flex-1 min-w-0">This step is done: {s.summary}</p>
        {next && (
          <Link to={next.to} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Next: {next.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>
    );
  }
  return (
    <div role="status" aria-label="Step status" className="mb-4 rounded-md border bg-card px-3 py-2 text-sm space-y-1">
      <p className="inline-flex items-center gap-2"><StatusIcon status={s.status} /><span>{s.open.length > 0 ? "Still open here:" : s.summary}</span></p>
      {s.open.length > 0 && (
        // A link back to this same step adds nothing: shown as text.
        <ul className="text-xs list-disc pl-6">{s.open.map((o) => (
          <li key={o.text}><DetailText d={o.to?.includes(`/${STAGE_STEP[stage]}?`) && !o.to.includes("status=") && !o.to.includes("q=") ? { text: o.text } : o} /></li>
        ))}</ul>
      )}
    </div>
  );
}

/** Previous / next journey step, keeping the selected BOQ. */
export function StepNav({ prev, next }: { prev: { label: string; to: string } | null; next: { label: string; to: string } | null }) {
  if (!prev && !next) return null;
  return (
    <nav aria-label="Previous and next step" className="mt-6 pt-4 border-t flex flex-wrap justify-between gap-2 text-sm">
      {prev ? <Link to={prev.to} className="inline-flex items-center gap-1 underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back: {prev.label}</Link> : <span />}
      {next && <Link to={next.to} className="inline-flex items-center gap-1 underline">Next: {next.label}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
    </nav>
  );
}
