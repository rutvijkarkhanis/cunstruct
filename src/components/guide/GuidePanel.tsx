// GUIDE MODE panel: a compact card over the project journey's own screens.
// It reads the same rows (same query keys and loaders) the screens read,
// says where each step actually stands, and links to the screen or the
// existing feature where the next action is taken. It never writes: every
// correction, rate, Apply or freeze happens in the linked screen, by the user.
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Compass, SkipForward, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadProjectDrawings } from "@/lib/review/drawingStorage";
import type { StoredDrawing } from "@/lib/review/documentResolve";
import { loadReviewItems } from "@/lib/review/reviewStore";
import { effectiveQuantity } from "@/lib/review/reviewQueue";
import { appBoqLinesKey, loadAppBoqLines, type AppBoqLine } from "@/lib/app/boqLines";
import { basisNotice, effectiveRate, incompleteWarning, lineStatus, type BoqTotals } from "@/lib/app/boqTable";
import { journeyPath, type JourneyStage, type ReviewState } from "@/lib/app/journey";
import { projectStatusLabel } from "@/lib/app/projects";
import { loadShellProject, shellProjectKey, type ShellProject } from "@/components/app/projectShellContext";
import { useSelectedBoq } from "@/components/app/useSelectedBoq";
import { useBoqJourney } from "@/components/app/useBoqJourney";
import {
  GUIDE_STATUS_LABEL, GUIDE_STEPS, guideProjectOf, guideStepStates,
  type GuideStatus, type GuideStepKey, type GuideStepState,
} from "@/lib/guide/guide";
import { exitGuide, goToGuideStep, skipGuideStep, useGuideSession, type GuideSession } from "@/lib/guide/guideSession";

const SHOWN = 5;
const fmtQty = (n: number | null | undefined, unit?: string | null) =>
  n == null ? "no quantity (pending)" : `${n.toLocaleString("en-IN", { maximumFractionDigits: 4 })} ${unit ?? ""}`.trim();
const fmtInr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const STATUS_TONE: Record<GuideStatus | "skipped", string> = {
  done: "bg-emerald-600 dark:bg-emerald-500",
  open: "bg-sky-600 dark:bg-sky-500",
  attention: "bg-amber-500",
  blocked: "bg-red-600 dark:bg-red-500",
  unavailable: "bg-muted-foreground/40",
  info: "bg-primary/70",
  skipped: "bg-muted-foreground/20",
};
const BADGE_TONE: Record<GuideStatus | "skipped", string> = {
  done: "text-emerald-800 bg-emerald-500/15 dark:text-emerald-300",
  open: "text-sky-800 bg-sky-500/15 dark:text-sky-300",
  attention: "text-amber-900 bg-amber-500/15 dark:text-amber-300",
  blocked: "text-red-800 bg-red-500/15 dark:text-red-300",
  unavailable: "text-muted-foreground bg-muted",
  info: "text-foreground bg-secondary",
  skipped: "text-muted-foreground bg-muted",
};

export default function GuidePanel() {
  const { user } = useAuth();
  const session = useGuideSession(user?.id);
  const { pathname } = useLocation();
  if (!session) return null;
  return guideProjectOf(pathname) === session.projectId ? <ActiveGuide session={session} /> : <PausedGuide session={session} />;
}

function PausedGuide({ session }: { session: GuideSession }) {
  return (
    <aside aria-label="Guided walkthrough" className="fixed z-40 bottom-3 right-3 left-3 sm:left-auto sm:w-[22rem] rounded-lg border bg-card shadow-lg px-3 py-2 text-sm flex flex-wrap items-center gap-2">
      <Compass className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0 flex-1">Guide paused: <span className="font-medium">{session.projectName}</span>, step {session.step + 1} of {GUIDE_STEPS.length}</p>
      <Link to={journeyPath(session.projectId, GUIDE_STEPS[session.step].route, null)} className="underline">Resume</Link>
      <Button size="sm" variant="ghost" onClick={exitGuide}>Exit guide</Button>
    </aside>
  );
}

