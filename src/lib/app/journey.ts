// THE QUANTITY BOQ JOURNEY — where a BOQ stands in each stage of the current
// phase (A–E), and the one next action, from persisted rows only. Pure: every
// figure comes from rules other screens already use (reviewSummary for the
// review queue, boqTotals for lines, the export's "not verified or edited"
// rule for review items left out of the BOQ). Nothing here is a page visit,
// a guess or a new completion rule.
//
// Quantity, specification and price are separate dimensions: a line with an
// established quantity and no rate is complete for this phase. Rates belong
// to the Pricing phase (see BOQ_PHASES) and are reported, never required here.
import type { BoqTotals } from "@/lib/app/boqTable";
import type { ReviewSummary } from "@/lib/review/reviewQueue";
import { UNKNOWN_ORIGIN_LABEL } from "@/lib/quantity";
import { WORKBENCH_PREVIEW_ENABLED } from "@/lib/workbenchPreview";

// ── The BOQ lifecycle ────────────────────────────────────────────────────────

export type PhaseAvailability = "current" | "planned" | "later";
export interface BoqPhase { key: string; name: string; question: string; availability: PhaseAvailability; note: string }

/** The five BOQ phases. Only Quantity is built; the rest are stated as not yet
 *  available, with what they will add — never shown as steps you can take. */
export const BOQ_PHASES: readonly BoqPhase[] = [
  { key: "quantity", name: "Quantity BOQ", question: "How much work or material is required?", availability: "current",
    note: "Scope, quantities, units, drawing evidence and review status." },
  { key: "specification", name: "Specification BOQ", question: "What exactly must be supplied or installed?", availability: "planned",
    note: "Not available yet. It will add material and product requirements to the same BOQ items." },
  { key: "pricing", name: "Pricing BOQ", question: "What is the estimated cost, and on what rate basis?", availability: "planned",
    note: "Not available yet. Rates you enter per line in the BOQ builder are kept on the same items and are not a finished price." },
  { key: "procurement", name: "Procurement BOQ", question: "From whom, and on what terms, will it be bought?", availability: "later",
    note: "Later. Supplier comparison, quotations and terms." },
  { key: "execution", name: "Execution & variations", question: "What changed, and what was actually used?", availability: "later",
    note: "Later. Changes and actual consumption against the BOQ." },
];

// ── Review state of one BOQ's latest drawing analysis ─────────────────────────

export type ReviewState =
  | { kind: "none" }                       // no drawing analysis for this BOQ
  | { kind: "run"; runId: string; summary: ReviewSummary };

/** Items with a decision that keeps them out of the BOQ until resolved. */
const heldBack = (s: ReviewSummary) => s.flagged + s.markedPending;
/** The export's rule: items not verified or edited are not in the BOQ. */
export const reviewNotInBoq = (r: ReviewState) =>
  (r.kind === "run" ? r.summary.total - r.summary.verified - r.summary.edited : 0);

// ── Stages A–E ───────────────────────────────────────────────────────────────

export type StageKey = "drawings" | "review" | "boq" | "checks" | "export";
export type StageStatus = "done" | "todo" | "attention" | "not_started";
export interface StageAction { label: string; to: string; external?: boolean }
/** A fact about a stage; `to` is where it is resolved, when it can be. */
export interface StageDetail { text: string; to?: string }
export interface JourneyStage {
  key: StageKey; title: string; goal: string;
  status: StageStatus; summary: string; detail: StageDetail[];
  /** Open items behind the summary, each linked to where it is resolved. */
  open: StageDetail[];
  action: StageAction | null;
}

/** The journey step (route) each stage is worked on. */
export const STAGE_STEP: Record<StageKey, string> = { drawings: "drawings", review: "review", boq: "boq", checks: "check", export: "export" };

