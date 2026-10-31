// Engine freeze manifest: the complete frozen candidate (every source file the engine's code reaches,
// runtime and type-only), its configuration and dependency versions, and one combined fingerprint
// that identifies the candidate independently of the Git commit (the candidate has uncommitted work).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { REPO, sha256, sha256File } from "./common";

/** Entry points of the measurement engine: geometry/text extraction and dimension extraction. */
export const ENGINE_ENTRIES = ["src/lib/measurement-lab/baselines/engine-9ac1f71/pdfGeometry.ts", "src/lib/measurement-lab/baselines/engine-9ac1f71/linearDimensions.ts"];

/** The original four-file fingerprint (kept for continuity with earlier reports). */
export const CORE_FOUR = ["src/lib/measurement-lab/baselines/engine-9ac1f71/linearDimensions.ts", "src/lib/measurement-lab/baselines/engine-9ac1f71/dimensionTerminators.ts", "src/lib/measurement-lab/baselines/engine-9ac1f71/dimensionAssociation.ts", "src/lib/measurement-lab/baselines/engine-9ac1f71/pdfGeometry.ts"];

interface ClosureFile { file: string; sha256: string; reachedBy: "runtime" | "type-only" }

/** Follows relative and "@/" imports from the entries; bare package imports are recorded as dependencies. */
export function engineClosure(entries = ENGINE_ENTRIES): { files: ClosureFile[]; packages: string[] } {
  const files = new Map<string, "runtime" | "type-only">(), packages = new Set<string>();
  const queue: [string, "runtime" | "type-only"][] = entries.map((e) => [e, "runtime"]);
  while (queue.length) {
    const [f, how] = queue.shift()!;
    if (files.get(f) === "runtime" || (files.has(f) && how === "type-only")) continue;
    files.set(f, how);
    const src = readFileSync(path.join(REPO, f), "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)) {
      const spec = m[2], typeOnly = Boolean(m[1]) || how === "type-only";
      if (!spec.startsWith(".") && !spec.startsWith("@/")) { packages.add(spec); continue; }
      const base = spec.startsWith("@/") ? path.join("src", spec.slice(2)) : path.join(path.dirname(f), spec);
      const hit = [".ts", ".tsx", "/index.ts"].map((x) => base + x).find((x) => existsSync(path.join(REPO, x)));
      if (hit) queue.push([hit, typeOnly ? "type-only" : "runtime"]);
    }
  }
  return {
    files: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([file, reachedBy]) => ({ file, sha256: sha256File(path.join(REPO, file)), reachedBy })),
    packages: [...packages].sort(),
  };
}

const git = (...a: string[]) => { try { return execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" }).trim(); } catch { return null; } };

export function freezeManifest() {
  const { files, packages } = engineClosure();
  const pkg = (name: string) => { try { return JSON.parse(readFileSync(path.join(REPO, "node_modules", name, "package.json"), "utf8")).version as string; } catch { return null; } };
  const pdfjsBuild = "node_modules/pdfjs-dist/legacy/build/pdf.mjs";
  const config = ["package.json", "tsconfig.json", "tsconfig.app.json", "scripts/accuracy/vitest.config.ts"].filter((f) => existsSync(path.join(REPO, f)))
    .map((f) => ({ file: f, sha256: sha256File(path.join(REPO, f)) }));
  const combined = sha256(files.map((f) => `${f.sha256}  ${f.file}`).join("\n"));
  // historical rule (earlier reports' "c7c771d8…"): sha256 of the four files' contents concatenated in CORE_FOUR order
  const core4 = sha256(Buffer.concat(CORE_FOUR.map((f) => readFileSync(path.join(REPO, f)))));
  return {
    schema: "cunstruct.engine-freeze.v1",
    candidate: { fingerprint: combined, rule: "sha256 of the sorted lines '<sha256>  <path>' for every file in engine_files" },
    core_four: { fingerprint: core4, files: CORE_FOUR, rule: "sha256 of the four files concatenated in this order (the historical c7c771d8… rule)" },
    git: { base_commit: git("rev-parse", "HEAD"), branch: git("rev-parse", "--abbrev-ref", "HEAD"), uncommitted_engine_files: (git("status", "--porcelain", "--", ...files.map((f) => f.file)) ?? "").split("\n").filter(Boolean) },
    engine_files: files,
    engine_packages: packages.map((p) => ({ name: p, version: pkg(p.startsWith("@") ? p.split("/").slice(0, 2).join("/") : p.split("/")[0]) })),
    pdfjs_runtime_build: { file: pdfjsBuild, sha256: existsSync(path.join(REPO, pdfjsBuild)) ? sha256File(path.join(REPO, pdfjsBuild)) : null, version: pkg("pdfjs-dist") },
    configuration: config,
    runtime: { node: process.version, vite_node: pkg("vite-node"), vitest: pkg("vitest"), typescript: pkg("typescript"), platform: `${process.platform}-${process.arch}` },
    commands: {
      engine: "npx vite-node --root . scripts/accuracy/mq/runEngine.ts --pdf <file.pdf> --pages 1,3,4 --out <dir>",
      ledger: "npx vite-node --root . scripts/accuracy/mq/buildLedger.ts --engine <dir>/engine-output.json --gold <gold-set.json> --out <dir>",
      validation: "npx vite-node --root . scripts/accuracy/mq/validate.ts --manifest <dataset-manifest.json> --purpose <development|validation|release-holdout> --out <dir>",
    },
    not_covered: [
      "pdf.js text/geometry results can depend on the pdfjs-dist build; the build file hash above pins it.",
      "Node's floating point is IEEE-754 on every supported platform; outputs were verified identical across repeated runs on this machine only.",
    ],
  };
}
