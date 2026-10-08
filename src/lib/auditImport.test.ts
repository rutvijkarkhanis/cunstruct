// PR #156 — persistCoverageFindings() extends the EXISTING audit-import
// path (importAuditRun's own module) to let the deterministic Coverage
// generator (coverageSignals.ts) write into boq_audit_run/boq_audit_finding
// idempotently. Mocks the supabase client the same chain-builder way
// boqDocumentLinks.test.ts already does, so this exercises the real
// select/insert/update/delete shape the function actually sends.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { persistCoverageFindings, loadActiveCoverageFindingCounts } from "./auditImport";
import { COVERAGE_FINDING_SOURCE } from "./review/coverageFindings";
import type { CoverageSignal } from "./review/coverageSignals";

function signal(overrides: Partial<CoverageSignal> = {}): CoverageSignal {
  return {
    type: "POTENTIAL_GAP",
    boqId: "boq-civil",
    documentId: "doc-A",
    normalizedKey: "d-07",
    mark: "D-07",
    evidenceTypes: ["schedule_entry"],
    observationIds: ["o1"],
    signalKey: "coverage¦boq-civil¦doc-A¦d-07",
    reason: 'Evidence for "D-07" (schedule_entry) was found in this document, but no matching item exists in this BOQ.',
    ...overrides,
  };
}

let existingSignalKeys: string[] = [];
/** signal_key values whose INSERT should simulate a lost race (23505),
 *  even though the pre-check select didn't know about them yet. */
let raceConflictKeys: Set<string> = new Set();
/** signal_key values whose INSERT should simulate a genuine, unrelated DB
 *  error (never a 23505 on the signal_key index) — must propagate, never
 *  be swallowed as "already exists". */
let genericErrorKeys: Set<string> = new Set();
let nextRunId = "run-1";

const selectFindingCalls: { boqId: string }[] = [];
const insertFindingCalls: Record<string, unknown>[] = [];
const insertRunCalls: Record<string, unknown>[] = [];
const updateRunCalls: { id: string; patch: Record<string, unknown> }[] = [];
const deleteRunCalls: { id: string }[] = [];

/** Rows loadActiveCoverageFindingCounts' query "returns" — the mock doesn't
 *  re-implement PostgREST's own source-filtering join; the test fixture
 *  simply configures exactly the rows that WOULD have survived
 *  `.eq("boq_audit_run.source", "coverage_engine")` server-side. */
let activeCountRows: { boq_id: string; state: string }[] = [];
const activeCountInCalls: string[][] = [];
const activeCountSourceFilters: string[] = [];

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        if (table === "boq_audit_finding") {
          return {
            select: (cols: string) => {
              if (cols.includes("boq_audit_run")) {
                const obj: Record<string, unknown> = {};
                obj.in = (_col: string, ids: string[]) => { activeCountInCalls.push(ids); return obj; };
                obj.eq = (col: string, v: string) => {
                  activeCountSourceFilters.push(`${col}=${v}`);
                  return { then: (resolve: (r: { data: unknown; error: null }) => void) => resolve({ data: activeCountRows, error: null }) };
                };
                return obj;
              }
              const obj: Record<string, unknown> = {};
              let boqId = "";
              obj.eq = (_col: string, v: string) => { boqId = v; return obj; };
              obj.not = () => {
                selectFindingCalls.push({ boqId });
                const rows = existingSignalKeys.map((k) => ({ signal_key: k }));
                return { then: (resolve: (r: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null }) };
              };
              return obj;
            },
            insert: (row: Record<string, unknown>) => {
              insertFindingCalls.push(row);
              const key = row.signal_key as string;
              if (genericErrorKeys.has(key)) {
                return { then: (resolve: (r: { error: { code: string; message: string } }) => void) => resolve({ error: { code: "42501", message: "permission denied for table boq_audit_finding" } }) };
              }
              if (raceConflictKeys.has(key)) {
                return { then: (resolve: (r: { error: { code: string; message: string } }) => void) => resolve({ error: { code: "23505", message: 'duplicate key value violates unique constraint "boq_audit_finding_signal_key_idx"' } }) };
              }
              return { then: (resolve: (r: { error: null }) => void) => resolve({ error: null }) };
            },
          };
        }
        if (table === "boq_audit_run") {
          return {
            insert: (row: Record<string, unknown>) => {
              insertRunCalls.push(row);
              const id = nextRunId;
              return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
            },
            update: (patch: Record<string, unknown>) => ({
              eq: (_col: string, id: string) => {
                updateRunCalls.push({ id, patch });
                return { then: (resolve: (r: { error: null }) => void) => resolve({ error: null }) };
              },
            }),
            delete: () => ({
              eq: (_col: string, id: string) => {
                deleteRunCalls.push({ id });
                return { then: (resolve: (r: { error: null }) => void) => resolve({ error: null }) };
              },
            }),
          };
        }
        throw new Error(`unexpected table in test: ${table}`);
      },
    },
  };
});

