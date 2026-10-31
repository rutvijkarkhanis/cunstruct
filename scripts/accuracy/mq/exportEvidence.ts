// Converts a frozen engine run into measurement-evidence v1 records (one JSON object per line) and
// validates every record against the contract. Nothing is sent anywhere; no product code runs.
//   npx vite-node --root . scripts/accuracy/mq/exportEvidence.ts --engine <engine-output.json> --pdf <drawing.pdf> --out <file.jsonl> [--ledger <ledger.json>]
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { PageDimensions } from "@/lib/review/linearDimensions";
import type { LedgerRow } from "@/lib/measurement-quality/ledger";
import { evidenceFromEngine, MeasurementEvidenceV1 } from "@/lib/measurement-quality/evidenceContract";
import { args, assertOutsideRepo, need, readJson, sha256File, writeText } from "./common";
import { freezeManifest } from "./fingerprint";

const a = args();
const out = need(a, "out");
assertOutsideRepo(out);
const pdf = need(a, "pdf"), sha = sha256File(pdf);
const pages = readJson<PageDimensions[]>(need(a, "engine"));
const views = new Map((a.ledger ? readJson<{ rows: LedgerRow[] }>(a.ledger).rows : []).filter((r) => r.engine).map((r) => [r.engine!.id, r.view]));
const fm = freezeManifest();
const size = (n: number): [number, number] => { const m = new RegExp(`Page\\s+${n} size:\\s+([\\d.]+) x ([\\d.]+)`).exec(execFileSync("pdfinfo", ["-f", String(n), "-l", String(n), pdf], { encoding: "utf8" }))!; return [Number(m[1]), Number(m[2])]; };
const lines: string[] = [];
let bad = 0;
for (const p of pages) {
  const ps = size(p.page);
  for (const d of p.dimensions) {
    const e = evidenceFromEngine(d, { file_name: path.basename(pdf), file_sha256: sha, view: views.get(d.id) ?? null, page_size_pt: ps, candidate_fingerprint: fm.candidate.fingerprint, core_fingerprint: fm.core_four.fingerprint });
    const ok = MeasurementEvidenceV1.safeParse(JSON.parse(JSON.stringify(e))).success;
    if (!ok) bad++;
    lines.push(JSON.stringify(e));
  }
}
writeText(out, lines.join("\n") + "\n");
console.log(`${lines.length} evidence records, ${bad} failing the contract → ${out}`);
if (bad) process.exit(1);
