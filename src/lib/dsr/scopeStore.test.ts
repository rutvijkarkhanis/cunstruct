// DSR check persistence against the in-memory database: the real store code
// runs unchanged; nothing is sent over the network.
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/integrations/supabase/client", async () => await import("@/lib/e2e/inMemorySupabase"));
import { readTable, resetInMemoryDb, dropInMemoryTable } from "@/lib/e2e/inMemorySupabase";
import { seedCatalogue } from "./seedFixture";
import { buildDsrIndex, matchLine } from "./match";
import { scopeSuggestions, type ScopeLine } from "./scope";
import { acceptScopeSuggestion, applyScheduleRate, decisionsFromSpec, loadDsrSchedule, saveScopeDecision, scheduleRateProblem } from "./scopeStore";
import { quantityState, quantityProvenance } from "@/lib/quantity";

const all = seedCatalogue();
const ix = buildDsrIndex(all, "DSR", "2023");
const DSR = { source: "DSR", year: "2023" };
const rcc = { id: "L1", boq_id: "B", description: "RCC 1:2:4 in footings", unit: "cum", dsr_code: "5.1.3", qty: 12, included: true, dsr_rate: 8583.4, custom_rate: null, external_key: null };
const suggestionFor = (lines: ScopeLine[], rule: string) =>
  scopeSuggestions(lines, new Map(lines.map((l) => [l.id, matchLine(l, ix)])), ix).find((s) => s.rule === rule)!;
const boqRow = () => readTable("boq")[0] as { spec: Record<string, unknown>; updated_at: string };

beforeEach(() => resetInMemoryDb({ boq: [{ id: "B", project_id: "P", spec: { overheads: 10 }, updated_at: "2026-10-01T00:00:00Z" }], boq_line: [{ ...rcc }] }));

describe("Accept", () => {
  it("adds a PENDING line per chosen item — schedule code, description and unit, no quantity, no rate — and records the decision", async () => {
    const s = suggestionFor([rcc], "excluded_formwork");
    const r = await acceptScopeSuggestion({ boqId: "B", suggestion: s, codes: ["5.9.3", "5.9.5"], expected: null, schedule: DSR, changedBy: "u1" });
    expect(r).toMatchObject({ status: "accepted", created: 2, decision: { status: "saved", historyRecorded: true } });
    const added = readTable("boq_line").filter((l) => l.id !== "L1");
    expect(added).toHaveLength(2);
    const item = all.find((i) => i.code === "5.9.3")!;
    expect(added[0]).toMatchObject({
      dsr_code: "5.9.3", unit: item.unit, qty: 0, quantity_status: "PENDING", basis: "PENDING",
      external_key: "dsr-scope:excluded_formwork:5:5.9.3", included: true,
    });
    expect(added[0].dsr_rate).toBeUndefined();
    expect(added[0].custom_rate).toBeUndefined();
    expect(String(added[0].basis_note)).toContain("DSR 2023 item 5.1.3 excludes centering");
    // The shared quantity rule treats it as missing a quantity — not zero, not priced.
    const line = { qty: 0, unit: item.unit, quantity_status: "PENDING", basis: "PENDING", included: true, dsr_rate: null, custom_rate: null };
    expect(quantityState(line as never)).toBe("pending");
    expect(quantityProvenance(line).label).toBe("Awaiting quantity");
    // Decision and history.
    expect(decisionsFromSpec(boqRow().spec)["excluded_formwork:5"]).toMatchObject({ decision: "accepted", codes: ["5.9.3", "5.9.5"], lineIds: added.map((a) => a.id), by: "u1", schedule: "DSR 2023" });
    expect(boqRow().spec.overheads).toBe(10); // other spec keys kept
    expect(readTable("boq_line_change_log")).toEqual([expect.objectContaining({ field: "dsr_scope_decision", old_value: "undecided: excluded_formwork:5", new_value: "accepted: excluded_formwork:5 (5.9.3, 5.9.5)" })]);
    // Re-derived: the suggestion now knows its lines.
    const after = suggestionFor(readTable("boq_line") as unknown as ScopeLine[], "excluded_formwork");
    expect(after.acceptedLineIds).toEqual(added.map((a) => a.id));
  });

  it("a retry never duplicates lines (stable external key)", async () => {
    const s = suggestionFor([rcc], "excluded_formwork");
    await acceptScopeSuggestion({ boqId: "B", suggestion: s, codes: ["5.9.3"], expected: null, schedule: DSR, changedBy: null });
    const rec = decisionsFromSpec(boqRow().spec)["excluded_formwork:5"];
    const r = await acceptScopeSuggestion({ boqId: "B", suggestion: s, codes: ["5.9.3"], expected: rec, schedule: DSR, changedBy: null });
    expect(r).toMatchObject({ status: "accepted", created: 0 });
    expect(readTable("boq_line")).toHaveLength(2);
  });

  it("refuses items outside the suggestion or schedule, and a decision changed meanwhile — writing nothing", async () => {
    const s = suggestionFor([rcc], "excluded_formwork");
    expect(await acceptScopeSuggestion({ boqId: "B", suggestion: s, codes: ["2.8.1"], expected: null, schedule: DSR, changedBy: null })).toMatchObject({ status: "invalid" });
    expect(await acceptScopeSuggestion({ boqId: "B", suggestion: s, codes: [], expected: null, schedule: DSR, changedBy: null })).toMatchObject({ status: "invalid" });
    expect(await acceptScopeSuggestion({ boqId: "B", suggestion: s, codes: ["5.9.3"], expected: null, schedule: { source: "DSR", year: "2021" }, changedBy: null })).toMatchObject({ status: "invalid" });
    await saveScopeDecision({ boqId: "B", key: s.key, decision: "rejected", expected: null, schedule: "DSR 2023", changedBy: "other" });
    expect(await acceptScopeSuggestion({ boqId: "B", suggestion: s, codes: ["5.9.3"], expected: null, schedule: DSR, changedBy: null })).toEqual({ status: "conflict" });
    expect(readTable("boq_line")).toHaveLength(1);
  });
});

