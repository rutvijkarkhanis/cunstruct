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
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize, Crosshair, ChevronLeft, ChevronRight, FileWarning, Loader2 } from "lucide-react";
import { resolvePageSpace, transformBoxes, unionBox } from "@/lib/review/evidenceCoords";
import type { AnalysisSource, EvidenceBox } from "@/lib/review/analysisSchemaV1";

// Bundle the worker with Vite (kept off the main thread; no CDN dependency).
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

interface Props {
  fileUrl: string | null;         // short-lived signed URL, or null when no file
  source: AnalysisSource | undefined;
  documentName?: string | null;
  /** Reason to show instead of rendering (e.g. "Source drawing unavailable"). */
  unavailableReason?: string | null;
}

type Size = { width: number; height: number };

export default function PdfEvidenceViewer({ fileUrl, source, documentName, unavailableReason }: Props) {
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

  // Evidence boxes on the CURRENT page (per-box page overrides the item page).
  const boxes: EvidenceBox[] = useMemo(
    () => (source?.evidence ?? []).filter((b) => (b.page ?? source?.page ?? page) === page),
    [source, page],
  );

  // When the item changes, jump to its source page.
  useEffect(() => { setPage(source?.page ?? 1); }, [source]);

  // Load the document when the signed URL changes.
  useEffect(() => {
    if (!fileUrl) { docRef.current = null; setStatus("idle"); return; }
    let cancelled = false;
    setStatus("loading");
    const task = pdfjsLib.getDocument(fileUrl);
    task.promise.then((doc) => {
      if (cancelled) return;
      docRef.current = doc;
      setNumPages(doc.numPages);
      setPage((p) => Math.min(Math.max(1, p), doc.numPages));
      setStatus("ready");
    }).catch(() => { if (!cancelled) setStatus("error"); });
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
      if (!ctx) return;
      renderTaskRef.current?.cancel?.();
      const task = pdfPage.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      renderTaskRef.current = task;
      await task.promise;
    } catch { /* cancelled renders throw — ignore */ }
  }, [page, scale]);

  useEffect(() => { if (status === "ready") void renderPage(); }, [status, renderPage]);

  // Fit-to-page: scale so the page fills the container width.
  const fitPage = useCallback(() => {
    const c = containerRef.current;
    if (!c || !pageBase) return;
    setScale(Math.max(0.1, Math.min(8, (c.clientWidth - 24) / pageBase.width)));
  }, [pageBase]);

  // Fit-to-evidence: scale so the evidence union fills ~80% of the container,
  // using the shared page space; then scroll to centre it. No-ops without boxes.
  const fitEvidence = useCallback(() => {
    const c = containerRef.current;
    const space = resolvePageSpace(source, pageBase);
    const u = unionBox(boxes);
    if (!c || !space || !u || !pageBase) return;
    const uw = Math.max(1, u[2] - u[0]);
    const s = Math.max(0.2, Math.min(8, (c.clientWidth * 0.8 * space.width) / (uw * pageBase.width)));
    setScale(s);
    // Centre after the canvas resizes.
    setTimeout(() => {
      const rendered: Size = { width: pageBase.width * s, height: pageBase.height * s };
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

  // ── Non-render states ───────────────────────────────────────────────────────
  if (unavailableReason) {
    return <Shell name={documentName}><Fallback icon={FileWarning} text={unavailableReason} /></Shell>;
  }
  if (!fileUrl) {
    return (
      <Shell name={documentName}>
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
      <div ref={containerRef} className="relative overflow-auto border rounded bg-neutral-100" style={{ height: 460 }}>
        {status === "loading" && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
        {status === "error" && <div className="absolute inset-0 flex items-center justify-center text-sm text-red-600">Failed to load the drawing.</div>}
        <div className="relative inline-block">
          <canvas ref={canvasRef} className="block" />
          {overlayRects.map((r, i) => (
            <div key={i}
              className={`absolute pointer-events-none ${i === 0 ? "border-2 border-amber-500 bg-amber-400/25" : "border-2 border-dashed border-amber-500/80 bg-amber-400/10"}`}
              style={{ left: r.left, top: r.top, width: r.width, height: r.height }}>
              <span className="absolute -top-4 left-0 text-[10px] font-medium text-amber-700 bg-white/70 px-0.5 rounded">{boxes[i].label ?? `E${i + 1}`}</span>
            </div>
          ))}
        </div>
      </div>
      {source?.evidence && source.evidence.length > 0 && boxes.length === 0 && (
        <p className="text-[11px] text-muted-foreground">Evidence for this item is on another page — use the page controls.</p>
      )}
      {(!source?.evidence || source.evidence.length === 0) && (
        <p className="text-[11px] text-muted-foreground">Evidence coordinates unavailable — showing the source page only.</p>
      )}
    </Shell>
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
