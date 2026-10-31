// Validation runner: runs the FROZEN engine on a dataset and scores it against its prepared references.
//   npx vite-node --root . scripts/accuracy/mq/validate.ts --manifest <dataset.manifest.json> --purpose <validation|development-benchmark|release-holdout>
//     --root <dir holding the dataset's files> --reference <reference file> --freeze <ENGINE-FREEZE-MANIFEST.json> --out <dir>
//     [--review-seed <int>]   (also build blinded reviewer packages for each drawing)
// Refuses: a purpose the dataset's role forbids; an engine that differs from the freeze manifest; a
// reference or drawing whose hash differs from the manifest; a missing file. Proves afterwards that
// neither the engine nor the reference changed during the run.
import path from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { assertUsable, DatasetManifest, Purpose } from "@/lib/measurement-quality/datasetManifest";
import { buildLedger, type LedgerRow, type ReferenceDimension } from "@/lib/measurement-quality/ledger";
import { checkAccounting, computeMetrics, type Metric } from "@/lib/measurement-quality/metrics";
import { fromGoldSet, fromR0, type R0Case } from "@/lib/measurement-quality/referenceAdapters";
import { classifyFailure } from "@/lib/measurement-quality/failureReasons";
import { args, assertOutsideRepo, need, readJson, REPO, sha256File, writeJson, writeText } from "./common";
import { freezeManifest } from "./fingerprint";
import { runEngine } from "./engineRunner";

const a = args();
const out = need(a, "out");
assertOutsideRepo(out);
const manifest = DatasetManifest.parse(readJson(need(a, "manifest")));
const purpose = Purpose.parse(need(a, "purpose"));
const frozen = readJson<ReturnType<typeof freezeManifest>>(need(a, "freeze"));
const before = freezeManifest();
if (before.candidate.fingerprint !== frozen.candidate.fingerprint) {
  const changed = before.engine_files.filter((f) => frozen.engine_files.find((o) => o.file === f.file)?.sha256 !== f.sha256).map((f) => f.file);
  throw new Error(`engine differs from the freeze manifest (${changed.join(", ") || "file set changed"}): a validation run needs the frozen candidate`);
}
assertUsable(manifest, purpose, { engineFingerprint: before.candidate.fingerprint });

const refPath = need(a, "reference");
const refSha = sha256File(refPath);
if (manifest.annotations.reference_sha256 && refSha !== manifest.annotations.reference_sha256) throw new Error(`reference ${path.basename(refPath)} has sha256 ${refSha}, manifest says ${manifest.annotations.reference_sha256}`);
const refJson = readJson<Record<string, unknown>>(refPath);
const root = need(a, "root");

// a "pending" file counts as supplied once it exists under --root; its full SHA-256 is checked below
const missing = manifest.files.filter((f) => f.name.toLowerCase().endsWith(".pdf") && !existsSync(path.join(root, f.name)));
const inScope = manifest.files.filter((f) => f.pages_in_scope?.length);
const blocking = missing.filter((f) => inScope.includes(f));
if (blocking.length) throw new Error(`files not supplied: ${blocking.map((f) => `${f.name} (sha256 ${f.sha256})`).join(", ")} — see the dataset's acquisition instructions`);

const runs: { file: string; sha256: string; pages: number[]; ledger: LedgerRow[]; dims: number; outcome: Record<string, number> }[] = [];
for (const f of inScope) {
  const p = path.join(root, f.name), sha = sha256File(p);
  if (sha !== f.sha256) throw new Error(`${f.name}: sha256 ${sha} differs from the manifest (${f.sha256})`);
  const refs: ReferenceDimension[] = "items" in refJson ? fromGoldSet(refJson as never).filter((r) => r.sha256 === sha) : fromR0(refJson as unknown as R0Case, { name: f.name, sha256: sha });
  const { pages } = await runEngine(p, f.pages_in_scope!);
  writeJson(path.join(out, `engine-output-${f.name}.json`), pages, 0);
  const ledger = buildLedger(refs, pages);
  const all = pages.flatMap((q) => q.dimensions);
  runs.push({ file: f.name, sha256: sha, pages: f.pages_in_scope!, ledger, dims: all.length, outcome: all.reduce<Record<string, number>>((m, d) => ({ ...m, [d.decisions.overall]: (m[d.decisions.overall] ?? 0) + 1 }), {}) });
  if (a["review-seed"]) execFileSync("npx", ["vite-node", "--root", ".", "scripts/accuracy/mq/makeReviewPackages.ts", "--engine", path.join(out, `engine-output-${f.name}.json`), "--ledger", path.join(out, "ledger.json"),
    "--pdf", p, "--manifest", need(a, "manifest"), "--seed", a["review-seed"], "--out", path.join(out, `review-${f.name}`)], { cwd: REPO, stdio: "inherit" });
}
const ledger = runs.flatMap((r) => r.ledger);
const metrics = computeMetrics(ledger);
const violations = checkAccounting(ledger, ledger.map((r) => r.measurement_id), metrics);
writeJson(path.join(out, "ledger.json"), { schema: "cunstruct.measurement-ledger.v1", rows: ledger });
writeJson(path.join(out, "metrics.json"), { schema: "cunstruct.measurement-metrics.v1", metrics });

