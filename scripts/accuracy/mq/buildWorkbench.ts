// Builds the offline measurement-evidence workbench (developer tool; never part of the product).
//   npx vite-node --root . scripts/accuracy/mq/buildWorkbench.ts --engine <engine-output.json> --ledger <ledger.json>
//     --gold <gold-set.json> --pdf <drawing.pdf> --manifest <dataset.manifest.json> --out <dir> [--tile-dpi 300]
// Output (private, outside Git): index.html + app.js + style.css (copied from scripts/accuracy/mq/workbench/),
// data.js (engine evidence, reference, ledger outcomes, failure classes), pages/ and tiles/ (poppler renders).
// Open <out>/index.html in a browser: no server, no network.
import path from "node:path";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPageGeometry } from "@/lib/measurement-lab/baselines/engine-9ac1f71/pdfGeometry";
import type { LinearDimension, PageDimensions, Point } from "@/lib/measurement-lab/baselines/engine-9ac1f71/linearDimensions";
import type { LedgerRow, ReferenceDimension } from "@/lib/measurement-quality/ledger";
import { classifyFailure, FAILURE_CATEGORIES } from "@/lib/measurement-quality/failureReasons";
import { assertUsable, DatasetManifest } from "@/lib/measurement-quality/datasetManifest";
import { args, assertOutsideRepo, need, readJson, REPO, sha256File, writeText } from "./common";
import { freezeManifest } from "./fingerprint";

const a = args();
const out = need(a, "out");
assertOutsideRepo(out);
const manifest = DatasetManifest.parse(readJson(need(a, "manifest")));
assertUsable(manifest, "exploratory");
const pdf = need(a, "pdf"), pdfSha = sha256File(pdf);
if (!manifest.files.some((f) => f.sha256 === pdfSha)) throw new Error("drawing not in the dataset manifest");
const pages = readJson<PageDimensions[]>(need(a, "engine"));
const ledger = readJson<{ rows: LedgerRow[] }>(need(a, "ledger")).rows;
const gold = readJson<{ items: ReferenceDimension[] }>(need(a, "gold")).items.filter((i) => i.kind === "linear_dimension");
const TILE_DPI = Number(a["tile-dpi"] ?? 300), BASE_DPI = 72, TILE_PT = 256;

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdf)), isEvalSupported: false, verbosity: 0 }).promise;
const ledgerByEngine = new Map(ledger.filter((r) => r.engine).map((r) => [r.engine!.id, r]));
const goldById = new Map(gold.map((g) => [g.gold_id, g]));
const r1 = (p: Point): Point => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];

