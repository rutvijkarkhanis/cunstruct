// Builds blinded independent-review packages from a frozen engine run and its reconciled ledger.
//   npx vite-node --root . scripts/accuracy/mq/makeReviewPackages.ts --engine <engine-output.json> --ledger <ledger.json>
//     --pdf <drawing.pdf> --manifest <dataset.manifest.json> --seed <int> --out <dir> [--dev-review <a.json,...>] [--historical-held <held_items.json>]
// Writes <out>/reviewer-1/ and <out>/reviewer-2/ (blinded: crops, page images, the PDF, instructions,
// blank forms) and <out>/SECRET-answer-key/ (mapping, sampling record). Fills in NO reviews.
import path from "node:path";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { LinearDimension, PageDimensions } from "@/lib/review/linearDimensions";
import type { LedgerRow } from "@/lib/measurement-quality/ledger";
import { classifyFailure } from "@/lib/measurement-quality/failureReasons";
import { assertUsable, DatasetManifest } from "@/lib/measurement-quality/datasetManifest";
import { blindIds, mulberry32, REVIEW_RESPONSE_SCHEMA, ReviewResponse, shuffle, stratifiedSample, type AnswerKeyEntry } from "@/lib/measurement-quality/reviewPackages";
import { args, assertOutsideRepo, need, readJson, REPO, sha256File, toCsv, writeJson, writeText } from "./common";

const a = args();
const out = need(a, "out");
assertOutsideRepo(out);
const seed = Number(need(a, "seed"));
const manifest = DatasetManifest.parse(readJson(need(a, "manifest")));
assertUsable(manifest, "review-packages");
const pdf = need(a, "pdf");
const pdfSha = sha256File(pdf);
if (!manifest.files.some((f) => f.sha256 === pdfSha)) throw new Error(`drawing ${pdfSha} is not in dataset ${manifest.dataset_id}`);
const pages = readJson<PageDimensions[]>(need(a, "engine"));
const ledger = readJson<{ rows: LedgerRow[] }>(need(a, "ledger")).rows;

const all = pages.flatMap((p) => p.dimensions);
const goldOf = new Map(ledger.filter((r) => r.engine).map((r) => [r.engine!.id, r]));
const orientation = (d: LinearDimension): AnswerKeyEntry["orientation"] => {
  const l = d.line;
  if (!l) return "unknown";
  const dx = Math.abs(l.b[0] - l.a[0]), dy = Math.abs(l.b[1] - l.a[1]);
  return dy < 0.05 * dx ? "horizontal" : dx < 0.05 * dy ? "vertical" : "oblique";
};
const reason = (d: LinearDimension) => classifyFailure(d)?.primary ?? null;

// ── packages ────────────────────────────────────────────────────────────────
const A = all.filter((d) => d.decisions.overall === "acceptable");
const B = all.filter((d) => goldOf.has(d.id) && d.decisions.overall !== "acceptable");
const heldPool = all.filter((d) => !goldOf.has(d.id) && d.decisions.overall === "hold");
const rejPool = all.filter((d) => !goldOf.has(d.id) && d.decisions.overall === "reject");
const C = stratifiedSample(heldPool, 30, seed, (d) => reason(d)!, [(d) => `p${d.page}`, orientation, (d) => d.association?.measures ?? "none", (d) => d.scaleCheck?.region ?? "none"]);
const D = stratifiedSample(rejPool, 15, seed + 1, (d) => reason(d)!, [(d) => `p${d.page}`, orientation]);
const members: [AnswerKeyEntry["package"], LinearDimension[]][] = [["A", A], ["B", B], ["C", C.items], ["D", D.items]];
const chosen = members.flatMap(([p, ds]) => ds.map((d) => ({ p, d })));
if (new Set(chosen.map((c) => c.d.id)).size !== chosen.length) throw new Error("a measurement is in more than one package");

// historical developer context (never shown to reviewers)
const devSets = (a["dev-review"] ?? "").split(",").filter(Boolean).flatMap((f) => readJson<{ page: number; text: string; endpoints_pt: number[][]; dim_id?: string }[]>(f));
const heldHist = a["historical-held"] ? readJson<{ page: number; text: string; endpoints_pt: number[][] }[]>(a["historical-held"]) : [];
const near = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 1;
const tileMatch = (d: LinearDimension, it: { page: number; text: string; endpoints_pt: number[][]; dim_id?: string }) =>
  it.dim_id === d.id || (it.page === d.page && it.text === d.text && !!d.span && ((near(d.span.start, it.endpoints_pt[0]) && near(d.span.end, it.endpoints_pt[1])) || (near(d.span.start, it.endpoints_pt[1]) && near(d.span.end, it.endpoints_pt[0]))));
