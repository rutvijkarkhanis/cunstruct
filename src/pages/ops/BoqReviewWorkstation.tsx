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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Check, Pencil, Flag, Clock, ChevronLeft, ChevronRight, Upload, Cpu, FileText, ChevronDown, ChevronUp, AlertTriangle, Link2, MoreHorizontal, Info, X,
} from "lucide-react";
import { parseAnalysisV1, type ClaimType } from "@/lib/review/analysisSchemaV1";
import {
  orderQueue, reviewSummary, isCritical, criticalReasons, effectiveQuantity, diffItem, quantityDelta, LOW_CONFIDENCE,
  type ReviewStatus, type FlagReason, type ReviewerValues, type ReviewSummary,
} from "@/lib/review/reviewQueue";
import { transformBoxes, unionBox, hasPlaceableEvidence } from "@/lib/review/evidenceCoords";
import { claimLabel, formatClaimValue, summarizeClaimEvidence, type EvidenceSummary } from "@/lib/review/evidenceDisplay";
import { defaultInputMode, isProviderConfigured, PROVIDERS, type InputMode } from "@/lib/review/analysisProviders";
import { createAnalysisRun, loadReviewItems, latestRunForBoq, saveReviewDecision, updateResolvedDocument, type StoredReviewItem } from "@/lib/review/reviewStore";
import { buildApplyPlan, applyReviewPlan, type ApplyCandidate, type BoqLineForApply, type UnsupportedChange } from "@/lib/review/applyReview";
import {
  resolveItemDrawing, resolveDrawingWithDiagnostics, needsDocumentResolution, computeDrawingLinkStatus,
  type StoredDrawing, type DrawingLinkStatus,
} from "@/lib/review/documentResolve";
import { signedDrawingUrl, loadProjectDrawings } from "@/lib/review/drawingStorage";
import { groupByCategory, isCountableUnit, type CategoryGroup, type TypeCard, type ElementCategory } from "@/lib/review/typeGrouping";
import { instancesForType, type TypeInstance } from "@/lib/review/typeInstances";
import { latestLocationRunForDocument, loadLocationObservations, type LocationObservation } from "@/lib/review/locationObservations";
import { markersForAll, markersForCategory, markersForType, markersForInstance, type DrawingMarker } from "@/lib/review/drawingMarkers";
import PdfEvidenceViewer from "@/components/review/PdfEvidenceViewer";
import DocumentSelector from "@/components/review/DocumentSelector";
import AiApiPanel from "@/components/review/AiApiPanel";
import AiStateBadge from "@/components/review/AiStateBadge";

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

/**
 * `boqId` is optional and additive — every existing caller renders this as a
 * plain `<Route element>` and relies entirely on `useParams` (`/ops/boq/:id`
 * or `/ops/projects/:id/boqs/:boqId/review`), exactly as before. The prop
 * exists ONLY so ProjectWorkspace (Stage B) can embed this exact, unmodified
 * component for `mode=review` without a matching path segment to read a
 * route param from — it is never the only mechanism, and relative
 * navigation (`navigate("../boqs/${boqId}")`) below is unaffected: the
 * workspace route is a sibling of `boqs/:boqId/review` under the same
 * ProjectLayout, so "up one route level" resolves identically either way.
 */