const pageData = [];
for (const P of pages) {
  const g = await extractPageGeometry(await doc.getPage(P.page), P.page);
  const shapes = g.shapes;
  const shapePts = (i: number) => (shapes[i] ? { index: i, type: shapes[i].type, points: (shapes[i].points as Point[]).map(r1) } : null);
  // straight segments, for the "source geometry" overlays (raw drawing, not engine decisions)
  const segs: { a: Point; b: Point; i: number }[] = [];
  shapes.forEach((s, i) => {
    if (s.type !== "line" && s.type !== "polyline" && s.type !== "polygon" && s.type !== "rectangle") return;
    const p = s.points as Point[], closed = s.type === "polygon" || s.type === "rectangle";
    for (let k = 0; k < (closed ? p.length : p.length - 1); k++) segs.push({ a: p[k], b: p[(k + 1) % p.length], i });
  });
  const dims = P.dimensions.map((d: LinearDimension) => {
    const h = d.textHeight;
    const l = d.line;
    const u: Point | null = l ? (() => { const L = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]); return [(l.b[0] - l.a[0]) / L, (l.b[1] - l.a[1]) / L] as Point; })() : null;
    const at = (s: number): Point => r1([l!.a[0] + u![0] * s, l!.a[1] + u![1] * s]);
    const term = (t: { at: number; kind: string; shapes: number[]; evidence: string }, side: string) => ({ side, kind: t.kind, at: at(t.at), evidence: t.evidence, shapes: t.shapes.map(shapePts).filter(Boolean) });
    const chosen = new Set(d.endpoints?.ends?.map((t) => t.at) ?? []);
    const marks = l && d.endpoints ? [...d.endpoints.left.map((t) => ({ ...term(t, "left"), chosen: chosen.has(t.at) })), ...d.endpoints.right.map((t) => ({ ...term(t, "right"), chosen: chosen.has(t.at) }))] : [];
    const assocEnds = d.association?.ends.map((e) => (e.kind === "edge" ? { ...e, geometry: shapePts(e.shape) } : e)) ?? null;
    // source geometry: lines parallel to the dimension near its text (competing lines), and lines
    // crossing each end's axis (extension lines, faces). Raw drawing only.
    const parallel: { a: Point; b: Point; shape: number }[] = [], atEnds: { a: Point; b: Point; shape: number; end: number }[] = [];
    if (u) {
      const [x, y] = d.textAnchor;
      for (const s of segs) {
        const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], L = Math.hypot(dx, dy);
        if (L < 0.5) continue;
        const sin = Math.abs((dx / L) * u[1] - (dy / L) * u[0]);
        const mx = (s.a[0] + s.b[0]) / 2, my = (s.a[1] + s.b[1]) / 2;
        if (sin < 0.02 && Math.abs((mx - x) * -u[1] + (my - y) * u[0]) <= 3 * h && Math.abs((mx - x) * u[0] + (my - y) * u[1]) <= Math.max(60, (d.span?.length ?? 60))) parallel.push({ a: r1(s.a), b: r1(s.b), shape: s.i });
        if (d.span && sin > 0.98) [d.span.start, d.span.end].forEach((e, k) => {
          const off = Math.abs((mx - e[0]) * u[0] + (my - e[1]) * u[1]);
          const reach = Math.min(...[s.a, s.b].map((q) => Math.abs((q[0] - e[0]) * -u[1] + (q[1] - e[1]) * u[0])));
          if (off <= 1.5 && (reach <= 40 * h)) atEnds.push({ a: r1(s.a), b: r1(s.b), shape: s.i, end: k });
        });
      }
    }
    const L = ledgerByEngine.get(d.id);
    const f = classifyFailure(d);
    const ref = L ? goldById.get(L.measurement_id) : undefined;
    return {
      id: d.id, page: d.page, text: d.text, value: d.parsed.value, unit: d.unit, unitBasis: d.unitBasis, textAnchor: r1(d.textAnchor), textHeight: d.textHeight,
      line: d.line, span: d.span, endpoints: d.endpoints ? { decision: d.endpoints.decision, reason: d.endpoints.reason, textPosition: d.endpoints.textPosition, length: d.endpoints.length } : null,
      marks, association: d.association ? { decision: d.association.decision, measures: d.association.measures, reason: d.association.reason, ends: assocEnds } : null,
      scaleCheck: d.scaleCheck, measured: d.measured, status: d.status, decisions: d.decisions, reasons: d.reasons, role: d.role, chain: d.chain ?? null, covers: d.covers ?? null,
      crossView: d.crossView ?? null, possibleRepeatOf: d.possibleRepeatOf ?? null,
      orientation: u ? (Math.abs(u[1]) < 0.05 ? "horizontal" : Math.abs(u[0]) < 0.05 ? "vertical" : "oblique") : "unknown",
      failure: f, source: { parallel: parallel.slice(0, 40), atEnds: atEnds.slice(0, 40) },
      ledger: L ? { measurement_id: L.measurement_id, outcomes: L.outcomes, fully_correct: L.fully_correct, line_on_reference_axis: L.line_on_reference_axis } : null,
      reference: ref ? { gold_id: ref.gold_id, source_id: ref.source_id, view: ref.view, view_scale: ref.view_scale, printed_text: ref.printed_text, value: ref.value, unit: ref.unit, text_center_pt: ref.text_center_pt, endpoints_pt: ref.endpoints_pt, associated_element: ref.associated_element, association_basis: ref.association_basis ?? null, status: ref.reference_status, verification: ref.verification, amendments: ref.amendments ?? [] } : null,
    };
  });
  // scale regions: members' anchors and spans (the engine's region extent before its per-dimension margin)
  const byId = new Map(P.dimensions.map((d) => [d.id, d]));
  const regions = P.regions.map((rg) => {
    const pts = rg.members.flatMap((m) => { const d = byId.get(m)!; return [d.textAnchor, ...(d.span ? [d.span.start, d.span.end] : [])]; });
    const hs = rg.members.map((m) => byId.get(m)!.textHeight).sort((x, y) => x - y);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { id: rg.id, members: rg.members, valuePerPoint: rg.valuePerPoint, ratioIfMm: rg.ratioIfMm, support: rg.support, extent: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], margin: 10 * hs[Math.floor(hs.length / 2)] };
  });
  const tags = P.excluded.filter((e) => /tag inside a small closed outline/.test(e.reason)).map((e) => ({ text: e.text, at: r1(e.at) }));
  const vp = (await doc.getPage(P.page)).getViewport({ scale: 1 });
  pageData.push({ page: P.page, size: [vp.width, vp.height], dims, regions, tags, scaleNotes: P.scaleNotes, unitNote: P.unitNote });
}
await doc.destroy();

