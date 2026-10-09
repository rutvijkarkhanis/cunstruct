// PROJECT ANALYSIS ORCHESTRATION — Phase A's "Analyze Project" action.
//
// Turns an EXPLICIT, user-confirmed Document -> Discipline(s) mapping (built
// in the new Analyze UI — never inferred from project_document.discipline,
// which is free text and, in every real upload today, hardcoded
// "Architectural" regardless of actual content) into the existing AI
// pipeline's own calls:
//   - one generateAnalysis({mode:"BOQ", boqId, documentIds}) call per
//     discipline that has at least one assigned document — never per file,
//     never per item.
//   - one generateAnalysis({mode:"LOCATION", documentId}) call per DISTINCT
//     document across the WHOLE plan — a document assigned to several
//     disciplines still gets exactly one LOCATION call, reused by every
//     discipline's reconciliation (see modeRequiresBoqScope()'s doc in
//     supabase/functions/_shared/contract.ts: LOCATION stays document-level
//     by design, unlike BOQ which is now claimed per-BOQ).
//
// No business logic duplicated from the edge function: this module only
// decides WHAT to call and WITH WHICH documentIds/boqId — generateAnalysis()
// itself still owns eligibility, claiming, cost, and the actual OpenAI call.
// Dependency-injected (same shape as findSimilarHandler.ts's ShareReadDeps
// convention) so the orchestration logic is testable without Supabase.

import { DISCIPLINES } from "@/lib/disciplines";
import type { GenerateResponse } from "./analysisClient";

/** One discipline's resolved analysis target: which documents feed it, and
 *  which BOQ to send them to — null means "create a new one for this
 *  discipline," already decided by the Analyze UI before this plan is built
 *  (see resolveBoqCandidates below), never guessed here. */
export interface DisciplinePlan {
  discipline: string;
  documentIds: string[];
  boqId: string | null;
}

/**
 * Groups an explicit Document -> Discipline(s) multi-select mapping (e.g.
 * `{ "doc-1": ["civil", "electrical"], "doc-2": ["electrical"] }`, exactly
 * the shape the Analyze UI's checklist produces) into one DisciplinePlan per
 * discipline that has at least one document — the inverse direction the
 * orchestration actually needs to drive per-discipline BOQ calls.
 *
 * A document assigned to zero disciplines contributes nothing (silently
 * excluded, never an error — that's the normal "not part of this Analyze
 * run" state, not a mistake). A discipline nobody assigned any document to
 * is left OUT of the result entirely — never produces an empty BOQ call or
 * creates a BOQ nobody asked for.
 *
 * Always returns disciplines in DISCIPLINES' own fixed order (civil,
 * plumbing, electrical, hvac, fire), never the mapping's insertion order or
 * an alphabetical accident — stable or display and for the call-count tests.
 */
export function buildDisciplinePlans(
  documentDisciplines: Record<string, string[]>,
  boqIdByDiscipline: Record<string, string | null | undefined> = {},
): DisciplinePlan[] {
  const documentIdsByDiscipline = new Map<string, string[]>();
  for (const [documentId, disciplines] of Object.entries(documentDisciplines)) {
    for (const discipline of disciplines) {
      const list = documentIdsByDiscipline.get(discipline) ?? [];
      list.push(documentId);
      documentIdsByDiscipline.set(discipline, list);
    }
  }
  return DISCIPLINES
    .map((d) => d.key)
    .filter((key) => (documentIdsByDiscipline.get(key)?.length ?? 0) > 0)
    .map((discipline) => ({
      discipline,
      documentIds: documentIdsByDiscipline.get(discipline) ?? [],
      boqId: boqIdByDiscipline[discipline] ?? null,
    }));
}

export interface BoqCandidate {
  id: string;
  name: string;
  discipline: string;
}

/**
 * Existing project BOQs already tagged with this discipline — for the
 * Analyze UI to offer as "reuse this BOQ" options instead of silently
 * assuming which existing BOQ a discipline key "really" means.
 *
 * Deliberately NOT authoritative: `boq.discipline` has historically
 * defaulted to 'civil' for every BOQ regardless of actual content (see
 * 20260806090000_boq_discipline.sql's default and the Phase A investigation
 * — createBoq() only started persisting a deliberate, caller-chosen
 * discipline value in this phase). A pre-existing BOQ that matches here may
 * simply never have been tagged — this function cannot tell the difference,
 * so the UI must show candidates by NAME for the user to confirm or
 * decline, never auto-select one on this list's say alone.
 */
export function resolveBoqCandidates(discipline: string, existingBoqs: BoqCandidate[]): BoqCandidate[] {
  return existingBoqs.filter((b) => b.discipline === discipline);
}

