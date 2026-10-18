// SYNTHETIC CONTROLS for the E1 intake check and the E1 → E2 hand-off. Every
// set, drawing, measurement sheet, reference, permission and attestation below
// is SYNTHETIC — written for these tests only. Nothing here is benchmark
// evidence, and no test here moves E1 or E2 towards DONE.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/integrations/supabase/client", async () => await import("@/lib/e2e/inMemorySupabase"));

import { REFERENCE_BOQ_SCHEMA, type ReferenceBoq } from "@/lib/e2e/boqReference";
import { seedCatalogue } from "@/lib/dsr/seedFixture";
import type { DsrIndex } from "@/lib/dsr/match";
import { buildPricingIndex } from "./metrics";
import { runManifest } from "./runner";
import { checkE1Portfolio, checkE1Root, checkE1Set, manifestFromE1, EXCLUDED_DRAWINGS, E1_SET_SCHEMA, LOCAL_EXCLUSIONS_FILE, type E1SetMeta, type SetIntake } from "./e1Intake";

const PAGE = { width: 595, height: 842 };
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const box = (x: number, y: number): [number, number, number, number] => [x, y, x + 30, y + 8];

/** A SYNTHETIC reference BOQ: two measured lines and one ambiguous line. */
function reference(drawingSha: string, prefix: string, by: string, kitchen: number): ReferenceBoq {
  const line = (id: string, item: string, unit: string, quantity: number | undefined, at: [number, number], extra = {}) => ({
    id: `${prefix}-${id}`, item, unit, ...(quantity == null ? {} : { quantity }), floor: "Ground Floor", sourcePage: 1,
    evidence: { page: 1, bbox: box(...at), pageSize: PAGE }, measurementRule: "SYNTHETIC: printed room tag", ...extra,
  });
  return {
    schema_version: REFERENCE_BOQ_SCHEMA, project: "SYNTHETIC E1 intake control (not a real project)",
    drawing: { sha256: drawingSha, pages: [1] }, preparedBy: by, preparedAt: "2026-10-18",
    preparedWithoutCunstructOutput: true, measurementConventions: "Synthetic.",
    lines: [
      line("KIT", "Floor area — Kitchen", "sqm", kitchen, [50, 50]),
      line("DR1", "Door D1", "nos", 4, [300, 250]),
      line("STO", "Floor area — Store", "sqm", undefined, [50, 250], { status: "ambiguous", note: "SYNTHETIC: tag illegible" }),
    ] as ReferenceBoq["lines"],
  };
}

const ANALYSIS = JSON.stringify({
  schema_version: "cunstruct.analysis.v1",
  items: [
    { key: "k-kit", item: "Floor area — Kitchen (Ground Floor)", quantity: 20, unit: "sqm", at: [50, 50] },
    { key: "k-dr1", item: "Door D1", quantity: 4, unit: "nos", at: [300, 250] },
  ].map((s) => ({
    key: s.key, item: s.item, quantity: s.quantity, unit: s.unit, location: "Ground Floor", status: "MEASURED", confidence: null,
    source: { document_id: "doc-synthetic", page: 1, evidence: [{ bbox: box(...(s.at as [number, number])), page: 1 }] },
  })),
});

const ATTESTED = {
  notAnExcludedDrawing: { by: "SYNTHETIC protocol owner", date: "2026-10-18" },
  engineOutputBeforeQsOpened: { by: "SYNTHETIC protocol owner", date: "2026-10-18" },
  qsSheetsComplete: { by: "SYNTHETIC protocol owner", date: "2026-10-18" },
  noMeasuredLineOnScaledRow: { by: "SYNTHETIC protocol owner", date: "2026-10-18" },
  contractTagsChecked: { by: "SYNTHETIC second checker", date: "2026-10-18" },
};