// ── renders (poppler): one base image per page and a tile grid at TILE_DPI ──
mkdirSync(path.join(out, "pages"), { recursive: true });
mkdirSync(path.join(out, "tiles"), { recursive: true });
const tiles: Record<number, { cols: number; rows: number; pt: number; dpi: number }> = {};
for (const p of pageData) {
  const base = path.join(out, "pages", `page-${p.page}`);
  if (!existsSync(base + ".png")) execFileSync("pdftoppm", ["-f", String(p.page), "-l", String(p.page), "-r", String(BASE_DPI), "-png", "-singlefile", pdf, base]);
  const big = path.join(out, `.big-${p.page}`);
  const cols = Math.ceil(p.size[0] / TILE_PT), rows = Math.ceil(p.size[1] / TILE_PT);
  if (!existsSync(path.join(out, "tiles", `p${p.page}-${rows - 1}-${cols - 1}.png`))) {
    execFileSync("pdftoppm", ["-f", String(p.page), "-l", String(p.page), "-r", String(TILE_DPI), "-png", "-singlefile", pdf, big]);
    execFileSync("python3", ["-I", "-c", `
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
im=Image.open(${JSON.stringify(big + ".png")}); k=${TILE_DPI}/72; T=${TILE_PT}
for r in range(${rows}):
  for c in range(${cols}):
    box=(int(c*T*k),int(r*T*k),min(im.width,int((c+1)*T*k)),min(im.height,int((r+1)*T*k)))
    im.crop(box).save(${JSON.stringify(path.join(out, "tiles"))}+f"/p${p.page}-{r}-{c}.png", optimize=True)
`]);
    execFileSync("rm", ["-f", big + ".png"]);
  }
  tiles[p.page] = { cols, rows, pt: TILE_PT, dpi: TILE_DPI };
}

const fm = freezeManifest();
const data = {
  schema: "cunstruct.workbench-data.v1",
  dataset: { id: manifest.dataset_id, role: manifest.role, drawing: path.basename(pdf), sha256: pdfSha },
  engine: { candidate_fingerprint: fm.candidate.fingerprint, core_four: fm.core_four.fingerprint, base_commit: fm.git.base_commit },
  reference: { type: "Gold Set — DEVELOPER-VERIFIED, NOT independently verified" },
  failureCategories: FAILURE_CATEGORIES, baseDpi: BASE_DPI, tiles, pages: pageData,
  built: new Date().toISOString().slice(0, 10),
};
writeText(path.join(out, "data.js"), `// Generated by scripts/accuracy/mq/buildWorkbench.ts — engine output and references for the offline workbench.\nwindow.WB_DATA = ${JSON.stringify(data)};\n`);
for (const f of ["index.html", "app.js", "style.css"]) copyFileSync(path.join(REPO, "scripts/accuracy/mq/workbench", f), path.join(out, f));
console.log(`workbench: ${pageData.reduce((s, p) => s + p.dims.length, 0)} measurements on pages ${pageData.map((p) => p.page).join(", ")} → ${path.join(out, "index.html")}`);
