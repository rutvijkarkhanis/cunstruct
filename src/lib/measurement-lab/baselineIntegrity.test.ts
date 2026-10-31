import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// The lab must never change an engine. These checks pin both engines' sources.
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("engine sources are pinned", () => {
  it("the 1de95f6 copies are the original commit's files, apart from the header and import specifiers", () => {
    // sha256 of `git show 1de95f6:src/lib/review/<file>.ts`
    const ORIGINAL = { linearDimensions: "ffd5cbec4ee9c20f38624cbba77d23649607ca661ae90eb25948487b2a0b2f8a", pdfGeometry: "19f916d18de24475bef5863f7a47c10de263e7828121ece58cd4ffa0056f1a44" };
    for (const [name, want] of Object.entries(ORIGINAL)) {
      let s = read(`src/lib/measurement-lab/baselines/engine-1de95f6/${name}.ts`);
      s = s.replace(/^(\/\/ .*\n){4}/, "") // the 4-line FROZEN COPY header
        .replace('from "@/lib/review/drawingGeometry"', 'from "./drawingGeometry"').replace('from "@/lib/review/drawingGeometry"', 'from "./drawingGeometry"')
        .replace('from "@/lib/review/drawingInventory"', 'from "./drawingInventory"');
      expect(sha(s), name).toBe(want);
    }
  });
  it("the current engine's four core files still carry their frozen hashes", () => {
    const FROZEN = {
      "src/lib/review/linearDimensions.ts": "7775e5ab643c32ed2b02144f1d8c7ba17ef48509204bb2d90d416688272abc17",
      "src/lib/review/dimensionTerminators.ts": "1d0def8d16840529b22478734fd317dab164f89e208f28c73f95a09de59d870e",
      "src/lib/review/dimensionAssociation.ts": "cce70229e7a2453f528340e35491de7de53db1e7b3b32a8253e17b2f83ffef3a",
      "src/lib/review/pdfGeometry.ts": "746e4397040db249a1c75aa06c643f7e24d481bf138bac72625b563b132619a3",
    };
    for (const [f, want] of Object.entries(FROZEN)) expect(sha(readFileSync(path.join(root, f))), f).toBe(want);
  });
  it("the lab never reaches the BOQ, pricing, exports, analysis runs or apply-review", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) files.push(p); } };
    walk(path.join(root, "src/lib/measurement-lab"));
    files.push(...["MeasurementLabPanel.tsx", "MeasurementLabLauncher.tsx", "BlindReferenceCapture.tsx"].map((f) => path.join(root, "src/components/review", f)));
    const forbidden = /from\s+["'][^"']*(applyReview|reviewStore|boq|Boq|pricing|tenderExport|analysisClient|measuredQuantities|integrations\/supabase|untypedDb)[^"']*["']/;
    const bad = files.filter((f) => forbidden.test(readFileSync(f, "utf8"))).map((f) => path.relative(root, f));
    expect(bad).toEqual([]);
  });
});
