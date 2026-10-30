// FLOOR PLAN TO 3D — preview tool (milestones 1–4): open a PDF floor plan,
// set its scale, detect or draw walls, confirm them, see them in 3D and edit
// them. Local only: the file is read in the browser and nothing is uploaded
// or saved (no Supabase query or write). Disabled in production builds unless
// VITE_CUNSTRUCT_FLOORPLAN_3D === "true".
import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min?url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlanCanvas } from "@/components/floorplan/PlanCanvas";
import { Viewer3D } from "@/components/floorplan/Viewer3D";
import { extractPageGeometry, type PageGeometryExtraction } from "@/lib/review/pdfGeometry";
import { segmentsFromShapes, type Point } from "@/lib/floorplan/geometry";
import { calibrate, fromScaleNote, scaleSuggestions, type Scale } from "@/lib/floorplan/scale";
import { detectWallCandidates, DEFAULT_WALL_OPTIONS } from "@/lib/floorplan/walls";
import {
  addManualWall, deleteWall, effectiveHeight, emptyModel, quantities, setWallLength, updateWall, wallLength, wallsFromCandidates,
  type BuildingModel,
} from "@/lib/floorplan/model";
import { planBounds, wallBoxes } from "@/lib/floorplan/mesh";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type Mode = "select" | "calibrate" | "draw";
const fmt = (v: number, d = 0) => v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