describe("Accept — repeats, races and order of decisions", () => {
  const accept = (codes: string[], expected: Parameters<typeof acceptScopeSuggestion>[0]["expected"], note?: string, by = "u1") =>
    acceptScopeSuggestion({ boqId: "B", suggestion: suggestionFor([rcc], "excluded_formwork"), codes, expected, note, schedule: DSR, changedBy: by });
  const scopeLines = () => readTable("boq_line").filter((l) => String(l.external_key ?? "").startsWith("dsr-scope:"));

  it("a double click (two accepts at once) adds each line once and records one decision", async () => {
    const [a, b] = await Promise.all([accept(["5.9.3"], null), accept(["5.9.3"], null)]);
    expect(scopeLines()).toHaveLength(1);
    expect([a, b].map((r) => r.status)).toEqual(["accepted", "accepted"]);
    const lineIds = [a, b].flatMap((r) => (r.status === "accepted" ? r.lineIds : []));
    expect(new Set(lineIds)).toEqual(new Set([scopeLines()[0].id]));
    expect(readTable("boq_line_change_log")).toHaveLength(1);
  });

  it("a retry after a lost reply (stale 'expected') reuses the lines and changes nothing", async () => {
    await accept(["5.9.3"], null);
    const r = await accept(["5.9.3"], null);
    expect(r).toMatchObject({ status: "accepted", created: 0, decision: { status: "saved", unchanged: true } });
    expect(scopeLines()).toHaveLength(1);
    expect(readTable("boq_line_change_log")).toHaveLength(1);
    // Someone ELSE's acceptance is still a conflict for this person's stale view.
    expect(await accept(["5.9.3"], null, undefined, "u2")).toEqual({ status: "conflict" });
  });

  it("Accept after Reject replaces the decision; Reject after Accept keeps the lines (they are never deleted)", async () => {
    await saveScopeDecision({ boqId: "B", key: "excluded_formwork:5", decision: "rejected", expected: null, schedule: "DSR 2023", changedBy: "u1" });
    const rejected = decisionsFromSpec(boqRow().spec)["excluded_formwork:5"];
    expect(await accept(["5.9.3"], rejected)).toMatchObject({ status: "accepted", created: 1 });
    const accepted = decisionsFromSpec(boqRow().spec)["excluded_formwork:5"];
    expect(accepted).toMatchObject({ decision: "accepted", codes: ["5.9.3"] });
    await saveScopeDecision({ boqId: "B", key: "excluded_formwork:5", decision: "rejected", expected: accepted, schedule: "DSR 2023", changedBy: "u1" });
    expect(decisionsFromSpec(boqRow().spec)["excluded_formwork:5"].decision).toBe("rejected");
    expect(scopeLines()).toHaveLength(1);
  });

  it("Undo after Accept clears the decision but the lines remain, still pending and unpriced", async () => {
    await accept(["5.9.3"], null);
    const accepted = decisionsFromSpec(boqRow().spec)["excluded_formwork:5"];
    expect(await saveScopeDecision({ boqId: "B", key: "excluded_formwork:5", decision: null, expected: accepted, schedule: "DSR 2023", changedBy: "u1" })).toMatchObject({ status: "saved", record: null });
    expect(decisionsFromSpec(boqRow().spec)["excluded_formwork:5"]).toBeUndefined();
    expect(scopeLines()).toEqual([expect.objectContaining({ dsr_code: "5.9.3", qty: 0, quantity_status: "PENDING" })]);
    expect(scopeLines()[0].dsr_rate).toBeUndefined();
    // The re-derived suggestion still knows the lines.
    expect(suggestionFor(readTable("boq_line") as unknown as ScopeLine[], "excluded_formwork").acceptedLineIds).toEqual([scopeLines()[0].id]);
  });

  it("adding another item keeps the earlier items and the earlier note when no new note is typed", async () => {
    await accept(["5.9.3"], null, "Slab soffits from GA drawings");
    const first = decisionsFromSpec(boqRow().spec)["excluded_formwork:5"];
    await accept(["5.9.6"], first, "");
    expect(decisionsFromSpec(boqRow().spec)["excluded_formwork:5"]).toMatchObject({ codes: ["5.9.3", "5.9.6"], note: "Slab soffits from GA drawings" });
  });
});

