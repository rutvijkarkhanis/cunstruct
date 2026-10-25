// GUIDE MODE — a read-only walkthrough of one existing project, step by step
// over the project journey's own screens. Every status here is derived from
// the journey stages (lib/app/journey) the screens already show, so the guide
// can never disagree with them. Pure: no reads, no writes, no new rules.
//
// A step with nothing to inspect is "unavailable" and says why; a step whose
// work is held up by an earlier decision is "blocked". Nothing is ever shown
// as complete unless the journey says it is done.
import {
  journeyPath, manageBoqsPath, reviewWorkstationPath, builderPath,
  type JourneyStage, type ReviewState, type StageKey,
} from "@/lib/app/journey";
import type { BoqTotals } from "@/lib/app/boqTable";

export type GuideStepKey = "overview" | "drawings" | "takeoff" | "review" | "boq" | "checks" | "export";

export interface GuideStepDef {
  key: GuideStepKey;
  title: string;
  /** The journey screen (route under /app/projects/:id/) this step opens. */
  route: string;
  /** What the estimator is looking at. */
  what: string;
  /** Why it matters. */
  why: string;
}

export const GUIDE_STEPS: readonly GuideStepDef[] = [
  { key: "overview", title: "Project overview", route: "overview",
    what: "The project's recorded details and where each stage of its BOQ stands.",
    why: "The scope and the client, location and size set what the BOQ must cover." },
  { key: "drawings", title: "Drawings", route: "drawings",
    what: "The drawings uploaded to this project. Choose one in the list to open it in the viewer.",
    why: "Every quantity should trace back to a drawing; this is the evidence the BOQ rests on." },
  { key: "takeoff", title: "Take-off and quantities", route: "review",
    what: "The quantities taken off the drawings for this BOQ: item, quantity, unit and the drawing region it was read from.",
    why: "A take-off quantity is only as good as its evidence; a quantity with no region recorded needs checking against the drawing." },
  { key: "review", title: "Review", route: "review",
    what: "The decision on each take-off item: verified, corrected, flagged or marked pending.",
    why: "Only verified or corrected quantities reach the BOQ. Flagged and pending items stay out until resolved." },
  { key: "boq", title: "BOQ", route: "boq",
    what: "The BOQ lines: description, unit, quantity, rate and where each quantity came from.",
    why: "This is the document the contractor prices against; a pending quantity or missing rate is stated, never filled in." },
  { key: "checks", title: "Checks", route: "check",
    what: "What is still open on this BOQ: pending quantities, review items left out, missing rates and unrecorded quantity bases.",
    why: "Each open item would otherwise go out unnoticed in the export." },
  { key: "export", title: "Export", route: "export",
    what: "The export screen: PDF (priced, or specs and quantities) and Excel (CSV).",
    why: "The exported documents state everything still open, so a working estimate is never read as final." },
];

export type GuideStatus = "done" | "open" | "attention" | "blocked" | "unavailable" | "info";
export const GUIDE_STATUS_LABEL: Record<GuideStatus, string> = {
  done: "Complete", open: "In progress", attention: "Needs attention",
  blocked: "Blocked", unavailable: "Unavailable", info: "Ready to inspect",
};

/** A next action the estimator takes in an existing screen. `write`: it
 *  changes project data there — the guide only links to it, never does it. */
export interface GuideAction { label: string; to: string; write: boolean }

export interface GuideStepState {
  status: GuideStatus;
  summary: string;
  action: GuideAction | null;
}

