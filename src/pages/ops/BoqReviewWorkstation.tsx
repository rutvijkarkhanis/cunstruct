// BOQ REVIEW WORKSTATION — verify a drawing analysis item-by-item.
//
// Split-screen inspection tool. LEFT: the current analysis item + Verify/Edit/
// Flag/Mark-Pending. RIGHT: an evidence viewer that positions the analysis's
// bounding boxes in page space. Importing an analysis NEVER changes the BOQ; all
// review state lives in analysis_review_item. Works with NO AI configured (JSON
// import is the default). All review actions are deterministic/client-side.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowLeft, Check, Pencil, Flag, Clock, ChevronLeft, ChevronRight, Upload, Cpu, FileText, ChevronDown, ChevronUp,
} from "lucide-react";
import { parseAnalysisV1, type ClaimType } from "@/lib/review/analysisSchemaV1";
import {
  orderQueue, matchesFilter, reviewSummary, isCritical, effectiveQuantity, diffItem, quantityDelta,
  type ReviewFilter, type ReviewStatus, type FlagReason, type ReviewerValues,
} from "@/lib/review/reviewQueue";
import { transformBoxes, unionBox, hasPlaceableEvidence } from "@/lib/review/evidenceCoords";
import { claimLabel, formatClaimValue, summarizeClaimEvidence, type EvidenceSummary } from "@/lib/review/evidenceDisplay";
import { defaultInputMode, isProviderConfigured, PROVIDERS, type InputMode } from "@/lib/review/analysisProviders";
import { createAnalysisRun, loadReviewItems, latestRunForBoq, saveReviewDecision, type StoredReviewItem } from "@/lib/review/reviewStore";
import { buildApplyPlan, applyReviewPlan, type ApplyCandidate, type BoqLineForApply, type UnsupportedChange } from "@/lib/review/applyReview";
import { resolveItemDrawing, type StoredDrawing } from "@/lib/review/documentResolve";
import { signedDrawingUrl } from "@/lib/review/drawingStorage";
import PdfEvidenceViewer from "@/components/review/PdfEvidenceViewer";
import DocumentSelector from "@/components/review/DocumentSelector";

const FLAG_REASONS: { key: FlagReason; label: string }[] = [
  { key: "DRAWING_UNCLEAR", label: "Drawing unclear" },
  { key: "CONFLICTING_DRAWINGS", label: "Conflicting drawings" },
  { key: "INCORRECT_QUANTITY", label: "Incorrect quantity" },
  { key: "INCORRECT_DIMENSION", label: "Incorrect dimension" },
  { key: "INCORRECT_SPECIFICATION", label: "Incorrect specification" },
  { key: "MISSING_EVIDENCE", label: "Missing evidence" },
  { key: "DUPLICATE", label: "Duplicate" },
  { key: "OTHER", label: "Other" },
];

const FILTERS: ReviewFilter[] = ["ALL", "NEEDS_REVIEW", "CRITICAL", "PENDING", "VERIFIED", "EDITED", "FLAGGED"];