export interface JourneyInput {
  projectId: string;
  boqId: string | null;
  drawingCount: number;
  drawingsWithoutFile: number;
  review: ReviewState | null;     // null when there is no BOQ
  totals: BoqTotals | null;       // null when there is no BOQ
  lineCount: number;              // every line, included or not
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** BOQ-table searches that find lines by their basis label (the table's
 *  search matches lib/quantity's provenance label). */
export const UNKNOWN_BASIS_SEARCH = UNKNOWN_ORIGIN_LABEL;
export const ASSUMPTION_SEARCH = "Assumption";

/** Journey path within the project, keeping the selected BOQ. */
export const journeyPath = (projectId: string, step: string, boqId: string | null) =>
  `/app/projects/${projectId}/${step}${boqId ? `?boq=${encodeURIComponent(boqId)}` : ""}`;

/** The journey BOQ step opened on a filter (status and/or search). */
export const boqFilterPath = (projectId: string, boqId: string, f: { status?: string; q?: string }) => {
  const q = new URLSearchParams({ boq: boqId });
  if (f.status) q.set("status", f.status);
  if (f.q) q.set("q", f.q);
  return `/app/projects/${projectId}/boq?${q}`;
};

const withReturn = (path: string, returnTo: string | null | undefined) =>
  returnTo ? `${path}${path.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}` : path;

/** The review workstation for a BOQ, with a way back to where the user came from. */
export const reviewWorkstationPath = (projectId: string, boqId: string, returnTo: string) =>
  withReturn(`/ops/projects/${projectId}/boqs/${boqId}/review`, returnTo);
/** The BOQ builder (rates, lines, commercials), with a way back to the journey. */
export const builderPath = (projectId: string, boqId: string, returnTo?: string | null) =>
  withReturn(`/ops/projects/${projectId}/boqs/${boqId}`, returnTo);
/** Where a BOQ is created for the project, with a way back to the journey. */
export const manageBoqsPath = (projectId: string, returnTo?: string | null) =>
  withReturn(`/ops/projects/${projectId}/boqs/manage`, returnTo);

/** A returnTo is honoured only when it is a path inside the project journey —
 *  never another origin or an arbitrary route. */
export function safeJourneyReturn(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/app/projects/") || raw.includes("//") || raw.includes("\\")) return null;
  return raw;
}
/** The journey BOQ step for the project a returnTo belongs to — the
 *  workbench's BOQ section when the returnTo is in the workbench preview and
 *  this build has it (otherwise unchanged; folds away without the preview). */
export function journeyBoqFrom(returnTo: string, boqId: string): string | null {
  const m = returnTo.match(/^\/app\/projects\/([^/?#]+)/);
  if (!m) return null;
  const path = journeyPath(decodeURIComponent(m[1]), "boq", boqId);
  return WORKBENCH_PREVIEW_ENABLED && isWorkbenchPath(returnTo) ? inWorkbench(path) : path;
}

/** Journey steps the workbench preview also has, as workbench sections. */
export const WORKBENCH_SECTIONS = ["drawings", "review", "boq", "check", "export"] as const;

/** Whether a path is inside a project's workbench preview. */
export const isWorkbenchPath = (path: string) => /^\/app\/projects\/[^/?#]+\/workbench(?=[/?#]|$)/.test(path);

/** A journey step path as the same section of the workbench preview (query
 *  kept); any other path is returned unchanged. Pure: whether to use it is
 *  the caller's (WORKBENCH_PREVIEW_ENABLED-gated) decision. */
export const inWorkbench = (path: string) =>
  path.replace(new RegExp(`^(/app/projects/[^/?#]+/)(${WORKBENCH_SECTIONS.join("|")})(?=[/?#]|$)`), "$1workbench/$2");

export function journeyStages(i: JourneyInput): JourneyStage[] {
  const p = (step: string) => journeyPath(i.projectId, step, i.boqId);
  const createBoq: StageAction = { label: "Create a BOQ", to: manageBoqsPath(i.projectId, journeyPath(i.projectId, "overview", null)), external: true };

  // A — Project and drawings
  const drawings: JourneyStage = {
    key: "drawings", title: "Project & drawings", goal: "Upload the drawings the quantities will come from.",
    // Done once any drawing has a file to work from; a record without a file
    // is reported, not treated as blocking the rest of the journey.
    status: i.drawingCount === 0 ? "todo" : i.drawingsWithoutFile >= i.drawingCount ? "attention" : "done",
    summary: i.drawingCount === 0 ? "No drawings yet."
      : i.drawingsWithoutFile >= i.drawingCount ? `${plural(i.drawingCount, "drawing")}, but none has a file to review.`
      : `${plural(i.drawingCount - i.drawingsWithoutFile, "drawing")} uploaded.`,
    detail: i.drawingsWithoutFile > 0 && i.drawingsWithoutFile < i.drawingCount ? [{ text: `${plural(i.drawingsWithoutFile, "drawing record")} without a file`, to: p("drawings") }] : [],
    open: [],
    action: { label: i.drawingCount === 0 ? "Upload drawings" : "Open drawings", to: p("drawings") },
  };

  // B — Review quantities
  let review: JourneyStage;
  const reviewAction = (label: string): StageAction | null => (i.boqId ? { label, to: p("review") } : createBoq);
  if (!i.boqId || !i.review) {
    review = { key: "review", title: "Review quantities", goal: "Check each quantity found on the drawings.",
      status: "not_started", summary: "No BOQ yet — create one to review quantities into.", detail: [], open: [], action: createBoq };
  } else if (i.review.kind === "none") {
    review = { key: "review", title: "Review quantities", goal: "Check each quantity found on the drawings.",
      status: "not_started", summary: "No drawing analysis for this BOQ yet.", detail: [], open: [], action: reviewAction("Start review") };
  } else {
    const s = i.review.summary;
    const held = heldBack(s);
    review = {
      key: "review", title: "Review quantities", goal: "Check each quantity found on the drawings.",
      status: s.remaining > 0 ? "todo" : held > 0 ? "attention" : "done",
      summary: s.remaining > 0
        ? `${plural(s.remaining, "item")} of ${s.total} still ${s.remaining === 1 ? "needs" : "need"} a decision. Apply is blocked until every item has one.`
        : held > 0 ? `Every item has a decision; ${held} ${held === 1 ? "is" : "are"} held back (flagged or marked pending) and will not reach the BOQ until resolved.`
        : `All ${s.total} items are verified or corrected.`,
      detail: [
        ...(s.flagged ? [{ text: `${plural(s.flagged, "item")} flagged`, to: p("review") }] : []),
        ...(s.markedPending ? [{ text: `${plural(s.markedPending, "item")} marked pending`, to: p("review") }] : []),
      ],
      open: s.remaining > 0 ? [{ text: `${plural(s.remaining, "item")} still ${s.remaining === 1 ? "needs" : "need"} a decision`, to: p("review") }] : [],
      action: reviewAction(s.remaining > 0 ? "Continue review" : "Open review"),
    };
  }

  // C — Build and inspect the BOQ
  const t = i.totals;
  const boq: JourneyStage = !i.boqId || !t
    ? { key: "boq", title: "Build BOQ", goal: "Confirm every line has a quantity, unit and basis.",
        status: "not_started", summary: "No BOQ yet.", detail: [], open: [], action: createBoq }
    : {
        key: "boq", title: "Build BOQ", goal: "Confirm every line has a quantity, unit and basis.",
        status: i.lineCount === 0 ? "todo" : t.pending > 0 ? "attention" : "done",
        summary: i.lineCount === 0 ? "No lines yet — apply reviewed items or add lines in the BOQ builder."
          : t.pending > 0 ? `${plural(t.pending, "line")} still ${t.pending === 1 ? "has" : "have"} a pending quantity.`
          : `All ${t.complete + t.unpriced} included lines have a quantity.`,
        detail: [],
        open: t.pending > 0 ? [{ text: `${plural(t.pending, "line")} with a pending quantity`, to: boqFilterPath(i.projectId, i.boqId, { status: "pending" }) }] : [],
        // With pending quantities, open the BOQ filtered to them.
        action: { label: t.pending > 0 && i.lineCount > 0 ? "Show pending lines" : "Open BOQ", to: t.pending > 0 && i.lineCount > 0 ? boqFilterPath(i.projectId, i.boqId, { status: "pending" }) : p("boq") },
      };

  // D — Check and finalise: what an export would have to state.
  const notInBoq = i.review ? reviewNotInBoq(i.review) : 0;
  const checks: JourneyStage = !i.boqId || !t
    ? { key: "checks", title: "Check & finalise", goal: "See what is still open before you issue the BOQ.",
        status: "not_started", summary: "No BOQ yet.", detail: [], open: [], action: null }
    : (() => {
        const boqId = i.boqId!;
        const open: StageDetail[] = [];
        if (t.pending) open.push({ text: `${plural(t.pending, "line")} with a pending quantity`, to: boqFilterPath(i.projectId, boqId, { status: "pending" }) });
        if (notInBoq) open.push({ text: `${plural(notInBoq, "review item")} not in the BOQ (not verified or corrected)`, to: p("review") });
        const notes: StageDetail[] = [];
        if (t.basisUnknown) notes.push({ text: `${plural(t.basisUnknown, "quantity", "quantities")} with no recorded basis`, to: boqFilterPath(i.projectId, boqId, { q: UNKNOWN_BASIS_SEARCH }) });
        if (t.assumed) notes.push({ text: `${plural(t.assumed, "quantity", "quantities")} based on an assumption`, to: boqFilterPath(i.projectId, boqId, { q: ASSUMPTION_SEARCH }) });
        if (t.unpriced) notes.push({ text: `${plural(t.unpriced, "line")} without a rate (rates belong to the Pricing phase)`, to: builderPath(i.projectId, boqId, p("check")) });
        return {
          key: "checks" as const, title: "Check & finalise", goal: "See what is still open before you issue the BOQ.",
          status: i.lineCount === 0 ? "not_started" as const : open.length ? "attention" as const : "done" as const,
          summary: i.lineCount === 0 ? "Nothing to check yet."
            : open.length ? `Still open: ${open.map((o) => o.text).join("; ")}.` : "No pending quantities and no review items left out.",
          detail: notes,
          open,
          action: i.lineCount === 0 ? null : { label: "Review checks", to: p("check") },
        };
      })();

  // E — Export
  const exp: JourneyStage = {
    key: "export", title: "Export", goal: "Download the Quantity BOQ as PDF or Excel.",
    status: !i.boqId || i.lineCount === 0 ? "not_started" : checks.status === "done" ? "todo" : "attention",
    summary: !i.boqId || i.lineCount === 0 ? "Nothing to export yet."
      : checks.status === "done" ? "Ready to export." : "You can export now; the document states everything still open.",
    detail: [],
    open: [],
    action: !i.boqId || i.lineCount === 0 ? null : { label: "Export", to: p("export") },
  };

  return [drawings, review, boq, checks, exp];
}

/** The single next action: the first stage, in journey order, that is not
 *  done and has an action. Export counts as not done until exported, so a
 *  finished BOQ's next action is Export. */
export function nextStage(stages: JourneyStage[]): JourneyStage | null {
  return stages.find((s) => s.status !== "done" && s.action) ?? null;
}
