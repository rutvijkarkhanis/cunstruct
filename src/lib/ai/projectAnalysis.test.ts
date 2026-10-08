import { describe, it, expect, vi } from "vitest";
import {
  buildDisciplinePlans, resolveBoqCandidates, runProjectAnalysis,
  type DisciplinePlan, type ProjectAnalysisDeps, type BoqCandidate,
} from "./projectAnalysis";
import type { GenerateResponse } from "./analysisClient";

const ok = (itemCount = 1): GenerateResponse => ({ ok: true, generated: 1, itemCount });

describe("buildDisciplinePlans", () => {
  it("groups a document assigned to multiple disciplines into EACH of those disciplines' plans", () => {
    const plans = buildDisciplinePlans({
      "floor-plan": ["civil", "electrical", "plumbing"],
      "electrical-layout": ["electrical"],
    });
    expect(plans.map((p) => p.discipline)).toEqual(["civil", "plumbing", "electrical"]);
    expect(plans.find((p) => p.discipline === "civil")?.documentIds).toEqual(["floor-plan"]);
    expect(plans.find((p) => p.discipline === "plumbing")?.documentIds).toEqual(["floor-plan"]);
    expect(plans.find((p) => p.discipline === "electrical")?.documentIds).toEqual(["floor-plan", "electrical-layout"]);
  });

  it("a document assigned to zero disciplines is silently excluded, never an error", () => {
    const plans = buildDisciplinePlans({ "unassigned-doc": [] });
    expect(plans).toEqual([]);
  });

  it("a discipline nobody assigned any document to is left out entirely — never an empty plan", () => {
    const plans = buildDisciplinePlans({ "doc-1": ["civil"] });
    expect(plans.map((p) => p.discipline)).toEqual(["civil"]);
    expect(plans.some((p) => p.discipline === "fire")).toBe(false);
  });

  it("always orders disciplines in DISCIPLINES' own fixed order, regardless of mapping insertion order", () => {
    const plans = buildDisciplinePlans({
      "doc-1": ["fire"],
      "doc-2": ["civil"],
      "doc-3": ["hvac"],
    });
    expect(plans.map((p) => p.discipline)).toEqual(["civil", "hvac", "fire"]);
  });

  it("never adds Finishes/Interiors or any key outside the 5 fixed disciplines", () => {
    const plans = buildDisciplinePlans({ "doc-1": ["civil", "plumbing", "electrical", "hvac", "fire"] });
    expect(plans).toHaveLength(5);
    expect(plans.every((p) => ["civil", "plumbing", "electrical", "hvac", "fire"].includes(p.discipline))).toBe(true);
  });

  it("carries an explicitly confirmed boqId through per discipline, defaulting to null when omitted", () => {
    const plans = buildDisciplinePlans(
      { "doc-1": ["civil"], "doc-2": ["electrical"] },
      { civil: "existing-civil-boq" },
    );
    expect(plans.find((p) => p.discipline === "civil")?.boqId).toBe("existing-civil-boq");
    expect(plans.find((p) => p.discipline === "electrical")?.boqId).toBeNull();
  });
});

describe("resolveBoqCandidates", () => {
  const boqs: BoqCandidate[] = [
    { id: "boq-1", name: "Civil Works", discipline: "civil" },
    { id: "boq-2", name: "Ground Floor BOQ", discipline: "civil" },
    { id: "boq-3", name: "Electrical Works", discipline: "electrical" },
  ];

  it("returns every existing BOQ tagged with the given discipline", () => {
    expect(resolveBoqCandidates("civil", boqs).map((b) => b.id)).toEqual(["boq-1", "boq-2"]);
  });

  it("returns an empty list when no BOQ is tagged with this discipline — the UI must offer 'create new', never fabricate a match", () => {
    expect(resolveBoqCandidates("fire", boqs)).toEqual([]);
  });
});