export default function BoqReviewWorkstation({ boqId: injectedBoqId }: { boqId?: string } = {}) {
  const { id: routeId, boqId: routeBoqId } = useParams<{ id?: string; boqId?: string }>();
  const boqId = injectedBoqId ?? routeBoqId ?? routeId!;
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
    queryFn: (): Promise<StoredDrawing[]> => loadProjectDrawings(boq!.project_id!),
  });

  // The BOQ's current lines, for diffing reviewed values against the CURRENT
  // BOQ (not the original AI value) when building the apply-to-BOQ plan.
  // scope_id is embedded and resolved to its project_scope name here — the
  // ONLY place BoqLineForApply.scope_name comes from — so classifyReviewItem
  // itself stays pure/I-O-free (see applyReview.ts). If the embed fails (a
  // freshly-migrated column not yet in PostgREST's schema cache — the same
  // lag class documented in applyFinding.ts's OPTIONAL_COL_RE fallback), this
  // falls back to the pre-Phase-2 select with scope_name left null, which is
  // exactly today's behavior for the (only) case that matters when it's
  // missing: a single-candidate match is unaffected either way.
  const { data: boqLines = [] } = useQuery({
    queryKey: ["rw-lines", boqId],
    enabled: !!boqId,
    queryFn: async (): Promise<BoqLineForApply[]> => {
      const { data, error } = await supabase.from("boq_line")
        .select("id, external_key, qty, unit, quantity_status, scope_id, project_scope(name)")
        .eq("boq_id", boqId);
      if (!error) {
        return (data ?? []).map((r) => {
          const row = r as unknown as { id: string; external_key: string | null; qty: number; unit: string | null; quantity_status: string | null; project_scope: { name: string } | { name: string }[] | null };
          const scope = Array.isArray(row.project_scope) ? row.project_scope[0] : row.project_scope;
          return {
            id: row.id, external_key: row.external_key, qty: row.qty, unit: row.unit, quantity_status: row.quantity_status,
            scope_name: scope?.name ?? null,
          };
        });
      }
      const { data: fallback } = await supabase.from("boq_line")
        .select("id, external_key, qty, unit, quantity_status").eq("boq_id", boqId);
      return (fallback ?? []).map((r) => ({ ...(r as object), scope_name: null }) as BoqLineForApply);
    },
  });

  const [items, setItems] = useState<StoredReviewItem[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [resolvedDocumentId, setResolvedDocumentId] = useState<string | null>(null);
  const [runCreatedAt, setRunCreatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showRelinkModal, setShowRelinkModal] = useState(false);
  const [relinking, setRelinking] = useState(false);
  const [selectedApplyIds, setSelectedApplyIds] = useState<Set<string>>(new Set());
  const [selectedClaim, setSelectedClaim] = useState<ClaimType | null>(null);
  // Which of the current type's LOCATION instances (if any) the drawing is
  // focused on — mutually exclusive with selectedClaim (selecting one clears
  // the other): the drawing shows either the type's own claim evidence or
  // one specific instance's own real evidence, never a blend of both.
  const [focusedInstanceId, setFocusedInstanceId] = useState<string | null>(null);
  const [showStatsBreakdown, setShowStatsBreakdown] = useState(false);
  // Element/type navigator — an always-visible rail on desktop (the
  // reference's permanent Instance List), a full-screen drill-down overlay
  // on mobile where there's no room for three regions at once. ONE
  // TypeNavigator instance either way (see its own component) — never a
  // duplicated mobile/desktop pair.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [needsReviewOnly, setNeedsReviewOnly] = useState(true);
  // What the drawing's annotation layer is scoped to (Sections 6/7/8 of the
  // reference-adoption plan): "type" (the default — the current item's own
  // instances/evidence), "category" (every type in one category, entered by
  // clicking a category header), or "all" (every real marking in the
  // analysis). A focused instance (focusedInstanceId above) narrows further
  // within whichever of these is active, rather than being a fourth mode.
  const [drawingMode, setDrawingMode] = useState<"type" | "category" | "all">("type");
  const [selectedCategory, setSelectedCategory] = useState<ElementCategory | null>(null);

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

  // The full, unfiltered navigation set — Prev/Next and the type navigator
  // both work over EVERY item, attention-first ordered (orderQueue), never
  // restricted by a display filter. "Needs review only" (below) only ever
  // changes which types are SHOWN in the navigator list, never which ones
  // Prev/Next can reach — a reviewer can always get to any type.
  const ordered = useMemo(() => orderQueue(items), [items]);
  const summary = useMemo(() => reviewSummary(items), [items]);
  const current = ordered[Math.min(cursor, Math.max(0, ordered.length - 1))];

  // Category -> Type grouping (Section B/C of the reference-adoption plan):
  // a pure, derived view over the SAME items — never a second identity.
  // Each TypeCard.reviewItem IS the exact StoredReviewItem Apply/persistence
  // already operates on; grouping never merges two items into one type.
  const categoryGroups = useMemo(() => groupByCategory(ordered), [ordered]);

  // The current item's resolved drawing name — same resolution ResolvedEvidenceViewer
  // uses, surfaced here too for the compact "GROUND FLOOR PLAN" context bar
  // (drawing-intelligence-workstation framing). Real, already-loaded data only;
  // never a guess when nothing resolves.
  const currentDocumentName = useMemo(() => {
    if (!current) return null;
    const resolved = resolveItemDrawing(current.ai.source, drawings, resolvedDocumentId);
    const stored = resolved ? drawings.find((d) => d.documentId === resolved.documentId) : undefined;
    return stored?.name || current.ai.source?.document || null;
  }, [current, drawings, resolvedDocumentId]);

  // Every navigation entry point clears any focused instance itself —
  // deliberately NOT a `useEffect` keyed on `current?.id`, which would also
  // fire (and clobber) the one case that must set a NEW focus in the same
  // interaction: clicking a different type's instance marker directly on the
  // canvas (see onSelectMarker below, which switches type and focuses an
  // instance together).
  const selectType = useCallback((id: string) => {
    const idx = ordered.findIndex((it) => it.id === id);
    if (idx >= 0) setCursor(idx);
    setDrawingMode("type");
    setFocusedInstanceId(null);
    setSelectedClaim(null);
    setMobileNavOpen(false);
  }, [ordered]);

  // Selecting a category (Section 6): the drawing scopes to every type in it
  // (markersForCategory), and the inspector settles on that category's first
  // type so there's always a coherent single "current" item, matching the
  // reference's own behavior of still letting a category selection drill
  // toward a type. Never merges categories or invents a type.
  const selectCategory = useCallback((category: ElementCategory) => {
    setSelectedCategory(category);
    setDrawingMode("category");
    setFocusedInstanceId(null);
    setSelectedClaim(null);
    const first = categoryGroups.find((g) => g.category === category)?.types[0]?.reviewItem.id;
    if (first) {
      const idx = ordered.findIndex((it) => it.id === first);
      if (idx >= 0) setCursor(idx);
    }
  }, [categoryGroups, ordered]);

  const selectAll = useCallback(() => {
    setDrawingMode("all"); setSelectedCategory(null); setFocusedInstanceId(null); setSelectedClaim(null);
  }, []);

  // LOCATION observations — the one place Cunstruct has genuine per-occurrence
  // evidence (see typeInstances.ts). Read-only, admin-produced-but-not-admin-
  // gated-to-read: fetched for every distinct document this run's items
  // resolve against, using the primary document-scoped lookup (model="" —
  // that param only affects the rarer cross-document content-hash fallback,
  // never the direct per-document lookup this relies on). Absent for a
  // document LOCATION extraction was never run for — an honest "instance
  // detail unavailable" state, never worked around.
  //
  // Resolved once per item (not just for `current`) — Category/All marker
  // modes need every type's instances, not only the one currently inspected.
  const docIdByItemId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const it of items) map.set(it.id, resolveItemDrawing(it.ai.source, drawings, resolvedDocumentId)?.documentId ?? null);
    return map;
  }, [items, drawings, resolvedDocumentId]);

  const resolvedDocIds = useMemo(
    () => [...new Set([...docIdByItemId.values()].filter((id): id is string => id != null))].sort(),
    [docIdByItemId],
  );

  const { data: observationsByDoc = {} } = useQuery({
    queryKey: ["rw-location-observations", boq?.project_id, resolvedDocIds],
    enabled: !!boq?.project_id && resolvedDocIds.length > 0,
    queryFn: async (): Promise<Record<string, LocationObservation[]>> => {
      const projectId = boq!.project_id!;
      const entries = await Promise.all(resolvedDocIds.map(async (docId): Promise<[string, LocationObservation[]]> => {
        const run = await latestLocationRunForDocument(projectId, docId, "");
        if (run.status !== "SUCCEEDED" || !run.runId) return [docId, []];
        return [docId, await loadLocationObservations(run.runId)];
      }));
      return Object.fromEntries(entries);
    },
  });

  const instancesByItemId = useMemo(() => {
    const map = new Map<string, TypeInstance[]>();
    for (const it of items) {
      const docId = docIdByItemId.get(it.id);
      const observations = docId ? (observationsByDoc[docId] ?? []) : [];
      map.set(it.id, instancesForType({ key: it.ai.key, dimension: it.ai.dimension, specification: it.ai.specification }, observations));
    }
    return map;
  }, [items, docIdByItemId, observationsByDoc]);

  const currentInstances: TypeInstance[] = useMemo(
    () => (current ? (instancesByItemId.get(current.id) ?? []) : []),
    [current, instancesByItemId],
  );

  const currentCategory = useMemo(
    () => categoryGroups.find((g) => g.types.some((t) => t.reviewItem.id === current?.id))?.category ?? "Other",
    [categoryGroups, current?.id],
  );

  // The drawing's actual annotation layer (Section 3): real markers only —
  // never a fabricated box. A focused instance narrows within the active
  // mode (instance always wins, regardless of type/category/all); otherwise
  // the mode itself decides the scope. Markers are then restricted to items
  // that resolve to the SAME document `current` does — a review session
  // spanning several source drawings must never show one document's
  // markings on another's page.
  const drawingMarkers: DrawingMarker[] = useMemo(() => {
    if (!current) return [];
    const raw = focusedInstanceId
      ? markersForInstance(current, currentCategory, currentInstances, focusedInstanceId)
      : drawingMode === "all"
        ? markersForAll(categoryGroups, instancesByItemId)
        : drawingMode === "category" && selectedCategory
          ? markersForCategory(categoryGroups.find((g) => g.category === selectedCategory)!, instancesByItemId)
          : markersForType(current, currentCategory, currentInstances);
    const currentDocId = docIdByItemId.get(current.id);
    return raw.filter((m) => docIdByItemId.get(m.reviewItemId) === currentDocId);
  }, [current, focusedInstanceId, drawingMode, selectedCategory, categoryGroups, instancesByItemId, currentInstances, currentCategory, docIdByItemId]);

  // "What am I looking at?" (acceptance criteria) — a real, computed label
  // for the canvas's own context row, never a static caption.
  const markerContextLabel = useMemo(() => {
    if (!current) return "";
    if (focusedInstanceId) {
      const idx = currentInstances.findIndex((i) => i.observation.id === focusedInstanceId);
      return idx >= 0 ? `${current.ai.key} — instance ${idx + 1} of ${currentInstances.length}` : current.ai.key;
    }
    if (drawingMode === "all") return `All categories — ${categoryGroups.reduce((n, g) => n + g.types.length, 0)} types`;
    if (drawingMode === "category" && selectedCategory) {
      const group = categoryGroups.find((g) => g.category === selectedCategory);
      return `${selectedCategory} — ${group?.types.length ?? 0} type${group?.types.length === 1 ? "" : "s"}`;
    }
    return isCountableUnit(current.ai.unit) && currentInstances.length
      ? `${current.ai.key} — ${currentInstances.length} instance${currentInstances.length === 1 ? "" : "s"}`
      : current.ai.key;
  }, [current, focusedInstanceId, currentInstances, drawingMode, selectedCategory, categoryGroups]);

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

  // Actual per-item resolution state for this run — never inferred from
  // resolved_document_id alone, since a null override can still mean every
  // item resolves fine on its own (id/filename match against `drawings`).
  const linkStatus: DrawingLinkStatus = useMemo(
    () => computeDrawingLinkStatus(items.map((it) => it.ai.source), drawings, resolvedDocumentId),
    [items, drawings, resolvedDocumentId],
  );

  const handleRelink = useCallback(async (documentId: string) => {
    if (!runId) return;
    setRelinking(true);
    try {
      await updateResolvedDocument(runId, documentId);
      // Updates resolvedDocumentId, which ItemPanel/ResolvedEvidenceViewer
      // already re-resolve against on every render — no extra plumbing needed
      // to show the real PDF/evidence for the current item immediately.
      setResolvedDocumentId(documentId);
      setShowRelinkModal(false);
      toast.success("Drawing re-linked for this analysis — evidence re-resolved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to re-link the drawing");
    } finally {
      setRelinking(false);
    }
  }, [runId]);

  const applyMut = useMutation({
    mutationFn: () => applyReviewPlan({ boqId, candidates: applyPlan, selectedIds: selectedApplyIds }),
    onSuccess: (res) => {
      // Honest, best-effort provenance for the BOQ screen: only existing lines
      // this exact call is known to have modified — matchedLineId comes from
      // the pure classification computed before the call, and any review item
      // this same result reports conflicted is excluded (it was never
      // written). A NEW_LINE's real id is never returned to the client (see
      // applyReview.ts's ApplyResult, untouched here), so a newly-created
      // line is correctly left unmarked rather than guessed at.
      const appliedCandidates = applyPlan.filter((c) =>
        (c.classification === "APPLY" || c.classification === "NEW_LINE")
        && selectedApplyIds.has(c.reviewItemId)
        && !res.conflictedReviewItemIds.includes(c.reviewItemId),
      );
      const justAppliedLineIds = appliedCandidates
        .filter((c) => c.classification === "APPLY" && c.matchedLineId)
        .map((c) => c.matchedLineId!);
      // How many of what was just applied came from an EDITED review item —
      // real, derived from the same items[] this run of the reviewer state
      // machine already has, not a fabricated figure. Carried through
      // navigation state the same way appliedCount/unresolvedCount already are.
      const correctedCount = appliedCandidates.filter((c) =>
        items.find((it) => it.id === c.reviewItemId)?.reviewStatus === "EDITED",
      ).length;
      toast.success(`Applied ${res.appliedCount} to the BOQ` + (res.unresolvedCount ? ` · ${res.unresolvedCount} unresolved` : ""), {
        action: {
          label: "View updated BOQ",
          // appliedCount/unresolvedCount are the exact counts ApplyResult
          // already returns — carried through so the BOQ screen can show a
          // truthful "just applied" banner even when no individual line can
          // be marked (every NEW_LINE candidate; see justAppliedLineIds above).
          onClick: () => navigate(`../boqs/${boqId}`, {
            state: {
              justAppliedLineIds, appliedCount: res.appliedCount, unresolvedCount: res.unresolvedCount, correctedCount,
              // Real, already-computed review-session totals (same `summary`
              // this screen already renders) — carried through so the BOQ
              // payoff screen can show Reviewed/Verified alongside
              // Applied/Corrected without inventing a new figure.
              reviewedCount: summary.total - summary.remaining, verifiedCount: summary.verified,
            },
          }),
        },
      });
      qc.invalidateQueries({ queryKey: ["rw-lines", boqId] });
      qc.invalidateQueries({ queryKey: ["boq-lines", boqId] });
      setShowApplyModal(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to apply to the BOQ"),
  });

  // NOTE on the drawing's default focus: this used to auto-select the
  // quantity claim here (the pre-marker-mode "spatial review entry point").
  // Now that the Category/Type/Instance annotation layer (drawingMarkers.ts)
  // is the drawing's default view for every selection — type, category, or
  // all — that auto-selection would silently steal precedence away from
  // marker mode every time `current` changes (PdfEvidenceViewer gives a
  // selected claim priority over markers, since a reviewer who explicitly
  // clicked an evidence link means it). selectType/go/selectCategory/
  // selectAll each clear `selectedClaim` themselves instead — a claim stays
  // selected ONLY when the reviewer explicitly picked one via an "Evidence ·"
  // link in the inspector, never as a side effect of navigation.

  const go = useCallback((delta: number) => {
    setCursor((c) => Math.max(0, Math.min(ordered.length - 1, c + delta)));
    setFocusedInstanceId(null);
    setDrawingMode("type");
    setSelectedClaim(null);
  }, [ordered.length]);

  const applyDecision = useCallback(async (
    status: ReviewStatus, opts: { reviewer?: ReviewerValues | null; flagReason?: FlagReason | null; note?: string | null } = {},
  ) => {
    if (!current) return;
    // Preserve an already-saved reviewer correction when this transition
    // doesn't supply a new one — only Edit ever passes `reviewer` explicitly.
    // Without this, clicking Verify (or Flag, or Mark Pending) after an Edit
    // would silently wipe the correction back to null.
    const reviewer = "reviewer" in opts ? opts.reviewer ?? null : current.reviewer ?? null;
    try {
      await saveReviewDecision({ itemId: current.id, reviewStatus: status, reviewer, flagReason: opts.flagReason ?? null, reviewNote: opts.note ?? null });
      setItems((prev) => prev.map((it) => it.id === current.id
        ? { ...it, reviewStatus: status, reviewer: reviewer ?? undefined, flagReason: opts.flagReason ?? undefined, reviewNote: opts.note ?? undefined, reviewedAt: new Date().toISOString() }
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

  const reviewedCount = summary.total - summary.remaining;
  const reviewComplete = summary.remaining === 0;

  return (
    <div className="p-2 sm:p-4 space-y-2">
      {/* QUIET top bar — the drawing's own identity + the reviewer's position
          in the element set lead ("Ground Floor Plan · 3 / 12"), not "BOQ
          Review" chrome. Everything else that used to stand permanently in
          this row (filters, the full queue list, the stats breakdown) now
          lives inside the one popover the position text opens — so the row
          itself stays down to: back, position (+ element list), Apply
          (quiet until review is complete), overflow. Single elements
          throughout — only inner text/size responds to the breakpoint. */}
      <div className="flex items-center gap-1 sm:gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate(`../boqs/${boqId}`)} aria-label="Back to BOQ">
          <ArrowLeft className="w-4 h-4" />
        </Button>

        {/* Opens the full-screen Element Types drill-down on mobile (the
            navigator rail has no room there). Harmless on desktop — the
            overlay it would open is itself `lg:hidden`, since the rail is
            already a permanent visible column there (see TypeNavigator
            below): one button, one behavior, never a second copy of this
            text duplicated per breakpoint. */}
        <button type="button" onClick={() => setMobileNavOpen(true)} aria-label="Element types" className="lg:pointer-events-none flex items-baseline gap-1.5 min-w-0 text-left rounded px-1.5 py-1 -mx-1.5 hover:bg-muted/60">
          <span className="font-semibold text-sm sm:text-base leading-tight truncate max-w-[8rem] sm:max-w-[18rem]">
            {currentDocumentName ?? "Review"}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0 inline-flex items-center gap-0.5">
            {current ? ordered.indexOf(current) + 1 : 0} / {summary.total}
            <ChevronDown className="w-3 h-3 opacity-60 lg:hidden" />
          </span>
        </button>

        <div className="ml-auto flex items-center gap-1">
          {/* Apply is the completion action, not a peer of the other controls
              on this bar — quiet text while items remain, a real primary
              button once the review pass is actually done (Section 13). */}
          {reviewComplete && applyableCandidates.length > 0 ? (
            <Button size="sm" onClick={openApplyModal}>
              <span className="sm:hidden">Apply ({applyableCandidates.length})</span>
              <span className="hidden sm:inline">Apply {applyableCandidates.length} to BOQ</span>
            </Button>
          ) : (
            <button onClick={openApplyModal} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1">
              Apply{applyableCandidates.length > 0 ? ` (${applyableCandidates.length})` : ""}
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More options"><MoreHorizontal className="w-4 h-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {runCreatedAt && (
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Run {new Date(runCreatedAt).toLocaleString()}
                </DropdownMenuLabel>
              )}
              {linkStatus !== "linked" && (
                <DropdownMenuItem onClick={() => setShowRelinkModal(true)}>
                  <AlertTriangle className="w-4 h-4 mr-2 text-amber-600" />{linkStatus === "needs_attention" ? "Drawing link needs attention" : "No drawing linked"} · Re-link
                </DropdownMenuItem>
              )}
              {linkStatus === "linked" && (
                <DropdownMenuItem onClick={() => setShowRelinkModal(true)}>
                  <Link2 className="w-4 h-4 mr-2" />Re-link drawing
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setShowImportModal(true)}>
                <Upload className="w-4 h-4 mr-2" />Import New Analysis
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Review-complete banner — the one moment Apply becomes the dominant
          action on screen, replacing the quiet text link above with an
          actual highlighted bar (Section 13). Absent while any item remains
          unreviewed, so it never competes with the workspace below. */}
      {reviewComplete && applyableCandidates.length > 0 && (
        <button onClick={openApplyModal} className="w-full flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-left hover:bg-primary/10">
          <span className="text-sm"><b>Review complete</b> — {applyableCandidates.length} quantity change{applyableCandidates.length === 1 ? "" : "s"} ready for the BOQ</span>
          <span className="text-xs font-medium text-primary shrink-0">Apply to BOQ →</span>
        </button>
      )}

      {/* THREE-PANE WORKSPACE — matches the reference's own composition
          exactly: a permanent navigator rail (left — the reference's file/
          plan tree, translated for Cunstruct into Category/Type, since a
          single-document BOQ review has no multi-sheet project to browse),
          the drawing (center, the dominant region), and a permanent
          instances+details rail (right — the reference's own INSTANCE LIST +
          DETAILS column). Visual verification against the reference frames
          showed the previous floating-card-over-the-drawing inspector still
          read as "a PDF with a panel attached," not the reference's actual
          persistent right column — this is a structural fix, not a
          restyling: same ItemPanel, same props, just given its own column
          instead of an absolutely-positioned overlay. */}
      <div className="lg:flex lg:gap-3 lg:h-[calc(100vh-100px)] lg:min-h-[460px]">
        <TypeNavigator
          groups={categoryGroups}
          currentId={current?.id}
          onSelect={selectType}
          reviewedCount={reviewedCount}
          totalCount={summary.total}
          completionPct={summary.completionPct}
          needsReviewOnly={needsReviewOnly}
          onNeedsReviewOnlyChange={setNeedsReviewOnly}
          showBreakdown={showStatsBreakdown}
          onToggleBreakdown={() => setShowStatsBreakdown((s) => !s)}
          summary={summary}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
          drawingMode={drawingMode}
          selectedCategory={selectedCategory}
          onSelectCategory={selectCategory}
          onSelectAll={selectAll}
        />

        {!current ? (
          <Card className="flex-1"><CardContent className="p-8 text-center text-muted-foreground">Nothing in this filter. Switch to “all”.</CardContent></Card>
        ) : (
          <>
            {/* THE DRAWING IS THE PRODUCT — still the dominant region,
                filling whatever space the two rails either side leave it,
                exactly as the reference's own canvas does between its
                file tree and its Instances column. */}
            <div className="flex-1 min-w-0 mt-2 lg:mt-0 lg:h-full">
              <ResolvedEvidenceViewer
                item={current}
                drawings={drawings}
                resolvedDocumentId={resolvedDocumentId}
                selectedClaim={selectedClaim}
                markers={drawingMarkers}
                markerContextLabel={markerContextLabel}
                onSelectMarker={(id) => {
                  const marker = drawingMarkers.find((m) => m.id === id);
                  if (!marker) return;
                  setSelectedClaim(null);
                  // Clicking a marker for a DIFFERENT type drills the
                  // inspector into it directly from the canvas — the
                  // reference's own "click the object, not just the list
                  // row" interaction. Already-focused-same-instance toggles
                  // off; anything else focuses the clicked instance.
                  const alreadyFocused = marker.reviewItemId === current.id && focusedInstanceId === marker.observationId;
                  if (marker.reviewItemId !== current.id) {
                    const idx = ordered.findIndex((it) => it.id === marker.reviewItemId);
                    if (idx >= 0) setCursor(idx);
                    setDrawingMode("type");
                  }
                  setFocusedInstanceId(marker.observationId ? (alreadyFocused ? null : marker.observationId) : null);
                }}
              />
            </div>
            {/* Instances + Details — the reference's own right column. On
                mobile there's no room for a third region, so it drops below
                the drawing in normal flow instead of becoming a fourth
                stacked card. ONE ItemPanel instance either way (responsive
                classes on its wrapper only) — a duplicated mobile/desktop
                pair would break every exact-name button query in its tests. */}
            <div className="mt-3 lg:mt-0 lg:w-80 lg:shrink-0 lg:h-full lg:overflow-y-auto lg:rounded-lg lg:border lg:bg-card lg:p-3">
              <ItemPanel
                key={current.id}
                item={current}
                index={ordered.indexOf(current)}
                count={ordered.length}
                category={categoryGroups.find((g) => g.types.some((t) => t.reviewItem.id === current.id))?.category ?? "Other"}
                instances={currentInstances}
                focusedInstanceId={focusedInstanceId}
                onFocusInstance={(id) => { setFocusedInstanceId(id); setSelectedClaim(null); }}
                onVerify={() => applyDecision("VERIFIED")}
                onEdit={(reviewer) => applyDecision("EDITED", { reviewer })}
                onFlag={(flagReason, note) => applyDecision("FLAGGED", { flagReason, note })}
                onPending={() => applyDecision("MARKED_PENDING")}
                onPrev={() => go(-1)}
                onNext={() => go(1)}
                keyboardEnabled
                onSelectClaim={(c) => { setSelectedClaim(c); setFocusedInstanceId(null); }}
                drawings={drawings}
                resolvedDocumentId={resolvedDocumentId}
              />
            </div>
          </>
        )}
      </div>

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

      {/* Apply reviewed changes to the BOQ — explicit confirmation, exact diff.
          The checkpoint framing (REVIEW COMPLETE — N/M/K) uses summary and
          applyableCandidates, both already computed above from real review
          state; nothing here is a new number. */}
      <Dialog open={showApplyModal} onOpenChange={setShowApplyModal}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 -mt-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-primary">Review complete</div>
            <p className="text-sm mt-0.5">
              <b>{summary.total - summary.remaining}</b> reviewed · <b>{summary.edited}</b> corrected · <b>{applyableCandidates.length}</b> ready to enter the BOQ
            </p>
          </div>
          <h2 className="font-semibold">Apply reviewed quantities</h2>
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

      {/* Re-link drawing — corrects/sets which stored document this analysis's
          evidence resolves against. Applies to the whole analysis run, not
          just the current item. Never guesses: closing without picking one
          leaves the mapping exactly as it was. */}
      <Dialog open={showRelinkModal} onOpenChange={setShowRelinkModal}>
        <DialogContent className="max-w-lg">
          <h2 className="font-semibold">Re-link drawing</h2>
          <p className="text-xs text-muted-foreground -mt-2">
            Choose the project document this analysis's evidence should resolve against. This applies to every item
            in this analysis, not just the one you're currently reviewing.
          </p>
          <DocumentSelector
            searchedFor={current?.ai.source?.document ?? null}
            availableDrawings={drawings.map((d) => ({ documentId: d.documentId, name: d.name, originalFilename: d.originalFilename }))}
            onSelect={handleRelink}
            onCancel={() => setShowRelinkModal(false)}
          />
          {relinking && <p className="text-xs text-muted-foreground">Linking…</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Element Type Navigator ───────────────────────────────────────────────────────
// The reference's permanent Instance List, one grain up — types, not raw
// instances (see typeGrouping.ts for why that's the honest grain Cunstruct's
// data actually supports). Always visible on desktop; a full-screen
// drill-down overlay on mobile, since there's no room for three regions on a
// phone. ONE instance either way (responsive classes only) — a duplicated
// mobile/desktop pair would break exact-text queries the same way it would
// in ItemPanel.
export function TypeNavigator({
  groups, currentId, onSelect, reviewedCount, totalCount, completionPct,
  needsReviewOnly, onNeedsReviewOnlyChange, showBreakdown, onToggleBreakdown, summary,
  mobileOpen, onMobileClose, drawingMode, selectedCategory, onSelectCategory, onSelectAll,
}: {
  groups: CategoryGroup[];
  currentId?: string;
  onSelect: (id: string) => void;
  reviewedCount: number;
  totalCount: number;
  completionPct: number;
  needsReviewOnly: boolean;
  onNeedsReviewOnlyChange: (v: boolean) => void;
  showBreakdown: boolean;
  onToggleBreakdown: () => void;
  summary: ReviewSummary;
  mobileOpen: boolean;
  onMobileClose: () => void;
  /** Which of the drawing's annotation scopes is active (Section 6/7) — drives
   *  the "All"/category header's selected-state styling. Optional so a caller
   *  that doesn't yet wire category selection (e.g. an older test render)
   *  still gets a working, if unhighlighted, navigator. */
  drawingMode?: "type" | "category" | "all";
  selectedCategory?: ElementCategory | null;
  onSelectCategory?: (category: ElementCategory) => void;
  onSelectAll?: () => void;
}) {
  // Collapsed state per category — nothing starts collapsed, so a category
  // with exceptions is never a click away from where the reviewer lands.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCategory = (cat: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    return next;
  });

  return (
    <div
      className={cn(
        "lg:flex lg:relative lg:z-auto lg:h-full lg:w-64 lg:shrink-0 lg:border lg:rounded-lg lg:bg-card flex-col overflow-y-auto",
        mobileOpen ? "fixed inset-0 z-50 bg-background flex" : "hidden lg:flex",
      )}
    >
      <div className="p-3 border-b space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Element Types</span>
          <button type="button" onClick={onMobileClose} aria-label="Close element types" className="lg:hidden text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{reviewedCount} / {totalCount} reviewed</span>
            <span>{completionPct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${completionPct}%` }} />
          </div>
        </div>
        <div className="flex items-center justify-between text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground">
            <input type="checkbox" checked={needsReviewOnly} onChange={(e) => onNeedsReviewOnlyChange(e.target.checked)} />
            Needs review only
          </label>
          <button onClick={onToggleBreakdown} className="text-primary hover:underline">
            {showBreakdown ? "Hide breakdown" : "Breakdown"}
          </button>
        </div>
        {showBreakdown && (
          <div className="grid grid-cols-3 gap-1.5 text-center pt-1">
            <Stat label="Verified" value={summary.verified} cls="text-green-700" />
            <Stat label="Edited" value={summary.edited} cls="text-blue-700" />
            <Stat label="Flagged" value={summary.flagged} cls="text-amber-700" />
            <Stat label="Pending" value={summary.markedPending} cls="text-purple-700" />
            <Stat label="Remaining" value={summary.remaining} />
            <Stat label="Total" value={summary.total} />
          </div>
        )}
      </div>

      {/* "All" — the drawing's un-scoped state (Section 6): every real
          marking in the analysis, all equally muted. A quiet text row, not a
          category peer, since it isn't one. */}
      {onSelectAll && (
        <button
          type="button"
          onClick={onSelectAll}
          className={cn(
            "shrink-0 text-left px-3 py-2.5 text-sm font-bold border-b border-l-[3px]",
            drawingMode === "all" ? "bg-primary/10 border-l-primary text-foreground" : "border-l-transparent text-muted-foreground hover:bg-muted/50 hover:border-l-muted-foreground/30",
          )}
        >
          All categories
        </button>
      )}

      <div className="flex-1 overflow-y-auto divide-y">
        {groups.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">No element types in this analysis.</p>
        )}
        {groups.map((group) => {
          const shown = needsReviewOnly ? group.types.filter((t) => t.reviewStatus === "PENDING_REVIEW") : group.types;
          if (needsReviewOnly && shown.length === 0) return null;
          const isCollapsed = collapsed.has(group.category);
          const categorySelected = drawingMode === "category" && selectedCategory === group.category;
          return (
            <div key={group.category}>
              <div className={cn(
                "w-full flex items-center gap-1 pr-3 border-l-[3px]",
                categorySelected ? "bg-primary/10 border-l-primary" : "border-l-transparent hover:bg-muted/50",
              )}>
                <button
                  type="button"
                  onClick={() => toggleCategory(group.category)}
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${group.category}`}
                  className="p-2 text-muted-foreground shrink-0"
                >
                  {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {/* Selecting the category NAME (Section 6) — not the chevron,
                    which only expands/collapses the list — scopes the
                    drawing's annotation layer to every type in it. Bold,
                    larger text than a type row — this is the top level of
                    the navigation hierarchy, and must read as one. */}
                <button
                  type="button"
                  onClick={() => onSelectCategory?.(group.category)}
                  className="flex-1 min-w-0 flex items-center justify-between gap-2 py-2.5 text-sm font-bold text-left"
                >
                  <span className="truncate">{group.category} <span className="text-muted-foreground font-normal text-xs">({shown.length})</span></span>
                  {group.needsAttentionCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0">
                      {group.needsAttentionCount} needs review
                    </span>
                  )}
                </button>
              </div>
              {!isCollapsed && shown.map((t) => (
                <TypeRow key={t.reviewItem.id} card={t} current={t.reviewItem.id === currentId} onSelect={onSelect} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// One type's row in the navigator: key/name, dimension+specification when
// known, and its quantity framed honestly — "N instances" only for a
// countable unit (the real, already-extracted count), the measurement
// itself otherwise (typeGrouping.isCountableUnit decides which).
function TypeRow({ card, current, onSelect }: { card: TypeCard; current: boolean; onSelect: (id: string) => void }) {
  const { reviewItem, countable, instanceCount } = card;
  const ai = reviewItem.ai;
  const qtyLabel = countable
    ? `${instanceCount ?? "—"} instance${instanceCount === 1 ? "" : "s"}`
    : `${ai.quantity ?? "—"}${ai.unit ? ` ${ai.unit}` : ""}`;
  const dot = card.needsAttention
    ? "bg-amber-500"
    : reviewItem.reviewStatus === "FLAGGED" ? "bg-amber-600"
    : reviewItem.reviewStatus === "PENDING_REVIEW" ? "bg-muted-foreground/40"
    : "bg-emerald-500";
  return (
    <button
      type="button"
      onClick={() => onSelect(reviewItem.id)}
      className={cn(
        "w-full flex items-start gap-2.5 pl-6 pr-3 py-2.5 text-left text-xs border-l-[3px] transition-colors",
        current ? "bg-primary/10 border-l-primary" : "border-l-transparent hover:bg-muted/50 hover:border-l-muted-foreground/30",
      )}
    >
      <span className={cn("mt-1 h-2 w-2 rounded-full shrink-0", dot)} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", current ? "font-bold text-sm" : "font-semibold text-xs")}>{ai.key}{ai.key !== ai.item ? ` — ${ai.item}` : ""}</span>
        {ai.dimension && <span className="block text-muted-foreground truncate">{ai.dimension}{ai.specification ? ` · ${ai.specification}` : ""}</span>}
        <span className="block text-muted-foreground tabular-nums font-medium">{qtyLabel}</span>
      </span>
    </button>
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
  // AMBIGUOUS reuses this same bucket (with its own `reason` text, same as
  // NOT_ELIGIBLE/CANNOT_APPLY) rather than a new UI section — it must never
  // silently vanish from every bucket, but Phase 2 is a matching-safety fix,
  // not new UI (see Phase 6).
  const unresolved = candidates.filter((c) =>
    c.classification === "NOT_ELIGIBLE" || c.classification === "CANNOT_APPLY" || c.classification === "AMBIGUOUS",
  );
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
export function ImportGate({ boqId, projectId, projectType, boqName, onImported, drawings, onBack }: {
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

    // Any item referencing a document (by id or filename) needs resolution
    // attempted — including when the project has no drawings uploaded yet:
    // that case still surfaces the selector, offering "import unresolved,
    // link later" instead of silently skipping resolution altogether.
    if (!needsDocumentResolution(parsed.analysis.items.map((it) => it.source))) {
      parsed.warnings.slice(0, 3).forEach((w) => toast.warning(w));
      await doImport(parsed.analysis);
      return;
    }

    const unresolvedItems = parsed.analysis.items.filter(
      (it) => resolveDrawingWithDiagnostics(it.source, drawings).resolved === null,
    );

    if (unresolvedItems.length === 0) {
      // All items resolved → proceed
      parsed.warnings.slice(0, 3).forEach((w) => toast.warning(w));
      await doImport(parsed.analysis);
      return;
    }

    // At least one item unresolved → show selector (never silently guessed).
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
          configured && projectId ? (
            <AiApiPanel
              projectId={projectId}
              boqId={boqId}
              onGenerated={async (runId) => {
                const items = await loadReviewItems(runId);
                toast.success(`Generated ${items.length} item${items.length === 1 ? "" : "s"} for review`);
                onImported(runId, items);
              }}
            />
          ) : (
            <div className="text-sm text-muted-foreground space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span>Provider</span>
                <Select disabled>
                  <SelectTrigger className="h-8 w-40"><SelectValue placeholder="OpenAI" /></SelectTrigger>
                  <SelectContent>{PROVIDERS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
                <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">not configured</span>
              </div>
              <p className="text-xs">
                {projectId
                  ? "No AI provider is configured yet. The analysis call runs server-side (API keys never reach the browser). Until a provider is configured, use Import JSON — the workstation is fully functional without AI."
                  : "AI analysis requires this BOQ to belong to a project (drawings are attached at the project level)."}
              </p>
            </div>
          )
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
            onSkip={() => pendingAnalysis && doImport(pendingAnalysis)}
          />
        </div>
      )}

      {projectType && <p className="text-xs text-muted-foreground">Project type: {projectType}</p>}
    </div>
  );
}

// ── Left item panel ────────────────────────────────────────────────────────────
export function ItemPanel({
  item, index, count, category, instances, focusedInstanceId, onFocusInstance,
  onVerify, onEdit, onFlag, onPending, onPrev, onNext, keyboardEnabled, onSelectClaim, drawings, resolvedDocumentId,
}: {
  item: StoredReviewItem; index: number; count: number;
  /** Derived, presentation-only — see typeGrouping.categorize(). */
  category?: string;
  /** Real LOCATION-observation instances for this type, when that extraction
   *  has actually been run for its document — [] otherwise (an honest
   *  "instance detail unavailable" state, never worked around). */
  instances?: TypeInstance[];
  focusedInstanceId?: string | null;
  onFocusInstance?: (id: string | null) => void;
  onVerify: () => void; onEdit: (r: ReviewerValues) => void; onFlag: (r: FlagReason, note: string) => void; onPending: () => void;
  onPrev: () => void; onNext: () => void; keyboardEnabled?: boolean; onSelectClaim: (claim: ClaimType) => void;
  drawings: StoredDrawing[]; resolvedDocumentId?: string | null;
}) {
  const ai = item.ai;
  const [editing, setEditing] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [draft, setDraft] = useState<ReviewerValues>({});
  const [flagReason, setFlagReason] = useState<FlagReason>("DRAWING_UNCLEAR");
  const [flagNote, setFlagNote] = useState("");
  // Whether the reviewer has opened at least one evidence link for THIS item —
  // reset per item, feeds the critical-item verification gate below.
  const [evidenceViewed, setEvidenceViewed] = useState(false);
  // Bumped whenever "Use this value" stages a candidate into the draft, so the
  // (uncontrolled) quantity input remounts and picks up the new defaultValue —
  // it never remounts on ordinary typing.
  const [candidateNonce, setCandidateNonce] = useState(0);
  // Dimension/specification/location are collapsed by default — criticalReasons()
  // never names one of these three as the reason an item needs review, so there is
  // no case where forcing one open-by-default is currently warranted; an actual
  // reviewer edit to one of them still surfaces immediately via the AI-vs-reviewer
  // diff box below, without needing this section open.
  const [moreDetails, setMoreDetails] = useState(false);

  useEffect(() => { setEditing(false); setFlagging(false); setDraft({}); setEvidenceViewed(false); setMoreDetails(false); }, [item.id]);

  // Stages a candidate's value into the draft and opens the Edit form — never
  // saves anything itself. The reviewer still must click Save correction (and
  // separately Verify) for it to take effect; this only pre-fills the field.
  const stageCandidateValue = (value: number) => {
    setEditing(true);
    setDraft((d) => ({ ...d, quantity: value }));
    setCandidateNonce((n) => n + 1);
  };

  // Resolve the same drawing ResolvedEvidenceViewer will show. Computed here
  // (not just further below with the display-only claimEvidence/documentName
  // values) because the verification gate needs it too: evidence that exists
  // but doesn't resolve to an actual drawing is not "usable" evidence, and
  // must be treated as its own risk — reusing resolveItemDrawing/resolvedOk,
  // the existing resolution signal, rather than inventing a parallel one.
  const resolved = useMemo(
    () => resolveItemDrawing(ai.source, drawings, resolvedDocumentId),
    [ai.source, drawings, resolvedDocumentId],
  );
  const resolvedOk = !!resolved?.filePath;

  // A PENDING/quantity-less item has nothing to verify. Evidence that exists
  // but can't be resolved to a drawing is never usable, so it blocks Verify
  // outright — clicking a broken link doesn't make the evidence real, so
  // (unlike the resolvable case below) there is no "mark it viewed" unlock
  // here; it clears only once the drawing itself actually resolves. A
  // critical item with resolvable evidence the reviewer hasn't looked at yet
  // shouldn't be one-click-verifiable either — unless it has no evidence to
  // look at in the first place, which is already its own critical reason and
  // must not become a dead end.
  // A reviewer-supplied quantity resolves a PENDING/quantity-less AI value —
  // without this, an item that started PENDING could never be verified again,
  // even after the reviewer explicitly supplied a real number via Edit.
  const hasReviewerQuantity = item.reviewer != null && "quantity" in item.reviewer && item.reviewer.quantity != null;
  const pendingNoQuantity = !hasReviewerQuantity && (ai.aiStatus === "PENDING" || ai.quantity == null);
  const hasEvidence = (ai.source?.evidence.length ?? 0) > 0;
  const evidenceUnresolvable = hasEvidence && !resolvedOk;
  const needsEvidenceCheck = isCritical(item) && hasEvidence && resolvedOk && !evidenceViewed;
  const verifyDisabled = pendingNoQuantity || evidenceUnresolvable || needsEvidenceCheck;
  const verifyDisabledReason = pendingNoQuantity
    ? "No quantity to verify — Edit to supply one, or Mark Pending."
    : evidenceUnresolvable
      ? "Evidence exists but its source drawing isn't available — link the drawing before verifying."
      : needsEvidenceCheck
        ? "Check the evidence before verifying a critical item."
        : undefined;

  useEffect(() => {
    if (!keyboardEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape must close an open form even while focus is inside its inputs.
      if (e.key === "Escape" && (editing || flagging)) {
        setEditing(false);
        setFlagging(false);
        return;
      }
      // Never let a shortcut fire while a form is open — a focused Save/Cancel
      // button (not an INPUT/TEXTAREA) would otherwise still trigger one.
      if (editing || flagging) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "v") { if (!verifyDisabled) onVerify(); }
      else if (k === "e") setEditing(true);
      else if (k === "f") setFlagging(true);
      else if (k === "p") onPending();
      else if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboardEnabled, editing, flagging, verifyDisabled, onVerify, onPending, onPrev, onNext]);

  const eff = effectiveQuantity(item);
  const diffs = diffItem(item);
  const delta = quantityDelta(item);
  // "Evidence unavailable" is layered on top of criticalReasons() here, at the
  // UI layer where drawing-resolution state actually lives, rather than
  // inside reviewQueue.ts's pure, drawings-agnostic criticalReasons() — the
  // resolution signal itself is still exactly resolveItemDrawing/resolvedOk,
  // nothing new invented. criticalReasons() only ever says "No evidence" when
  // the item has none at all, so the two reasons never overlap.
  const reasons = evidenceUnresolvable ? [...criticalReasons(item), "Evidence unavailable"] : criticalReasons(item);

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

  // Opening any claim's evidence counts as "checked" for THIS item, whichever
  // claim it was — the gate is about looking at the drawing, not one field.
  const handleSelectClaim = (claim: ClaimType) => {
    setEvidenceViewed(true);
    onSelectClaim(claim);
  };

  // Effective current value per editable field — reviewer override if
  // present, else the AI value — so the Edit form pre-fills with what's
  // actually true today instead of forcing a full retype.
  const reviewer = item.reviewer;
  const effUnit = reviewer && "unit" in reviewer ? reviewer.unit : ai.unit;
  const effDimension = reviewer && "dimension" in reviewer ? reviewer.dimension : ai.dimension;
  const effSpecification = reviewer && "specification" in reviewer ? reviewer.specification : ai.specification;
  const effLocation = reviewer && "location" in reviewer ? reviewer.location : ai.location;

  return (
    <div className="space-y-2.5">
      {/* The selected element's identity — a small eyebrow, not a form-row
          label or a row of provenance badges: the reviewer is already inside
          the Review workflow and knows this is the AI's proposed measurement
          (Section 7) — AiStateBadge/StatusBadge/AI status/Confidence/Source
          moved into Details below, alongside dimension/specification/
          location, matching the reference's own compact identity line above
          its dense DETAILS column. */}
      <div>
        {category && <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{category}</div>}
        <div className="text-sm font-semibold truncate">
          {ai.key}{ai.key !== ai.item ? ` · ${ai.item}` : ""}
        </div>
        {ai.description && <div className="text-xs text-muted-foreground mt-0.5">{ai.description}</div>}
        {item.duplicateOf && <div className="text-xs text-rose-700 mt-0.5">Possible duplicate of {item.duplicateOf}</div>}
      </div>

      {/* Status/confidence — ALWAYS visible, never behind a "Details" click.
          Visual-acceptance follow-up: the reference never hides its Detection
          Confidence behind a disclosure, and confidence/risk is one of the
          handful of things this panel exists to answer — burying it was a
          real information-architecture gap, not a styling one. Only
          Source/Dimension/Specification/Location (lower-priority, rarely the
          reason an item needs attention) stay inside "Details" below. */}
      <div className="flex items-center gap-1.5 flex-wrap pb-2 border-b">
        <AiStateBadge state="ai" />
        <StatusBadge status={item.reviewStatus} />
        {ai.confidence != null && (
          <span className={cn(
            "text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide",
            ai.confidence <= LOW_CONFIDENCE ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800",
          )}>
            {Math.round(ai.confidence * 100)}% confidence
          </span>
        )}
      </div>

      {/* Review-required indicator — a quiet colored line, not a bordered/
          backgrounded banner box, but still the one piece of risk signal
          that stays in the primary flow (it's decision-relevant, not
          decorative metadata, and gates Verify below). */}
      {reasons.length > 0 && (
        <div className="flex items-start gap-1.5 text-xs text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span><span className="font-medium">Review required</span> — {reasons.join(" · ")}</span>
        </div>
      )}

      {/* Quantity — the one value a reviewer is actually here to decide on,
          but rendered as a compact property row (like every other claim),
          not an oversized hero number: visual verification against the
          reference showed a giant number here was exactly the old
          item-review card's dominant visual model the reviewer explicitly
          asked to move away from. Its evidence link is how "does this look
          right?" actually gets checked. */}
      <div className="rounded border bg-muted/30 p-2">
        <ClaimField claim="quantity" value={formatClaimValue(ai, "quantity")} evidence={claimEvidence.quantity} onSelectClaim={handleSelectClaim} />
      </div>

      {/* Type -> Instances (Section B/C/D of the reference-adoption plan).
          Real per-occurrence evidence, only ever shown when LOCATION
          extraction has actually produced it for this drawing — never a
          fabricated placement. Selecting a row focuses the drawing's
          annotation layer on THAT instance via drawingMarkers.ts, giving it
          the "primary" marker treatment while its siblings stay visible but
          subordinate (see markersForInstance in the parent). */}
      {isCountableUnit(ai.unit) && instances && instances.length > 0 && (
        <div className="space-y-1.5 border-t pt-2">
          <div className="text-xs font-semibold uppercase tracking-wide">{instances.length} instance{instances.length === 1 ? "" : "s"} located on the drawing</div>
          <div className="rounded border divide-y max-h-36 overflow-y-auto">
            {instances.map((inst, i) => {
              const focused = focusedInstanceId === inst.observation.id;
              return (
                <button
                  key={inst.observation.id}
                  type="button"
                  onClick={() => onFocusInstance?.(focused ? null : inst.observation.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs border-l-[3px]",
                    focused ? "bg-rose-50 border-l-rose-600" : "hover:bg-muted/50 border-l-transparent",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", inst.differsFromType ? "bg-amber-500" : "bg-blue-500")} aria-hidden="true" />
                  <span className="truncate flex-1 font-medium">
                    Instance {i + 1}{inst.observation.scopeHint ? ` · ${inst.observation.scopeHint}` : ""}
                    {inst.differsFromType && <span className="text-amber-700"> · differs from type</span>}
                  </span>
                  <span className="text-muted-foreground shrink-0">p.{inst.observation.evidence.page ?? "—"}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {isCountableUnit(ai.unit) && (!instances || instances.length === 0) && (
        <p className="text-[11px] text-muted-foreground">Instance detail unavailable — LOCATION extraction hasn't been run for this drawing yet.</p>
      )}

      {ai.candidates && ai.candidates.length > 1 && (
        <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
          <div className="flex items-center gap-1.5 font-medium text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Conflicting sources — {ai.candidates.length} candidate values found
          </div>
          {ai.candidates.map((c, i) => (
            <div key={i} className="flex items-center justify-between gap-2 pl-5">
              <span className="font-medium">{c.value}{c.unit ? ` ${c.unit}` : ""}</span>
              <span className="text-muted-foreground text-right flex-1 truncate">
                {c.basis}
                {c.source?.document ? ` — ${c.source.document}${c.source.page != null ? ` p.${c.source.page}` : ""}` : ""}
              </span>
              <button
                type="button"
                onClick={() => stageCandidateValue(c.value)}
                className="text-[10px] text-amber-700 hover:text-amber-900 underline shrink-0"
              >
                Use this value
              </button>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground pl-5">No value has been chosen — pick one via Edit before verifying.</p>
        </div>
      )}

      <div>
        <button type="button" className="text-xs font-medium flex items-center gap-1 text-muted-foreground" onClick={() => setMoreDetails((m) => !m)}>
          Details {moreDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {moreDetails && (
          <div className="mt-1.5 space-y-2">
            {/* AI status/Confidence badges already surfaced above, always
                visible — these exact-value rows (not duplicated there) are
                the precise numbers behind them, plus Source. */}
            <div className="flex flex-wrap items-start gap-x-5 gap-y-1.5 text-xs">
              <Field label="AI status" value={ai.aiStatus} tone={ai.aiStatus === "PENDING" ? "danger" : ai.aiStatus === "INFERRED" ? "warning" : undefined} />
              <Field
                label="Confidence"
                value={ai.confidence == null ? "—" : `${Math.round(ai.confidence * 100)}%`}
                tone={ai.confidence != null && ai.confidence <= LOW_CONFIDENCE ? "danger" : undefined}
                hint="A high AI confidence is not a substitute for checking the evidence — verify before accepting."
              />
              <Field label="Source" value={ai.source?.document ? `${ai.source.document}${ai.source.page != null ? ` — Page ${ai.source.page}` : ""}` : "—"} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <ClaimField claim="dimension" value={formatClaimValue(ai, "dimension")} evidence={claimEvidence.dimension} onSelectClaim={handleSelectClaim} />
              <ClaimField claim="specification" value={formatClaimValue(ai, "specification")} evidence={claimEvidence.specification} onSelectClaim={handleSelectClaim} />
              <ClaimField claim="location" value={formatClaimValue(ai, "location")} evidence={claimEvidence.location} onSelectClaim={handleSelectClaim} />
            </div>
            {/* Reasoning — the reference's own "why this result?" text, folded
                into this single DETAILS column rather than a second,
                redundant disclosure the reference doesn't have. Only shown
                when the analysis actually supplied it. */}
            {(ai.calculation || ai.notes) && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                {ai.calculation && <div>Calculation: {ai.calculation}</div>}
                {ai.notes && <div>Notes: {ai.notes}</div>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Your review — only once a reviewer value actually exists; an empty
          box before any correction is noise, not information. Deliberately
          plain (no AI badge) so the AI-extracted vs. human-reviewed contrast
          in the two boxes' treatment IS the hierarchy signal. */}
      {item.reviewer && "quantity" in item.reviewer && (
        <div className="rounded border border-blue-500/30 p-2 space-y-2">
          <div className="flex items-center gap-2">
            <AiStateBadge state="human" />
            <div className="text-[10px] font-semibold text-foreground uppercase tracking-wide">Your review</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Field label="Your quantity" value={`${eff ?? "—"} ${delta ? `(${delta})` : ""}`} />
          </div>
        </div>
      )}

      {/* AI vs reviewer diff (edited items) */}
      {diffs.length > 0 && (
        <div className="text-xs bg-muted/50 rounded p-2 space-y-0.5">
          {diffs.map((d) => (
            <div key={d.field}>{d.field}: <span className="line-through text-muted-foreground">{d.aiValue || "—"}</span> → <span className="font-medium">{d.reviewerValue || "—"}</span></div>
          ))}
        </div>
      )}

      {/* Edit form. The Save/Cancel row is a SIBLING of the bordered field
          box (both direct children of CardContent), not nested inside it —
          `position: sticky` only has room to operate within its own
          immediate parent's box, and that box needs to span the full height
          the reviewer scrolls through, not just the small form it sits in. */}
      {editing && (
        <>
          <div className="border rounded p-3 space-y-2">
            <div className="text-xs font-medium">Edit — AI values shown as placeholders; both are retained</div>
            <div className="grid grid-cols-2 gap-2">
              <LabeledInput key={candidateNonce} label={`Quantity (AI: ${ai.quantity ?? "—"})`} type="number" defaultValue={draft.quantity ?? eff ?? ""} onChange={(v) => setDraft((d) => ({ ...d, quantity: v === "" ? null : Number(v) }))} />
              <LabeledInput label={`Unit (AI: ${ai.unit ?? "—"})`} defaultValue={effUnit ?? ""} onChange={(v) => setDraft((d) => ({ ...d, unit: v }))} />
              <LabeledInput label={`Dimension (AI: ${ai.dimension ?? "—"})`} defaultValue={effDimension ?? ""} onChange={(v) => setDraft((d) => ({ ...d, dimension: v }))} />
              <LabeledInput label={`Specification (AI: ${ai.specification ?? "—"})`} defaultValue={effSpecification ?? ""} onChange={(v) => setDraft((d) => ({ ...d, specification: v }))} />
              <LabeledInput label={`Location (AI: ${ai.location ?? "—"})`} defaultValue={effLocation ?? ""} onChange={(v) => setDraft((d) => ({ ...d, location: v }))} />
            </div>
            <LabeledInput label="Notes" defaultValue={reviewer?.notes ?? ""} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />
          </div>
          <div className="sticky bottom-0 bg-background border-t pt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => onEdit(pruneDraft(draft))} disabled={Object.keys(pruneDraft(draft)).length === 0}>Save correction</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <p className="w-full text-xs text-muted-foreground">Saved corrections are applied to the BOQ when you click Apply to BOQ.</p>
          </div>
        </>
      )}

      {/* Flag form — same sibling structure, same reason. */}
      {flagging && (
        <>
          <div className="border rounded p-3 space-y-2">
            <Select value={flagReason} onValueChange={(v) => setFlagReason(v as FlagReason)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{FLAG_REASONS.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
            <Textarea rows={2} placeholder="Optional note" value={flagNote} onChange={(e) => setFlagNote(e.target.value)} />
          </div>
          <div className="sticky bottom-0 bg-background border-t pt-2 flex gap-2">
            <Button size="sm" onClick={() => onFlag(flagReason, flagNote)}>Save flag</Button>
            <Button size="sm" variant="ghost" onClick={() => setFlagging(false)}>Cancel</Button>
          </div>
        </>
      )}

      {/* Actions — Verify/Edit as the primary pair (accept vs. correct),
          Flag/Mark Pending as a smaller secondary row underneath (exception
          paths, not equal-weight peers of Verify) — matches the reference's
          own Accept/Reject pair at the foot of its DETAILS column, not a
          captioned decision prompt above them. */}
      {!editing && !flagging && (
        // Verify's nearest `div` ancestor must itself carry `sticky`/
        // `bottom-0` (an existing test checks exactly that) — so Flag/Mark
        // Pending sit in a separate, non-sticky sibling below rather than
        // nested a div deeper inside this one.
        <div className="sticky bottom-0 bg-background border-t pt-2 grid grid-cols-2 gap-2">
          <Button onClick={onVerify} disabled={verifyDisabled} title={verifyDisabledReason}><Check className="w-4 h-4 mr-1" /> Verify</Button>
          <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="w-4 h-4 mr-1" /> Edit</Button>
        </div>
      )}
      {!editing && !flagging && (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setFlagging(true)}><Flag className="w-3.5 h-3.5 mr-1" /> Flag</Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={onPending}><Clock className="w-3.5 h-3.5 mr-1" /> Mark Pending</Button>
        </div>
      )}

      {/* Next is the one obvious continuation action; Previous stays
          reachable as a small icon-only affordance beside it rather than
          competing for primary attention — one composition on every
          breakpoint, not a separate desktop Prev/Next pair. */}
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onPrev} aria-label="Previous type"><ChevronLeft className="w-4 h-4" /></Button>
        <Button onClick={onNext} className="flex-1">Next type <ChevronRight className="w-4 h-4 ml-1" /></Button>
      </div>
    </div>
  );
}

// ── Right panel: resolve the real drawing, else fall back to the coord plot ────
export function ResolvedEvidenceViewer({ item, drawings, resolvedDocumentId, selectedClaim, markers, onSelectMarker, markerContextLabel }: {
  item: StoredReviewItem; drawings: StoredDrawing[]; resolvedDocumentId?: string | null; selectedClaim?: ClaimType | null;
  markers?: DrawingMarker[]; onSelectMarker?: (id: string) => void; markerContextLabel?: string | null;
}) {
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
  const pageTitles = useMemo(() => {
    const stored = resolved ? drawings.find((d) => d.documentId === resolved.documentId) : undefined;
    return stored?.pageTitles ?? null;
  }, [resolved, drawings]);
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

  // A real stored file we could sign → render the actual drawing with
  // overlays. No card/border/padding chrome around it — the PDF viewer IS
  // the workspace, not a "document preview" sitting inside an attachment
  // card. min-w-0: without it, this grid item (on the review split view) can
  // be forced wider than its track by the PDF canvas's own intrinsic size —
  // grid/flex items default to min-width:auto (their content's min size), and
  // Tailwind's grid-cols-N utilities only guard against that with an explicit
  // minmax(0, 1fr) track. See PdfEvidenceViewer's containerRef for the other
  // half of this fix.
  if (resolved?.filePath) {
    return (
      <div className="min-w-0 lg:h-full">
        <PdfEvidenceViewer
          fileUrl={signed}
          source={item.ai.source}
          documentName={documentName}
          unavailableReason={signState === "unavailable" ? "Source drawing unavailable." : null}
          selectedClaim={selectedClaim}
          selectedClaimValue={selectedClaimValue}
          pageTitles={pageTitles}
          markers={markers}
          onSelectMarker={onSelectMarker}
          markerContextLabel={markerContextLabel}
        />
      </div>
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

  // Compact, never a giant empty placeholder (Section 14): no real drawing
  // file resolved for this item, so there is genuinely nothing to render as
  // "the drawing" — but the fallback itself stays small and factual (a
  // capped-height plot, or a short sentence) instead of filling the
  // workspace with an empty striped box. The Verify-gate's "Evidence
  // unavailable" reason (in ItemPanel's banner) already carries the
  // decision-relevant signal; this just shows what little we truthfully have.
  return (
    <div className="rounded border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileText className="w-3.5 h-3.5" />
        <span className="font-medium text-foreground">{ai.source?.document ?? "No source document"}</span>
        {ai.source?.page != null && <span>· Page {ai.source.page}</span>}
      </div>

      {placeable && pageSpace ? (
        <>
          <div ref={boxRef} className="relative w-full border rounded bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(0,0,0,0.03)_10px,rgba(0,0,0,0.03)_20px)]"
            style={{ height: Math.min(rendered.height || 240, 320) }}>
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
        <p className="text-xs text-muted-foreground">
          {ai.source?.document
            ? <>Source: <b className="text-foreground">{ai.source.document}</b>{ai.source.page != null ? ` — Page ${ai.source.page}` : ""}. No evidence coordinates were supplied — review this quantity against the drawing directly.</>
            : <>This item has no drawing source in the analysis — review this quantity on its own merits.</>}
        </p>
      )}
    </div>
  );
}

// ── small presentational helpers ────────────────────────────────────────────────
function Stat({ label, value, cls = "" }: { label: string; value: number; cls?: string }) {
  return <div className="rounded border p-2"><div className={`text-lg font-bold ${cls}`}>{value}</div><div className="text-[11px] text-muted-foreground">{label}</div></div>;
}
// `hint`, when given, replaces a permanently-visible caveat sentence with a
// small info affordance (native title — same hover pattern already used for
// `value` below) — the explanation is still one hover away, but it no longer
// stands in the default flow of every single item.
function Field({ label, value, tone, hint }: { label: string; value: string; tone?: "warning" | "danger"; hint?: string }) {
  const toneCls = tone === "danger" ? "text-rose-700 font-medium" : tone === "warning" ? "text-amber-700 font-medium" : "";
  return (
    <div>
      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
        {label}
        {hint && <Info className="w-3 h-3 text-muted-foreground/70 shrink-0" title={hint} />}
      </div>
      <div className={`truncate ${toneCls}`} title={value}>{value}</div>
    </div>
  );
}
// A claim's AI value plus its evidence state (P0-3/P0-5): clickable when
// evidence exists (navigates the viewer to it), plain muted text otherwise —
// never implying a link that isn't actually backed by evidence data. Every
// claim (quantity included) renders as the same compact property row,
// matching the reference's own dense DETAILS column — quantity used to get
// an oversized hero-number treatment nothing else on the panel competed
// with; visual verification against the reference showed that was exactly
// the old item-review card's dominant visual model, so it's gone.
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
function LabeledInput({ label, type = "text", defaultValue, onChange }: { label: string; type?: string; defaultValue?: string | number; onChange: (v: string) => void }) {
  return <label className="text-xs block"><span className="text-muted-foreground">{label}</span><Input className="h-8 mt-0.5" type={type} defaultValue={defaultValue} onChange={(e) => onChange(e.target.value)} /></label>;
}
function pruneDraft(d: ReviewerValues): ReviewerValues {
  const out: ReviewerValues = {};
  (Object.keys(d) as (keyof ReviewerValues)[]).forEach((k) => {
    const v = d[k];
    if (v !== undefined && v !== "") (out as Record<string, unknown>)[k] = v;
  });
  return out;
}
