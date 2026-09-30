// DRAWING THUMBNAIL — a real first-page preview of a stored PDF drawing,
// so a Documents card reads as "a drawing" rather than a generic file row.
//
// Reuses the exact same pdf.js loading pattern ProjectDocuments.tsx already
// uses for page-counting on upload (dynamic import + worker URL) — no new
// dependency, no new rendering approach. Renders page 1 at a small scale into
// an offscreen-sized canvas. Truthful fallback (the same FileText icon block
// used before this existed) on any failure — never a fabricated placeholder.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { signedDrawingUrl } from "@/lib/review/drawingStorage";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

const THUMB_SIZE = 56; // px — matches the h-14 w-14 slot this replaces

export default function DrawingThumbnail({ revisionId, filePath, className, onClick, renderSize = THUMB_SIZE }: {
  revisionId: string; filePath: string; className?: string; onClick?: () => void;
  /** Target render resolution (px, longest page side) — pass a bigger value
   *  than THUMB_SIZE when the caller displays this at gallery-card size, so
   *  the PDF is re-rasterised sharp rather than upscaled from a 56px canvas. */
  renderSize?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);

  const { data: url } = useQuery({
    queryKey: ["drawing-thumbnail-url", revisionId],
    queryFn: () => signedDrawingUrl(filePath),
  });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const doc = await pdfjs.getDocument(url).promise;
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(4, renderSize / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setRendered(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [url, renderSize]);

  const Wrapper = onClick ? "button" : "div";
  const wrapperProps = onClick ? { type: "button" as const, onClick, "aria-label": "Preview drawing" } : {};

  if (failed || url === null) {
    return (
      <Wrapper {...wrapperProps} className={cn("h-14 w-14 shrink-0 rounded-md bg-muted text-muted-foreground flex items-center justify-center", className)}>
        <FileText className="h-6 w-6" />
      </Wrapper>
    );
  }

  return (
    <Wrapper {...wrapperProps} className={cn("h-14 w-14 shrink-0 rounded-md border bg-white overflow-hidden flex items-center justify-center", className)}>
      {!rendered && <FileText className="h-6 w-6 text-muted-foreground/50" />}
      <canvas ref={canvasRef} className={cn("max-h-full max-w-full", !rendered && "hidden")} />
    </Wrapper>
  );
}