const devVerdict = (d: LinearDimension): string | null => {
  const g = goldOf.get(d.id);
  if (g) return `Gold Set ${g.measurement_id} (developer reference, status ${g.reference.status}); ledger final outcome ${g.outcomes.final}`;
  if (devSets.some((it) => tileMatch(d, it))) return "developer stated 'correct' after viewing a review tile (session statement; not independent)";
  if (heldHist.some((it) => tileMatch(d, it))) return "in the historical 15-item developer held sample (context only; not a population estimate)";
  return null;
};

const rnd = mulberry32(seed + 2);
const ids = blindIds(chosen.length, rnd);
const order = shuffle(chosen.map((c, i) => ({ ...c, item_id: ids[i] })), rnd);
const key: AnswerKeyEntry[] = order.map(({ p, d, item_id }) => ({
  item_id, package: p, engine_id: d.id, gold_id: goldOf.get(d.id)?.measurement_id ?? null, page: d.page, view: goldOf.get(d.id)?.view ?? `p${d.page}`,
  scale_region: d.scaleCheck?.region ?? null, orientation: orientation(d), measures: d.association?.measures ?? null, engine_status: d.decisions.overall,
  primary_reason: reason(d), engine_value: d.parsed.value, engine_span: d.span ? [d.span.start, d.span.end] : null,
  engine_ends: d.association?.ends.map((e) => (e.kind === "grid" ? { kind: "grid", labels: e.labels } : { kind: e.kind })) ?? null, developer_verdict: devVerdict(d),
}));

// second reviewer: stratified by package, at least 30, accepted and held both present
const second = stratifiedSample(order, 36, seed + 3, (o) => o.p, [(o) => `p${o.d.page}`, (o) => orientation(o.d)]);

// ── render (poppler) ────────────────────────────────────────────────────────
const CROP = 600; // pt, identical for every item so crop size reveals nothing
const pageSize = new Map<number, [number, number]>();
for (const n of new Set(order.map((o) => o.d.page))) {
  const info = execFileSync("pdfinfo", ["-f", String(n), "-l", String(n), pdf], { encoding: "utf8" });
  const m = new RegExp(`Page\\s+${n} size:\\s+([\\d.]+) x ([\\d.]+)`).exec(info)!;
  pageSize.set(n, [Number(m[1]), Number(m[2])]);
}
const window = (d: LinearDimension, size: [number, number]) => {
  const x0 = Math.max(0, Math.min(size[0] - CROP, d.textAnchor[0] - CROP / 2)), y0 = Math.max(0, Math.min(size[1] - CROP, d.textAnchor[1] - CROP / 2));
  return { x0: Math.round(x0), y0: Math.round(y0), w: CROP, h: CROP };
};
const DPI = Number(a.dpi ?? 200);
// a wide context view, identical in size for every item (so its size reveals nothing either)
const CONTEXT = 1600, CONTEXT_DPI = 100;
const contextWindow = (d: LinearDimension, size: [number, number]) => {
  const w = Math.min(CONTEXT, size[0]), h = Math.min(CONTEXT, size[1]);
  return { x0: Math.round(Math.max(0, Math.min(size[0] - w, d.textAnchor[0] - w / 2))), y0: Math.round(Math.max(0, Math.min(size[1] - h, d.textAnchor[1] - h / 2))), w: Math.floor(w), h: Math.floor(h) };
};
const reviewerItems = order.map(({ d, item_id }) => {
  const w = window(d, pageSize.get(d.page)!), c = contextWindow(d, pageSize.get(d.page)!);
  return { item_id, page: d.page, crop: { file: `crops/${item_id}.png`, ...w, px_per_pt: DPI / 72 }, context: { file: `crops/${item_id}-context.png`, ...c, px_per_pt: CONTEXT_DPI / 72 },
    marker_pt: [Math.round(d.textAnchor[0] * 10) / 10, Math.round(d.textAnchor[1] * 10) / 10], page_image: `pages/page-${d.page}.png` };
});
// leakage guard: reviewer items carry only these fields
const ALLOWED = ["item_id", "page", "crop", "context", "marker_pt", "page_image"];
for (const it of reviewerItems) for (const k of Object.keys(it)) if (!ALLOWED.includes(k)) throw new Error(`reviewer item field ${k} is not allowed`);