/** Write one complete SYNTHETIC set folder; `mutate` breaks it for a negative control. */
function writeSet(root: string, id: string, opts: Partial<E1SetMeta> & { skip?: string[]; goldBy?: string; tags?: Record<string, string>; tamper?: boolean; drawing?: Buffer } = {}) {
  const d = join(root, id);
  const w = (p: string, body: string | Buffer) => { mkdirSync(join(d, p, ".."), { recursive: true }); writeFileSync(join(d, p), body); };
  const skip = new Set(opts.skip ?? []);
  const drawing = opts.drawing ?? `SYNTHETIC drawing bytes for ${id} — not a real drawing`;
  const dsha = sha(drawing);
  w("drawings/set.pdf", drawing);
  w("SHA256SUMS", `${dsha}  drawings/set.pdf\n`);
  if (opts.tamper) w("drawings/set.pdf", drawing + " (edited after receipt)");
  if (!skip.has("permission")) w("permission/signed-permission.pdf", "SYNTHETIC permission");
  w("engine-output/analysis.json", ANALYSIS);
  w("engine-output/analysis.json.sha256", `${sha(ANALYSIS)}  analysis.json\n`);
  w("qs-a/measurement-sheet.xlsx", "SYNTHETIC sheet A");
  w("qs-a/reference-boq.json", JSON.stringify(reference(dsha, "A", "SYNTHETIC QS A", 20)));
  if (!skip.has("qs-b")) {
    w("qs-b/measurement-sheet.xlsx", "SYNTHETIC sheet B");
    w("qs-b/reference-boq.json", JSON.stringify(reference(dsha, "B", "SYNTHETIC QS B", 20.4)));
  }
  if (!skip.has("adjudication")) {
    w("adjudication/adjudicated-measurement-sheet.xlsx", "SYNTHETIC adjudicated sheet");
    w("adjudication/disagreements.csv", "SYNTHETIC log");
  }
  if (!skip.has("gold")) {
    w("gold/reference-boq.json", JSON.stringify(reference(dsha, "G", opts.goldBy ?? "SYNTHETIC adjudicator", 20)));
    w("gold/disagreements.csv", "SYNTHETIC log");
  }
  w("contract-tags.json", JSON.stringify(opts.tags ?? { "G-KIT": "in", "G-DR1": "in" }));
  const meta: E1SetMeta = {
    schema_version: E1_SET_SCHEMA, id, typology: opts.typology ?? "residential", modality: opts.modality ?? "vector",
    setAEligible: opts.setAEligible ?? true,
    permission: opts.permission ?? { status: "signed", signedBy: "SYNTHETIC owner", date: "2026-10-18" },
    attestations: opts.attestations ?? ATTESTED,
  };
  w("set.json", JSON.stringify(meta));
  return d;
}

const failing = (s: SetIntake) => s.checks.filter((c) => !c.ok).map((c) => c.id);

let root: string;
let ix: DsrIndex;
beforeAll(() => {
  ix = buildPricingIndex(seedCatalogue());
  root = mkdtempSync(join(tmpdir(), "e1-synthetic-"));
  return () => rmSync(root, { recursive: true, force: true });
});