export default function FloorPlan3D() {
  const enabled = import.meta.env.DEV || import.meta.env.VITE_CUNSTRUCT_FLOORPLAN_3D === "true";
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [fileName, setFileName] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [extraction, setExtraction] = useState<PageGeometryExtraction | null>(null);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<Mode>("select");
  const [picks, setPicks] = useState<Point[]>([]);
  const [calMm, setCalMm] = useState("");
  const [drawThickness, setDrawThickness] = useState("");
  const [model, setModel] = useState<BuildingModel>(emptyModel());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const segments = useMemo(() => (extraction ? segmentsFromShapes(extraction.shapes) : []), [extraction]);
  const suggestions = useMemo(() => (extraction ? scaleSuggestions(extraction.textRuns) : []), [extraction]);
  const mesh = useMemo(() => wallBoxes(model), [model]);
  const bounds = useMemo(() => planBounds(model), [model]);
  const q = useMemo(() => quantities(model), [model]);
  const selected = model.walls.find((w) => w.id === selectedId) ?? null;

  if (!enabled) return <Navigate to="/" replace />;

  const run = (fn: () => void) => {
    try { fn(); setMessage(null); } catch (e) { setMessage((e as Error).message); }
  };

  async function openFile(file: File) {
    setBusy(true);
    try {
      const d = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      setDoc(d); setFileName(file.name); setModel(emptyModel()); setSelectedId(null); setPicks([]);
      await loadPage(d, 1);
    } catch (e) {
      setMessage(`Could not open this file as a PDF: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function loadPage(d: PDFDocumentProxy, n: number) {
    setBusy(true);
    try {
      const page = await d.getPage(n);
      const ex = await extractPageGeometry(page, n);
      setPageNumber(n); setExtraction(ex); setModel((m) => ({ ...m, walls: [] })); setSelectedId(null); setPicks([]);
      const fit = Math.min(1.6, Math.max(0.3, 820 / ex.pageSize.width));
      setZoom(Number(fit.toFixed(2)));
      setMessage(ex.shapes.length ? null : "This page has no vector lines (it is probably a scan). Walls can still be drawn by hand after calibrating the scale.");
    } finally { setBusy(false); }
  }

  function setScale(s: Scale) {
    // walls are stored in millimetres; a new scale would move them off the drawing, so they are cleared
    setModel((m) => ({ ...m, scale: s, walls: m.walls.length ? [] : m.walls }));
    setSelectedId(null);
  }

  function onPick(p: Point) {
    if (mode === "select") { setSelectedId(null); return; }
    const next = picks.length >= 2 ? [p] : [...picks, p];
    setPicks(next);
    if (mode === "draw" && next.length === 2 && model.scale) {
      const k = model.scale.mmPerUnit;
      run(() => {
        setModel((m) => addManualWall(m, [next[0][0] * k, next[0][1] * k], [next[1][0] * k, next[1][1] * k], num(drawThickness)));
        setPicks([]);
      });
    }
  }

  function detect() {
    if (!model.scale) return;
    run(() => {
      const cands = detectWallCandidates(segments, model.scale!.mmPerUnit);
      setModel((m) => ({ ...m, walls: wallsFromCandidates(cands) }));
      setSelectedId(null);
      setMessage(`${cands.length} wall candidate${cands.length === 1 ? "" : "s"} found from ${segments.length} drawn lines. Check each one: confirm walls, delete anything that is not a wall.`);
    });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-4 py-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-lg font-semibold">Floor plan to 3D</h1>
        <span className="text-xs text-muted-foreground">Preview · local only: the drawing stays in this browser and nothing is saved</span>
      </header>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── left: plan ── */}
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="fp-file">Floor plan (PDF)</Label>
              <Input id="fp-file" type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])} />
            </div>
            {doc && (
              <>
                <div>
                  <Label htmlFor="fp-page">Page</Label>
                  <Input id="fp-page" type="number" min={1} max={doc.numPages} value={pageNumber} className="w-20"
                    onChange={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= doc.numPages) loadPage(doc, n); }} />
                </div>
                <span className="text-xs text-muted-foreground pb-2">of {doc.numPages} · {fileName}</span>
                <div className="flex gap-1 pb-0.5">
                  <Button size="sm" variant="outline" onClick={() => setZoom((z) => Math.max(0.2, +(z / 1.4).toFixed(2)))}>−</Button>
                  <Button size="sm" variant="outline" onClick={() => setZoom((z) => Math.min(8, +(z * 1.4).toFixed(2)))}>+</Button>
                </div>
              </>
            )}
          </div>

          {doc && extraction && (
            <>
              <div className="flex flex-wrap gap-2">
                {(["select", "calibrate", "draw"] as Mode[]).map((m) => (
                  <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} disabled={m === "draw" && !model.scale}
                    onClick={() => { setMode(m); setPicks([]); }}>
                    {m === "select" ? "Select" : m === "calibrate" ? "Calibrate scale" : "Draw wall"}
                  </Button>
                ))}
                <Button size="sm" variant="secondary" disabled={!model.scale || !segments.length} onClick={detect}>Detect walls</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {mode === "calibrate" && "Click two points whose real distance you know (e.g. the ends of a dimension line), then enter that distance."}
                {mode === "draw" && "Enter the wall thickness, then click the wall's two end points along its centreline."}
                {mode === "select" && `${extraction.shapes.length} vector shapes · ${segments.length} straight lines · ${extraction.textRuns.length} text runs on this page.`}
              </p>
              <div className="max-h-[70vh] overflow-auto rounded border bg-muted/30">
                <PlanCanvas doc={doc} pageNumber={pageNumber} pageSize={extraction.pageSize} zoom={zoom} mmPerUnit={model.scale?.mmPerUnit ?? null}
                  walls={model.walls} selectedId={selectedId} picks={mode === "select" ? [] : picks} onPick={onPick} onSelectWall={setSelectedId} />
              </div>
            </>
          )}
        </section>

        {/* ── right: scale, 3D, walls ── */}
        <section className="min-w-0 space-y-4">
          {doc && (
            <div className="rounded border p-3 space-y-2">
              <h2 className="text-sm font-semibold">1 · Scale</h2>
              {model.scale ? (
                <p className="text-sm">{fmt(model.scale.mmPerUnit, 3)} mm per page unit <span className="text-muted-foreground">({model.scale.evidence})</span></p>
              ) : <p className="text-sm text-muted-foreground">Not set. Nothing is measured until the scale is calibrated or a printed scale is confirmed.</p>}
              {mode === "calibrate" && (
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <Label htmlFor="fp-cal">Real distance between the two points (mm)</Label>
                    <Input id="fp-cal" inputMode="decimal" value={calMm} onChange={(e) => setCalMm(e.target.value)} className="w-40" />
                  </div>
                  <Button size="sm" disabled={picks.length !== 2} onClick={() => run(() => { setScale(calibrate(picks[0], picks[1], num(calMm))); setPicks([]); setMode("select"); })}>
                    Set scale
                  </Button>
                  <span className="text-xs text-muted-foreground">{picks.length}/2 points picked</span>
                </div>
              )}
              {suggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Printed scale found:</span>
                  {suggestions.map((s) => (
                    <Button key={s.ratio} size="sm" variant="outline" onClick={() => setScale(fromScaleNote(s))}>
                      Use 1:{s.ratio} (sheet at its printed size)
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-end gap-2 pt-1">
                <div>
                  <Label htmlFor="fp-h">Storey height (mm)</Label>
                  <Input id="fp-h" inputMode="decimal" className="w-32" placeholder="not on the plan"
                    value={model.storeyHeightMm ?? ""} onChange={(e) => setModel((m) => ({ ...m, storeyHeightMm: e.target.value === "" ? null : Number(e.target.value) || null }))} />
                </div>
                {mode === "draw" && (
                  <div>
                    <Label htmlFor="fp-t">New wall thickness (mm)</Label>
                    <Input id="fp-t" inputMode="decimal" className="w-32" value={drawThickness} onChange={(e) => setDrawThickness(e.target.value)} />
                  </div>
                )}
              </div>
            </div>
          )}

          {message && <p role="status" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{message}</p>}

          <div className="rounded border overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-2">
              <h2 className="text-sm font-semibold">2 · 3D</h2>
              <span className="text-xs text-muted-foreground">Drag to orbit, scroll to zoom, click a wall to select it.
                {mesh.withoutHeight.length > 0 && ` ${mesh.withoutHeight.length} wall(s) not shown: no height yet.`}</span>
            </div>
            <div className="h-[420px]">
              <Viewer3D boxes={mesh.boxes} bounds={bounds} selectedId={selectedId} onSelectWall={setSelectedId} />
            </div>
          </div>

          {selected && (
            <div className="rounded border p-3 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">Wall {selected.id} <span className="font-normal text-muted-foreground">· {selected.source === "drawing" ? `read from lines ${selected.evidence?.lines.join(" & ")} on page ${selected.evidence?.page}` : "drawn by hand"} · {selected.status}</span></h2>
                <div className="flex gap-2">
                  {selected.status === "candidate" && <Button size="sm" onClick={() => setModel((m) => updateWall(m, selected.id, { status: "confirmed" }))}>Confirm</Button>}
                  <Button size="sm" variant="destructive" onClick={() => { setModel((m) => deleteWall(m, selected.id)); setSelectedId(null); }}>Delete</Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <NumberField id="fp-len" label="Length (mm)" value={Math.round(wallLength(selected))} onCommit={(v) => run(() => setModel((m) => setWallLength(m, selected.id, v)))} />
                <NumberField id="fp-thk" label="Thickness (mm)" value={Math.round(selected.thicknessMm)} onCommit={(v) => run(() => setModel((m) => updateWall(m, selected.id, { thicknessMm: v })))} />
                <NumberField id="fp-wh" label="Own height (mm)" value={selected.heightMm ?? null} placeholder={model.storeyHeightMm ? `storey ${model.storeyHeightMm}` : "none"}
                  onCommit={(v) => run(() => setModel((m) => updateWall(m, selected.id, { heightMm: Number.isNaN(v) ? null : v })))} />
              </div>
              <p className="text-xs text-muted-foreground">Height used: {effectiveHeight(model, selected) ? `${fmt(effectiveHeight(model, selected)!)} mm` : "none: enter a storey height or this wall's own height"}</p>
            </div>
          )}

          <div className="rounded border p-3 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">3 · Walls and quantities</h2>
              {q.candidates > 0 && <Button size="sm" variant="outline" onClick={() => setModel((m) => ({ ...m, walls: m.walls.map((w) => ({ ...w, status: "confirmed" as const })) }))}>Confirm all {q.candidates} candidates</Button>}
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm tabular-nums">
              <Stat label="Walls" value={`${q.confirmed} confirmed · ${q.candidates} to check`} />
              <Stat label="Length" value={`${fmt(q.lengthM, 2)} m`} />
              <Stat label="Face area" value={q.faceAreaM2 == null ? "needs heights" : `${fmt(q.faceAreaM2, 2)} m²`} />
              <Stat label="Volume" value={q.volumeM3 == null ? "needs heights" : `${fmt(q.volumeM3, 3)} m³`} />
            </dl>
            <p className="text-xs text-muted-foreground">{q.basis} Detection limits: {DEFAULT_WALL_OPTIONS.minThicknessMm}–{DEFAULT_WALL_OPTIONS.maxThicknessMm} mm thick, lines at least {DEFAULT_WALL_OPTIONS.minOverlapMm} mm long. Provisional: not added to any BOQ.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function NumberField({ id, label, value, placeholder, onCommit }: { id: string; label: string; value: number | null; placeholder?: string; onCommit: (v: number) => void }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) { setSeen(value); setText(value == null ? "" : String(value)); }
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="decimal" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(num(text))} onKeyDown={(e) => e.key === "Enter" && onCommit(num(text))} />
    </div>
  );
}
