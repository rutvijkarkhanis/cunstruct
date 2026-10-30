// Scores linear-dimension extraction against a reference (gold) file.
//   ACC_DIMS="C-01=<pdf or geometry.json>#<page>=<gold.json>;..."  ACC_OUT=<report.json>
// A .json source is a saved pdfGeometry extraction (used to score the geometry
// as it was before a fix). Gold files stay outside the repository.
import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPageGeometry, type PageGeometryExtraction } from "@/lib/review/pdfGeometry";
import { extractLinearDimensions, type LinearDimension } from "@/lib/review/linearDimensions";

interface GoldDim { gid: string; value: number; axis: "h" | "v"; across: number; span: [number, number]; anchor: [number, number]; repeatOf?: string }
interface Gold { case: string; page: number; split: string; grade: string; dimensions: GoldDim[] }

const ENDPOINT_TOL = 1.5; // page points
const ANCHOR_TOL = 6;

async function geometry(src: string, page: number): Promise<PageGeometryExtraction> {
  if (src.endsWith(".json")) return JSON.parse(readFileSync(src, "utf8"));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(src)), isEvalSupported: false }).promise;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return extractPageGeometry((await doc.getPage(page)) as any, page);
}

function spanOk(d: LinearDimension, g: GoldDim): boolean {
  if (!d.span) return false;
  const k = g.axis === "h" ? 0 : 1;
  const [a, b] = [d.span.start[k], d.span.end[k]].sort((x, y) => x - y);
  return Math.abs(a - g.span[0]) <= ENDPOINT_TOL && Math.abs(b - g.span[1]) <= ENDPOINT_TOL && Math.abs(d.span.start[1 - k] - g.across) <= ENDPOINT_TOL;
}

export function score(gold: Gold, dims: LinearDimension[], scale: { valuePerPoint: number } | null) {
  const used = new Set<string>();
  const rows = gold.dimensions.map((g) => {
    const cands = dims.filter((d) => !used.has(d.id) && d.parsed.value === g.value)
      .map((d) => ({ d, dist: Math.hypot(d.textAnchor[0] - g.anchor[0], d.textAnchor[1] - g.anchor[1]) }))
      .filter((c) => c.dist <= ANCHOR_TOL).sort((p, q) => p.dist - q.dist);
    const d = cands[0]?.d;
    if (d) used.add(d.id);
    const goldLen = g.span[1] - g.span[0];
    return {
      gid: g.gid, value: g.value, id: d?.id ?? null, status: d?.status ?? "not-recognised", spanCorrect: d ? spanOk(d, g) : false,
      measured: d?.measured?.value ?? null, relError: d?.measured ? Math.abs(d.measured.value - g.value) / g.value : null,
      goldLength: goldLen, goldImplied: scale ? Math.round(goldLen * scale.valuePerPoint) : null,
      repeatGold: g.repeatOf ?? null, repeatFlag: d?.possibleRepeatOf ?? null,
    };
  });
  const n = rows.length;
  const recognised = rows.filter((r) => r.id).length;
  const spanCorrect = rows.filter((r) => r.spanCorrect).length;
  const consistent = rows.filter((r) => r.status === "consistent");
  const falseConsistent = consistent.filter((r) => !r.spanCorrect);
  const extras = dims.filter((d) => !used.has(d.id));
  const relErr = consistent.map((r) => r.relError!).sort((a, b) => a - b);
  const repeatsGold = rows.filter((r) => r.repeatGold);
  const repeatsFlagged = rows.filter((r) => r.repeatFlag);
  // a repeat pair is correct in either order (which side is "first" depends on reading order)
  const gidOf = new Map(rows.filter((r) => r.id).map((r) => [r.id!, r.gid]));
  const goldPairs = new Set(rows.filter((r) => r.repeatGold).flatMap((r) => [`${r.gid}|${r.repeatGold}`, `${r.repeatGold}|${r.gid}`]));
  const repeatTP = repeatsFlagged.filter((r) => goldPairs.has(`${r.gid}|${gidOf.get(r.repeatFlag!)}`));
  const goldRatios = gold.dimensions.filter((g) => g.span[1] - g.span[0] >= 20).map((g) => g.value / (g.span[1] - g.span[0])).sort((a, b) => a - b);
  return {
    case: gold.case, page: gold.page, split: gold.split, grade: gold.grade,
    gold: n, recognised, spanCorrect,
    status: Object.fromEntries(["consistent", "conflict", "ambiguous", "unchecked", "unassociated", "not-recognised"].map((s) => [s, rows.filter((r) => r.status === s).length])),
    consistentAndSpanCorrect: consistent.length - falseConsistent.length,
    falseConsistent: falseConsistent.map((r) => r.gid),
    spanCorrectButHeld: rows.filter((r) => r.spanCorrect && r.status !== "consistent").map((r) => `${r.gid}:${r.status}`),
    lengthAgreement: relErr.length ? { n: relErr.length, median: relErr[Math.floor(relErr.length / 2)], max: relErr[relErr.length - 1], within1pct: relErr.filter((e) => e <= 0.01).length } : null,
    scale: { calibrated: scale?.valuePerPoint ?? null, fromGold: goldRatios.length ? goldRatios[Math.floor(goldRatios.length / 2)] : null },
    extraCandidates: extras.map((d) => ({ id: d.id, text: d.text, status: d.status })),
    extraConsistent: extras.filter((d) => d.status === "consistent").map((d) => d.id),
    repeats: { gold: repeatsGold.length, flagged: repeatsFlagged.length, correct: repeatTP.length, wrong: repeatsFlagged.filter((r) => !repeatTP.includes(r)).map((r) => r.gid) },
    rows,
  };
}

it("score linear dimensions", async () => {
  const spec = process.env.ACC_DIMS;
  if (!spec) return;
  const out = [];
  for (const entry of spec.split(";")) {
    const [, srcPage, goldPath] = entry.split("=");
    const [src, page] = srcPage.split("#");
    const gold: Gold = JSON.parse(readFileSync(goldPath, "utf8"));
    const r = extractLinearDimensions(await geometry(src, Number(page)));
    out.push({ source: src.split("/").pop(), ...score(gold, r.dimensions, r.scale), excluded: r.excluded, scaleNotes: r.scaleNotes, pageScale: r.scale });
  }
  writeFileSync(process.env.ACC_OUT!, JSON.stringify(out, null, 1));
}, 300000);
