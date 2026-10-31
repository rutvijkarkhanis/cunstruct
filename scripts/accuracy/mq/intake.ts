// PDF intake diagnostic: inspects a dataset's PDFs without modifying them.
//   npx vite-node --root . scripts/accuracy/mq/intake.ts --manifest <dataset.manifest.json> --root <dir holding the files> --out <dir> [--max-pages N]
// Refuses a dataset whose role does not permit intake (a holdout is never opened), and any file whose
// SHA-256 differs from the manifest. Writes intake.json and INTAKE.md; never edits the manifest.
import path from "node:path";
import { existsSync } from "node:fs";
import { assertUsable, DatasetManifest } from "@/lib/measurement-quality/datasetManifest";
import { args, assertOutsideRepo, need, readJson, sha256File, writeJson, writeText } from "./common";
import { intakePdf, type DocIntake } from "./intakeLib";

const a = args();
const m = DatasetManifest.parse(readJson(need(a, "manifest")));
assertUsable(m, "intake-diagnostic");
const root = need(a, "root"), out = need(a, "out");
assertOutsideRepo(out);
const docs: (DocIntake | { file: string; error: string })[] = [];
for (const f of m.files) {
  if (!f.name.toLowerCase().endsWith(".pdf")) continue;
  const p = path.join(root, f.name);
  if (f.status === "pending" || !existsSync(p)) { docs.push({ file: f.name, error: "not supplied" }); continue; }
  const sha = sha256File(p);
  if (sha !== f.sha256) { docs.push({ file: f.name, error: `SHA-256 mismatch: manifest ${f.sha256} file ${sha}; not processed` }); continue; }
  docs.push(await intakePdf(p, sha, { outOfDomain: m.role === "out-of-domain", maxPages: a["max-pages"] ? Number(a["max-pages"]) : undefined }));
}
const h = writeJson(path.join(out, "intake.json"), { schema: "cunstruct.intake.v1", dataset_id: m.dataset_id, role: m.role, docs });
const L = [`# Intake diagnostic — ${m.dataset_id} (role: ${m.role})`, "", `intake.json sha256 ${h.slice(0, 16)}…. Read-only; nothing was modified.`, "",
  "| file | pages | producer / creator | OCGs | class | vector-measurement suitable | notes |", "|---|---|---|---|---|---|---|"];
for (const d of docs) {
  if ("error" in d) { L.push(`| ${d.file} | | | | | | ${d.error} |`); continue; }
  L.push(`| ${d.file} | ${d.pages} | ${d.producer ?? "?"} / ${d.creator ?? "?"} | ${d.optional_content_groups} | ${d.class} | ${d.suitable_for_vector_measurement_validation ? "yes" : "no"} | ${d.reasons.join("; ")} |`);
}
L.push("", "## Per page", "", "| file | page | size pt | rot | text runs | numeric | vector segs | images (dpi, cover) | transforms (rot/skew) | forms | OC marks | scale notes | class |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const d of docs) if (!("error" in d)) for (const p of d.page_reports)
  L.push(`| ${d.file} | ${p.page} | ${p.size_pt.join("×")} | ${p.rotation} | ${p.text_runs} | ${p.numeric_texts} | ${p.vector_segments} | ${p.images.map((i) => `${i.dpi}dpi ${(i.page_cover * 100).toFixed(0)}%`).join(", ") || "none"} | ${p.transforms} (${p.rotated_or_skewed_ctm}) | ${p.form_xobjects} | ${p.marked_content_oc} | ${p.scale_notes.join(" / ").slice(0, 80)} | ${p.class} |`);
L.push("", "## Caveats", ...[...new Set(docs.flatMap((d) => ("caveats" in d ? d.caveats.map((c) => `- ${d.file}: ${c}`) : [])))]);
writeText(path.join(out, "INTAKE.md"), L.join("\n") + "\n");
console.log(`${m.dataset_id}: ${docs.map((d) => `${d.file}=${"error" in d ? d.error : d.class}`).join("  ")}`);
