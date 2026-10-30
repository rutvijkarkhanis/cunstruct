// Plan view: renders one PDF page and overlays the walls in page units.
// Clicks are reported in page units (scale 1, y down), the same space
// pdfGeometry extracts shapes in, so picks line up with the drawing.
import { useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Point } from "@/lib/floorplan/geometry";
import type { Wall } from "@/lib/floorplan/model";

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number;
  pageSize: { width: number; height: number };
  zoom: number;
  mmPerUnit: number | null;
  walls: Wall[];
  selectedId: string | null;
  picks: Point[];
  onPick: (p: Point) => void;
  onSelectWall: (id: string | null) => void;
}

export function PlanCanvas({ doc, pageNumber, pageSize, zoom, mmPerUnit, walls, selectedId, picks, onPick, onSelectWall }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cssWidth = pageSize.width * zoom;
  const cssHeight = pageSize.height * zoom;

  useEffect(() => {
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled || !canvasRef.current) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: zoom * dpr });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport });
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, zoom]);

  const toPage = (e: React.MouseEvent<SVGSVGElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * pageSize.width, ((e.clientY - r.top) / r.height) * pageSize.height];
  };

  const wallPolygon = (w: Wall): string | null => {
    if (!mmPerUnit) return null;
    const [x0, y0] = w.start, [x1, y1] = w.end;
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = (-(y1 - y0) / L) * (w.thicknessMm / 2), ny = ((x1 - x0) / L) * (w.thicknessMm / 2);
    return [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]
      .map(([x, y]) => `${x / mmPerUnit},${y / mmPerUnit}`).join(" ");
  };

  const stroke = Math.max(0.6, 1.2 / zoom);
  return (
    <div className="relative" style={{ width: cssWidth, height: cssHeight }}>
      <canvas ref={canvasRef} style={{ width: cssWidth, height: cssHeight }} className="block bg-white" aria-label={`Plan, page ${pageNumber}`} />
      <svg
        className="absolute inset-0 cursor-crosshair"
        width={cssWidth}
        height={cssHeight}
        viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}
        preserveAspectRatio="none"
        onClick={(e) => onPick(toPage(e))}
      >
        {walls.map((w) => {
          const pts = wallPolygon(w);
          if (!pts) return null;
          const sel = w.id === selectedId;
          return (
            <polygon
              key={w.id}
              points={pts}
              fill={sel ? "rgba(37,99,235,0.45)" : w.status === "confirmed" ? "rgba(22,163,74,0.35)" : "rgba(245,158,11,0.35)"}
              stroke={sel ? "#1d4ed8" : w.status === "confirmed" ? "#15803d" : "#b45309"}
              strokeWidth={stroke}
              onClick={(e) => {
                e.stopPropagation();
                onSelectWall(w.id);
              }}
              style={{ cursor: "pointer" }}
            />
          );
        })}
        {picks.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={3 / zoom + 1} fill="#dc2626" stroke="white" strokeWidth={stroke / 2} />
        ))}
        {picks.length === 2 && <line x1={picks[0][0]} y1={picks[0][1]} x2={picks[1][0]} y2={picks[1][1]} stroke="#dc2626" strokeWidth={stroke} />}
      </svg>
    </div>
  );
}