function ActiveGuide({ session }: { session: GuideSession }) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [expanded, setExpanded] = useState(true);
  const projectId = session.projectId;
  const projectQ = useQuery({ queryKey: shellProjectKey(projectId), queryFn: () => loadShellProject(projectId) });
  const sel = useSelectedBoq(projectId);
  const boqId = sel.selected?.id ?? null;
  const j = useBoqJourney(projectId, boqId, sel.boqs.length > 0);
  const drawingsQ = useQuery({ queryKey: ["boq-drawings", projectId], queryFn: () => loadProjectDrawings(projectId) });
  const linesQ = useQuery({ queryKey: appBoqLinesKey(boqId), enabled: !!boqId, queryFn: () => loadAppBoqLines(boqId!) });

  const step = session.step;
  const def = GUIDE_STEPS[step];
  const here = `${pathname}${search}`;
  const loading = projectQ.isLoading || sel.loading || j.loading || drawingsQ.isLoading || (!!boqId && linesQ.isLoading);
  const failed = projectQ.isError || sel.error || j.error || drawingsQ.isError || linesQ.isError;
  const states = loading || failed || !projectQ.data ? null : guideStepStates({
    projectId, boqId, stages: j.stages, review: j.review, totals: j.totals,
    lineCount: linesQ.data?.length ?? 0, drawingCount: drawingsQ.data?.length ?? 0, here,
  });
  const skipped = (k: GuideStepKey) => session.skipped.includes(k);
  const stepPath = (i: number) => journeyPath(projectId, GUIDE_STEPS[i].route, boqId);
  const go = (i: number) => { goToGuideStep(i); navigate(stepPath(i)); };
  const onStepScreen = pathname === `/app/projects/${projectId}/${def.route}`;
  const state = states?.[def.key] ?? null;
  const tone = (k: GuideStepKey): GuideStatus | "skipped" => (skipped(k) ? "skipped" : states?.[k].status ?? "unavailable");
  const last = step === GUIDE_STEPS.length - 1;

  return (
    <>
      {/* Keeps the end of the page reachable above the panel. */}
      <div aria-hidden="true" className={expanded ? "h-[28rem] sm:h-72" : "h-14"} />
      <aside aria-label="Guided walkthrough"
        className="fixed z-40 bottom-3 right-3 left-3 sm:left-auto sm:w-[24rem] rounded-lg border bg-card shadow-lg text-sm flex flex-col max-h-[60vh]">
        <header className="px-3 pt-2 pb-1.5 border-b space-y-1.5">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-xs text-muted-foreground truncate">
              Guide · <span className="text-foreground font-medium">Step {step + 1} of {GUIDE_STEPS.length}</span> · {projectQ.data?.name ?? session.projectName}
            </p>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Collapse guide" : "Expand guide"} aria-expanded={expanded}>
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" onClick={exitGuide}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />Exit guide
            </Button>
          </div>
          <ol aria-label="Guide progress" className="flex gap-1">
            {GUIDE_STEPS.map((s, i) => (
              <li key={s.key} className="flex-1">
                <button type="button" onClick={() => go(i)} aria-current={i === step ? "step" : undefined}
                  aria-label={`Step ${i + 1}: ${s.title} — ${skipped(s.key) ? "Skipped" : states ? GUIDE_STATUS_LABEL[states[s.key].status] : "loading"}`}
                  title={s.title}
                  className={cn("block h-1.5 w-full rounded-full", STATUS_TONE[tone(s.key)], i === step && "ring-2 ring-offset-1 ring-offset-card ring-foreground/60")} />
              </li>
            ))}
          </ol>
        </header>
        {expanded && (
          <div className="px-3 py-2 space-y-2 overflow-y-auto min-h-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{def.title}</h2>
              {state && (
                <span className={cn("text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded", BADGE_TONE[tone(def.key)])}>
                  {skipped(def.key) ? "Skipped" : GUIDE_STATUS_LABEL[state.status]}
                </span>
              )}
            </div>
            {loading ? (
              <p role="status" className="text-muted-foreground">Reading this project…</p>
            ) : failed ? (
              <p role="alert">Could not read this project's data, so this step cannot say where it stands. Nothing has been changed.</p>
            ) : !projectQ.data ? (
              <p role="alert">This project is not available to you (not found, or no access). Exit the guide to continue.</p>
            ) : state && (
              <>
                <p>{state.summary}</p>
                <p className="text-muted-foreground"><span className="font-medium text-foreground">What you see: </span>{def.what}</p>
                <p className="text-muted-foreground"><span className="font-medium text-foreground">Why it matters: </span>{def.why}</p>
                <GuideFacts stepKey={def.key} projectId={projectId} project={projectQ.data} boqId={boqId}
                  boqName={sel.selected?.name ?? null} boqCount={sel.boqs.length} drawings={drawingsQ.data ?? []}
                  review={j.review} lines={linesQ.data ?? []} totals={j.totals} stages={j.stages} />
                {!onStepScreen && (
                  <Link to={stepPath(step)} className="inline-flex items-center gap-1 underline">Open the {def.title} screen <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
                )}
                <NextAction state={state} />
              </>
            )}
          </div>
        )}
        <footer className="px-3 py-2 border-t flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1" onClick={() => go(step - 1)} disabled={step === 0}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Back
          </Button>
          <Button size="sm" variant="ghost" className="gap-1" onClick={() => { skipGuideStep(); if (!last) navigate(stepPath(step + 1)); }}
            disabled={last && skipped(def.key)}>
            <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />Skip step
          </Button>
          {last ? (
            <Button size="sm" className="ml-auto" onClick={exitGuide}>Finish guide</Button>
          ) : (
            <Button size="sm" className="ml-auto gap-1" onClick={() => go(step + 1)}>
              Next<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </footer>
      </aside>
    </>
  );
}

function NextAction({ state }: { state: GuideStepState }) {
  if (!state.action) return null;
  return (
    <div className="rounded-md border border-dashed px-2 py-1.5 space-y-0.5">
      <p className="text-xs text-muted-foreground">
        {state.action.write ? "Next action — you do this in the linked screen; the guide does not change anything." : "Next action"}
      </p>
      <Link to={state.action.to} className="underline">{state.action.label}</Link>
    </div>
  );
}

interface FactsProps {
  stepKey: GuideStepKey; projectId: string; project: ShellProject;
  boqId: string | null; boqName: string | null; boqCount: number;
  drawings: StoredDrawing[]; review: ReviewState | null; lines: AppBoqLine[];
  totals: BoqTotals | null; stages: JourneyStage[];
}

function Dl({ rows }: { rows: [string, string | number][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}
    </dl>
  );
}
const More = ({ n, where }: { n: number; where: string }) => (n > 0 ? <p className="text-xs text-muted-foreground">and {n} more on {where}.</p> : null);

function GuideFacts(p: FactsProps) {
  const runId = p.review?.kind === "run" ? p.review.runId : null;
  const itemsQ = useQuery({
    queryKey: ["guide-review-items", runId], enabled: !!runId && (p.stepKey === "takeoff" || p.stepKey === "review"),
    queryFn: () => loadReviewItems(runId!),
  });
  const nr = (v: string | number | null | undefined) => (v == null || v === "" ? "not recorded" : v);

  switch (p.stepKey) {
    case "overview":
      return (
        <Dl rows={[
          ["Client", nr(p.project.client_name)], ["Location", nr(p.project.location)], ["Type", nr(p.project.project_type)],
          ["Area", p.project.area_sqft == null ? "not recorded" : `${p.project.area_sqft.toLocaleString("en-IN")} sq ft`],
          ["Floors", nr(p.project.floors)], ["Status", projectStatusLabel(p.project.status)],
          ["BOQ", p.boqName ? `${p.boqName}${p.boqCount > 1 ? ` (1 of ${p.boqCount})` : ""}` : "none yet"],
          ["Drawings", p.drawings.length],
        ]} />
      );
    case "drawings": {
      if (!p.drawings.length) return null;
      return (
        <div className="space-y-0.5">
          <ul className="text-xs space-y-0.5">
            {p.drawings.slice(0, SHOWN).map((d) => (
              <li key={d.documentId}>
                <Link className="underline" to={`/app/projects/${p.projectId}/drawings?${new URLSearchParams({ ...(p.boqId ? { boq: p.boqId } : {}), document: d.documentId })}`}>{d.name}</Link>
                <span className="text-muted-foreground">{d.filePath ? (d.pageCount ? ` · ${d.pageCount} page${d.pageCount === 1 ? "" : "s"}` : "") : " · no file uploaded"}</span>
              </li>
            ))}
          </ul>
          <More n={p.drawings.length - SHOWN} where="the Drawings screen" />
        </div>
      );
    }
    case "takeoff": {
      if (!runId) return null;
      if (itemsQ.isLoading) return <p role="status" className="text-xs text-muted-foreground">Reading the take-off…</p>;
      if (itemsQ.isError) return <p role="alert" className="text-xs">Could not read the take-off items.</p>;
      const items = itemsQ.data ?? [];
      const known = new Set(p.drawings.map((d) => d.documentId));
      const withRegion = items.filter((it) => (it.ai.source?.evidence?.length ?? 0) > 0).length;
      return (
        <div className="space-y-1">
          <p className="text-xs">{withRegion} of {items.length} with a measured region recorded on a drawing.</p>
          <ul className="text-xs space-y-1">
            {items.slice(0, SHOWN).map((it) => {
              const src = it.ai.source;
              const href = src?.documentId && known.has(src.documentId) && runId
                ? `/app/projects/${p.projectId}/drawings?${new URLSearchParams({ ...(p.boqId ? { boq: p.boqId } : {}), document: src.documentId, item: it.id, run: runId, ...(src.page ? { page: String(src.page) } : {}) })}`
                : null;
              const corrected = effectiveQuantity(it) !== it.ai.quantity;
              return (
                <li key={it.id} className="min-w-0 truncate" title={it.ai.item}>
                  <span className="font-medium">{it.ai.item}</span> ({it.ai.key}): {fmtQty(it.ai.quantity, it.ai.unit)}
                  {corrected && <> → corrected to {fmtQty(effectiveQuantity(it), it.reviewer?.unit ?? it.ai.unit)}</>}
                  {" · "}
                  {href ? <Link className="underline" to={href}>{(src?.evidence?.length ?? 0) > 0 ? "show region" : "open drawing"}{src?.page ? `, p.${src.page}` : ""}</Link>
                    : <span className="text-muted-foreground">{src?.document ? `${src.document}${src.page ? `, p.${src.page}` : ""} (not linked to a project drawing)` : "no drawing recorded"}</span>}
                </li>
              );
            })}
          </ul>
          <More n={items.length - SHOWN} where="the review screen" />
        </div>
      );
    }
    case "review": {
      if (p.review?.kind !== "run") return null;
      const s = p.review.summary;
      const decided = (itemsQ.data ?? []).filter((it) => it.reviewStatus !== "VERIFIED" && it.reviewStatus !== "PENDING_REVIEW");
      const label: Record<string, string> = { EDITED: "corrected", FLAGGED: "flagged", MARKED_PENDING: "marked pending" };
      return (
        <div className="space-y-1">
          <Dl rows={[["Verified", s.verified], ["Corrected", s.edited], ["Flagged", s.flagged], ["Marked pending", s.markedPending], ["Awaiting a decision", s.remaining]]} />
          {decided.length > 0 && (
            <ul className="text-xs space-y-0.5">
              {decided.slice(0, SHOWN).map((it) => (
                <li key={it.id} className="min-w-0 truncate" title={it.reviewNote ?? it.ai.item}><span className="font-medium">{it.ai.item}</span> — {label[it.reviewStatus]}{it.flagReason ? ` (${it.flagReason.toLowerCase().replace(/_/g, " ")})` : ""}{it.reviewNote ? `: “${it.reviewNote}”` : ""}</li>
              ))}
            </ul>
          )}
          <More n={decided.length - SHOWN} where="the review screen" />
        </div>
      );
    }
    case "boq": {
      const t = p.totals;
      if (!t || !p.lines.length) return null;
      const included = p.lines.filter((l) => l.included);
      return (
        <div className="space-y-1">
          <Dl rows={[
            ["BOQ", p.boqName ?? ""], ["Lines", `${p.lines.length} (${t.excluded} excluded)`], ["Priced", t.complete],
            ["No rate", t.unpriced], ["Quantity pending", t.pending], ["Priced total", `${fmtInr(t.pricedTotal)} (priced lines only)`],
          ]} />
          <ul className="text-xs space-y-0.5">
            {included.slice(0, SHOWN).map((l) => {
              const st = lineStatus(l);
              const rate = effectiveRate(l);
              return (
                <li key={l.id} className="min-w-0 truncate" title={l.description ?? undefined}>
                  <span className="font-medium">{l.description || "(no description)"}</span>: {st === "pending" ? "quantity pending" : fmtQty(l.qty, l.unit)}
                  {" · "}{rate == null ? <span className="text-amber-800 dark:text-amber-300">no rate</span> : `${fmtInr(rate)}/${l.unit ?? "unit"}`}
                </li>
              );
            })}
          </ul>
          <More n={included.length - SHOWN} where="the BOQ screen" />
        </div>
      );
    }
    case "checks": {
      const c = p.stages.find((s) => s.key === "checks");
      if (!c || (!c.open.length && !c.detail.length)) return null;
      const item = (d: { text: string; to?: string }) => <li key={d.text}>{d.to ? <Link className="underline" to={d.to}>{d.text}</Link> : d.text}</li>;
      return (
        <div className="space-y-1 text-xs">
          {c.open.length > 0 && <><p className="font-medium">Still open</p><ul className="list-disc pl-4">{c.open.map(item)}</ul></>}
          {c.detail.length > 0 && <><p className="font-medium">Also stated in the export</p><ul className="list-disc pl-4">{c.detail.map(item)}</ul></>}
        </div>
      );
    }
    case "export": {
      if (!p.totals || !p.lines.length) return null;
      const notes = [incompleteWarning(p.totals), basisNotice(p.totals)].filter(Boolean) as string[];
      return (
        <div className="space-y-1 text-xs">
          <p>On the Export screen: <span className="font-medium">PDF (priced)</span>, <span className="font-medium">PDF — specs &amp; quantities</span> and <span className="font-medium">Excel (CSV)</span>. Downloading reads the BOQ and creates a file on your computer; it changes no project data.</p>
          {notes.map((n) => <p key={n} className="text-amber-900 dark:text-amber-300">{n}</p>)}
        </div>
      );
    }
  }
}