describe("Reject, Defer and Undo", () => {
  it("reject records the decision and a note, deletes nothing; undo clears it, guarded on what was saved", async () => {
    const r = await saveScopeDecision({ boqId: "B", key: "excluded_reinforcement:5", decision: "rejected", expected: null, note: " Steel is in the structural package ", schedule: "DSR 2023", changedBy: "u1" });
    expect(r).toMatchObject({ status: "saved", historyRecorded: true, record: { decision: "rejected", note: "Steel is in the structural package" } });
    expect(readTable("boq_line")).toHaveLength(1);
    const saved = decisionsFromSpec(boqRow().spec)["excluded_reinforcement:5"];
    expect(await saveScopeDecision({ boqId: "B", key: "excluded_reinforcement:5", decision: null, expected: null, schedule: "DSR 2023", changedBy: "u1" })).toEqual({ status: "conflict" });
    expect(await saveScopeDecision({ boqId: "B", key: "excluded_reinforcement:5", decision: null, expected: saved, schedule: "DSR 2023", changedBy: "u1" })).toMatchObject({ status: "saved", record: null });
    expect(decisionsFromSpec(boqRow().spec)).toEqual({});
    expect(readTable("boq_line_change_log").map((l) => l.new_value)).toEqual([
      "rejected: excluded_reinforcement:5 — Steel is in the structural package", "undecided: excluded_reinforcement:5",
    ]);
  });

  it("defer of one suggestion leaves another's decision untouched", async () => {
    await saveScopeDecision({ boqId: "B", key: "a", decision: "rejected", expected: null, schedule: "DSR 2023", changedBy: null });
    await saveScopeDecision({ boqId: "B", key: "b", decision: "deferred", expected: null, schedule: "DSR 2023", changedBy: null });
    expect(Object.fromEntries(Object.entries(decisionsFromSpec(boqRow().spec)).map(([k, v]) => [k, v.decision]))).toEqual({ a: "rejected", b: "deferred" });
  });

  it("without the history table the decision is saved and reported as not recorded", async () => {
    dropInMemoryTable("boq_line_change_log");
    expect(await saveScopeDecision({ boqId: "B", key: "a", decision: "deferred", expected: null, schedule: "DSR 2023", changedBy: null }))
      .toMatchObject({ status: "saved", historyRecorded: false });
  });
});