describe("E1 set intake (kit §8) on SYNTHETIC set folders", () => {
  it("passes a complete set: permission, hashes, two QS, adjudication, gold by a third person, every measured gold line tagged", () => {
    const s = checkE1Set(writeSet(root, "S01"));
    expect(failing(s)).toEqual([]);
    expect(s.complete).toBe(true);
    expect(s.checks.map((c) => c.id)).toEqual([
      "register", "permission", "drawing", "engine-output", "qs-a", "qs-b", "qs-independent", "adjudication", "gold", "contract-tags",
      "attest:notAnExcludedDrawing", "attest:engineOutputBeforeQsOpened", "attest:qsSheetsComplete", "attest:noMeasuredLineOnScaledRow", "attest:contractTagsChecked",
    ]);
  });

  it("refuses a set without an adjudicated gold reference, a second QS, or an adjudicated measurement sheet", () => {
    expect(failing(checkE1Set(writeSet(root, "N-nogold", { skip: ["gold"] })))).toEqual(["gold", "contract-tags"]);
    expect(failing(checkE1Set(writeSet(root, "N-oneqs", { skip: ["qs-b"] })))).toEqual(["qs-b"]);
    expect(failing(checkE1Set(writeSet(root, "N-noadj", { skip: ["adjudication"] })))).toEqual(["adjudication"]);
  });

  it("refuses gold prepared by one of the two QS: the adjudicator must be a third person", () => {
    const s = checkE1Set(writeSet(root, "N-selfgold", { goldBy: "SYNTHETIC QS A" }));
    expect(failing(s)).toEqual(["gold"]);
    expect(s.checks.find((c) => c.id === "gold")!.detail).toMatch(/must be a third person/);
  });

  it("refuses untagged measured gold lines and tags for lines that are not measured gold lines", () => {
    expect(checkE1Set(writeSet(root, "N-untagged", { tags: { "G-KIT": "in" } })).checks.find((c) => c.id === "contract-tags")!.detail).toMatch(/1 measured gold line\(s\) untagged: G-DR1/);
    expect(failing(checkE1Set(writeSet(root, "N-qstags", { tags: { "A-KIT": "in", "A-DR1": "in" } })))).toEqual(["contract-tags"]);
  });

  it("refuses unsigned permission, a drawing edited after receipt, and missing attestations", () => {
    expect(failing(checkE1Set(writeSet(root, "N-perm", { permission: { status: "pending" } })))).toEqual(["permission"]);
    expect(failing(checkE1Set(writeSet(root, "N-noperm-file", { skip: ["permission"] })))).toEqual(["permission"]);
    expect(failing(checkE1Set(writeSet(root, "N-tamper", { tamper: true })))).toContain("drawing");
    expect(failing(checkE1Set(writeSet(root, "N-attest", { attestations: {} })))).toEqual([
      "attest:notAnExcludedDrawing", "attest:engineOutputBeforeQsOpened", "attest:qsSheetsComplete", "attest:noMeasuredLineOnScaledRow", "attest:contractTagsChecked",
    ]);
  });

  it("refuses a repository test fixture as a set's drawing (pilot package §A5, X7)", () => {
    const s = checkE1Set(writeSet(root, "N-fixture", { drawing: readFileSync(join(__dirname, "..", "..", "e2e", "fixtures", "document-a.pdf")) }));
    expect(failing(s)).toEqual(["drawing"]);
    expect(s.checks.find((c) => c.id === "drawing")!.detail).toMatch(/document-a\.pdf \(X7\).*excluded from E1/);
  });

  it("catches only exact copies by hash: a changed copy of an excluded drawing is held until a person signs the not-excluded check", () => {
    // The fixture with bytes appended after %%EOF: a different SHA-256, same drawing.
    const copy = Buffer.concat([readFileSync(join(__dirname, "..", "..", "e2e", "fixtures", "document-a.pdf")), Buffer.from("\n% SYNTHETIC appended\n")]);
    const { notAnExcludedDrawing: _omit, ...rest } = ATTESTED;
    const held = checkE1Set(writeSet(root, "N-copy", { drawing: copy, attestations: rest }));
    expect(held.checks.find((c) => c.id === "drawing")!.ok).toBe(true); // the hash check alone does not see it
    expect(failing(held)).toEqual(["attest:notAnExcludedDrawing"]);
    expect(held.complete).toBe(false);
    expect(manifestFromE1([held]).manifest.sets).toEqual([]); // never reaches E2 unsigned
  });

  it("refuses a drawing listed in the local, git-ignored exclusion register", () => {
    const r = mkdtempSync(join(tmpdir(), "e1-localx-"));
    const d = writeSet(r, "S01");
    const drawingSha = sha(readFileSync(join(d, "drawings", "set.pdf")));
    writeFileSync(join(r, LOCAL_EXCLUSIONS_FILE), `| SYNTHETIC app drawing | \`${drawingSha}\` |\n`);
    const { sets, localExclusions } = checkE1Root(r);
    expect(localExclusions).toBe(1);
    expect(failing(sets[0])).toEqual(["drawing"]);
    expect(sets[0].checks.find((c) => c.id === "drawing")!.detail).toContain(LOCAL_EXCLUSIONS_FILE);
  });

  it("knows the excluded drawings (kit §1.3)", () => {
    const hit = (s: string) => EXCLUDED_DRAWINGS.find((x) => x.test(s))?.label;
    expect(hit("af382dca" + "0".repeat(51) + "f9db5")).toMatch(/Set B/);
    expect(hit("6ef6c85bf0cf43ea260e5a7e78bbbfaf08ef26586801a626a605ad3b0b1e7e72")).toMatch(/drawing-1/);
    expect(hit("0".repeat(64))).toBeUndefined();
  });
});