export interface ProjectAnalysisDeps {
  /** Creates a new BOQ for this discipline (wraps the existing createBoq()
   *  from useBoqManagement.ts — scope resolution, naming, etc. are this
   *  dependency's concern, not this module's) and returns its id. */
  createBoqForDiscipline: (discipline: string) => Promise<string>;
  generateBoqAnalysis: (args: { boqId: string; documentIds: string[] }) => Promise<GenerateResponse>;
  generateLocationAnalysis: (args: { documentId: string }) => Promise<GenerateResponse>;
  /** PR #154 — persist the (boqId, documentIds) provenance this discipline's
   *  BOQ call just succeeded against (see boqDocumentLinks.ts). Called ONLY
   *  from inside the loop below, immediately after generateBoqAnalysis
   *  resolves for THIS discipline — never speculatively, never for a
   *  discipline whose call is about to run or has thrown. A later
   *  discipline's failure throws before its own link call, but can never
   *  un-persist an earlier discipline's already-recorded mapping (each
   *  iteration's persistence is independent and already committed by the
   *  time a later iteration throws).
   *
   *  Optional so every pre-existing caller/test that builds
   *  ProjectAnalysisDeps without it keeps working unchanged — omitting it
   *  simply skips persistence, exactly like before this field existed. */
  linkAnalyzedDocuments?: (args: { boqId: string; documentIds: string[]; runId?: string | null }) => Promise<void>;
}

export interface DisciplineAnalysisOutcome {
  discipline: string;
  boqId: string;
  result: GenerateResponse;
}

export interface LocationAnalysisOutcome {
  documentId: string;
  result: GenerateResponse;
}

export interface ProjectAnalysisResult {
  disciplines: DisciplineAnalysisOutcome[];
  locations: LocationAnalysisOutcome[];
}

/** Coarse, discipline/batch-level progress only (Phase A section 11) — never
 *  per-file/per-page fake progress. `label` is the raw discipline key or
 *  document id; the UI maps it to a display name (disciplineByKey / the
 *  document's own name), keeping this module presentation-free. */
export interface ProjectAnalysisProgress {
  phase: "boq" | "location";
  label: string;
  index: number;
  total: number;
}

/**
 * Runs the full Analyze Project plan: one BOQ-mode call per discipline,
 * then one LOCATION-mode call per distinct document across every
 * discipline combined. Sequential, not parallel — same reasoning as every
 * other batch path in this codebase (e.g. useBoqManagement's counts query
 * aside, which IS parallel because its calls are independent reads; these
 * are writes that each claim real analysis_run_source rows, and running
 * them one at a time keeps a failed discipline's call from leaving unrelated
 * ones half-started in a way that's hard to reason about) — Analyze
 * Project's own coarse, discipline-at-a-time progress UI (Phase A section 11)
 * reflects this same ordering.
 */
export async function runProjectAnalysis(
  plans: DisciplinePlan[],
  deps: ProjectAnalysisDeps,
  onProgress?: (progress: ProjectAnalysisProgress) => void,
): Promise<ProjectAnalysisResult> {
  const nonEmptyPlans = plans.filter((p) => p.documentIds.length > 0);
  const disciplines: DisciplineAnalysisOutcome[] = [];
  for (const [i, plan] of nonEmptyPlans.entries()) {
    onProgress?.({ phase: "boq", label: plan.discipline, index: i + 1, total: nonEmptyPlans.length });
    const boqId = plan.boqId ?? (await deps.createBoqForDiscipline(plan.discipline));
    const result = await deps.generateBoqAnalysis({ boqId, documentIds: plan.documentIds });
    disciplines.push({ discipline: plan.discipline, boqId, result });
    // Persisted right here — the moment THIS discipline's own call is known
    // to have succeeded — never batched until the whole multi-discipline
    // run finishes. A later discipline's throw aborts the loop before its
    // own persistence call, but this one has already committed.
    if (deps.linkAnalyzedDocuments) {
      // Scope F — result.runId (GenerateResponse) is the analysis run that
      // just produced this discipline's review items; forwarded so the link
      // can resolve the EXACT analyzed revision (see boqDocumentLinks.ts)
      // instead of only ever falling back to "current revision right now."
      await deps.linkAnalyzedDocuments({ boqId, documentIds: plan.documentIds, runId: result.runId });
    }
  }

  // Never per-discipline, never per-item: exactly one LOCATION call per
  // document id that appears ANYWHERE in the plan, however many disciplines
  // it was assigned to.
  const distinctDocumentIds = [...new Set(plans.flatMap((p) => p.documentIds))];
  const locations: LocationAnalysisOutcome[] = [];
  for (const [i, documentId] of distinctDocumentIds.entries()) {
    onProgress?.({ phase: "location", label: documentId, index: i + 1, total: distinctDocumentIds.length });
    const result = await deps.generateLocationAnalysis({ documentId });
    locations.push({ documentId, result });
  }

  return { disciplines, locations };
}
