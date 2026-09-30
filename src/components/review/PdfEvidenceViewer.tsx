// PDF EVIDENCE VIEWER — renders a real drawing page and overlays AI evidence.
//
// Uses pdf.js to render the page to a canvas, then positions the analysis's
// bounding boxes on top using the SHARED coordinate convention in
// evidenceCoords.ts (no duplicate transform logic). Overlays stay aligned across
// zoom / resize because they are recomputed from the same page space each render.
// Graceful states for loading, error, "no file", and "no coordinates" — nothing
// is fabricated.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min?url";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ZoomIn, ZoomOut, Maximize, Crosshair, ChevronLeft, ChevronRight, FileWarning, Loader2 } from "lucide-react";
import { resolvePageSpace, transformBoxes, fitToEvidence, getEvidenceForClaim, detectPageSizeMismatch, type Rect } from "@/lib/review/evidenceCoords";
import { claimLabel, sheetPositionLabel } from "@/lib/review/evidenceDisplay";
import { resolvePageTitle } from "@/lib/review/documentResolve";
import type { AnalysisSource, EvidenceBox, ClaimType } from "@/lib/review/analysisSchemaV1";
import type { DrawingMarker } from "@/lib/review/drawingMarkers";

// Bundle the worker with Vite (kept off the main thread; no CDN dependency).
// The ?url import tells Vite to bundle the worker and return its URL as a string.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface Props {
  fileUrl: string | null;         // short-lived signed URL, or null when no file
  source: AnalysisSource | undefined;
  documentName?: string | null;
  /** Reason to show instead of rendering (e.g. "Source drawing unavailable"). */
  unavailableReason?: string | null;
  /** Filter evidence to show only this claim. Shows all evidence if undefined. */
  selectedClaim?: ClaimType | null;
  /** The AI-supplied display value for `selectedClaim` (e.g. "7 nos"), for the
   *  evidence-context banner. Formatted by the caller, which owns the item's
   *  AI fields — this component only knows about evidence/coordinates. */
  selectedClaimValue?: string | null;
  /** Printed sheet title per page number, from the resolved drawing's
   *  document_revision.page_titles. Optional; a page with no entry falls back
   *  to a bare "Sheet N of M" — never an invented title. */
  pageTitles?: Record<string, string> | null;
  /**
   * The Category/Type/Instance annotation layer (Section 3 of the
   * reference-adoption plan) — ADDITIVE and fully backward compatible: when
   * omitted (undefined), every existing behavior below is unchanged. When
   * present (even as an empty array), this component switches into "marker
   * mode" for this render: the old per-item `source.evidence` overlay and its
   * page/fit logic are suppressed in favor of these real, already-resolved
   * markers (see drawingMarkers.ts — never fabricated) — UNLESS `selectedClaim`
   * is also set, in which case a reviewer clicked a specific claim's evidence
   * link in the inspector and that takes precedence, exactly as before.
   */
  markers?: DrawingMarker[];
  onSelectMarker?: (id: string) => void;
  /** What to show in the top context row while in marker mode, e.g. "Windows
   *  — 2 types" or "W1 — 3 instances". Optional; marker mode shows nothing
   *  in that row rather than inventing a caption when omitted. */
  markerContextLabel?: string | null;
}

type Size = { width: number; height: number };