describe("E1 portfolio against the plan's test (10–20 sets; residential, commercial, institutional; vector and scanned)", () => {
  it("one complete set is far from E1: the shortfall is listed", () => {
    const p = checkE1Portfolio([checkE1Set(writeSet(mkdtempSync(join(tmpdir(), "e1-one-")), "S01"))]);
    expect(p).toMatchObject({ complete: 1, meetsPlanCount: false, meetsPlanSpread: false });
    expect(p.missing).toEqual(["9 more complete set(s) for the minimum of 10", "no complete commercial set", "no complete institutional set", "no complete scanned set"]);
  });

  it("ten complete sets spanning every typology and both modalities meet the plan's count and spread; kit targets are reported separately", () => {
    const r = mkdtempSync(join(tmpdir(), "e1-ten-"));
    const mix: [E1SetMeta["typology"], E1SetMeta["modality"]][] = [
      ["residential", "vector"], ["residential", "vector"], ["residential", "scanned"], ["commercial", "vector"], ["commercial", "vector"],
      ["commercial", "scanned"], ["institutional", "vector"], ["institutional", "vector"], ["institutional", "vector"], ["institutional", "scanned"],
    ];
    mix.forEach(([typology, modality], i) => writeSet(r, `S${String(i + 1).padStart(2, "0")}`, { typology, modality }));
    writeSet(r, "S11", { skip: ["gold"] }); // incomplete: does not count
    const { sets, portfolio } = checkE1Root(r);
    expect(sets).toHaveLength(11);
    expect(portfolio).toMatchObject({ complete: 10, meetsPlanCount: true, meetsPlanSpread: true, missing: [] });
    expect(portfolio.kitTargetsUnmet).toEqual([]);
  });

  it("counts only S01-style folders as sets: output and working folders under the E1 root are ignored", () => {
    const r = mkdtempSync(join(tmpdir(), "e1-folders-"));
    writeSet(r, "S01");
    for (const f of ["e1-out", "acquisition", "screening"]) mkdirSync(join(r, f));
    const { sets, portfolio, ignoredFolders } = checkE1Root(r);
    expect(sets.map((x) => x.id)).toEqual(["S01"]);
    expect(portfolio).toMatchObject({ sets: 1, complete: 1 });
    expect(ignoredFolders).toEqual(["acquisition", "e1-out", "screening"]);
  });
});

describe("E1 → E2 hand-off on SYNTHETIC sets", () => {
  it("only complete sets reach the runner, always scored against the gold reference; incomplete sets are refused with reasons", async () => {
    const r = mkdtempSync(join(tmpdir(), "e1-handoff-"));
    writeSet(r, "S01");
    writeSet(r, "S02", { setAEligible: false });
    writeSet(r, "S03", { skip: ["gold"] });
    writeSet(r, "S04", { goldBy: "SYNTHETIC QS B" });
    const { sets } = checkE1Root(r);
    const { manifest, refused } = manifestFromE1(sets);

    expect(manifest.sets.map((s) => [s.id, s.role])).toEqual([["S01", "acceptance"], ["S02", "development"]]);
    expect(manifest.sets.every((s) => s.reference.endsWith(join("gold", "reference-boq.json")))).toBe(true);
    expect(manifest.sets[0].analysisSha256).toBe(sha(ANALYSIS));
    expect(refused.map((x) => [x.id, x.failing.map((c) => c.id)])).toEqual([["S03", ["gold", "contract-tags"]], ["S04", ["gold"]]]);

    writeFileSync(join(r, "manifest.json"), JSON.stringify(manifest));
    const out = join(r, "out");
    const { results } = await runManifest(join(r, "manifest.json"), out, ix);
    expect(results.map((s) => [s.id, s.error ?? null])).toEqual([["S01", null], ["S02", null]]);
    for (const id of ["S01", "S02"]) expect(existsSync(join(out, id, "gates.json")), id).toBe(true);
    const metrics = JSON.parse(readFileSync(join(out, "S01", "metrics.json"), "utf8"));
    const scored = (metrics.rawMachine.lines as { referenceId: string }[]).map((l) => l.referenceId).sort();
    expect(scored).toEqual(["G-DR1", "G-KIT"]); // gold lines, never QS-A's or QS-B's
  });
});
