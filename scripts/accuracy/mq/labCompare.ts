// Measurement Lab, headless: runs BOTH engines (recovered 1de95f6, current 9ac1f71) on one drawing with
// the same core the in-app lab uses, freezes both runs, and writes the comparison report.
//   npx vite-node --root . scripts/accuracy/mq/labCompare.ts --pdf <drawing.pdf> --pages 1,3,4 [--reference <gold-set.json>] --out <private dir> [--repeat]
// --repeat runs each engine twice and fails unless both runs hash identically.
import path from "node:path";
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildLabReport, freezeRun, runEngineOn, sha256Hex, verifyLog, type EngineId, type FrozenRun } from "@/lib/measurement-lab/core";
import { fromGoldSet } from "@/lib/measurement-quality/referenceAdapters";
import { args, assertOutsideRepo, need, writeJson, writeText } from "./common";

const a = args();
const out = need(a, "out");
assertOutsideRepo(out);
const pdfPath = need(a, "pdf"), bytes = new Uint8Array(readFileSync(pdfPath));
const sha = await sha256Hex(bytes);
const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
const pages = a.pages ? a.pages.split(",").map(Number) : Array.from({ length: doc.numPages }, (_, i) => i + 1);
const input = { name: path.basename(pdfPath), sha256: sha, pages };
const runs: FrozenRun[] = [];
for (const id of ["engine-1de95f6", "engine-9ac1f71"] as EngineId[]) {
  const r = await freezeRun(id, input, await runEngineOn(id, doc as never, pages));
  if (a.repeat) {
    const again = await freezeRun(id, input, await runEngineOn(id, doc as never, pages));
    if (again.output_sha256 !== r.output_sha256 || again.raw_output_sha256 !== r.raw_output_sha256) throw new Error(`${id}: repeated run differs`);
    console.log(`${id}: repeated run identical (${r.output_sha256.slice(0, 16)}…)`);
  }
  writeJson(path.join(out, `${id}.frozen-run.json`), r, 0);
  runs.push(r);
}
let reference;
if (a.reference) {
  const raw = readFileSync(a.reference);
  const j = JSON.parse(raw.toString("utf8"));
  reference = { name: path.basename(a.reference), sha256: await sha256Hex(new Uint8Array(raw)), type: String(j.reference_type ?? "unknown provenance"), items: fromGoldSet(j).filter((r) => r.sha256 === sha) };
}
const log: never[] = [];
const report = buildLabReport({ drawing: input, runs: [runs[0], runs[1]], reference, log, logIntact: (await verifyLog(log)) === null });
writeJson(path.join(out, "lab-report.json"), report.json);
writeText(path.join(out, "LAB-REPORT.md"), report.markdown);
console.log(runs.map((r) => `${r.engine.id}: ${r.measurements.length} (acc ${r.counts.accepted}, held ${r.counts.held}, rej ${r.counts.rejected})`).join("  |  "));