describe("runProjectAnalysis", () => {
  function deps(overrides: Partial<ProjectAnalysisDeps> = {}): ProjectAnalysisDeps & {
    createBoqForDiscipline: ReturnType<typeof vi.fn>;
    generateBoqAnalysis: ReturnType<typeof vi.fn>;
    generateLocationAnalysis: ReturnType<typeof vi.fn>;
  } {
    return {
      createBoqForDiscipline: vi.fn(async (discipline: string) => `new-${discipline}-boq`),
      generateBoqAnalysis: vi.fn(async () => ok()),
      generateLocationAnalysis: vi.fn(async () => ok(0)),
      ...overrides,
    };
  }

  it("calls generateBoqAnalysis once per discipline, with that discipline's own boqId and documentIds", async () => {
    const plans: DisciplinePlan[] = [
      { discipline: "civil", documentIds: ["doc-1", "doc-2"], boqId: "civil-boq" },
      { discipline: "electrical", documentIds: ["doc-1"], boqId: "electrical-boq" },
    ];
    const d = deps();
    await runProjectAnalysis(plans, d);
    expect(d.generateBoqAnalysis).toHaveBeenCalledTimes(2);
    expect(d.generateBoqAnalysis).toHaveBeenNthCalledWith(1, { boqId: "civil-boq", documentIds: ["doc-1", "doc-2"] });
    expect(d.generateBoqAnalysis).toHaveBeenNthCalledWith(2, { boqId: "electrical-boq", documentIds: ["doc-1"] });
  });

  it("creates a new BOQ only when a discipline's boqId is null, and uses the real BOQ id it returns", async () => {
    const plans: DisciplinePlan[] = [
      { discipline: "civil", documentIds: ["doc-1"], boqId: "existing-civil-boq" },
      { discipline: "fire", documentIds: ["doc-2"], boqId: null },
    ];
    const d = deps();
    const result = await runProjectAnalysis(plans, d);
    expect(d.createBoqForDiscipline).toHaveBeenCalledTimes(1);
    expect(d.createBoqForDiscipline).toHaveBeenCalledWith("fire");
    expect(result.disciplines.find((o) => o.discipline === "fire")?.boqId).toBe("new-fire-boq");
    expect(d.generateBoqAnalysis).toHaveBeenCalledWith({ boqId: "new-fire-boq", documentIds: ["doc-2"] });
  });

  it("skips a discipline with zero documents entirely — no BOQ creation, no BOQ analysis call", async () => {
    const plans: DisciplinePlan[] = [{ discipline: "hvac", documentIds: [], boqId: null }];
    const d = deps();
    const result = await runProjectAnalysis(plans, d);
    expect(d.createBoqForDiscipline).not.toHaveBeenCalled();
    expect(d.generateBoqAnalysis).not.toHaveBeenCalled();
    expect(result.disciplines).toEqual([]);
  });

  it("calls generateLocationAnalysis once per DISTINCT document shared across multiple disciplines — never once per discipline", async () => {
    // The exact Phase A scenario: an architectural floor plan assigned to
    // BOTH Civil and Electrical must still get exactly ONE LOCATION call.
    const plans: DisciplinePlan[] = [
      { discipline: "civil", documentIds: ["floor-plan", "sections"], boqId: "civil-boq" },
      { discipline: "electrical", documentIds: ["floor-plan", "electrical-layout"], boqId: "electrical-boq" },
    ];
    const d = deps();
    const result = await runProjectAnalysis(plans, d);
    expect(d.generateLocationAnalysis).toHaveBeenCalledTimes(3); // floor-plan, sections, electrical-layout — not 4
    const calledDocIds = d.generateLocationAnalysis.mock.calls.map((c: unknown[]) => (c[0] as { documentId: string }).documentId);
    expect(calledDocIds.sort()).toEqual(["electrical-layout", "floor-plan", "sections"]);
    expect(result.locations.map((l) => l.documentId).sort()).toEqual(["electrical-layout", "floor-plan", "sections"]);
  });

  it("cost-guarantee: 2 disciplines sharing documents across 9 distinct documents -> exactly 2 BOQ calls + 9 LOCATION calls, never per-item", async () => {
    const civilDocs = ["d1", "d2", "d3", "d4", "d5", "d6"];
    const electricalDocs = ["d4", "d5", "d6", "d7", "d8", "d9"]; // 3 shared with civil
    const plans: DisciplinePlan[] = [
      { discipline: "civil", documentIds: civilDocs, boqId: "civil-boq" },
      { discipline: "electrical", documentIds: electricalDocs, boqId: "electrical-boq" },
    ];
    const d = deps();
    await runProjectAnalysis(plans, d);
    expect(d.generateBoqAnalysis).toHaveBeenCalledTimes(2);
    expect(d.generateLocationAnalysis).toHaveBeenCalledTimes(9); // d1..d9, deduped, not 12
  });

  it("reports coarse, discipline/batch-level progress only — one tick per discipline call and per distinct document, never per item", async () => {
    const plans: DisciplinePlan[] = [
      { discipline: "civil", documentIds: ["floor-plan", "sections"], boqId: "civil-boq" },
      { discipline: "electrical", documentIds: ["floor-plan"], boqId: "electrical-boq" },
    ];
    const d = deps();
    const progress: Array<{ phase: string; label: string; index: number; total: number }> = [];
    await runProjectAnalysis(plans, d, (p) => progress.push(p));
    expect(progress).toEqual([
      { phase: "boq", label: "civil", index: 1, total: 2 },
      { phase: "boq", label: "electrical", index: 2, total: 2 },
      { phase: "location", label: "floor-plan", index: 1, total: 2 },
      { phase: "location", label: "sections", index: 2, total: 2 },
    ]);
  });

  it("an empty-document discipline contributes no progress tick at all", async () => {
    const plans: DisciplinePlan[] = [{ discipline: "fire", documentIds: [], boqId: null }];
    const d = deps();
    const progress: unknown[] = [];
    await runProjectAnalysis(plans, d, (p) => progress.push(p));
    expect(progress).toEqual([]);
  });

  it("processes disciplines in plan order and returns one outcome per non-empty discipline, carrying the real generate result through", async () => {
    const civilResult: GenerateResponse = { ok: true, generated: 2, itemCount: 2, runId: "run-civil" };
    const d = deps({ generateBoqAnalysis: vi.fn(async () => civilResult) });
    const plans: DisciplinePlan[] = [{ discipline: "civil", documentIds: ["doc-1"], boqId: "civil-boq" }];
    const result = await runProjectAnalysis(plans, d);
    expect(result.disciplines).toEqual([{ discipline: "civil", boqId: "civil-boq", result: civilResult }]);
  });
});

