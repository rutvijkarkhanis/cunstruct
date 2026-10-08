// ANALYZE PROJECT + READINESS — Phase A. Lives inside the existing
// ProjectWorkspace/WorkspaceContext architecture (mode="analyze") — no new
// top-level nav, no second workspace shell.
//
// Three steps, all local component state (never persisted — "keep the
// mapping as Analyze-session state," per the Phase A product decision):
//   1. "assign" — the user explicitly assigns each document to one or more
//      of the 5 fixed disciplines (civil/plumbing/electrical/hvac/fire).
//      NEVER inferred from project_document.discipline (free text,
//      hardcoded "Architectural" on every real upload today — see
//      projectAnalysis.ts's own header comment) and NEVER forces a document
//      into exactly one discipline.
//   2. "running" — runProjectAnalysis() does the real work (one BOQ call per
//      discipline, one LOCATION call per distinct document); this step only
//      shows coarse, discipline/batch-level progress, never fake per-file
//      granularity.
//   3. "results" — the readiness rollup (Ready / Needs Review / Unresolved)
//      plus "Review Exceptions": every non-GREEN item, with Item/Discipline/
//      Expected/Located/Schedule-evidence/Status columns (never a literal
//      "Schedule: 7" — schedule quantities aren't structured data). Clicking
//      a row opens the EXISTING BoqReviewWorkstation via onEnterMode
//      ("review", boqId) — no second review workstation.
//
// Reuses EXISTING AI infra verbatim: generateAnalysis()/fetchPreflight()
// (analysisClient.ts), createBoq() (useBoqManagement.ts),
// latestRunForBoq()/loadReviewItems() (reviewStore.ts),
// latestLocationRunForDocument()/loadLocationObservations()
// (locationObservations.ts). Never calls OpenAI directly, never writes a
// BOQ line, never modifies a quantity.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Loader2, Sparkles, AlertTriangle, AlertCircle } from "lucide-react";
import { DISCIPLINES, disciplineByKey } from "@/lib/disciplines";
import { loadProjectDrawings } from "@/lib/review/drawingStorage";
import { useProjectBoqs } from "@/hooks/useProjectBoqs";
import { useBoqManagement, NEW_SCOPE } from "@/hooks/useBoqManagement";
import {
  buildDisciplinePlans, resolveBoqCandidates, runProjectAnalysis,
  type ProjectAnalysisProgress, type DisciplinePlan,
} from "@/lib/ai/projectAnalysis";
import { fetchPreflight, generateAnalysis } from "@/lib/ai/analysisClient";
import { linkAnalyzedDocumentsToBoq, loadBoqDocumentLinks } from "@/lib/review/boqDocumentLinks";
import { latestRunForBoq, loadReviewItems } from "@/lib/review/reviewStore";
import { latestLocationRunForDocument, loadLocationObservations } from "@/lib/review/locationObservations";
import { computeProjectReadiness, type ProjectReadinessResult, type ExceptionRow } from "@/lib/review/computeProjectReadiness";
import { generateAndPersistCoverageFindings } from "@/lib/review/coverageOrchestration";
import { loadActiveCoverageFindingCounts, persistCoverageFindings } from "@/lib/auditImport";
import type { ReconciliationStatus } from "@/lib/review/instanceReconciliation";
import type { WorkspaceMode } from "@/lib/review/workspaceState";
import { Link } from "react-router-dom";

const STATUS_LABEL: Record<ReconciliationStatus, string> = { GREEN: "Ready", AMBER: "Needs Review", RED: "Unresolved" };
const STATUS_VARIANT: Record<ReconciliationStatus, "default" | "secondary" | "destructive"> = { GREEN: "default", AMBER: "secondary", RED: "destructive" };

type Step = "assign" | "running" | "results";

export interface WorkspaceAnalyzePanelProps {
  projectId: string;
  onEnterMode: (mode: WorkspaceMode, boqId?: string) => void;
}