export default function PdfEvidenceViewer({ fileUrl, source, documentName, unavailableReason, selectedClaim, selectedClaimValue, pageTitles, markers, onSelectMarker, markerContextLabel }: Props) {
  // Marker mode is signaled by PRESENCE of `markers` (even []), not its
  // length — an empty marker set for the current selection (e.g. a category
  // with no real evidence at all) must still suppress the old per-item
  // overlay, not silently fall back to it. A selected claim always wins:
  // the reviewer explicitly asked to inspect one specific claim's evidence.
  const markerModeActive = markers !== undefined && !selectedClaim;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTaskRef = useRef<any>(null);

  const [numPages, setNumPages] = useState(1);
  const [page, setPage] = useState(source?.page ?? 1);
  const [scale, setScale] = useState(1);
  const [pageBase, setPageBase] = useState<Size | null>(null); // page size at scale 1
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // Evidence boxes on the CURRENT page (per-box page overrides the item page).
  // A box with no resolvable page (neither its own `page` nor `source.page`) is
  // excluded here rather than assumed to be on whatever page is showing.
  const boxes: EvidenceBox[] = useMemo(() => {
    if (markerModeActive) return []; // markers own the canvas in this mode
    let filtered = (source?.evidence ?? []).filter((b) => {
      const resolvedPage = b.page ?? source?.page;
      return resolvedPage != null && resolvedPage === page;
    });
    if (selectedClaim) filtered = getEvidenceForClaim(filtered, selectedClaim);
    return filtered;
  }, [source, page, selectedClaim, markerModeActive]);

  // Navigate to the correct page whenever the item OR the selected claim
  // changes — computed from BOTH current values together, in one effect, so
  // page can never go stale. Two separate effects (one keyed on `source`, one
  // on `selectedClaim`) used to miss the case where `source` changes but
  // `selectedClaim`'s value doesn't (e.g. the same claim stays selected across
  // an item switch, whether carried over or reselected before
  // BoqReviewWorkstation's "clear on item change" effect commits): neither
  // effect's dependency changed, so neither fired, and the viewer was left
  // showing the PREVIOUS page while the context banner (computed fresh from
  // both values every render) correctly named the new page — production bug,
  // reproduced by the "source changes, same claim stays selected" test below.
  useEffect(() => {
    if (markerModeActive) return; // the marker-navigation effect below owns paging in this mode
    if (selectedClaim) {
      // Resolved from the FULL evidence array, not the current page's boxes,
      // so this works even when the viewer isn't already on the right page.
      const claimBoxes = getEvidenceForClaim(source?.evidence ?? [], selectedClaim);
      const targetPage = claimBoxes[0]?.page ?? source?.page;
      if (targetPage != null) setPage(targetPage);
      // No resolvable page for this claim — leave the page as it is, same as before.
      return;
    }
    setPage(source?.page ?? 1);
  }, [source, selectedClaim, markerModeActive]);

  // Marker-mode page navigation: jump to wherever the primary (focused)
  // marker lives, else the first marker in the set — so selecting a type or
  // instance actually moves the drawing to it, not just highlights whatever
  // page happens to already be open.
  useEffect(() => {
    if (!markerModeActive) return;
    const primary = markers!.find((m) => m.emphasis === "primary");
    const target = primary ?? markers![0];
    if (target) setPage(target.page);
  }, [markers, markerModeActive]);

  // Load the document when the signed URL changes.
  useEffect(() => {
    if (!fileUrl) { docRef.current = null; setStatus("idle"); setErrorDetail(null); return; }
    let cancelled = false;
    setStatus("loading");
    setErrorDetail(null);
    const task = pdfjsLib.getDocument(fileUrl);
    task.promise.then((doc) => {
      if (cancelled) return;
      docRef.current = doc;
      setNumPages(doc.numPages);
      setPage((p) => Math.min(Math.max(1, p), doc.numPages));
      setStatus("ready");
    }).catch((err) => {
      if (!cancelled) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[PdfEvidenceViewer] Failed to load PDF:", msg);
        setErrorDetail(msg);
        setStatus("error");
      }
    });
    return () => { cancelled = true; try { task.destroy?.(); } catch { /* noop */ } };
  }, [fileUrl]);

  // Render the current page at the current scale.
  const renderPage = useCallback(async () => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    try {
      const pdfPage = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
      const base = pdfPage.getViewport({ scale: 1 });
      setPageBase({ width: base.width, height: base.height });
      const viewport = pdfPage.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        console.error("[PdfEvidenceViewer] Failed to get 2D context from canvas");
        setErrorDetail("Canvas rendering unavailable");
        setStatus("error");
        return;
      }
      renderTaskRef.current?.cancel?.();
      const task = pdfPage.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      renderTaskRef.current = task;
      await task.promise;
      setErrorDetail(null);
    } catch (err) {
      // Only treat as error if not a cancellation (TextLayerMode errors during cancel are expected)
      if (err instanceof Error && err.message?.includes("cancelled")) {
        // Cancelled render is expected, don't treat as error
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[PdfEvidenceViewer] Failed to render page:", msg);
      setErrorDetail(`Render failed: ${msg}`);
      setStatus("error");
    }
  }, [page, scale]);

  useEffect(() => { if (status === "ready") void renderPage(); }, [status, renderPage]);

  // Fit-to-page: scale so the page fills the container width.
  const fitPage = useCallback(() => {
    const c = containerRef.current;
    // Never guess when the container isn't measurable yet (clientWidth 0 —
    // e.g. not yet laid out, or a test environment with no real layout
    // engine) — same defensive rule fitToEvidence already applies via its
    // own viewportWidth check.
    if (!c || !pageBase || !c.clientWidth) return;
    setScale(Math.max(0.1, Math.min(8, (c.clientWidth - 24) / pageBase.width)));
  }, [pageBase]);

  // ROOT CAUSE of the mobile "blank drawing" report: without this, a page is
  // first painted at whatever `scale` already was (default 1 — the PDF's own
  // native point size) the instant it becomes ready, and nothing ever
  // re-fits it unless this item happens to have evidence (see fitEvidence
  // below, which only runs `if boxes.length`). A full architectural sheet at
  // native scale is far wider/taller than any phone viewport, so the visible
  // area shows an empty corner of the page — indistinguishable from "nothing
  // rendered" on a small screen. This gives EVERY page a sane baseline fit
  // the moment it's measurable; fitEvidence (defined next, so it runs after
  // this in the same commit — effects fire in source order) still overrides
  // it with a tighter fit whenever the item actually has evidence.
  useEffect(() => { if (status === "ready" && pageBase) fitPage(); }, [status, pageBase, fitPage]);

  // Fit-to-evidence: delegate the scale calculation to the ONE canonical
  // implementation (evidenceCoords.fitToEvidence), then scroll to centre it.
  // No-ops without boxes.
  const fitEvidence = useCallback(() => {
    const c = containerRef.current;
    const space = resolvePageSpace(source, pageBase);
    if (!c || !space || !pageBase) return;
    // maxScale: 4 (tighter than fitToEvidence's own default of 8) — a second,
    // independent guard against an oversized canvas specifically for the
    // AUTOMATIC fit trigger, in addition to the layout containment fix above.
    // Manual zoom (+/- buttons) is untouched and keeps its own 8x ceiling.
    const fit = fitToEvidence(boxes, space, pageBase, c.clientWidth, { maxScale: 4 });
    if (!fit) return;
    setScale(fit.scale);
    // Centre after the canvas resizes — biased toward the upper-left of the
    // viewport (38%/38% instead of dead-center 50%/50%) rather than
    // geometric center. The inspector floats over the canvas's bottom-right
    // corner on desktop (see BoqReviewWorkstation's workspace layout); a
    // dead-centered box routinely landed half-hidden under it. This is a
    // presentation-layer scroll-position heuristic only — never changes the
    // evidence geometry or the fit scale itself.
    setTimeout(() => {
      const rendered: Size = { width: pageBase.width * fit.scale, height: pageBase.height * fit.scale };
      const rects = transformBoxes(boxes, space, rendered);
      if (!rects.length) return;
      const cx = rects.reduce((m, r) => m + r.left + r.width / 2, 0) / rects.length;
      const cy = rects.reduce((m, r) => m + r.top + r.height / 2, 0) / rects.length;
      c.scrollLeft = cx - c.clientWidth * 0.38;
      c.scrollTop = cy - c.clientHeight * 0.38;
    }, 30);
  }, [source, pageBase, boxes]);

  // Auto re-fit whenever the CURRENT selection's evidence set changes: fit
  // tightly to it when there is any, else fall back to the page-wide
  // baseline fit. Without the `else fitPage()` branch, switching from an
  // item WITH evidence to one WITHOUT (same page, so the first effect above
  // never re-fires — neither `status` nor `pageBase` changed) left the
  // viewer at the PREVIOUS item's zoomed-in crop. Section 14 is explicit
  // that no evidence means "show the drawing normally", not whatever the
  // last item happened to leave the scale at.
  useEffect(() => {
    if (status !== "ready" || markerModeActive) return;
    if (boxes.length) fitEvidence(); else fitPage();
  }, [status, boxes, fitEvidence, fitPage, markerModeActive]);

  // Markers actually on the current page — resolved the same way `boxes`
  // resolves a page above (marker.page was already computed by
  // drawingMarkers.ts using the exact same box.page ?? source.page rule).
  const markersOnPage = useMemo(
    () => (markerModeActive ? (markers ?? []).filter((m) => m.page === page) : []),
    [markers, markerModeActive, page],
  );

  // Fit to the primary (focused) marker when one exists, else to the whole
  // visible marker set for this page, else the page-wide baseline — mirrors
  // fitEvidence's own centering approach but keyed on real marker geometry.
  // Assumes one coordinate space per page (every marker on a page comes from
  // the same document/PDF, so the first marker's declared pageSize — if any —
  // is authoritative for all of them here).
  const fitMarkers = useCallback(() => {
    const c = containerRef.current;
    if (!c || !pageBase) { return; }
    const primary = markersOnPage.find((m) => m.emphasis === "primary");
    const focusSet = primary ? [primary] : markersOnPage;
    if (!focusSet.length) { fitPage(); return; }
    const space = resolvePageSpace({ pageSize: focusSet[0].pageSize }, pageBase);
    if (!space) { fitPage(); return; }
    const fit = fitToEvidence(focusSet.map((m) => m.box), space, pageBase, c.clientWidth, { maxScale: 4 });
    if (!fit) { fitPage(); return; }
    setScale(fit.scale);
    setTimeout(() => {
      const rendered: Size = { width: pageBase.width * fit.scale, height: pageBase.height * fit.scale };
      const rects = transformBoxes(focusSet.map((m) => m.box), space, rendered);
      if (!rects.length) return;
      const cx = rects.reduce((m, r) => m + r.left + r.width / 2, 0) / rects.length;
      const cy = rects.reduce((m, r) => m + r.top + r.height / 2, 0) / rects.length;
      c.scrollLeft = cx - c.clientWidth * 0.38;
      c.scrollTop = cy - c.clientHeight * 0.38;
    }, 30);
  }, [markersOnPage, pageBase, fitPage]);

  useEffect(() => {
    if (status !== "ready" || !markerModeActive) return;
    fitMarkers();
  }, [status, markerModeActive, fitMarkers]);

  // Marker rects for the current page — same transformBoxes math as
  // overlayRects below, just resolved per-marker (a marker can in principle
  // declare its own pageSize, mirroring resolvePageSpace's override rule).
  const markerRects = useMemo(() => {
    if (!markerModeActive || !pageBase) return [];
    const rendered: Size = { width: pageBase.width * scale, height: pageBase.height * scale };
    return markersOnPage.map((m) => {
      const space = resolvePageSpace({ pageSize: m.pageSize }, pageBase);
      if (!space) return null;
      const rect = transformBoxes([m.box], space, rendered)[0];
      return rect ? { marker: m, rect } : null;
    }).filter((x): x is { marker: DrawingMarker; rect: Rect } => x != null);
  }, [markerModeActive, markersOnPage, pageBase, scale]);

  // Overlay rects for the current page.
  const overlayRects = useMemo(() => {
    const space = resolvePageSpace(source, pageBase);
    if (!space || !pageBase || !boxes.length) return [];
    return transformBoxes(boxes, space, { width: pageBase.width * scale, height: pageBase.height * scale });
  }, [source, pageBase, boxes, scale]);

  // Non-blocking heuristic: warn (never auto-correct) when a declared pageSize
  // looks rotated relative to the PDF's own actual rendered page — see the
  // rotation contract in evidenceCoords.ts.
  const pageSizeWarning = useMemo(
    () => detectPageSizeMismatch(source?.pageSize, pageBase),
    [source?.pageSize, pageBase],
  );

  // The selected claim's evidence identity for the context banner below —
  // resolved from the FULL evidence array (not the page-filtered `boxes`) so
  // it's stable regardless of page-navigation timing. Never fabricates a
  // label or page: both are null when the analysis didn't supply them.
  const selectedClaimEvidence = useMemo(() => {
    if (!selectedClaim) return null;
    const regions = getEvidenceForClaim(source?.evidence ?? [], selectedClaim);
    if (!regions.length) return null;
    return {
      label: regions.find((r) => r.label)?.label ?? null,
      page: regions[0].page ?? source?.page ?? null,
    };
  }, [source, selectedClaim]);

  const contextBanner = markerModeActive ? (
    <p className="shrink-0 text-[11px] text-muted-foreground truncate">{markerContextLabel ?? ""}</p>
  ) : (
    <EvidenceContextBanner
      selectedClaim={selectedClaim}
      selectedClaimValue={selectedClaimValue}
      evidence={selectedClaimEvidence}
      documentName={documentName}
    />
  );

  // WHAT/WHERE — the current page's own printed identity, independent of any
  // claim selection. Kept separate from `contextBanner` (WHY), which is about
  // the selected claim's evidence, not the sheet itself. Folded into the SAME
  // compact row as the zoom/page toolbar (Section 1: one small metadata
  // line, not a document-name heading of its own) — the caller's own top bar
  // already names the document, so this only adds the page identity.
  const currentPageTitle = useMemo(() => resolvePageTitle(pageTitles, page), [pageTitles, page]);
  const sheetIdentity = <SheetIdentity title={currentPageTitle} page={page} numPages={numPages} />;

  // ── Non-render states ───────────────────────────────────────────────────────
  if (unavailableReason) {
    return <Shell name={documentName}>{contextBanner}<Fallback icon={FileWarning} text={unavailableReason} /></Shell>;
  }
  if (!fileUrl) {
    return (
      <Shell name={documentName}>
        {contextBanner}
        <Fallback icon={FileWarning} text={
          source?.document
            ? `Source: ${source.document}${source.page != null ? ` — Page ${source.page}` : ""}. No drawing file is stored for this document yet — upload the PDF in Documents to see it here.`
            : "This item has no drawing source in the analysis."
        } />
      </Shell>
    );
  }

  return (
    <Shell
      identity={sheetIdentity}
      toolbar={
        <div className="flex items-center gap-1">
          <IconBtn title="Zoom out" onClick={() => setScale((s) => Math.max(0.1, s - 0.25))}><ZoomOut className="w-4 h-4" /></IconBtn>
          <span className="text-xs tabular-nums w-10 text-center">{Math.round(scale * 100)}%</span>
          <IconBtn title="Zoom in" onClick={() => setScale((s) => Math.min(8, s + 0.25))}><ZoomIn className="w-4 h-4" /></IconBtn>
          <IconBtn title="Fit page" onClick={fitPage}><Maximize className="w-4 h-4" /></IconBtn>
          <IconBtn
            title={markerModeActive ? "Fit to selection" : "Fit to evidence"}
            onClick={markerModeActive ? fitMarkers : fitEvidence}
            disabled={markerModeActive ? !markersOnPage.length : !boxes.length}
          ><Crosshair className="w-4 h-4" /></IconBtn>
          <span className="mx-1 w-px h-5 bg-border" />
          <IconBtn title="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft className="w-4 h-4" /></IconBtn>
          <span className="text-xs tabular-nums">{page} / {numPages}</span>
          <IconBtn title="Next page" onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page >= numPages}><ChevronRight className="w-4 h-4" /></IconBtn>
        </div>
      }
    >
      {contextBanner}
      {/* w-full max-w-full min-w-0: self-constrain to the available width
          regardless of embedding context, so overflow-auto actually scrolls
          an oversized canvas internally instead of the canvas's intrinsic
          size pulling this container (and its ancestors) wider than the
          viewport — see the min-w-0 note on the caller's Card. */}
      {/* No visible border/card framing around the canvas — it's a canvas,
          not a bounded "document preview" box. On desktop this fills
          whatever the flex parent (Shell, h-full) leaves after the compact
          identity/toolbar row above; on mobile it keeps its own viewport-
          relative height since there's no fixed-height ancestor to fill. */}
      <div ref={containerRef} className="relative overflow-auto w-full max-w-full min-w-0 h-[60vh] min-h-[360px] max-h-[72vh] lg:h-auto lg:flex-1 lg:min-h-0 lg:max-h-none">
        {status === "loading" && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="text-center text-sm space-y-1">
              <div className="text-red-600 font-medium">Failed to load the drawing.</div>
              {errorDetail && <div className="text-xs text-red-500">{errorDetail}</div>}
            </div>
          </div>
        )}
        <div className="relative inline-block" data-testid="evidence-overlays">
          <canvas ref={canvasRef} className="block" />
          {/* The first box is the SELECTED element — it must read as an
              object the reviewer picked on the drawing, not one of several
              generic highlight rectangles. A heavier solid border + a
              filled label chip (vs. the thin dashed treatment for any other
              boxes on the same page) is the entire visual difference; no
              geometry is invented — same rects transformBoxes already
              computed from the analysis's real evidence coordinates. */}
          {overlayRects.map((r, i) => {
            const box = boxes[i];
            const claim = box?.claim ?? "general";
            const claimIndicator = selectedClaim ? `${claim.slice(0, 3).toUpperCase()}${i + 1}` : `E${i + 1}`;
            const primary = i === 0;
            return (
              <div key={i}
                className={cn(
                  "absolute pointer-events-none",
                  primary
                    ? "border-[3px] border-amber-500 bg-amber-400/20 shadow-[0_0_0_4px_rgba(245,158,11,0.15)]"
                    : "border-2 border-dashed border-amber-500/70 bg-amber-400/10",
                )}
                style={{ left: r.left, top: r.top, width: r.width, height: r.height }}>
                <span className={cn(
                  "absolute -top-6 left-0 whitespace-nowrap rounded font-semibold",
                  primary ? "text-[11px] px-1.5 py-0.5 bg-amber-500 text-white shadow-sm" : "text-[10px] px-1 py-0.5 bg-white/75 text-amber-700",
                )}>
                  {box?.label ?? claimIndicator}
                </span>
              </div>
            );
          })}
          {/* Detection/instance markers (Section 3 of the reference-adoption
              plan) — a DIFFERENT hue (blue) from evidence (amber) on purpose:
              evidence ("this supports the claim") and a detection/instance
              marking ("this is the physical element") are different concepts
              (Section 11) that happen to share a coordinate system; the color
              makes that distinction visible, not just documented in a
              comment. Clickable (unlike the decorative evidence boxes above)
              so selecting an instance on the CANVAS works too, not only from
              the inspector's list. */}
          {/* Three-tier figure-ground hierarchy (visual acceptance review,
              correction 1/2): detections read as PAINTED ONTO the drawing —
              solid borders and clearly-visible fill at every tier, never a
              faint hairline — with each tier a genuinely distinct treatment,
              not merely a darker shade of the last:
                primary   — the one selected instance. A different HUE
                            (rose, not a darker blue) so it visually pops the
                            way the reference's red selected state does —
                            "selected instance ≠ selected type."
                secondary — every other instance of the selected type, or
                            every type in a selected category: still bold and
                            solid, just clearly one step down from primary.
                muted     — everything else on screen in this selection (the
                            "All categories" baseline, or a category's/type's
                            unfocused siblings): quieter than secondary, but
                            still immediately readable as "detected" at a
                            glance — never the near-invisible hairline this
                            used to be. */}
          {markerRects.map(({ marker, rect }) => (
            <button
              key={marker.id}
              type="button"
              onClick={() => onSelectMarker?.(marker.id)}
              className={cn(
                "absolute text-left border-solid transition-colors",
                marker.emphasis === "primary"
                  ? "border-[3px] border-rose-600 bg-rose-500/35 shadow-[0_0_0_5px_rgba(225,29,72,0.18)] z-10"
                  : marker.emphasis === "secondary"
                    ? "border-2 border-blue-600 bg-blue-500/25 hover:bg-blue-500/35"
                    : "border-[1.5px] border-blue-500/60 bg-blue-400/15 hover:bg-blue-400/25",
              )}
              style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              title={marker.differsFromType ? `${marker.label} — differs from type` : marker.label}
            >
              {marker.emphasis !== "muted" && (
                <span className={cn(
                  "absolute -top-6 left-0 whitespace-nowrap rounded font-semibold pointer-events-none",
                  marker.emphasis === "primary"
                    ? "text-[11px] px-1.5 py-0.5 bg-rose-600 text-white shadow-sm"
                    : "text-[10px] px-1 py-0.5 bg-blue-600 text-white shadow-sm",
                )}>
                  {marker.label}{marker.differsFromType ? " · differs" : ""}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      {/* Marker-mode fallback — honest "nothing here" rather than reusing the
          per-claim evidence copy below, which doesn't apply in this mode. */}
      {markerModeActive && markersOnPage.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          {(markers ?? []).length === 0
            ? "No detection markings or evidence available for this selection."
            : "This selection's markings are on another page — use the page controls."}
        </p>
      )}
      {/* Claim-aware fallback (Section 9): distinguishes "this claim genuinely
          has no evidence anywhere" (a truthful, non-fabricated statement) from
          "it has evidence, just not on the page currently showing" — the
          latter would be misleading if reported the same way once evidence
          can be filtered to a single claim by default. Never invents a page
          or a location either way. */}
      {!markerModeActive && (() => {
        const claimEvidenceAnyPage = selectedClaim ? getEvidenceForClaim(source?.evidence ?? [], selectedClaim) : (source?.evidence ?? []);
        if (claimEvidenceAnyPage.length === 0) {
          return (
            <p className="text-[11px] text-muted-foreground">
              {selectedClaim
                ? `Drawing evidence unavailable for this item's ${claimLabel(selectedClaim).toLowerCase()} — showing the source page only.`
                : "Evidence coordinates unavailable — showing the source page only."}
            </p>
          );
        }
        if (boxes.length === 0) {
          return <p className="text-[11px] text-muted-foreground">Evidence for this item is on another page — use the page controls.</p>;
        }
        return null;
      })()}
      {pageSizeWarning && <p className="text-[11px] text-amber-600">{pageSizeWarning}</p>}
    </Shell>
  );
}

// Sheet identity — WHAT this page is (its own printed title, when known) and
// WHERE it sits in the set. Separate from EvidenceContextBanner (WHY): a page
// has one identity regardless of which claim, if any, is selected. Never
// invents a title — falls back to the bare position when none is known.
function SheetIdentity({ title, page, numPages }: { title: string | null; page: number; numPages: number }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
      {title && <span className="font-medium text-foreground truncate max-w-[12rem]">{title}</span>}
      {title && <span aria-hidden="true">·</span>}
      <span className="shrink-0">{sheetPositionLabel(page, numPages)}</span>
    </div>
  );
}

// Evidence context — always tells the reviewer why they're looking at this
// page: which claim, the AI's value for it, and where the evidence came from.
// Neutral, non-alarming copy when nothing is selected yet; never fabricates a
// source name or page — shows "unavailable" rather than guessing.
function EvidenceContextBanner({ selectedClaim, selectedClaimValue, evidence, documentName }: {
  selectedClaim?: ClaimType | null;
  selectedClaimValue?: string | null;
  evidence: { label: string | null; page: number | null } | null;
  documentName?: string | null;
}) {
  if (!selectedClaim) {
    return (
      <p className="shrink-0 text-[11px] text-muted-foreground">
        Select an Evidence link to inspect the drawing source.
      </p>
    );
  }
  const sourceLabel = evidence?.label ?? documentName ?? null;
  // One quiet inline row, not a bordered/backgrounded box — the highlighted
  // element on the canvas itself and the inspector's own evidence link
  // already carry this information; this is a compact confirmation, not the
  // primary place a reviewer reads it. Each field stays its own element
  // (unchanged) so `getByText("Claim:").parentElement` etc. still resolves.
  return (
    <div className="shrink-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
      <span><span className="font-medium text-foreground">Claim:</span> {claimLabel(selectedClaim)}</span>
      {selectedClaimValue != null && <span><span className="font-medium text-foreground">Value:</span> {selectedClaimValue}</span>}
      <span><span className="font-medium text-foreground">Evidence source:</span> {sourceLabel ?? "unavailable"}</span>
      {evidence?.page != null && <span><span className="font-medium text-foreground">Page:</span> {evidence.page}</span>}
    </div>
  );
}

// h-full + flex-col so the canvas child (given `lg:flex-1 lg:min-h-0`) can
// absorb all height left over after this compact identity/toolbar row — the
// caller's outer workspace container is the one with the real fixed height
// (lg:h-[calc(100vh-172px)]); this just passes it down. `identity` (the
// page's own WHAT/WHERE, folded into this same row per Section 1) takes
// priority over the older plain `name` heading, which fallback states
// (no toolbar, no page loaded yet) still use since they have no page
// identity to show instead.
function Shell({ name, identity, toolbar, children }: { name?: string | null; identity?: React.ReactNode; toolbar?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        {identity ?? <span className="text-xs text-muted-foreground truncate max-w-[16rem]">{name ?? "Drawing"}</span>}
        <div className="ml-auto">{toolbar}</div>
      </div>
      {children}
    </div>
  );
}
function Fallback({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="border rounded p-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-2" style={{ minHeight: 200, justifyContent: "center" }}>
      <Icon className="w-6 h-6 text-muted-foreground/70" />
      <span>{text}</span>
    </div>
  );
}
function IconBtn({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <Button variant="ghost" size="icon" className="h-7 w-7" title={title} onClick={onClick} disabled={disabled}>{children}</Button>;
}