// nothing changed during the run
const after = freezeManifest();
const unchanged = after.candidate.fingerprint === before.candidate.fingerprint && sha256File(refPath) === refSha;
const record = {
  schema: "cunstruct.validation-run.v1", dataset_id: manifest.dataset_id, role: manifest.role, purpose,
  engine: { candidate_fingerprint: before.candidate.fingerprint, core_four: before.core_four.fingerprint, base_commit: before.git.base_commit },
  reference: { file: path.basename(refPath), sha256: refSha, independent: manifest.annotations.independent, provenance: manifest.annotations.provenance },
  drawings: runs.map((r) => ({ file: r.file, sha256: r.sha256, pages: r.pages, dimensions: r.dims, decisions: r.outcome })),
  accounting: { ok: violations.length === 0, violations }, engine_and_reference_unchanged: unchanged, ran_at: new Date().toISOString(),
};
writeJson(path.join(out, "run-record.json"), record);

const M = (id: string) => metrics.find((m) => m.id === id) as Metric;
const f = (id: string) => { const m = M(id); return `${m.numerator}/${m.denominator}`; };
const L = [
  `# Validation run — ${manifest.dataset_id} (${manifest.role}, purpose: ${purpose})`, "",
  `Engine: frozen candidate ${before.candidate.fingerprint.slice(0, 16)}… (core four ${before.core_four.fingerprint.slice(0, 8)}…), verified equal to the freeze manifest before and after the run: ${unchanged ? "yes" : "NO"}.`,
  `Reference: ${path.basename(refPath)} (sha256 ${refSha.slice(0, 16)}…) — ${manifest.annotations.independent ? "INDEPENDENT" : "NOT independent"}: ${manifest.annotations.provenance}.`,
  `Drawings: ${runs.map((r) => `${r.file} p${r.pages.join(",")} (${r.dims} dimensions: ${Object.entries(r.outcome).map(([k, v]) => `${k} ${v}`).join(", ")})`).join("; ")}.`,
  `Accounting: ${violations.length ? `${violations.length} VIOLATIONS` : "PASS"}.`, "",
  "| stage | metric | count / denominator |", "|---|---|---|",
  ...metrics.filter((m) => m.numerator !== null).map((m) => `| ${m.stage} | ${m.id} | ${m.numerator}/${m.denominator} (${m.basis}) |`),
  "", `Key figures: detected ${f("detection.found")}; correct endpoint pairs ${f("endpoints.correct-pair")}; correct associations ${f("association.correct")} (not scored when the reference states no element: ${f("association.associated-unscored")} unscored); accepted ${f("decision.acceptable")}; incorrectly accepted ${f("final.incorrectly-accepted")}.`,
  "", "Primary failure reasons (all non-accepted engine dimensions on the scored pages):",
];
const reasons: Record<string, number> = {};
for (const r of runs) for (const d of readJson<{ dimensions: never[] }[]>(path.join(out, `engine-output-${r.file}.json`)).flatMap((p) => p.dimensions)) { const c = classifyFailure(d); if (c) reasons[c.primary] = (reasons[c.primary] ?? 0) + 1; }
L.push(...Object.entries(reasons).sort((x, y) => y[1] - x[1]).map(([k, v]) => `- ${k}: ${v}`));
L.push("", manifest.role === "development" ? "This is DEVELOPMENT data: these figures are not validation." : "This run is a validation result. Record it before any change of role (docs/measurement-quality/DATASETS.md, promotion rules).");
writeText(path.join(out, "VALIDATION-REPORT.md"), L.join("\n") + "\n");
console.log(`${manifest.dataset_id}: ${ledger.length} references; accepted ${f("decision.acceptable")}, incorrectly accepted ${f("final.incorrectly-accepted")}; accounting ${violations.length ? "FAIL" : "PASS"}; unchanged ${unchanged}`);
if (violations.length || !unchanged) process.exit(1);