export default function WorkspaceAnalyzePanel({ projectId, onEnterMode }: WorkspaceAnalyzePanelProps) {
  const [step, setStep] = useState<Step>("assign");
  // documentId -> assigned discipline keys (multi-select — a document may
  // legitimately feed several BOQs at once).
  const [assignment, setAssignment] = useState<Record<string, string[]>>({});
  // discipline -> the existing BOQ id the user confirmed to reuse, or ""
  // (the "create a new one" choice). Undefined = not yet touched by the
  // user; the single-candidate default below applies until they do.
  const [boqChoice, setBoqChoice] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<ProjectAnalysisProgress | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ProjectReadinessResult | null>(null);

  const { data: drawings } = useQuery({
    queryKey: ["analyze-project-drawings", projectId],
    enabled: !!projectId,
    queryFn: () => loadProjectDrawings(projectId),
  });
  const { data: existingBoqs } = useProjectBoqs(projectId);
  const { createBoq } = useBoqManagement(projectId);

  // Same admin-only model resolution BoqReviewWorkstation.tsx now uses for
  // LOCATION's content-hash fallback — see its own fix's doc comment. A
  // non-admin caller gets "" (the fallback simply can't be checked for them
  // either way; the primary document_id-scoped lookup doesn't need it).
  const { data: locationPreflight } = useQuery({
    queryKey: ["location-admin-check", projectId],
    queryFn: () => fetchPreflight({ projectId, boqId: null, mode: "LOCATION" }),
    enabled: !!projectId,
  });
  const locationModel = locationPreflight?.internal?.model ?? "";

  const documents = drawings ?? [];

  const toggleAssignment = (documentId: string, discipline: string, checked: boolean) => {
    setAssignment((prev) => {
      const current = new Set(prev[documentId] ?? []);
      if (checked) current.add(discipline); else current.delete(discipline);
      return { ...prev, [documentId]: [...current] };
    });
  };

  const plans = useMemo(() => buildDisciplinePlans(assignment), [assignment]);

  const candidatesByDiscipline = useMemo(() => {
    const map = new Map<string, { id: string; name: string; discipline: string }[]>();
    for (const p of plans) map.set(p.discipline, resolveBoqCandidates(p.discipline, existingBoqs ?? []));
    return map;
  }, [plans, existingBoqs]);

  // The effective BOQ target per discipline right now, for display AND for
  // the actual Analyze call — "" means "create a new one." Explicit user
  // choice wins; otherwise a single existing candidate is the sensible
  // default (still shown, still changeable — never hidden).
  const effectiveBoqChoice = (discipline: string): string => {
    if (discipline in boqChoice) return boqChoice[discipline];
    const candidates = candidatesByDiscipline.get(discipline) ?? [];
    return candidates.length === 1 ? candidates[0].id : "";
  };

  const canAnalyze = plans.length > 0;

  async function handleAnalyze() {
    setRunError(null);
    setProgress(null);
    setStep("running");

    const plansWithBoq: DisciplinePlan[] = plans.map((p) => ({ ...p, boqId: effectiveBoqChoice(p.discipline) || null }));
    const createdBoqNames: Record<string, string> = {};

    try {
      const result = await runProjectAnalysis(
        plansWithBoq,
        {
          createBoqForDiscipline: async (discipline) => {
            const d = disciplineByKey(discipline);
            const name = `${d.name} BOQ`;
            const boqId = await createBoq({
              name, scopeId: NEW_SCOPE, newScopeName: d.name, newScopeKind: "discipline", discipline,
            });
            if (!boqId) throw new Error(`Could not create a BOQ for ${d.name}.`);
            createdBoqNames[boqId] = name;
            return boqId;
          },
          generateBoqAnalysis: async ({ boqId, documentIds }) => {
            const res = await generateAnalysis({ projectId, boqId, documentIds, mode: "BOQ" });
            if (!res.ok) throw new Error(res.error ?? "BOQ analysis failed.");
            return res;
          },
          // Best-effort: a LOCATION failure for one document must never stop
          // the rest of Analyze Project or hide the BOQ results already
          // produced — the readiness rollup below just sees that document as
          // "LOCATION not run" (AMBER for its countable items), an honest
          // outcome, not a blocked run.
          generateLocationAnalysis: ({ documentId }) => generateAnalysis({ projectId, boqId: null, documentIds: [documentId], mode: "LOCATION" }),
          // PR #154 — persists which documents fed this BOQ. Called by
          // runProjectAnalysis ONLY after this discipline's own BOQ call
          // already succeeded (see projectAnalysis.ts), so it never records
          // a discipline whose analysis failed.
          linkAnalyzedDocuments: ({ boqId, documentIds }) => linkAnalyzedDocumentsToBoq(boqId, documentIds),
        },
        setProgress,
      );

      const boqNameById = new Map<string, string>([
        ...(existingBoqs ?? []).map((b) => [b.id, b.name] as const),
        ...Object.entries(createdBoqNames),
      ]);
      const boqRefs = result.disciplines.map((d) => ({
        discipline: d.discipline, boqId: d.boqId, boqName: boqNameById.get(d.boqId) ?? disciplineByKey(d.discipline).name,
      }));

      // Coverage generation + persistence (PR #155/#156's own functions,
      // never duplicated here) — must run BEFORE computeProjectReadiness
      // below, so this same run's results screen reflects any gap it just
      // found rather than only showing it on a later run. Best-effort,
      // matching the exact existing precedent for a LOCATION failure (see
      // generateLocationAnalysis above): a Coverage failure never blocks
      // or hides the BOQ/readiness results Analyze Project already produced.
      try {
        await generateAndPersistCoverageFindings(boqRefs, projectId, {
          latestRunForBoq,
          loadReviewItems,
          loadLocationObservations: async (documentId) => {
            const run = await latestLocationRunForDocument(projectId, documentId, locationModel);
            if (run.status !== "SUCCEEDED" || !run.runId) return [];
            return loadLocationObservations(run.runId);
          },
          loadBoqDocumentLinks,
          persistCoverageFindings,
        });
      } catch {
        // Swallowed deliberately — Coverage is advisory; a failure here
        // must never surface as "Analysis failed" for a run whose BOQ/
        // LOCATION analysis genuinely succeeded.
      }

      const readinessResult = await computeProjectReadiness(boqRefs, documents, {
        latestRunForBoq,
        loadReviewItems,
        loadLocationRun: async (documentId) => {
          const run = await latestLocationRunForDocument(projectId, documentId, locationModel);
          if (run.status !== "SUCCEEDED" || !run.runId) return { ran: false, observations: [] };
          return { ran: true, observations: await loadLocationObservations(run.runId) };
        },
        // PR #157 — active Coverage "Potential Gap" findings, already
        // persisted by PR #156. Read-only: never regenerates Coverage here,
        // never calls coverageSignals.ts, never writes anything.
        loadActiveCoverageFindingCounts,
      });

      setReadiness(readinessResult);
      setStep("results");
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Analysis failed. Please try again.");
      setStep("assign");
    }
  }

  if (step === "running") {
    const pct = progress ? Math.round((progress.index / Math.max(progress.total, 1)) * 100) : 0;
    const label = progress
      ? progress.phase === "boq"
        ? `Analyzing ${disciplineByKey(progress.label).name} (${progress.index}/${progress.total})…`
        : `Extracting locations (${progress.index}/${progress.total})…`
      : "Starting…";
    return (
      <div className="space-y-3 py-4">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          <span>{label}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          This runs one analysis per discipline, then one location pass per drawing — never per item.
        </p>
      </div>
    );
  }

  if (step === "results" && readiness) {
    return <ReadinessResults readiness={readiness} projectId={projectId} onEnterMode={onEnterMode} onBackToAssign={() => setStep("assign")} />;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Analyze Project</div>
        <p className="text-[11px] text-muted-foreground">
          Assign each drawing to the discipline(s) it feeds. A drawing can feed more than one — e.g. an
          architectural floor plan may carry Civil, Electrical, and Plumbing evidence at once.
        </p>
      </div>

      {runError && (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {runError}
        </div>
      )}

      {documents.length === 0 ? (
        <p className="text-xs text-muted-foreground">No drawings uploaded to this project yet.</p>
      ) : (
        <div className="rounded border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px]">Drawing</TableHead>
                {DISCIPLINES.map((d) => (
                  <TableHead key={d.key} className="text-[11px] text-center">{d.short}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.documentId}>
                  <TableCell className="text-xs py-1.5">{doc.name}</TableCell>
                  {DISCIPLINES.map((d) => (
                    <TableCell key={d.key} className="text-center py-1.5">
                      <Checkbox
                        aria-label={`Assign ${doc.name} to ${d.name}`}
                        checked={(assignment[doc.documentId] ?? []).includes(d.key)}
                        onCheckedChange={(checked) => toggleAssignment(doc.documentId, d.key, checked === true)}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {plans.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Will analyze</div>
          {plans.map((plan) => {
            const d = disciplineByKey(plan.discipline);
            const candidates = candidatesByDiscipline.get(plan.discipline) ?? [];
            const chosen = effectiveBoqChoice(plan.discipline);
            return (
              <div key={plan.discipline} className="rounded border p-2 space-y-1.5">
                <div className="text-xs font-semibold">{d.name}</div>
                <ul className="text-[11px] text-muted-foreground space-y-0.5">
                  {plan.documentIds.map((docId) => (
                    <li key={docId}>✓ {documents.find((doc) => doc.documentId === docId)?.name ?? docId}</li>
                  ))}
                </ul>
                {candidates.length > 0 ? (
                  <Select value={chosen} onValueChange={(v) => setBoqChoice((prev) => ({ ...prev, [plan.discipline]: v }))}>
                    <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="Create a new BOQ" /></SelectTrigger>
                    <SelectContent>
                      {candidates.map((c) => <SelectItem key={c.id} value={c.id}>Reuse "{c.name}"</SelectItem>)}
                      <SelectItem value="">Create a new {d.name} BOQ</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Will create a new "{d.name} BOQ".</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Button className="w-full gap-1.5" disabled={!canAnalyze} onClick={handleAnalyze}>
        <Sparkles className="w-3.5 h-3.5" /> Analyze Project
      </Button>
    </div>
  );
}

function ReadinessResults({
  readiness, projectId, onEnterMode, onBackToAssign,
}: {
  readiness: ProjectReadinessResult;
  projectId: string;
  onEnterMode: (mode: WorkspaceMode, boqId?: string) => void;
  onBackToAssign: () => void;
}) {
  const [showExceptions, setShowExceptions] = useState(false);
  const { overall, byBoq } = readiness.projectReadiness;
  const { activeCountByBoqId, totalActiveCount } = readiness.coverage;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Readiness</div>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <Badge variant="default">{overall.green} Ready</Badge>
          <Badge variant="secondary">{overall.amber} Needs Review</Badge>
          <Badge variant="destructive">{overall.red} Unresolved</Badge>
          {/* PR #157 — advisory only, never a primary readiness state: a
              Potential Gap has no existing BOQ item to attach a GREEN/AMBER/
              RED status to, so it is reported here, never folded into the
              badges above. */}
          {totalActiveCount > 0 && (
            <Badge variant="outline" className="gap-1">
              <AlertCircle className="w-3 h-3" /> {totalActiveCount} potential {totalActiveCount === 1 ? "gap" : "gaps"}
            </Badge>
          )}
        </div>
        {totalActiveCount > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Evidence was found that does not currently map to a BOQ item — review below.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        {byBoq.map((b) => {
          const gapCount = activeCountByBoqId[b.boqId] ?? 0;
          return (
            <div key={b.boqId} className="rounded border p-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{b.boqName}</div>
                <div className="text-[11px] text-muted-foreground">{disciplineByKey(b.discipline).name}</div>
                {gapCount > 0 && (
                  <div className="text-[11px] text-amber-700 mt-0.5">
                    {gapCount} potential {gapCount === 1 ? "gap" : "gaps"}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-[11px] text-muted-foreground">{b.counts.readyPct}% ready</div>
                {gapCount > 0 && (
                  // Navigates to the EXISTING BOQ Audit Review (OpsBoqBuilder,
                  // same route WorkspaceBoqPanel.tsx's own "Open BOQ" link
                  // already uses) — never an embedded/reimplemented review UI.
                  <Link to={`/ops/projects/${projectId}/boqs/${b.boqId}`}>
                    <Button size="sm" variant="outline" className="h-6 text-[11px] px-2">Review</Button>
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {readiness.exceptions.length > 0 ? (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setShowExceptions((v) => !v)}>
          {showExceptions ? "Hide" : "Review"} Exceptions ({readiness.exceptions.length})
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">No exceptions — every item is Ready.</p>
      )}

      {showExceptions && <ExceptionsTable rows={readiness.exceptions} onEnterMode={onEnterMode} />}

      <Button variant="ghost" size="sm" className="w-full" onClick={onBackToAssign}>
        Run Analyze Project again
      </Button>
    </div>
  );
}

function ExceptionsTable({ rows, onEnterMode }: { rows: ExceptionRow[]; onEnterMode: (mode: WorkspaceMode, boqId?: string) => void }) {
  return (
    <div className="rounded border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-[11px]">Item</TableHead>
            <TableHead className="text-[11px]">Discipline</TableHead>
            <TableHead className="text-[11px]">Expected</TableHead>
            <TableHead className="text-[11px]">Located</TableHead>
            <TableHead className="text-[11px]">Schedule evidence</TableHead>
            <TableHead className="text-[11px]">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={`${row.boqId}-${row.itemId}`}
              className="cursor-pointer hover:bg-accent/40"
              onClick={() => onEnterMode("review", row.boqId)}
            >
              <TableCell className="text-xs py-1.5">{row.itemName}</TableCell>
              <TableCell className="text-xs py-1.5">{disciplineByKey(row.discipline).short}</TableCell>
              <TableCell className="text-xs py-1.5">{row.expectedQuantity ?? "—"}</TableCell>
              <TableCell className="text-xs py-1.5">{row.locatedCount ?? "—"}</TableCell>
              <TableCell className="text-xs py-1.5">{row.hasScheduleEntry ? "Yes" : "No"}</TableCell>
              <TableCell className="text-xs py-1.5">
                <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