vi.mock("@/lib/security/auditTrail", () => ({
  recordAuditTrail: vi.fn(async () => "corr-id"),
}));

describe("persistCoverageFindings", () => {
  beforeEach(() => {
    existingSignalKeys = [];
    raceConflictKeys = new Set();
    genericErrorKeys = new Set();
    nextRunId = "run-1";
    selectFindingCalls.length = 0;
    insertFindingCalls.length = 0;
    insertRunCalls.length = 0;
    updateRunCalls.length = 0;
    deleteRunCalls.length = 0;
    activeCountRows = [];
    activeCountInCalls.length = 0;
    activeCountSourceFilters.length = 0;
  });

  it("is a no-op for an empty signals array — never queries or creates a run", async () => {
    const result = await persistCoverageFindings({ boqId: "boq-civil", signals: [] });
    expect(result).toEqual({ runId: null, createdCount: 0, skippedCount: 0 });
    expect(selectFindingCalls).toHaveLength(0);
    expect(insertRunCalls).toHaveLength(0);
  });

  // B — source
  it("creates the boq_audit_run with source = coverage_engine", async () => {
    await persistCoverageFindings({ boqId: "boq-civil", signals: [signal()] });
    expect(insertRunCalls).toHaveLength(1);
    expect(insertRunCalls[0].source).toBe(COVERAGE_FINDING_SOURCE);
    expect(insertRunCalls[0].boq_id).toBe("boq-civil");
  });

  // C — finding type (via the adapter, asserted again at the persistence boundary)
  it("inserts the finding with finding_type MISSING_ITEM and the signal's signal_key", async () => {
    await persistCoverageFindings({ boqId: "boq-civil", signals: [signal()] });
    expect(insertFindingCalls).toHaveLength(1);
    expect(insertFindingCalls[0].finding_type).toBe("MISSING_ITEM");
    expect(insertFindingCalls[0].signal_key).toBe("coverage¦boq-civil¦doc-A¦d-07");
  });

  // D — provenance retained on the finding row
  it("retains item/reason/evidence provenance on the inserted finding", async () => {
    await persistCoverageFindings({ boqId: "boq-civil", signals: [signal({ mark: "D-07", evidenceTypes: ["physical", "schedule_entry"], observationIds: ["o1", "o2"] })] });
    const row = insertFindingCalls[0];
    expect(row.item).toBe("D-07");
    expect(row.reason).toContain("D-07");
    expect(row.evidence).toContain("physical");
    expect(row.evidence).toContain("schedule_entry");
    expect(row.evidence).toContain("o1");
    expect(row.evidence).toContain("o2");
  });

  it("updates the run's finding_count to the real inserted count, and reports it in the result", async () => {
    const result = await persistCoverageFindings({ boqId: "boq-civil", signals: [signal(), signal({ signalKey: "coverage¦boq-civil¦doc-A¦w-12", mark: "W-12" })] });
    expect(result).toEqual({ runId: "run-1", createdCount: 2, skippedCount: 0 });
    expect(updateRunCalls).toEqual([{ id: "run-1", patch: { finding_count: 2 } }]);
    expect(deleteRunCalls).toHaveLength(0);
  });

  // E — deterministic identity: same signal twice -> no duplicate finding
  it("the same signal regenerated on a later call is skipped — no new finding, no new run", async () => {
    await persistCoverageFindings({ boqId: "boq-civil", signals: [signal()] });
    expect(insertFindingCalls).toHaveLength(1);

    existingSignalKeys = ["coverage¦boq-civil¦doc-A¦d-07"]; // now "already known" by the DB
    insertFindingCalls.length = 0;
    insertRunCalls.length = 0;

    const result = await persistCoverageFindings({ boqId: "boq-civil", signals: [signal()] });
    expect(result).toEqual({ runId: null, createdCount: 0, skippedCount: 1 });
    expect(insertFindingCalls).toHaveLength(0);
    expect(insertRunCalls).toHaveLength(0);
  });

  it("a narrow insert-time race (pre-check missed it, insert hits 23505) is treated as already-existing, never thrown", async () => {
    raceConflictKeys = new Set(["coverage¦boq-civil¦doc-A¦d-07"]);
    const result = await persistCoverageFindings({ boqId: "boq-civil", signals: [signal()] });
    expect(result).toEqual({ runId: null, createdCount: 0, skippedCount: 1 });
    // The run created to hold this candidate is deleted, not left empty.
    expect(deleteRunCalls).toEqual([{ id: "run-1" }]);
    expect(updateRunCalls).toHaveLength(0);
  });

  // F — different BOQ -> separate findings
  it("same document + same mark but different BOQ produces two independent findings", async () => {
    const a = signal({ boqId: "boq-civil", signalKey: "coverage¦boq-civil¦doc-A¦d-07" });
    const b = signal({ boqId: "boq-electrical", signalKey: "coverage¦boq-electrical¦doc-A¦d-07" });
    await persistCoverageFindings({ boqId: "boq-civil", signals: [a] });
    await persistCoverageFindings({ boqId: "boq-electrical", signals: [b] });
    expect(insertFindingCalls).toHaveLength(2);
    expect(insertFindingCalls.map((r) => r.signal_key)).toEqual([a.signalKey, b.signalKey]);
  });

  // G — different document -> separate findings
  it("same BOQ + same mark but different document produces two independent findings", async () => {
    const a = signal({ documentId: "doc-A", signalKey: "coverage¦boq-civil¦doc-A¦d-07" });
    const b = signal({ documentId: "doc-B", signalKey: "coverage¦boq-civil¦doc-B¦d-07" });
    await persistCoverageFindings({ boqId: "boq-civil", signals: [a, b] });
    expect(insertFindingCalls).toHaveLength(2);
  });

  // H — different mark -> separate findings
  it("same document + BOQ but different mark produces two independent findings", async () => {
    const a = signal({ normalizedKey: "d-07", mark: "D-07", signalKey: "coverage¦boq-civil¦doc-A¦d-07" });
    const b = signal({ normalizedKey: "w-12", mark: "W-12", signalKey: "coverage¦boq-civil¦doc-A¦w-12" });
    await persistCoverageFindings({ boqId: "boq-civil", signals: [a, b] });
    expect(insertFindingCalls).toHaveLength(2);
  });

  // I — human disposition preservation
  it("never issues an update against an existing finding — a dismissed/resolved/accepted finding's state is never touched", async () => {
    existingSignalKeys = ["coverage¦boq-civil¦doc-A¦d-07"]; // simulates an existing, human-dispositioned finding
    await persistCoverageFindings({ boqId: "boq-civil", signals: [signal()] });
    // Only boq_audit_run is ever updated by this function; boq_audit_finding
    // is only ever selected (pre-check) or inserted (new rows) — never updated.
    expect(insertFindingCalls).toHaveLength(0);
  });

  // J — no BOQ mutation (structural guard)
  it("persistCoverageFindings never queries or writes the boq_line table, and never sets boq_line_id — purely advisory, no BOQ mutation path exists", () => {
    const source = readFileSync(resolve(__dirname, "./auditImport.ts"), "utf-8");
    // Scoped to ONLY the new Coverage function — importAuditRun's own
    // PRE-EXISTING code legitimately sets boq_line_id when a human-pasted
    // finding matched a real line, which is unrelated and untouched here.
    const start = source.indexOf("export async function persistCoverageFindings");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start);
    // Comments are allowed to explain precedent (e.g. "mirrors applyFinding.ts's
    // boq_line identity indexes") — only actual code matters here.
    const code = body.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\.from\(\s*["']boq_line["']\s*\)/);
    expect(code).not.toMatch(/boq_line_id\s*:/);
  });

  // K — input immutability
  it("never mutates the input signals array or its objects", async () => {
    const s = Object.freeze(signal());
    const signals = Object.freeze([s]);
    await expect(persistCoverageFindings({ boqId: "boq-civil", signals: signals as unknown as CoverageSignal[] })).resolves.toBeDefined();
  });

  // L — both evidence types collapse to one finding (already true from PR #155's
  // own generator; this proves the persistence layer doesn't split it either).
  it("a signal with both evidence types still produces exactly one finding", async () => {
    await persistCoverageFindings({ boqId: "boq-civil", signals: [signal({ evidenceTypes: ["physical", "schedule_entry"] })] });
    expect(insertFindingCalls).toHaveLength(1);
  });

  it("propagates a genuine, unrelated insert error rather than swallowing it as a conflict", async () => {
    genericErrorKeys = new Set(["coverage¦boq-civil¦doc-A¦d-07"]);
    await expect(persistCoverageFindings({ boqId: "boq-civil", signals: [signal()] })).rejects.toMatchObject({ code: "42501" });
  });
});

// PR #157 — the readiness summary's one scoped query for active Coverage
// finding counts, per boqId.
describe("loadActiveCoverageFindingCounts", () => {
  beforeEach(() => {
    activeCountRows = [];
    activeCountInCalls.length = 0;
    activeCountSourceFilters.length = 0;
  });

  it("is a no-op for an empty boqIds array — never issues a query", async () => {
    const result = await loadActiveCoverageFindingCounts([]);
    expect(result).toEqual({});
    expect(activeCountInCalls).toHaveLength(0);
  });

  it("filters by boq_audit_run.source = coverage_engine, the actual schema field — never by parsing reason/evidence text", async () => {
    activeCountRows = [{ boq_id: "boq-civil", state: "open" }];
    await loadActiveCoverageFindingCounts(["boq-civil"]);
    expect(activeCountSourceFilters).toEqual([`boq_audit_run.source=${COVERAGE_FINDING_SOURCE}`]);
  });

  it("scopes the query to exactly the given boqIds — one query, never one per BOQ", async () => {
    await loadActiveCoverageFindingCounts(["boq-civil", "boq-electrical"]);
    expect(activeCountInCalls).toEqual([["boq-civil", "boq-electrical"]]);
  });

  it("counts an OPEN finding as active", async () => {
    activeCountRows = [{ boq_id: "boq-civil", state: "open" }];
    expect(await loadActiveCoverageFindingCounts(["boq-civil"])).toEqual({ "boq-civil": 1 });
  });

  it("counts a KEPT_PENDING finding as active", async () => {
    activeCountRows = [{ boq_id: "boq-civil", state: "kept_pending" }];
    expect(await loadActiveCoverageFindingCounts(["boq-civil"])).toEqual({ "boq-civil": 1 });
  });

  it("counts an ACCEPTED finding as active, matching the existing lifecycle semantics (not terminal)", async () => {
    activeCountRows = [{ boq_id: "boq-civil", state: "accepted" }];
    expect(await loadActiveCoverageFindingCounts(["boq-civil"])).toEqual({ "boq-civil": 1 });
  });

  it("a DISMISSED finding is never counted as active — a human already settled it", async () => {
    activeCountRows = [{ boq_id: "boq-civil", state: "dismissed" }];
    expect(await loadActiveCoverageFindingCounts(["boq-civil"])).toEqual({});
  });

  it("a RESOLVED finding is never counted as active", async () => {
    activeCountRows = [{ boq_id: "boq-civil", state: "resolved" }];
    expect(await loadActiveCoverageFindingCounts(["boq-civil"])).toEqual({});
  });

  it("keeps multiple BOQs' counts independent — never merges or cross-attributes them", async () => {
    activeCountRows = [
      { boq_id: "boq-civil", state: "open" },
      { boq_id: "boq-civil", state: "open" },
      { boq_id: "boq-electrical", state: "open" },
    ];
    expect(await loadActiveCoverageFindingCounts(["boq-civil", "boq-electrical"])).toEqual({ "boq-civil": 2, "boq-electrical": 1 });
  });

  it("a BOQ with zero active findings is simply absent from the result, never a zero entry", async () => {
    activeCountRows = [{ boq_id: "boq-civil", state: "dismissed" }];
    expect(await loadActiveCoverageFindingCounts(["boq-civil"])).toEqual({});
  });
});
