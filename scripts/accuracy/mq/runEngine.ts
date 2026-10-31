// Runs the FROZEN measurement engine on one PDF and writes its raw output plus a run record.
//   npx vite-node --root . scripts/accuracy/mq/runEngine.ts --pdf <file.pdf> --pages 1,3,4 --out <dir>
// engine-output.json is deterministic (timings go to run-record.json), so equal inputs give equal hashes.
import path from "node:path";
import { args, assertOutsideRepo, need, sha256File, writeJson } from "./common";
import { freezeManifest } from "./fingerprint";
import { runEngine } from "./engineRunner";

const a = args();
const pdf = need(a, "pdf"), dir = need(a, "out");
assertOutsideRepo(dir);
const pages = a.pages && a.pages !== "all" ? a.pages.split(",").map(Number) : "all";
const { pages: result, ms } = await runEngine(pdf, pages);
const outHash = writeJson(path.join(dir, "engine-output.json"), result, 0);
const fm = freezeManifest();
writeJson(path.join(dir, "run-record.json"), {
  schema: "cunstruct.engine-run.v1",
  input: { file: path.basename(pdf), sha256: sha256File(pdf), pages: result.map((p) => p.page) },
  engine: { candidate_fingerprint: fm.candidate.fingerprint, core_four: fm.core_four.fingerprint, base_commit: fm.git.base_commit },
  output: { file: "engine-output.json", sha256: outHash, dimensions: result.reduce((s, p) => s + p.dimensions.length, 0) },
  timing_ms: Object.fromEntries(result.map((p, i) => [p.page, ms[i]])),
  started: new Date().toISOString(),
});
console.log(`engine output ${outHash}  (${result.map((p) => `p${p.page}:${p.dimensions.length}`).join(" ")})  candidate ${fm.candidate.fingerprint.slice(0, 12)}`);