export default function BoqReviewWorkstation() {
  const { id: routeId, boqId: routeBoqId } = useParams<{ id?: string; boqId?: string }>();
  const boqId = routeBoqId ?? routeId!;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: boq } = useQuery({
    queryKey: ["rw-boq", boqId],
    queryFn: async () => {
      const { data } = await supabase.from("boq").select("id, name, project_id").eq("id", boqId).single();
      return data as { id: string; name: string; project_id: string | null } | null;
    },
  });
  const { data: project } = useQuery({
    queryKey: ["rw-project", boq?.project_id],
    enabled: !!boq?.project_id,
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name, project_type").eq("id", boq!.project_id!).single();
      return data as { id: string; name: string; project_type: string | null } | null;
    },
  });

  // The project's stored drawings, for resolving an analysis item's source doc.
  const { data: drawings = [] } = useQuery({
    queryKey: ["rw-drawings", boq?.project_id],
    enabled: !!boq?.project_id,
    queryFn: async (): Promise<StoredDrawing[]> => {
      const { data: docs } = await supabase.from("project_document")
        .select("id, name, current_revision_id").eq("project_id", boq!.project_id!);
      const revIds = (docs ?? []).map((d) => d.current_revision_id).filter(Boolean) as string[];
      const revs = revIds.length
        ? (await supabase.from("document_revision").select("id, file_path, original_filename, page_count").in("id", revIds)).data ?? []
        : [];
      const revById = new Map(revs.map((r) => [r.id, r]));
      return (docs ?? []).map((d) => {
        const r = d.current_revision_id ? revById.get(d.current_revision_id) : undefined;
        return { documentId: d.id, name: d.name, originalFilename: r?.original_filename ?? null, filePath: r?.file_path ?? null, pageCount: r?.page_count ?? null };
      });
    },
  });

  // The BOQ's current lines, for diffing reviewed values against the CURRENT
  // BOQ (not the original AI value) when building the apply-to-BOQ plan.
  const { data: boqLines = [] } = useQuery({
    queryKey: ["rw-lines", boqId],
    enabled: !!boqId,
    queryFn: async (): Promise<BoqLineForApply[]> => {
      const { data } = await supabase.from("boq_line")
        .select("id, external_key, qty, unit, quantity_status").eq("boq_id", boqId);
      return (data ?? []) as unknown as BoqLineForApply[];
    },
  });

  const [items, setItems] = useState<StoredReviewItem[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [resolvedDocumentId, setResolvedDocumentId] = useState<string | null>(null);
  const [runCreatedAt, setRunCreatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ReviewFilter>("NEEDS_REVIEW");
  const [cursor, setCursor] = useState(0);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [selectedApplyIds, setSelectedApplyIds] = useState<Set<string>>(new Set());
  const [selectedClaim, setSelectedClaim] = useState<ClaimType | null>(null);

  // Load the latest run for this BOQ, if any.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const run = await latestRunForBoq(boqId);
        if (!alive) return;
        if (run) {
          setRunId(run.id);
          setResolvedDocumentId(run.resolved_document_id ?? null);
          setRunCreatedAt(run.created_at ?? null);
          setItems(await loadReviewItems(run.id));
        }
      } catch { /* degrade to import view */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [boqId]);

  const ordered = useMemo(() => orderQueue(items), [items]);
  const visible = useMemo(() => ordered.filter((it) => matchesFilter(it, filter)), [ordered, filter]);
  const summary = useMemo(() => reviewSummary(items), [items]);
  const current = visible[Math.min(cursor, Math.max(0, visible.length - 1))];

  // Apply-to-BOQ: pure classification, recomputed against the CURRENT BOQ lines
  // every render — never automatic, only acted on when the reviewer confirms.
  const applyPlan = useMemo(() => buildApplyPlan(items, boqLines), [items, boqLines]);
  const applyableCandidates = useMemo(
    () => applyPlan.filter((c) => c.classification === "APPLY" || c.classification === "NEW_LINE"),
    [applyPlan],
  );

  const openApplyModal = useCallback(() => {
    setSelectedApplyIds(new Set(applyableCandidates.map((c) => c.reviewItemId)));
    setShowApplyModal(true);
  }, [applyableCandidates]);

  const applyMut = useMutation({
    mutationFn: () => applyReviewPlan({ boqId, candidates: applyPlan, selectedIds: selectedApplyIds }),
    onSuccess: (res) => {
      toast.success(`Applied ${res.appliedCount} to the BOQ` + (res.unresolvedCount ? ` · ${res.unresolvedCount} unresolved` : ""));
      qc.invalidateQueries({ queryKey: ["rw-lines", boqId] });
      qc.invalidateQueries({ queryKey: ["boq-lines", boqId] });
      setShowApplyModal(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to apply to the BOQ"),
  });

  // Clear selectedClaim when item changes
  useEffect(() => { setSelectedClaim(null); }, [current?.id]);

  const go = useCallback((delta: number) => {
    setCursor((c) => Math.max(0, Math.min(visible.length - 1, c + delta)));
  }, [visible.length]);

  const applyDecision = useCallback(async (
    status: ReviewStatus, opts: { reviewer?: ReviewerValues | null; flagReason?: FlagReason | null; note?: string | null } = {},
  ) => {
    if (!current) return;
    try {
      await saveReviewDecision({ itemId: current.id, reviewStatus: status, reviewer: opts.reviewer ?? null, flagReason: opts.flagReason ?? null, reviewNote: opts.note ?? null });
      setItems((prev) => prev.map((it) => it.id === current.id
        ? { ...it, reviewStatus: status, reviewer: opts.reviewer ?? undefined, flagReason: opts.flagReason ?? undefined, reviewNote: opts.note ?? undefined, reviewedAt: new Date().toISOString() }
        : it));
      // Auto-advance to the next item in the current view.
      setTimeout(() => go(1), 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save review");
    }
  }, [current, go]);

  // ---- Loading / import gate --------------------------------------------------
  if (loading) return <div className="p-8 text-muted-foreground">Loading review…</div>;

  if (!runId || items.length === 0) {
    return (
      <ImportGate
        boqName={boq?.name}
        projectType={project?.project_type ?? null}
        onImported={async (rid, its) => {
          setRunId(rid);
          setItems(its);
          setCursor(0);
          // Fetch the newly created run to get resolved_document_id from database
          const run = await latestRunForBoq(boqId);
          if (run) setResolvedDocumentId(run.resolved_document_id ?? null);
        }}
        boqId={boqId}
        projectId={boq?.project_id ?? null}
        drawings={drawings}
        onBack={() => navigate(`../boqs/${boqId}`)}
      />
    );
  }

  return (
    <div className="p-4 space-y-3">
      {/* Header + summary */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => navigate(`../boqs/${boqId}`)}><ArrowLeft className="w-4 h-4 mr-1" /> BOQ</Button>
        <h2 className="font-semibold">BOQ Review</h2>
        <span className="text-sm text-muted-foreground">{boq?.name}</span>
        {runCreatedAt && <span className="text-xs text-muted-foreground">run {new Date(runCreatedAt).toLocaleString()}</span>}
        <Button variant="outline" size="sm" onClick={openApplyModal} className="ml-auto">
          Apply to BOQ{applyableCandidates.length > 0 ? ` (${applyableCandidates.length})` : ""}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowImportModal(true)}>Import New Analysis</Button>
        <span className="ml-auto text-sm text-muted-foreground">{summary.total - summary.remaining} / {summary.total} reviewed · {summary.completionPct}%</span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
        <Stat label="Total" value={summary.total} />
        <Stat label="Verified" value={summary.verified} cls="text-green-700" />
        <Stat label="Edited" value={summary.edited} cls="text-blue-700" />
        <Stat label="Flagged" value={summary.flagged} cls="text-amber-700" />
        <Stat label="Pending" value={summary.markedPending} cls="text-purple-700" />
        <Stat label="Remaining" value={summary.remaining} cls="text-muted-foreground" />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => { setFilter(f); setCursor(0); }}
            className={`text-xs px-2 py-1 rounded border ${filter === f ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {f.replace("_", " ").toLowerCase()}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">Keys: V verify · E edit · F flag · P pending · ← → move</span>
      </div>

      {!current ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Nothing in this filter. Switch to “all”.</CardContent></Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          <ItemPanel
            key={current.id}
            item={current}
            index={visible.indexOf(current)}
            count={visible.length}
            onVerify={() => applyDecision("VERIFIED")}
            onEdit={(reviewer) => applyDecision("EDITED", { reviewer })}
            onFlag={(flagReason, note) => applyDecision("FLAGGED", { flagReason, note })}
            onPending={() => applyDecision("MARKED_PENDING")}
            onPrev={() => go(-1)}
            onNext={() => go(1)}
            keyboardEnabled
            onSelectClaim={setSelectedClaim}
            drawings={drawings}
            resolvedDocumentId={resolvedDocumentId}
          />
          <ResolvedEvidenceViewer item={current} drawings={drawings} resolvedDocumentId={resolvedDocumentId} selectedClaim={selectedClaim} />
        </div>
      )}

      {/* Import new analysis modal */}
      <Dialog open={showImportModal} onOpenChange={setShowImportModal}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <ImportGate
            boqName={boq?.name}
            projectType={project?.project_type ?? null}
            onImported={(rid, its) => {
              setRunId(rid);
              setItems(its);
              setRunCreatedAt(new Date().toISOString());
              setCursor(0);
              setShowImportModal(false);
              toast.success("New analysis imported successfully");
            }}
            boqId={boqId}
            projectId={boq?.project_id ?? null}
            drawings={drawings}
            onBack={() => setShowImportModal(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Apply reviewed changes to the BOQ — explicit confirmation, exact diff */}
      <Dialog open={showApplyModal} onOpenChange={setShowApplyModal}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <h2 className="font-semibold">Apply reviewed changes to BOQ</h2>
          <p className="text-xs text-muted-foreground -mt-2">
            Only verified/edited items that differ from the current BOQ are applied. Flagged and unreviewed items are never touched.
          </p>
          <ApplyToBoqDialog
            candidates={applyPlan}
            selectedIds={selectedApplyIds}
            onToggle={(id) => setSelectedApplyIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })}
            onSelectAll={(checked) => setSelectedApplyIds(checked ? new Set(applyableCandidates.map((c) => c.reviewItemId)) : new Set())}
            onApply={() => applyMut.mutate()}
            applying={applyMut.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Apply to BOQ — confirmation screen ──────────────────────────────────────────
const UNSUPPORTED_FIELD_LABEL: Record<UnsupportedChange["field"], string> = {
  dimension: "Dimension", specification: "Specification", location: "Location",
};

export function ApplyToBoqDialog({ candidates, selectedIds, onToggle, onSelectAll, onApply, applying }: {
  candidates: ApplyCandidate[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: (checked: boolean) => void;
  onApply: () => void;
  applying: boolean;
}) {
  const applyable = candidates.filter((c) => c.classification === "APPLY" || c.classification === "NEW_LINE");
  const noChange = candidates.filter((c) => c.classification === "NO_CHANGE");
  const notApplicable = candidates.filter((c) => c.classification === "REVIEWED_NOT_APPLICABLE");
  const unresolved = candidates.filter((c) => c.classification === "NOT_ELIGIBLE" || c.classification === "CANNOT_APPLY");
  const selectedCount = applyable.filter((c) => selectedIds.has(c.reviewItemId)).length;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-sm font-semibold">Ready to apply ({applyable.length})</h3>
          {applyable.length > 0 && (
            <label className="text-xs flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={selectedCount === applyable.length} onChange={(e) => onSelectAll(e.target.checked)} />
              Select all
            </label>
          )}
        </div>
        {applyable.length === 0 ? (
          <p className="text-xs text-muted-foreground">No verified or edited items differ from the current BOQ.</p>
        ) : (
          <div className="divide-y border rounded">
            {applyable.map((c) => (
              <label key={c.reviewItemId} className="flex items-start gap-2 p-2 text-sm cursor-pointer">
                <input type="checkbox" className="mt-1" checked={selectedIds.has(c.reviewItemId)} onChange={() => onToggle(c.reviewItemId)} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    {c.itemName}
                    {c.classification === "NEW_LINE" && <span className="text-[10px] uppercase text-muted-foreground ml-1.5">new line</span>}
                  </div>
                  {c.changes.map((ch) => (
                    <div key={ch.field} className="text-xs text-muted-foreground">
                      {ch.field}: <span className="line-through">{ch.from}</span> → <span className="text-foreground font-medium">{ch.to}</span>
                    </div>
                  ))}
                  {c.unsupportedChanges.length > 0 && (
                    <div className="mt-1 text-xs text-amber-700">
                      Not applied to BOQ:
                      {c.unsupportedChanges.map((uc) => (
                        <div key={uc.field}>{UNSUPPORTED_FIELD_LABEL[uc.field]}: {uc.from} → {uc.to}</div>
                      ))}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {notApplicable.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-1 text-amber-700">Reviewed changes not applied to BOQ ({notApplicable.length})</h3>
          <div className="divide-y border rounded">
            {notApplicable.map((c) => (
              <div key={c.reviewItemId} className="p-2 text-sm">
                <div className="font-medium">{c.itemName}</div>
                {c.unsupportedChanges.map((uc) => (
                  <div key={uc.field} className="text-xs text-muted-foreground">
                    {UNSUPPORTED_FIELD_LABEL[uc.field]}: <span className="line-through">{uc.from}</span> → <span className="text-foreground font-medium">{uc.to}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {noChange.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">No change ({noChange.length})</summary>
          <ul className="mt-1 space-y-0.5 pl-4 list-disc">
            {noChange.map((c) => <li key={c.reviewItemId}>{c.itemName}</li>)}
          </ul>
        </details>
      )}

      {unresolved.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-1">Not applied ({unresolved.length})</h3>
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {unresolved.map((c) => <li key={c.reviewItemId}>{c.itemName} — {c.reason}</li>)}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t">
        <span className="text-xs text-muted-foreground mr-auto">{selectedCount} selected</span>
        <Button size="sm" disabled={selectedCount === 0 || applying} onClick={onApply}>
          {applying ? "Applying…" : `Apply ${selectedCount} to BOQ`}
        </Button>
      </div>
    </div>
  );
}

// ── Import gate ────────────────────────────────────────────────────────────────
function ImportGate({ boqId, projectId, projectType, boqName, onImported, drawings, onBack }: {
  boqId: string; projectId: string | null; projectType: string | null; boqName?: string;
  onImported: (runId: string, items: StoredReviewItem[]) => void; drawings: StoredDrawing[];
  onBack: () => void;
}) {
  const [mode, setMode] = useState<InputMode>(defaultInputMode());
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingAnalysis, setPendingAnalysis] = useState<AnalysisV1 | null>(null);
  const [documentSelectorState, setDocumentSelectorState] = useState<{ searchedFor: string | null; availableDrawings: { documentId: string; name: string; originalFilename?: string | null }[] } | null>(null);
  const configured = isProviderConfigured();
  const preview = useMemo(() => (text.trim() ? parseAnalysisV1(text) : null), [text]);

  const doImport = async (analysis: AnalysisV1, resolvedDocumentId?: string | null) => {
    setBusy(true);
    try {
      const { runId } = await createAnalysisRun({ boqId, projectId, analysis, source: "json_import", resolvedDocumentId: resolvedDocumentId ?? null });
      const items = await loadReviewItems(runId);
      setPendingAnalysis(null);
      setDocumentSelectorState(null);
      toast.success(`Loaded ${items.length} item${items.length === 1 ? "" : "s"} for review`);
      onImported(runId, items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load analysis");
    } finally { setBusy(false); }
  };

  const handleImportClick = async () => {
    const parsed = parseAnalysisV1(text);
    if (!parsed.ok || !parsed.analysis) return toast.error(parsed.error ?? "Invalid analysis JSON");

    // Check if any analysis item has a source document reference
    const needsDocResolution = parsed.analysis.items.some((it) => it.source?.document);
    if (!needsDocResolution || drawings.length === 0) {
      // No document references in analysis or no drawings → import directly
      parsed.warnings.slice(0, 3).forEach((w) => toast.warning(w));
      await doImport(parsed.analysis);
      return;
    }

    // Check if all items can be resolved
    const { resolveDrawingWithDiagnostics } = await import("@/lib/review/documentResolve");
    const allItems = parsed.analysis.items;
    const unresolvedItems = allItems.filter((it) => {
      const result = resolveDrawingWithDiagnostics(it.source, drawings);
      return result.resolved === null;
    });

    if (unresolvedItems.length === 0) {
      // All items resolved → proceed
      parsed.warnings.slice(0, 3).forEach((w) => toast.warning(w));
      await doImport(parsed.analysis);
      return;
    }

    // At least one item unresolved → show selector
    const firstUnresolved = unresolvedItems[0];
    const diagnostics = resolveDrawingWithDiagnostics(firstUnresolved.source, drawings).diagnostics!;
    parsed.warnings.slice(0, 3).forEach((w) => toast.warning(w));
    setPendingAnalysis(parsed.analysis);
    setDocumentSelectorState(diagnostics);
  };

  return (
    <div className="p-4 max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" /> BOQ</Button>
        <h2 className="font-semibold">BOQ Review — load analysis</h2>
        <span className="text-sm text-muted-foreground">{boqName}</span>
      </div>

      {/* Input mode selector */}
      <Card><CardContent className="p-4 space-y-3">
        <div className="text-sm font-medium">Analysis source</div>
        <div className="flex gap-2">
          <ModeBtn active={mode === "JSON_IMPORT"} onClick={() => setMode("JSON_IMPORT")} icon={Upload} label="Import JSON" />
          <ModeBtn active={mode === "AI_API"} onClick={() => setMode("AI_API")} icon={Cpu} label="Use AI API" />
        </div>

        {mode === "AI_API" ? (
          <div className="text-sm text-muted-foreground space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span>Provider</span>
              <Select disabled>
                <SelectTrigger className="h-8 w-40"><SelectValue placeholder="OpenAI" /></SelectTrigger>
                <SelectContent>{PROVIDERS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
              <span className={`text-xs px-2 py-0.5 rounded ${configured ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                {configured ? "configured" : "not configured"}
              </span>
            </div>
            <p className="text-xs">
              No AI provider is wired yet. The analysis call runs server-side (API keys never reach the browser).
              Until a provider is configured, use <b>Import JSON</b> — the workstation is fully functional without AI.
            </p>
          </div>
        ) : (
          <>
            <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)}
              placeholder='Paste Cunstruct analysis JSON — { "schema_version": "cunstruct.analysis.v1", "items": [ … ] }' />
            {preview && (
              <div className={`text-xs ${preview.ok ? "text-green-700" : "text-red-600"}`}>
                {preview.ok ? `✓ ${preview.analysis!.items.length} valid items${preview.warnings.length ? ` · ${preview.warnings.length} warning(s)` : ""}` : preview.error}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={!preview?.ok || busy} onClick={handleImportClick}>{busy ? "Loading…" : "Validate & load for review"}</Button>
              <span className="text-xs text-muted-foreground">Loading an analysis never changes the BOQ.</span>
            </div>
          </>
        )}
      </CardContent></Card>

      {documentSelectorState && (
        <div className="space-y-3">
          <div className="text-sm font-medium">Select a drawing for this analysis</div>
          <DocumentSelector
            searchedFor={documentSelectorState.searchedFor}
            availableDrawings={documentSelectorState.availableDrawings}
            onSelect={(docId) => {
              if (pendingAnalysis) {
                doImport(pendingAnalysis, docId);
              }
            }}
            onCancel={() => {
              setPendingAnalysis(null);
              setDocumentSelectorState(null);
            }}
          />
        </div>
      )}

      {projectType && <p className="text-xs text-muted-foreground">Project type: {projectType}</p>}
    </div>
  );
}

// ── Left item panel ────────────────────────────────────────────────────────────
export function ItemPanel({ item, index, count, onVerify, onEdit, onFlag, onPending, onPrev, onNext, keyboardEnabled, onSelectClaim, drawings, resolvedDocumentId }: {
  item: StoredReviewItem; index: number; count: number;
  onVerify: () => void; onEdit: (r: ReviewerValues) => void; onFlag: (r: FlagReason, note: string) => void; onPending: () => void;
  onPrev: () => void; onNext: () => void; keyboardEnabled?: boolean; onSelectClaim: (claim: ClaimType) => void;
  drawings: StoredDrawing[]; resolvedDocumentId?: string | null;
}) {
  const ai = item.ai;
  const [editing, setEditing] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [why, setWhy] = useState(false);
  const [draft, setDraft] = useState<ReviewerValues>({});
  const [flagReason, setFlagReason] = useState<FlagReason>("DRAWING_UNCLEAR");
  const [flagNote, setFlagNote] = useState("");

  useEffect(() => { setEditing(false); setFlagging(false); setWhy(false); setDraft({}); }, [item.id]);

  useEffect(() => {
    if (!keyboardEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "v") onVerify();
      else if (k === "e") setEditing(true);
      else if (k === "f") setFlagging(true);
      else if (k === "p") onPending();
      else if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboardEnabled, onVerify, onPending, onPrev, onNext]);

  const eff = effectiveQuantity(item);
  const diffs = diffItem(item);
  const delta = quantityDelta(item);

  // Resolve the same drawing ResolvedEvidenceViewer will show, so the
  // per-claim evidence line can honestly say when a claim's evidence exists
  // but can't actually be resolved to a drawing (P0-5) instead of looking
  // identical to a working link.
  const resolved = useMemo(
    () => resolveItemDrawing(ai.source, drawings, resolvedDocumentId),
    [ai.source, drawings, resolvedDocumentId],
  );
  const resolvedOk = !!resolved?.filePath;
  const documentName = useMemo(() => {
    const stored = resolved ? drawings.find((d) => d.documentId === resolved.documentId) : undefined;
    return stored?.name || ai.source?.document || null;
  }, [resolved, drawings, ai.source?.document]);

  const claimEvidence = useMemo(() => {
    const evidence = ai.source?.evidence ?? [];
    return {
      quantity: summarizeClaimEvidence(evidence, "quantity", ai.source?.page, documentName, resolvedOk),
      dimension: summarizeClaimEvidence(evidence, "dimension", ai.source?.page, documentName, resolvedOk),
      specification: summarizeClaimEvidence(evidence, "specification", ai.source?.page, documentName, resolvedOk),
      location: summarizeClaimEvidence(evidence, "location", ai.source?.page, documentName, resolvedOk),
    };
  }, [ai.source, documentName, resolvedOk]);

  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Item {index + 1} of {count}</span>
        <StatusBadge status={item.reviewStatus} />
      </div>

      <div>
        <div className="text-lg font-semibold">{ai.key}{ai.key !== ai.item ? ` · ${ai.item}` : ""}</div>
        {ai.description && <div className="text-sm text-muted-foreground">{ai.description}</div>}
        {item.duplicateOf && <div className="text-xs text-rose-700 mt-0.5">Possible duplicate of {item.duplicateOf}</div>}
      </div>

      {/* AI result — what the AI extracted, and why (evidence). Never implies
          the reviewer should accept it without checking. */}
      <div className="rounded border p-2 space-y-2">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">AI result</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <ClaimField claim="quantity" value={formatClaimValue(ai, "quantity")} evidence={claimEvidence.quantity} onSelectClaim={onSelectClaim} />
          <ClaimField claim="dimension" value={formatClaimValue(ai, "dimension")} evidence={claimEvidence.dimension} onSelectClaim={onSelectClaim} />
          <ClaimField claim="specification" value={formatClaimValue(ai, "specification")} evidence={claimEvidence.specification} onSelectClaim={onSelectClaim} />
          <ClaimField claim="location" value={formatClaimValue(ai, "location")} evidence={claimEvidence.location} onSelectClaim={onSelectClaim} />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm pt-1 border-t">
          <Field label="AI status" value={ai.aiStatus} />
          <Field label="Confidence" value={ai.confidence == null ? "—" : `${Math.round(ai.confidence * 100)}%`} />
          <Field label="Source" value={ai.source?.document ? `${ai.source.document}${ai.source.page != null ? ` — Page ${ai.source.page}` : ""}` : "—"} />
        </div>
        <p className="text-[10px] text-muted-foreground">A high AI confidence is not a substitute for checking the evidence — verify before accepting.</p>
      </div>

      {/* Reviewer result — separate from the AI's own (immutable) values above.
          Status badge is already shown in the header above; this section adds
          the reviewer's own value once one exists. */}
      <div className="rounded border p-2 space-y-2">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Reviewer result</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <Field label="Reviewer qty" value={item.reviewer && "quantity" in item.reviewer ? `${eff ?? "—"} ${delta ? `(${delta})` : ""}` : "—"} />
        </div>
      </div>

      {/* Why this quantity? */}
      <div>
        <button className="text-xs font-medium flex items-center gap-1" onClick={() => setWhy((w) => !w)}>
          Why this quantity? {why ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {why && (
          <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
            <div>Source: {ai.source?.document ?? "—"}{ai.source?.page != null ? ` — Page ${ai.source.page}` : ""}</div>
            <div>Evidence: {ai.source?.evidence.length ? `${ai.source.evidence.length} region(s)` : "none supplied"}</div>
            <div>Dimension: {ai.dimension ?? "—"}</div>
            {ai.calculation ? <div>Calculation: {ai.calculation}</div> : <div>Calculation: not supplied by the analysis</div>}
            {ai.notes && <div>Notes: {ai.notes}</div>}
            <div>AI confidence: {ai.confidence == null ? "—" : `${Math.round(ai.confidence * 100)}%`}</div>
          </div>
        )}
      </div>

      {/* AI vs reviewer diff (edited items) */}
      {diffs.length > 0 && (
        <div className="text-xs bg-muted/50 rounded p-2 space-y-0.5">
          {diffs.map((d) => (
            <div key={d.field}>{d.field}: <span className="line-through text-muted-foreground">{d.aiValue || "—"}</span> → <span className="font-medium">{d.reviewerValue || "—"}</span></div>
          ))}
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="border rounded p-3 space-y-2">
          <div className="text-xs font-medium">Edit — AI values shown as placeholders; both are retained</div>
          <div className="grid grid-cols-2 gap-2">
            <LabeledInput label={`Quantity (AI: ${ai.quantity ?? "—"})`} type="number" onChange={(v) => setDraft((d) => ({ ...d, quantity: v === "" ? null : Number(v) }))} />
            <LabeledInput label={`Unit (AI: ${ai.unit ?? "—"})`} onChange={(v) => setDraft((d) => ({ ...d, unit: v }))} />
            <LabeledInput label={`Dimension (AI: ${ai.dimension ?? "—"})`} onChange={(v) => setDraft((d) => ({ ...d, dimension: v }))} />
            <LabeledInput label={`Location (AI: ${ai.location ?? "—"})`} onChange={(v) => setDraft((d) => ({ ...d, location: v }))} />
          </div>
          <LabeledInput label="Notes" onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onEdit(pruneDraft(draft))} disabled={Object.keys(pruneDraft(draft)).length === 0}>Save correction</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Flag form */}
      {flagging && (
        <div className="border rounded p-3 space-y-2">
          <Select value={flagReason} onValueChange={(v) => setFlagReason(v as FlagReason)}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{FLAG_REASONS.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea rows={2} placeholder="Optional note" value={flagNote} onChange={(e) => setFlagNote(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onFlag(flagReason, flagNote)}>Save flag</Button>
            <Button size="sm" variant="ghost" onClick={() => setFlagging(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Actions */}
      {!editing && !flagging && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={onVerify}><Check className="w-4 h-4 mr-1" /> Verify</Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="w-4 h-4 mr-1" /> Edit</Button>
          <Button size="sm" variant="outline" onClick={() => setFlagging(true)}><Flag className="w-4 h-4 mr-1" /> Flag</Button>
          <Button size="sm" variant="outline" onClick={onPending}><Clock className="w-4 h-4 mr-1" /> Mark Pending</Button>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <Button size="sm" variant="ghost" onClick={onPrev}><ChevronLeft className="w-4 h-4 mr-1" /> Previous</Button>
        <Button size="sm" variant="ghost" onClick={onNext}>Next <ChevronRight className="w-4 h-4 ml-1" /></Button>
      </div>
    </CardContent></Card>
  );
}

// ── Right panel: resolve the real drawing, else fall back to the coord plot ────
export function ResolvedEvidenceViewer({ item, drawings, resolvedDocumentId, selectedClaim }: { item: StoredReviewItem; drawings: StoredDrawing[]; resolvedDocumentId?: string | null; selectedClaim?: ClaimType | null }) {
  const resolved = useMemo(
    () => resolveItemDrawing(item.ai.source, drawings, resolvedDocumentId),
    [item.ai.source, drawings, resolvedDocumentId],
  );
  // Prefer the stored drawing's own (human-entered) name over the raw
  // filename when it resolves — real, existing metadata, never a guessed
  // sheet name (P0-2).
  const documentName = useMemo(() => {
    const stored = resolved ? drawings.find((d) => d.documentId === resolved.documentId) : undefined;
    return stored?.name || item.ai.source?.document || "Drawing";
  }, [resolved, drawings, item.ai.source?.document]);
  const selectedClaimValue = selectedClaim ? formatClaimValue(item.ai, selectedClaim) : null;
  const [signed, setSigned] = useState<string | null>(null);
  const [signState, setSignState] = useState<"idle" | "signing" | "unavailable">("idle");

  useEffect(() => {
    let alive = true;
    setSigned(null);
    if (resolved?.filePath) {
      setSignState("signing");
      console.log("[ReviewWorkstation] Signing URL for path:", resolved.filePath);
      signedDrawingUrl(resolved.filePath).then((url) => {
        if (!alive) return;
        console.log("[ReviewWorkstation] Signed URL result:", url ? "success" : "null (access denied or file missing)");
        setSigned(url);
        setSignState(url ? "idle" : "unavailable");
      }).catch((err) => {
        console.error("[ReviewWorkstation] Error signing URL:", err);
        if (alive) setSignState("unavailable");
      });
    } else {
      console.log("[ReviewWorkstation] No file path to sign (document has no uploaded file)");
      setSignState("idle");
    }
    return () => { alive = false; };
  }, [resolved?.filePath]);

  // A real stored file we could sign → render the actual drawing with overlays.
  if (resolved?.filePath) {
    return (
      <Card><CardContent className="p-4">
        <PdfEvidenceViewer
          fileUrl={signed}
          source={item.ai.source}
          documentName={documentName}
          unavailableReason={signState === "unavailable" ? "Source drawing unavailable." : null}
          selectedClaim={selectedClaim}
          selectedClaimValue={selectedClaimValue}
        />
      </CardContent></Card>
    );
  }

  // Matched a document but it has no uploaded file, or nothing matched → keep the
  // existing page-coordinate plot / non-positional fallback (never fabricated).
  return <EvidenceViewer item={item} />;
}

// ── Right evidence viewer (page-coordinate plot fallback) ──────────────────────
function EvidenceViewer({ item }: { item: StoredReviewItem }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState({ width: 0, height: 0 });
  const ai = item.ai;
  const placeable = hasPlaceableEvidence(ai.source);
  const boxes = useMemo(() => ai.source?.evidence ?? [], [ai.source]);

  // Coordinate space: the union of the supplied boxes, padded to include the
  // origin. We PLOT the analysis coordinates truthfully — we do not claim to
  // render the underlying drawing (Cunstruct does not store the drawing file).
  const pageSpace = useMemo(() => {
    const u = unionBox(boxes);
    if (!u) return null;
    return { width: Math.max(u[2] * 1.05, 1), height: Math.max(u[3] * 1.05, 1) };
  }, [boxes]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setRendered({ width: el.clientWidth, height: el.clientWidth * (pageSpace ? pageSpace.height / pageSpace.width : 0.7) });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pageSpace]);

  const rects = pageSpace ? transformBoxes(boxes, pageSpace, rendered) : [];

  return (
    <Card><CardContent className="p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <FileText className="w-4 h-4 text-muted-foreground" />
        <span className="font-medium">{ai.source?.document ?? "No source document"}</span>
        {ai.source?.page != null && <span className="text-muted-foreground">· Page {ai.source.page}</span>}
      </div>

      {placeable && pageSpace ? (
        <>
          <div ref={boxRef} className="relative w-full border rounded bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(0,0,0,0.03)_10px,rgba(0,0,0,0.03)_20px)]"
            style={{ height: rendered.height || 300 }}>
            {rects.map((r, i) => (
              <div key={i} className="absolute border-2 border-amber-500 bg-amber-400/20"
                style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
                title={boxes[i].label ?? `Evidence ${i + 1}`}>
                <span className="absolute -top-4 left-0 text-[10px] text-amber-700">{boxes[i].label ?? `E${i + 1}`}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Showing {boxes.length} evidence region{boxes.length === 1 ? "" : "s"} in page coordinates. The underlying drawing
            image isn’t stored in Cunstruct yet, so this plots where the evidence sits on the page — not the drawing itself.
          </p>
        </>
      ) : (
        <div className="border rounded p-6 text-center text-sm text-muted-foreground">
          {ai.source?.document
            ? <>Source: <b>{ai.source.document}</b>{ai.source.page != null ? ` — Page ${ai.source.page}` : ""}.<br />No evidence coordinates were supplied — precise highlighting is unavailable.</>
            : <>This item has no drawing source in the analysis.</>}
        </div>
      )}
    </CardContent></Card>
  );
}

// ── small presentational helpers ────────────────────────────────────────────────
function Stat({ label, value, cls = "" }: { label: string; value: number; cls?: string }) {
  return <div className="rounded border p-2"><div className={`text-lg font-bold ${cls}`}>{value}</div><div className="text-[11px] text-muted-foreground">{label}</div></div>;
}
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate" title={value}>{value}</div>
    </div>
  );
}
// A claim's AI value plus its evidence state (P0-3/P0-5): clickable when
// evidence exists (navigates the viewer to it), plain muted text otherwise —
// never implying a link that isn't actually backed by evidence data.
function ClaimField({ claim, value, evidence, onSelectClaim }: {
  claim: ClaimType; value: string; evidence: EvidenceSummary; onSelectClaim: (claim: ClaimType) => void;
}) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{claimLabel(claim)}</div>
      <div className="truncate" title={value}>{value}</div>
      {evidence.hasEvidence ? (
        <button onClick={() => onSelectClaim(claim)} className="text-[10px] text-amber-600 hover:text-amber-700 font-medium text-left truncate block max-w-full" title={evidence.text}>
          {evidence.text}
        </button>
      ) : (
        <div className="text-[10px] text-muted-foreground">{evidence.text}</div>
      )}
    </div>
  );
}
function StatusBadge({ status }: { status: ReviewStatus }) {
  const map: Record<ReviewStatus, string> = {
    PENDING_REVIEW: "bg-muted text-muted-foreground", VERIFIED: "bg-green-100 text-green-800",
    EDITED: "bg-blue-100 text-blue-800", FLAGGED: "bg-amber-100 text-amber-800", MARKED_PENDING: "bg-purple-100 text-purple-800",
  };
  return <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${map[status]}`}>{status.replace("_", " ").toLowerCase()}</span>;
}
function ModeBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return <button onClick={onClick} className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded border ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}><Icon className="w-4 h-4" />{label}</button>;
}
function LabeledInput({ label, type = "text", onChange }: { label: string; type?: string; onChange: (v: string) => void }) {
  return <label className="text-xs block"><span className="text-muted-foreground">{label}</span><Input className="h-8 mt-0.5" type={type} onChange={(e) => onChange(e.target.value)} /></label>;
}
function pruneDraft(d: ReviewerValues): ReviewerValues {
  const out: ReviewerValues = {};
  (Object.keys(d) as (keyof ReviewerValues)[]).forEach((k) => {
    const v = d[k];
    if (v !== undefined && v !== "") (out as Record<string, unknown>)[k] = v;
  });
  return out;
}