export interface GuideInput {
  projectId: string;
  /** The BOQ the journey screens act on (lib useSelectedBoq), or null when the project has none. */
  boqId: string | null;
  /** Journey stages for that BOQ (useBoqJourney). */
  stages: JourneyStage[];
  review: ReviewState | null;
  totals: BoqTotals | null;
  lineCount: number;
  drawingCount: number;
  /** Where the guide is now: the review screen and the builder return here. */
  here: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function guideStepStates(i: GuideInput): Record<GuideStepKey, GuideStepState> {
  const stage = (k: StageKey) => i.stages.find((s) => s.key === k);
  const p = (route: string) => journeyPath(i.projectId, route, i.boqId);
  const createBoq: GuideAction = { label: "Create a BOQ (BOQ management)", to: manageBoqsPath(i.projectId, i.here), write: true };
  const workstation = i.boqId ? reviewWorkstationPath(i.projectId, i.boqId, i.here) : null;
  const noBoq: GuideStepState = { status: "unavailable", summary: "This project has no BOQ yet, so there is nothing to inspect here.", action: createBoq };

  const overview: GuideStepState = { status: "info", summary: "Project details as recorded.", action: null };

  const d = stage("drawings");
  const drawings: GuideStepState = i.drawingCount === 0
    ? { status: "unavailable", summary: "No drawings have been uploaded to this project.",
        action: { label: "Upload drawings (Upload or manage, on the Drawings screen)", to: p("drawings"), write: true } }
    : { status: d?.status === "done" ? "done" : "attention", summary: d?.summary ?? `${plural(i.drawingCount, "drawing")}.`, action: null };

  let takeoff: GuideStepState;
  let review: GuideStepState;
  if (!i.boqId) {
    takeoff = noBoq;
    review = noBoq;
  } else if (!i.review || i.review.kind === "none") {
    const load: GuideAction | null = workstation ? { label: "Open the review screen, where a take-off is loaded", to: workstation, write: true } : null;
    takeoff = { status: "unavailable", summary: "No take-off has been loaded for this BOQ, so there are no drawing quantities to inspect.", action: load };
    review = { status: "unavailable", summary: "Nothing to review: this BOQ has no take-off yet.", action: load };
  } else {
    const s = i.review.summary;
    takeoff = s.total === 0
      ? { status: "unavailable", summary: "The latest take-off for this BOQ has no items.", action: null }
      : { status: "info", summary: `${plural(s.total, "item")} in the latest take-off for this BOQ.`, action: null };
    const r = stage("review");
    const decide: GuideAction | null = workstation ? { label: "Open the review screen to decide items", to: workstation, write: true } : null;
    review = s.total === 0
      ? { status: "unavailable", summary: "Nothing to review: the latest take-off has no items.", action: null }
      : {
          status: s.remaining > 0 ? "blocked" : r?.status === "done" ? "done" : "attention",
          summary: r?.summary ?? "",
          action: r?.status === "done" ? null : decide,
        };
  }

  const b = stage("boq");
  const t = i.totals;
  const boq: GuideStepState = !i.boqId || !t ? noBoq
    : i.lineCount === 0
      ? { status: "unavailable", summary: "This BOQ has no lines yet. Lines come from applying reviewed items, or are added in the BOQ builder.",
          action: workstation ? { label: "Apply reviewed items (review screen)", to: workstation, write: true } : null }
      : {
          status: b?.status === "done" ? (t.unpriced > 0 ? "attention" : "done") : "attention",
          summary: [b?.summary, t.unpriced > 0 ? `${plural(t.unpriced, "line")} with a quantity ${t.unpriced === 1 ? "has" : "have"} no rate.` : ""].filter(Boolean).join(" "),
          action: t.pending > 0 ? { label: "Enter the pending quantities (BOQ screen)", to: b?.action?.to ?? p("boq"), write: true }
            : t.unpriced > 0 ? { label: "Enter missing rates (BOQ builder)", to: builderPath(i.projectId, i.boqId, i.here), write: true }
            : null,
        };

  const c = stage("checks");
  const checks: GuideStepState = !i.boqId || !t ? noBoq
    : i.lineCount === 0 ? { status: "unavailable", summary: "Nothing to check: this BOQ has no lines yet.", action: null }
    : {
        status: c?.status === "done" ? (c.detail.length ? "attention" : "done") : "attention",
        summary: c?.summary ?? "",
        action: c?.open[0]?.to ? { label: `Resolve: ${c.open[0].text}`, to: c.open[0].to, write: true } : null,
      };

  const e = stage("export");
  const exp: GuideStepState = !i.boqId || i.lineCount === 0
    ? { status: "unavailable", summary: "Nothing to export yet: this BOQ has no lines.", action: null }
    : { status: "info", summary: e?.summary ?? "", action: null };

  return { overview, drawings, takeoff, review, boq, checks, export: exp };
}

/** The project a journey path belongs to, if any. */
export const guideProjectOf = (pathname: string) => {
  const m = pathname.match(/^\/app\/projects\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};