const r1 = path.join(out, "reviewer-1"), r2 = path.join(out, "reviewer-2"), sec = path.join(out, "SECRET-answer-key");
// the ring sits clear of the text (26 pt radius) so it never covers a digit; ruler: labels every 50 pt, ticks every 10 pt
const RING = { marker_radius_pt: 26, marker_width: 2 };
const jobs = reviewerItems.map((it) => ({ out: path.join(r1, it.crop.file), page: it.page, x0: it.crop.x0, y0: it.crop.y0, w: it.crop.w, h: it.crop.h, marker: it.marker_pt, label: it.item_id, ruler: true, ruler_step: 50, ruler_minor: 10, ...RING }));
const ctxJobs = reviewerItems.map((it) => ({ out: path.join(r1, it.context.file), page: it.page, x0: it.context.x0, y0: it.context.y0, w: it.context.w, h: it.context.h, marker: it.marker_pt, label: it.item_id, ruler: true, ruler_step: 100, ruler_minor: 50, marker_radius_pt: 40, marker_width: 3 }));
const pageJobs = [...pageSize].map(([n, s]) => ({ out: path.join(r1, `pages/page-${n}.png`), page: n, x0: 0, y0: 0, w: s[0], h: s[1], marker: null, label: "", ruler: true, ruler_step: 100, ruler_minor: 50 }));
mkdirSync(r1, { recursive: true });
writeJson(path.join(out, ".render-jobs.json"), { pdf, dpi: DPI, jobs });
writeJson(path.join(out, ".render-context.json"), { pdf, dpi: CONTEXT_DPI, jobs: ctxJobs });
writeJson(path.join(out, ".render-pages.json"), { pdf, dpi: 150, jobs: pageJobs });
for (const j of [".render-jobs.json", ".render-context.json", ".render-pages.json"]) execFileSync("python3", ["-I", path.join(REPO, "scripts/accuracy/mq/render_crops.py"), path.join(out, j)], { stdio: "inherit" });

// ── reviewer packages ───────────────────────────────────────────────────────
const instructions = readFileSync(path.join(REPO, "docs/measurement-quality/REVIEWER-INSTRUCTIONS.md"), "utf8");
// page and marker_x/y are pre-filled locators (where the ringed text is); everything else is the reviewer's
const formCols = ["item_id", "reviewer_id", "reviewed_at", "page", "marker_x", "marker_y", "is_dimension", "printed_value", "unit", "line_a_x", "line_a_y", "line_b_x", "line_b_y",
  "end1_x", "end1_y", "end2_x", "end2_y", "element_kind", "end1_type", "element_end1", "end2_type", "element_end2", "evidence_sufficient", "ambiguous", "ambiguity_note", "confidence", "explanation"];
