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
import { ZoomIn, ZoomOut, Maximize, Crosshair, ChevronLeft, ChevronRight, FileWarning, Loader2 } from "lucide-react";
import { resolvePageSpace, transformBoxes, fitToEvidence, getEvidenceForClaim, detectPageSizeMismatch } from "@/lib/review/evidenceCoords";
import { claimLabel } from "@/lib/review/evidenceDisplay";
import type { AnalysisSource, EvidenceBox, ClaimType } from "@/lib/review/analysisSchemaV1";

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
}

type Size = { width: number; height: number };

export default function PdfEvidenceViewer({ fileUrl, source, documentName, unavailableReason, selectedClaim, selectedClaimValue }: Props) {
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
    let filtered = (source?.evidence ?? []).filter((b) => {
      const resolvedPage = b.page ?? source?.page;
      return resolvedPage != null && resolvedPage === page;
    });
    if (selectedClaim) filtered = getEvidenceForClaim(filtered, selectedClaim);
    return filtered;
  }, [source, page, selectedClaim]);

  // When the item changes, jump to its source page.
  useEffect(() => { setPage(source?.page ?? 1); }, [source]);

  // When the selected claim changes, jump to the page its evidence lives on —
  // a claim's evidence can be on a different page than the item's default
  // page. Resolved from the FULL evidence array, not the current page's boxes,
  // so this works even when the viewer isn't already on the right page.
  // Deliberately keyed only on `selectedClaim`, not `source`: BoqReviewWorkstation
  // clears selectedClaim one render after switching items, so keying on `source`
  // too would race that reset and strand the page on the previous item's claim page.
  useEffect(() => {
    if (!selectedClaim) return;
    const claimBoxes = getEvidenceForClaim(source?.evidence ?? [], selectedClaim);
    const targetPage = claimBoxes[0]?.page ?? source?.page;
    if (targetPage != null) setPage(targetPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClaim]);

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
    if (!c || !pageBase) return;
    setScale(Math.max(0.1, Math.min(8, (c.clientWidth - 24) / pageBase.width)));
  }, [pageBase]);

  // Fit-to-evidence: delegate the scale calculation to the ONE canonical
  // implementation (evidenceCoords.fitToEvidence), then scroll to centre it.
  // No-ops without boxes.
  const fitEvidence = useCallback(() => {
    const c = containerRef.current;
    const space = resolvePageSpace(source, pageBase);
    if (!c || !space || !pageBase) return;
    const fit = fitToEvidence(boxes, space, pageBase, c.clientWidth);
    if (!fit) return;
    setScale(fit.scale);
    // Centre after the canvas resizes.
    setTimeout(() => {
      const rendered: Size = { width: pageBase.width * fit.scale, height: pageBase.height * fit.scale };
      const rects = transformBoxes(boxes, space, rendered);
      if (!rects.length) return;
      const cx = rects.reduce((m, r) => m + r.left + r.width / 2, 0) / rects.length;
      const cy = rects.reduce((m, r) => m + r.top + r.height / 2, 0) / rects.length;
      c.scrollLeft = cx - c.clientWidth / 2;
      c.scrollTop = cy - c.clientHeight / 2;
    }, 30);
  }, [source, pageBase, boxes]);

  // Auto fit-to-evidence when a new item with boxes renders.
  useEffect(() => { if (status === "ready" && boxes.length) fitEvidence(); }, [status, boxes, fitEvidence]);

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

  const contextBanner = (
    <EvidenceContextBanner
      selectedClaim={selectedClaim}
      selectedClaimValue={selectedClaimValue}
      evidence={selectedClaimEvidence}
      documentName={documentName}
    />
  );

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
      name={documentName}
      toolbar={
        <div className="flex items-center gap-1">
          <IconBtn title="Zoom out" onClick={() => setScale((s) => Math.max(0.1, s - 0.25))}><ZoomOut className="w-4 h-4" /></IconBtn>
          <span className="text-xs tabular-nums w-10 text-center">{Math.round(scale * 100)}%</span>
          <IconBtn title="Zoom in" onClick={() => setScale((s) => Math.min(8, s + 0.25))}><ZoomIn className="w-4 h-4" /></IconBtn>
          <IconBtn title="Fit page" onClick={fitPage}><Maximize className="w-4 h-4" /></IconBtn>
          <IconBtn title="Fit to evidence" onClick={fitEvidence} disabled={!boxes.length}><Crosshair className="w-4 h-4" /></IconBtn>
          <span className="mx-1 w-px h-5 bg-border" />
          <IconBtn title="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft className="w-4 h-4" /></IconBtn>
          <span className="text-xs tabular-nums">{page} / {numPages}</span>
          <IconBtn title="Next page" onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page >= numPages}><ChevronRight className="w-4 h-4" /></IconBtn>
        </div>
      }
    >
      {contextBanner}
      <div ref={containerRef} className="relative overflow-auto border rounded bg-neutral-100" style={{ height: 460 }}>
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
          {overlayRects.map((r, i) => {
            const box = boxes[i];
            const claim = box?.claim ?? "general";
            const claimIndicator = selectedClaim ? `${claim.slice(0, 3).toUpperCase()}${i + 1}` : `E${i + 1}`;
            return (
              <div key={i}
                className={`absolute pointer-events-none ${i === 0 ? "border-2 border-amber-500 bg-amber-400/25" : "border-2 border-dashed border-amber-500/80 bg-amber-400/10"}`}
                style={{ left: r.left, top: r.top, width: r.width, height: r.height }}>
                <span className="absolute -top-4 left-0 text-[10px] font-medium text-amber-700 bg-white/70 px-0.5 rounded">{box?.label ?? claimIndicator}</span>
              </div>
            );
          })}
        </div>
      </div>
      {source?.evidence && source.evidence.length > 0 && boxes.length === 0 && (
        <p className="text-[11px] text-muted-foreground">Evidence for this item is on another page — use the page controls.</p>
      )}
      {(!source?.evidence || source.evidence.length === 0) && (
        <p className="text-[11px] text-muted-foreground">Evidence coordinates unavailable — showing the source page only.</p>
      )}
      {pageSizeWarning && <p className="text-[11px] text-amber-600">{pageSizeWarning}</p>}
    </Shell>
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
      <div className="rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Select an Evidence link to inspect the drawing source.
      </div>
    );
  }
  const sourceLabel = evidence?.label ?? documentName ?? null;
  return (
    <div className="rounded border bg-muted/40 px-3 py-2 text-xs space-y-0.5">
      <div><span className="font-medium">Claim:</span> {claimLabel(selectedClaim)}</div>
      {selectedClaimValue != null && <div><span className="font-medium">Value:</span> {selectedClaimValue}</div>}
      <div><span className="font-medium">Evidence source:</span> {sourceLabel ?? "unavailable"}</div>
      {evidence?.page != null && <div><span className="font-medium">Page:</span> {evidence.page}</div>}
    </div>
  );
}

function Shell({ name, toolbar, children }: { name?: string | null; toolbar?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium truncate max-w-[16rem]">{name ?? "Drawing"}</span>
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
