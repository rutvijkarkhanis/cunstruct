import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// The lab must never change an engine, and production must never reach the lab's engines.
// Each frozen engine is a byte-identical copy of the original commit's src/lib/review files
// (sha256 of `git show <commit>:src/lib/review/<file>`); all their imports are relative, so no
// line was rewritten. These checks pin both copies.
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const root = process.cwd();
const BASE = "src/lib/measurement-lab/baselines";
const PINNED: Record<string, { commit: string; files: Record<string, string> }> = {
  "engine-1de95f6": {
    commit: "1de95f68f45abed3f8322cb04d786fe707a3f348",
    files: {
      "drawingGeometry.ts": "fecdd86cb84e2f6748e2d02bb9927372a07f84ddddb008f3edfcc771dd77f458",
      "drawingInventory.ts": "7da9cba192738478e40082b98bbc526e6b3039a289adc4ab622f37311f6d52a2",
      "linearDimensions.ts": "ffd5cbec4ee9c20f38624cbba77d23649607ca661ae90eb25948487b2a0b2f8a",
      "pdfGeometry.ts": "19f916d18de24475bef5863f7a47c10de263e7828121ece58cd4ffa0056f1a44",
      "roomDimensionReconciliation.ts": "494f60b7d8dc18f758f6791476ef0f2c345227a8af2d0411ce1000c05561c14d",
    },
  },
  "engine-9ac1f71": {
    commit: "9ac1f71ee1df63cf3a6bec9ac98f58ab68a5fe11",
    files: {
      "dimensionAssociation.ts": "cce70229e7a2453f528340e35491de7de53db1e7b3b32a8253e17b2f83ffef3a",
      "dimensionTerminators.ts": "1d0def8d16840529b22478734fd317dab164f89e208f28c73f95a09de59d870e",
      "drawingGeometry.ts": "fecdd86cb84e2f6748e2d02bb9927372a07f84ddddb008f3edfcc771dd77f458",
      "drawingInventory.ts": "7da9cba192738478e40082b98bbc526e6b3039a289adc4ab622f37311f6d52a2",
      "linearDimensions.ts": "7775e5ab643c32ed2b02144f1d8c7ba17ef48509204bb2d90d416688272abc17",
      "pdfGeometry.ts": "746e4397040db249a1c75aa06c643f7e24d481bf138bac72625b563b132619a3",
      "roomDimensionReconciliation.ts": "494f60b7d8dc18f758f6791476ef0f2c345227a8af2d0411ce1000c05561c14d",
    },
  },
};
const walk = (d: string, out: string[] = []) => {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (f === "node_modules" || f.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(f)) out.push(p);
  }
  return out;
};
// Static imports/re-exports (statement start, may span lines) and dynamic import(); comments are not matched.
const specifiers = (src: string) => [
  ...[...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1]),
  ...[...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
];
const LAB_UI = ["MeasurementLabPanel.tsx", "MeasurementLabLauncher.tsx", "BlindReferenceCapture.tsx"];

describe("frozen engines", () => {
  it("each copy is byte-identical to its original commit, and the manifest agrees", () => {
    for (const [dir, { commit, files }] of Object.entries(PINNED)) {
      const manifest = JSON.parse(readFileSync(path.join(root, BASE, dir, "FROZEN.json"), "utf8"));
      expect(manifest.source_commit, dir).toBe(commit);
      expect(manifest.files, dir).toEqual(files);
      const present = readdirSync(path.join(root, BASE, dir)).filter((f) => f.endsWith(".ts")).sort();
      expect(present, dir).toEqual(Object.keys(files).sort());
      for (const [f, want] of Object.entries(files)) expect(sha(readFileSync(path.join(root, BASE, dir, f))), `${dir}/${f}`).toBe(want);
    }
  });
  it("each copy is self-contained: it imports only its own files and pdfjs-dist", () => {
    for (const [dir, { files }] of Object.entries(PINNED)) {
      for (const f of Object.keys(files)) {
        for (const s of specifiers(readFileSync(path.join(root, BASE, dir, f), "utf8"))) {
          const ok = s === "pdfjs-dist" || (s.startsWith("./") && `${s.slice(2)}.ts` in files);
          expect(ok, `${dir}/${f} imports ${s}`).toBe(true);
        }
      }
    }
  });
  it("nothing outside the lab imports a frozen engine (the production pipeline cannot reach them)", () => {
    const outside = walk(path.join(root, "src")).filter((f) => !f.includes(`${path.sep}measurement-lab${path.sep}`) && !f.includes(`${path.sep}measurement-quality${path.sep}`) && !LAB_UI.some((u) => f.endsWith(`${path.sep}review${path.sep}${u}`) || f.endsWith(`${path.sep}review${path.sep}${u.replace(".tsx", ".test.tsx")}`)));
    const bad = outside.filter((f) => specifiers(readFileSync(f, "utf8")).some((s) => s.includes("measurement-lab/baselines") || s.includes("measurement-lab/core"))).map((f) => path.relative(root, f));
    expect(bad).toEqual([]);
  });
  it("the lab never reaches the BOQ, pricing, exports, analysis runs, apply-review or the production engine", () => {
    const files = walk(path.join(root, "src/lib/measurement-lab")).filter((f) => !/\.test\./.test(f));
    files.push(...LAB_UI.map((f) => path.join(root, "src/components/review", f)));
    const forbidden = /^(@\/lib\/review\/(?!analysisSchemaV1$)|.*(applyReview|reviewStore|boq|Boq|pricing|tenderExport|analysisClient|measuredQuantities|integrations\/supabase|untypedDb))/;
    const bad = files.flatMap((f) => specifiers(readFileSync(f, "utf8")).filter((s) => forbidden.test(s)).map((s) => `${path.relative(root, f)} -> ${s}`));
    expect(bad).toEqual([]);
  });
});