// PR #154 — the first Coverage/Completeness prerequisite: persisting the
// (boqId, documentIds) provenance an Analyze Project run actually submitted
// and successfully executed, via the new optional linkAnalyzedDocuments dep.
describe("runProjectAnalysis — linkAnalyzedDocuments (PR #154 provenance persistence)", () => {
  function deps(overrides: Partial<ProjectAnalysisDeps> = {}): ProjectAnalysisDeps & {
    createBoqForDiscipline: ReturnType<typeof vi.fn>;
    generateBoqAnalysis: ReturnType<typeof vi.fn>;
    generateLocationAnalysis: ReturnType<typeof vi.fn>;
    linkAnalyzedDocuments: ReturnType<typeof vi.fn>;
  } {
    return {
      createBoqForDiscipline: vi.fn(async (discipline: string) => `new-${discipline}-boq`),
      generateBoqAnalysis: vi.fn(async () => ok()),
      generateLocationAnalysis: vi.fn(async () => ok(0)),
      linkAnalyzedDocuments: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("is never called when omitted — every pre-existing caller/test keeps working unchanged", async () => {
    const plans: DisciplinePlan[] = [{ discipline: "civil", documentIds: ["doc-1"], boqId: "civil-boq" }];
    // No linkAnalyzedDocuments in deps at all — must not throw, must not be required.
    await expect(runProjectAnalysis(plans, {
      createBoqForDiscipline: vi.fn(async () => "new-boq"),
      generateBoqAnalysis: vi.fn(async () => ok()),
      generateLocationAnalysis: vi.fn(async () => ok(0)),
    })).resolves.toBeDefined();
  });

  it("is called once per successful discipline, immediately after that discipline's own generateBoqAnalysis resolves, with exactly that discipline's boqId + documentIds", async () => {
    const plans: DisciplinePlan[] = [
      { discipline: "civil", documentIds: ["doc-1", "doc-2"], boqId: "civil-boq" },
      { discipline: "electrical", documentIds: ["doc-3"], boqId: "electrical-boq" },
    ];
    const d = deps();
    await runProjectAnalysis(plans, d);
    expect(d.linkAnalyzedDocuments).toHaveBeenCalledTimes(2);
    expect(d.linkAnalyzedDocuments).toHaveBeenNthCalledWith(1, { boqId: "civil-boq", documentIds: ["doc-1", "doc-2"] });
    expect(d.linkAnalyzedDocuments).toHaveBeenNthCalledWith(2, { boqId: "electrical-boq", documentIds: ["doc-3"] });
  });

  it("uses the REAL boqId a newly-created BOQ resolved to, never the plan's null placeholder", async () => {
    const plans: DisciplinePlan[] = [{ discipline: "fire", documentIds: ["doc-1"], boqId: null }];
    const d = deps();
    await runProjectAnalysis(plans, d);
    expect(d.linkAnalyzedDocuments).toHaveBeenCalledWith({ boqId: "new-fire-boq", documentIds: ["doc-1"] });
  });

  it("a discipline with zero documents never calls it — nothing was submitted for that discipline", async () => {
    const plans: DisciplinePlan[] = [{ discipline: "hvac", documentIds: [], boqId: null }];
    const d = deps();
    await runProjectAnalysis(plans, d);
    expect(d.linkAnalyzedDocuments).not.toHaveBeenCalled();
    expect(d.createBoqForDiscipline).not.toHaveBeenCalled();
  });

  it("the SAME document assigned to two disciplines produces two independent calls, never one overwriting the other", async () => {
    const plans: DisciplinePlan[] = [
      { discipline: "civil", documentIds: ["shared-doc"], boqId: "civil-boq" },
      { discipline: "electrical", documentIds: ["shared-doc"], boqId: "electrical-boq" },
    ];
    const d = deps();
    await runProjectAnalysis(plans, d);
    expect(d.linkAnalyzedDocuments).toHaveBeenCalledTimes(2);
    expect(d.linkAnalyzedDocuments).toHaveBeenCalledWith({ boqId: "civil-boq", documentIds: ["shared-doc"] });
    expect(d.linkAnalyzedDocuments).toHaveBeenCalledWith({ boqId: "electrical-boq", documentIds: ["shared-doc"] });
  });

  it("a later discipline's generateBoqAnalysis failure never prevents an earlier discipline's already-successful call from being persisted, and is itself never persisted", async () => {
    const plans: DisciplinePlan[] = [
      { discipline: "civil", documentIds: ["doc-1"], boqId: "civil-boq" },
      { discipline: "electrical", documentIds: ["doc-2"], boqId: "electrical-boq" },
    ];
    const d = deps({
      generateBoqAnalysis: vi.fn()
        .mockResolvedValueOnce(ok()) // civil succeeds
        .mockRejectedValueOnce(new Error("BOQ analysis failed.")), // electrical fails
    });
    await expect(runProjectAnalysis(plans, d)).rejects.toThrow("BOQ analysis failed.");
    expect(d.linkAnalyzedDocuments).toHaveBeenCalledTimes(1);
    expect(d.linkAnalyzedDocuments).toHaveBeenCalledWith({ boqId: "civil-boq", documentIds: ["doc-1"] });
  });

  it("a failing linkAnalyzedDocuments call propagates — a provenance-write failure is a real failure, never silently swallowed", async () => {
    const plans: DisciplinePlan[] = [{ discipline: "civil", documentIds: ["doc-1"], boqId: "civil-boq" }];
    const d = deps({ linkAnalyzedDocuments: vi.fn(async () => { throw new Error("DB write failed"); }) });
    await expect(runProjectAnalysis(plans, d)).rejects.toThrow("DB write failed");
  });

  it("re-running the identical plan calls it again with identical arguments — idempotency is the DB layer's job (unique constraint + upsert), not this orchestration's", async () => {
    const plans: DisciplinePlan[] = [{ discipline: "civil", documentIds: ["doc-1"], boqId: "civil-boq" }];
    const d = deps();
    await runProjectAnalysis(plans, d);
    await runProjectAnalysis(plans, d);
    expect(d.linkAnalyzedDocuments).toHaveBeenCalledTimes(2);
    expect(d.linkAnalyzedDocuments).toHaveBeenNthCalledWith(1, { boqId: "civil-boq", documentIds: ["doc-1"] });
    expect(d.linkAnalyzedDocuments).toHaveBeenNthCalledWith(2, { boqId: "civil-boq", documentIds: ["doc-1"] });
  });
});