const R1_ID = a["r1-id"] ?? "R1", R2_ID = a["r2-id"] ?? "R2", ADJ_ID = a["adj-id"] ?? "ADJ";
const pkg = (dir: string, items: typeof reviewerItems, reviewer: string) => {
  mkdirSync(path.join(dir, "crops"), { recursive: true });
  mkdirSync(path.join(dir, "pages"), { recursive: true });
  if (dir !== r1) for (const it of items) for (const f of [it.crop.file, it.context.file]) copyFileSync(path.join(r1, f), path.join(dir, f));
  if (dir !== r1) for (const n of new Set(items.map((i) => i.page))) copyFileSync(path.join(r1, `pages/page-${n}.png`), path.join(dir, `pages/page-${n}.png`));
  copyFileSync(pdf, path.join(dir, path.basename(pdf)));
  writeJson(path.join(dir, "items.json"), { schema: "cunstruct.review-items.v1", dataset_id: manifest.dataset_id, drawing: { file: path.basename(pdf), sha256: pdfSha }, coordinate_system: "PDF points, top-left origin, y down (the ruler on every crop and page image)", items });
  writeText(path.join(dir, "review-form.csv"), toCsv(formCols, items.map((i) => [i.item_id, reviewer, "", i.page, i.marker_pt[0], i.marker_pt[1], ...Array(formCols.length - 6).fill("")])));
  writeText(path.join(dir, "items.js"), `window.REVIEW_ITEMS = ${JSON.stringify({ reviewer_id: reviewer, drawing: { file: path.basename(pdf), sha256: pdfSha }, items })};\n`);
  for (const f of ["review-app.html", "review-app.js"]) copyFileSync(path.join(REPO, "scripts/accuracy/mq/review-app", f), path.join(dir, f));
  writeJson(path.join(dir, "review-response.schema.json"), { $comment: "Zod source: src/lib/measurement-quality/reviewPackages.ts (ReviewResponse)", schema: REVIEW_RESPONSE_SCHEMA, fields: Object.keys(ReviewResponse.shape) });
  writeText(path.join(dir, "REVIEWER-INSTRUCTIONS.md"), instructions.replace(/\{\{REVIEWER\}\}/g, reviewer).replace(/\{\{N\}\}/g, String(items.length)).replace(/\{\{DRAWING\}\}/g, path.basename(pdf)));
};
pkg(r1, reviewerItems, R1_ID);
const secondIds = new Set(second.items.map((o) => o.item_id));
const r2Items = shuffle(reviewerItems.filter((i) => secondIds.has(i.item_id)), mulberry32(seed + 4));
pkg(r2, r2Items, R2_ID);

// ── coordinator materials (not for reviewers; no engine data) ───────────────
const coord = path.join(out, "COORDINATOR");
writeJson(path.join(coord, "roster.json"), { schema: "cunstruct.review-roster.v1", reviewers: [
  { id: R1_ID, role: "reviewer-1", independent: true, assigned: reviewerItems.map((i) => i.item_id) },
  { id: R2_ID, role: "reviewer-2", independent: true, assigned: r2Items.map((i) => i.item_id) },
  { id: ADJ_ID, role: "adjudicator", independent: true, assigned: [] },
] });
writeJson(path.join(coord, "submissions.json"), { schema: "cunstruct.review-submissions.v1", submissions: [] });
copyFileSync(path.join(REPO, "docs/measurement-quality/REVIEW-OPERATING-PROCEDURE.md"), path.join(coord, "REVIEW-OPERATING-PROCEDURE.md"));

// ── secret answer key ───────────────────────────────────────────────────────
writeJson(path.join(sec, "answer-key.json"), { schema: "cunstruct.review-answer-key.v1", WARNING: "Never give this file to a reviewer.", seed, drawing_sha256: pdfSha, entries: key });
const S = (s: typeof C) => ({ method: s.method, seed: s.seed, strata: s.strata });
writeJson(path.join(sec, "sampling.json"), {
  seed, packages: {
    A: { definition: "every accepted measurement in the engine output", population: A.length, sampled: A.length },
    B: { definition: "every Gold Set measurement the engine did not accept (held or rejected)", population: B.length, sampled: B.length, held: B.filter((d) => d.decisions.overall === "hold").length, rejected: B.filter((d) => d.decisions.overall === "reject").length },
    C: { definition: "stratified sample of held measurements outside the Gold Set; primary key = primary failure reason; secondary = page, orientation, measured-element type, scale region", population: heldPool.length, sampled: C.items.length, ...S(C) },
    D: { definition: "stratified sample of rejected measurements outside the Gold Set; primary key = primary failure reason; secondary = page, orientation", population: rejPool.length, sampled: D.items.length, ...S(D) },
  },
  second_reviewer: { definition: "stratified by package over all packaged items", n: second.items.length, ...S(second as unknown as typeof C), item_ids: [...secondIds].sort() },
  estimation_note: "Packages A and B are censuses. C and D are stratified samples: any statement about the whole held or rejected population must weight each reviewed item by 1 / its stratum's inclusion probability and report the sampling uncertainty; unweighted C/D rates describe the sample only.",
});
console.log(`packages A ${A.length}, B ${B.length}, C ${C.items.length}/${heldPool.length}, D ${D.items.length}/${rejPool.length}; reviewer-1 ${reviewerItems.length} items, reviewer-2 ${secondIds.size}; seed ${seed}`);