describe("Use the schedule rate — separate, validated, audited", () => {
  const pending = { id: "N", boq_id: "B", dsr_code: "5.9.3", unit: "sqm", qty: 0, dsr_rate: null, custom_rate: null, quantity_status: "PENDING" };
  const item = all.find((i) => i.code === "5.9.3")!;
  beforeEach(() => resetInMemoryDb({ boq: [{ id: "B", project_id: "P" }], boq_line: [{ ...pending }] }));

  it("sets the schedule rate when schedule, code and unit check out, and records it; the quantity stays pending", async () => {
    const r = await applyScheduleRate({ boqId: "B", line: pending, item, schedule: DSR, changedBy: "u1" });
    expect(r).toEqual({ status: "applied", manualRateStillApplies: false });
    expect(readTable("boq_line")[0]).toMatchObject({ dsr_rate: item.rate, qty: 0, quantity_status: "PENDING" });
    expect(readTable("boq_line_change_log")[0]).toMatchObject({ field: "dsr_rate", old_value: null, new_value: `${item.rate} (DSR 2023 5.9.3)` });
  });

  it("refuses a wrong unit, another code or another schedule — nothing written", async () => {
    expect(scheduleRateProblem({ ...pending, unit: "sqft" }, item, DSR)).toMatch(/no conversion is assumed/);
    expect(scheduleRateProblem({ ...pending, unit: "cum" }, item, DSR)).toMatch(/^Unit check failed/);
    expect(scheduleRateProblem({ ...pending, dsr_code: "5.9.5" }, item, DSR)).toBe("The line is coded 5.9.5, not 5.9.3.");
    expect(scheduleRateProblem(pending, item, { source: "DSR", year: "2021" })).toBe("Item 5.9.3 is not from DSR 2021.");
    expect(scheduleRateProblem(pending, undefined, DSR)).toBe("The line's code is not an item in DSR 2023.");
    expect(await applyScheduleRate({ boqId: "B", line: { ...pending, unit: "cum" }, item, schedule: DSR, changedBy: null })).toMatchObject({ status: "invalid" });
    expect(readTable("boq_line")[0].dsr_rate).toBeNull();
  });

  it("is guarded: a rate changed meanwhile is not overwritten", async () => {
    const r = await applyScheduleRate({ boqId: "B", line: { ...pending, dsr_rate: 100 }, item, schedule: DSR, changedBy: null });
    expect(r).toEqual({ status: "conflict" });
    expect(readTable("boq_line")[0].dsr_rate).toBeNull();
  });

  it("fails closed without the history table (as manual rate edits do)", async () => {
    dropInMemoryTable("boq_line_change_log");
    expect(await applyScheduleRate({ boqId: "B", line: pending, item, schedule: DSR, changedBy: null })).toEqual({ status: "audit_unavailable" });
    expect(readTable("boq_line")[0].dsr_rate).toBeNull();
  });
});

describe("loading one schedule", () => {
  it("pages past the 1,000-row response cap and keeps only the selected schedule", async () => {
    resetInMemoryDb({ boq: [], dsr_item: [...all.map((i) => ({ ...i, billable: true })), { ...all[0], code: "OLD.1", rate_year: "2021", billable: true }, { ...all[1], code: "HDR", billable: false }] });
    const loaded = await loadDsrSchedule("DSR", "2023");
    expect(loaded).toHaveLength(2758);
    expect(loaded.some((i) => i.code === "OLD.1" || i.code === "HDR")).toBe(false);
  });
});
