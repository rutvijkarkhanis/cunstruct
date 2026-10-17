// Benchmark inputs (drawings, QS deliverables, gold references, scoring output)
// must never be committable. Asks git itself, via `git check-ignore --no-index`,
// so the result is what `git add` would do, whether or not a file exists.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function ignored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "--no-index", "-q", path], { stdio: "ignore" });
    return true; // exit 0: ignored
  } catch (e) {
    if ((e as { status?: number }).status === 1) return false; // exit 1: not ignored
    throw e;
  }
}

const MUST_BE_IGNORED = [
  // Drawings as received, any format or case
  "benchmark-inputs/E1/S01/drawings/S01.pdf",
  "benchmark-inputs/E1/S01/drawings/S01.PDF",
  "benchmark-inputs/E1/S01/drawings/GA-101.dwg",
  "benchmark-inputs/E1/S01/drawings/GA-101.dxf",
  "benchmark-inputs/E1/S01/drawings/scan-01.tif",
  "benchmark-inputs/E1/S01/drawings/scan-01.TIFF",
  "benchmark-inputs/E1/S01/drawings/photo.jpg",
  "benchmark-inputs/E1/S01/drawings/sheet.png",
  "benchmark-inputs/E1/S01/drawings/set.zip",
  "benchmark-inputs/E1/S01/SHA256SUMS",
  "benchmark-inputs/E1/S01/permission/signed-permission.pdf",
  "benchmark-inputs/E1/S01/permission/email.eml",
  // QS deliverables: IS 1200 measurement sheets and scoring-format references
  "benchmark-inputs/E1/S01/qs-a/measurement-sheet.xlsx",
  "benchmark-inputs/E1/S01/qs-a/measurement-sheet.xls",
  "benchmark-inputs/E1/S01/qs-a/measurement-sheet.csv",
  "benchmark-inputs/E1/S01/qs-a/reference-boq.json",
  "benchmark-inputs/E1/S01/qs-b/reference-boq.json",
  "benchmark-inputs/E1/S01/qs-b/declaration.docx",
  // Adjudication and gold
  "benchmark-inputs/E1/S01/adjudication/adjudicated-measurement-sheet.xlsx",
  "benchmark-inputs/E1/S01/gold/reference-boq.gold.json",
  "benchmark-inputs/E1/S01/gold/disagreements.csv",
  "benchmark-inputs/E1/S01/contract-tags.json",
  // Engine output and scoring output
  "benchmark-inputs/E1/S01/engine-output/extractor-output.json",
  "benchmark-inputs/E1/S01/engine-output/drawing-S01.json",
  "benchmark-inputs/E1/manifest.json",
  "benchmark-inputs/E1/out/summary.json",
  "benchmark-inputs/E1/out/S01/metrics.json",
  "benchmark-inputs/E1/out/S01/gates.json",
  // Local register, and the same protection for any other benchmark folder
  "benchmark-inputs/E1/REGISTER.local.md",
  "benchmark-inputs/E1/S01/INPUTS.md",
  "benchmark-inputs/other-run/drawing.PDF",
  "benchmark-inputs/other-run/notes.md",
  "benchmark-inputs/stray.json",
];

const MUST_STAY_COMMITTABLE = [
  "benchmark-inputs/E1/INPUTS.md",
  "benchmark-inputs/external-20261013/INPUTS.md",
  "benchmark-inputs/external-20261013/engine-output/engine-version.sha256",
];

describe("benchmark inputs stay out of Git", () => {
  it.each(MUST_BE_IGNORED)("%s is ignored", (p) => {
    expect(ignored(p)).toBe(true);
  });

  it.each(MUST_STAY_COMMITTABLE)("%s is not ignored", (p) => {
    expect(ignored(p)).toBe(false);
  });
});
