// LOCAL migration rehearsal for plan items R5/R6 — real Postgres 16 (PGlite),
// the repository's own migrations, and the app's own write-path code
// (src/lib/...) running as signed-in users under row-level security. Only the
// HTTP layer (PostgREST) is replaced, by ./pgliteSupabase.ts. Evidence label:
// LOCAL — not staging, not production. Fixture data is synthetic.
//
// Run: npm --prefix scripts/migration-rehearsal install
//      npx vitest run --config scripts/migration-rehearsal/vitest.config.ts
import { describe, it, expect, vi, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyMigrations, clientFor, createUser, migrationFiles, migrationSql, newDatabase, type RehearsalClient } from "./pgliteSupabase";

// The app's modules import one Supabase client; point it at whichever
// session the current step is acting as.
const session: { current: RehearsalClient | null } = { current: null };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: new Proxy({}, { get: (_t, k) => (session.current as unknown as Record<string | symbol, unknown>)[k] }),
}));

import { saveLineEdit } from "@/lib/lineEdit";
import { removeLineWithSnapshot, restoreRemovedLine, LineRemovalError } from "@/lib/lineRemoval";
import { applyManualRateEdit } from "@/lib/manualRateEdit";
import { applyScheduleRate, acceptScopeSuggestion, saveScopeDecision, decisionsFromSpec, type ScopeDecisionRecord } from "@/lib/dsr/scopeStore";
import { buildApplyPlan, applyReviewPlan } from "@/lib/review/applyReview";
import type { StoredReviewItem } from "@/lib/review/reviewStore";

const CHANGE_LOG = "20260921000000_boq_review_apply.sql";
const STAFF = "00000000-0000-4000-8000-00000000000a";
const STAFF_2 = "00000000-0000-4000-8000-00000000000b";
const OWNER = "00000000-0000-4000-8000-00000000000c";
/** handle_new_user makes the FIRST user ever created an admin; this one takes
 *  that role so every test user's role is exactly the one the test gives it. */
const BOOTSTRAP_ADMIN = "00000000-0000-4000-8000-000000000001";

/** Production today: every migration except the change log. */
const productionToday = () => migrationFiles("migrations").filter((f) => f !== CHANGE_LOG);

interface World { db: PGlite; boqId: string; projectId: string; staff: RehearsalClient; staff2: RehearsalClient; owner: RehearsalClient }

async function world(opts: { changeLog: boolean }): Promise<World> {
  const db = await newDatabase();
  await applyMigrations(db, "migrations", productionToday());
  if (opts.changeLog) await applyMigrations(db, "migrations", [CHANGE_LOG]); // applied LAST, as production will
  await createUser(db, BOOTSTRAP_ADMIN);
  await createUser(db, STAFF, { staff: true });
  await createUser(db, STAFF_2, { staff: true });
  await createUser(db, OWNER);
  const projectId = (await db.query<{ id: string }>("insert into public.projects (name, owner_id) values ('SYNTHETIC rehearsal project', $1) returning id", [OWNER])).rows[0].id;
  const boqId = (await db.query<{ id: string }>("insert into public.boq (project_id, name, status, spec, updated_at) values ($1, 'SYNTHETIC BOQ', 'draft', '{}'::jsonb, now()) returning id", [projectId])).rows[0].id;
  return { db, boqId, projectId, staff: clientFor(db, STAFF), staff2: clientFor(db, STAFF_2), owner: clientFor(db, OWNER) };
}

async function addLine(w: World, o: Record<string, unknown>): Promise<string> {
  const cols = Object.keys(o);
  const r = await w.db.query<{ id: string }>(
    `insert into public.boq_line (boq_id, ${cols.join(", ")}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")}) returning id`,
    [w.boqId, ...cols.map((c) => o[c])]);
  return r.rows[0].id;
}
const line = async (w: World, id: string) => (await w.db.query<Record<string, unknown>>("select * from public.boq_line where id = $1", [id])).rows[0] ?? null;
const log = async (w: World) => (await w.db.query<{ field: string; old_value: string | null; new_value: string | null; boq_line_id: string | null; changed_by: string | null }>(
  "select field, old_value, new_value, boq_line_id, changed_by from public.boq_line_change_log where boq_id = $1 order by changed_at, id", [w.boqId])).rows;
const as = <T>(c: RehearsalClient, f: () => Promise<T>) => { session.current = c; return f(); };

describe("1–2. Migrations (LOCAL, PGlite)", () => {
  it("the full chain applies in timestamp order, and the change-history migration re-runs as a no-op", async () => {
    const db = await newDatabase();
    const all = migrationFiles("migrations");
    expect(all).toContain(CHANGE_LOG);
    await applyMigrations(db, "migrations", all);
    await applyMigrations(db, "migrations", [CHANGE_LOG]);
    const t = await db.query("select 1 from information_schema.tables where table_schema='public' and table_name='boq_line_change_log'");
    expect(t.rows).toHaveLength(1);
  });

  it("production order: every other migration first, then the change log last; it re-runs as a no-op", async () => {
    const db = await newDatabase();
    await applyMigrations(db, "migrations", productionToday());
    const before = await db.query("select 1 from information_schema.tables where table_schema='public' and table_name='boq_line_change_log'");
    expect(before.rows).toHaveLength(0);
    await applyMigrations(db, "migrations", [CHANGE_LOG, CHANGE_LOG]);
    const pol = await db.query<{ policyname: string }>("select policyname from pg_policies where tablename='boq_line_change_log' order by 1");
    expect(pol.rows.map((p) => p.policyname)).toEqual(["boq_line_change_log owner read", "boq_line_change_log staff manage"]);
  });

  it("the deferred revisions chain 20261003→20261008 applies in order after it, and re-runs cleanly", async () => {
    const db = await newDatabase();
    await applyMigrations(db, "migrations", migrationFiles("migrations"));
    const deferred = migrationFiles("deferred-migrations");
    expect(deferred).toEqual([
      "20261003000000_boq_line_dsr_mapping.sql", "20261004000000_boq_line_rate_evidence.sql", "20261005000000_boq_line_rate_adoption.sql",
      "20261006000000_boq_commercial_revision.sql", "20261007000000_boq_commercial_revision_provenance.sql", "20261008000000_boq_commercial_revision_line_identity.sql",
    ]);
    await applyMigrations(db, "deferred-migrations", deferred);
    await applyMigrations(db, "deferred-migrations", deferred); // whole chain again, in order
    for (const t of ["boq_line_dsr_mapping", "vendor_quotation", "boq_line_rate_adoption", "boq_commercial_revision", "boq_commercial_revision_line"]) {
      const r = await db.query("select 1 from information_schema.tables where table_schema='public' and table_name=$1", [t]);
      expect(r.rows, t).toHaveLength(1);
    }
    expect(migrationSql("deferred-migrations", deferred[5])).toContain("create or replace function public.create_boq_commercial_revision");
  });
});

describe("3. Apply review results to the BOQ", () => {
  async function reviewRun(w: World) {
    const runId = (await w.db.query<{ id: string }>("insert into public.analysis_run (boq_id, project_id, item_count, created_by) values ($1, $2, 2, $3) returning id", [w.boqId, w.projectId, STAFF])).rows[0].id;
    const item = async (key: string, ai: object, status: string, reviewer: object | null) =>
      (await w.db.query<{ id: string }>("insert into public.analysis_review_item (run_id, boq_id, project_id, item_key, item_name, ai_json, reviewer_json, review_status) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
        [runId, w.boqId, w.projectId, key, (ai as { item: string }).item, JSON.stringify(ai), reviewer && JSON.stringify(reviewer), status])).rows[0].id;
    const aiNew = { key: "W9", item: "Window W9", quantity: 4, unit: "nos", confidence: 0.9, aiStatus: "MEASURED" };
    const aiOld = { key: "D1", item: "Door D1", quantity: 7, unit: "nos", confidence: 0.9, aiStatus: "MEASURED" };
    const newId = await item("W9", aiNew, "VERIFIED", null);
    const editId = await item("D1", aiOld, "EDITED", { quantity: 8 });
    const lineId = await addLine(w, { description: "Door D1", unit: "nos", qty: 7, quantity_status: "MEASURED", external_key: "D1" });
    const items: StoredReviewItem[] = [
      { id: newId, ai: aiNew as StoredReviewItem["ai"], reviewStatus: "VERIFIED" },
      { id: editId, ai: aiOld as StoredReviewItem["ai"], reviewStatus: "EDITED", reviewer: { quantity: 8 } },
    ];
    const plan = buildApplyPlan(items, [{ id: lineId, external_key: "D1", qty: 7, unit: "nos", quantity_status: "MEASURED", scope_name: null }]);
    return { plan, ids: new Set([newId, editId]), lineId };
  }

  it("with the change log: both lines written, and one history row per changed field", async () => {
    const w = await world({ changeLog: true });
    const { plan, ids, lineId } = await reviewRun(w);
    const r = await as(w.staff, () => applyReviewPlan({ boqId: w.boqId, candidates: plan, selectedIds: ids }));
    expect(r).toMatchObject({ appliedCount: 2, auditLogFailedReviewItemIds: [] });
    expect(Number((await line(w, lineId)).qty)).toBe(8);
    const rows = await log(w);
    expect(rows.map((x) => `${x.field}:${x.old_value}->${x.new_value}`).sort()).toEqual(["line_created:null->Window W9", "qty:7->8", "qty:null->4", "unit:null->nos"]);
    expect(rows.every((x) => x.changed_by === STAFF)).toBe(true);
  });

  it("without the change log (production today): the lines are written and the missing history is reported, never claimed", async () => {
    const w = await world({ changeLog: false });
    const { plan, ids, lineId } = await reviewRun(w);
    const r = await as(w.staff, () => applyReviewPlan({ boqId: w.boqId, candidates: plan, selectedIds: ids }));
    expect(r.appliedCount).toBe(2);
    expect([...r.auditLogFailedReviewItemIds].sort()).toEqual([...ids].sort());
    expect(Number((await line(w, lineId)).qty)).toBe(8);
  });
});

describe("4. Edit conflict between two sessions", () => {
  it("the second session's stale edit is refused; nothing it sent is written or recorded", async () => {
    const w = await world({ changeLog: true });
    const id = await addLine(w, { description: "Plaster", unit: "sqm", qty: 10, quantity_status: "MEASURED" });
    const loaded = { id, qty: 10, unit: "sqm", quantity_status: "MEASURED" };
    expect(await as(w.staff, () => saveLineEdit({ boqId: w.boqId, line: loaded, patch: { qty: 12 }, changedBy: STAFF }))).toEqual({ status: "saved", recorded: true });
    expect(await as(w.staff2, () => saveLineEdit({ boqId: w.boqId, line: loaded, patch: { qty: 15 }, changedBy: STAFF_2 }))).toEqual({ status: "conflict" });
    expect(Number((await line(w, id)).qty)).toBe(12);
    expect((await log(w)).map((x) => [x.field, x.old_value, x.new_value, x.changed_by])).toEqual([["qty", "10", "12", STAFF]]);
  });
});

describe("5. Remove → undo", () => {
  it("removal records a history row; undo puts back the identical row and relinks its history", async () => {
    const w = await world({ changeLog: true });
    const id = await addLine(w, { description: "Skirting", unit: "m", qty: 30, quantity_status: "MEASURED", custom_rate: 45, basis: "MANUAL", basis_note: "SYNTHETIC" });
    await as(w.staff, () => saveLineEdit({ boqId: w.boqId, line: { id, qty: 30, unit: "m", quantity_status: "MEASURED" }, patch: { qty: 32 }, changedBy: STAFF }));
    const before = await line(w, id);
    const removed = await as(w.staff, () => removeLineWithSnapshot(id, w.staff as never, { expected: { qty: 32 }, history: { boqId: w.boqId, changedBy: STAFF } }));
    expect(removed.historyRecorded).toBe(true);
    expect(await line(w, id)).toBeNull();
    expect((await log(w)).find((x) => x.field === "qty")!.boq_line_id).toBeNull(); // the FK cleared it
    const restored = await as(w.staff, () => restoreRemovedLine(removed, w.staff as never, { boqId: w.boqId, changedBy: STAFF }));
    expect(restored).toEqual({ unrestoredLinks: [], historyRecorded: true });
    expect(await line(w, id)).toEqual(before);
    const rows = await log(w);
    expect(rows.find((x) => x.field === "qty")!.boq_line_id).toBe(id); // relinked
    expect(rows.map((x) => x.field)).toEqual(["qty", "line_removed", "line_restored"]);
  });

  it("without the change log, removal is refused and offers 'exclude instead'; nothing is deleted", async () => {
    const w = await world({ changeLog: false });
    const id = await addLine(w, { description: "Skirting", unit: "m", qty: 30, quantity_status: "MEASURED" });
    const err = await as(w.staff, () => removeLineWithSnapshot(id, w.staff as never, { history: { boqId: w.boqId, changedBy: STAFF } })).catch((e) => e);
    expect(err).toBeInstanceOf(LineRemovalError);
    expect((err as LineRemovalError).excludeInstead).toBe(true);
    expect(await line(w, id)).not.toBeNull();
  });
});

describe("6. Exclude instead → undo", () => {
  it("excluding and undoing are guarded edits, each with its own history row", async () => {
    const w = await world({ changeLog: true });
    const id = await addLine(w, { description: "Boundary wall", unit: "cum", qty: 5, quantity_status: "MEASURED", included: true });
    expect(await as(w.staff, () => saveLineEdit({ boqId: w.boqId, line: { id, qty: 5, unit: "cum", included: true }, patch: { included: false }, changedBy: STAFF }))).toEqual({ status: "saved", recorded: true });
    expect((await line(w, id)).included).toBe(false);
    expect(await as(w.staff, () => saveLineEdit({ boqId: w.boqId, line: { id, qty: 5, unit: "cum", included: false }, patch: { included: true }, changedBy: STAFF }))).toEqual({ status: "saved", recorded: true });
    expect((await line(w, id)).included).toBe(true);
    expect((await log(w)).map((x) => [x.field, x.old_value, x.new_value])).toEqual([["included", "true", "false"], ["included", "false", "true"]]);
  });

  it("without the change log, exclude still saves (it is the safe alternative) and says it was not recorded", async () => {
    const w = await world({ changeLog: false });
    const id = await addLine(w, { description: "Boundary wall", unit: "cum", qty: 5, quantity_status: "MEASURED", included: true });
    expect(await as(w.staff, () => saveLineEdit({ boqId: w.boqId, line: { id, qty: 5, unit: "cum", included: true }, patch: { included: false }, changedBy: STAFF }))).toEqual({ status: "saved", recorded: false });
    expect((await line(w, id)).included).toBe(false);
  });
});

describe("7. DSR scope suggestion: Accept / Reject / Defer / Undo", () => {
  it("each decision is a guarded spec write with one history row; a stale decision is refused", async () => {
    const w = await world({ changeLog: true });
    const option = { id: "dsr-synthetic-1", source: "DSR", rate_year: "2023", code: "99.1", chapter: "SYNTHETIC", subhead: null, description: "SYNTHETIC waterproofing item", unit: "sqm", rate: 100 };
    const suggestion = { key: "synthetic-scope", title: "Waterproofing excluded", options: [option], triggers: [{ dsrCode: "22.7.1", clause: "SYNTHETIC clause" }] };
    const schedule = { source: "DSR", year: "2023" };
    const decisions = async () => {
      const r = await w.db.query<{ spec: unknown }>("select spec from public.boq where id = $1", [w.boqId]);
      return decisionsFromSpec(r.rows[0].spec)["synthetic-scope"] ?? null;
    };

    const acc = await as(w.staff, () => acceptScopeSuggestion({ boqId: w.boqId, suggestion: suggestion as never, codes: ["99.1"], expected: null, schedule, changedBy: STAFF }));
    expect(acc).toMatchObject({ status: "accepted", created: 1 });
    const added = await line(w, (acc as { lineIds: string[] }).lineIds[0]);
    expect(added).toMatchObject({ quantity_status: "PENDING", dsr_code: "99.1", included: true });
    const accepted = (await decisions()) as ScopeDecisionRecord;
    expect(accepted.decision).toBe("accepted");

    const rej = await as(w.staff, () => saveScopeDecision({ boqId: w.boqId, key: "synthetic-scope", decision: "rejected", expected: accepted, schedule: "DSR 2023", changedBy: STAFF }));
    expect(rej).toMatchObject({ status: "saved", historyRecorded: true });
    const rejected = (await decisions())!;
    // A second session still holding "accepted" is refused.
    expect(await as(w.staff2, () => saveScopeDecision({ boqId: w.boqId, key: "synthetic-scope", decision: "deferred", expected: accepted, schedule: "DSR 2023", changedBy: STAFF_2 }))).toEqual({ status: "conflict" });
    const def = await as(w.staff, () => saveScopeDecision({ boqId: w.boqId, key: "synthetic-scope", decision: "deferred", expected: rejected, schedule: "DSR 2023", changedBy: STAFF }));
    expect(def).toMatchObject({ status: "saved", historyRecorded: true });
    const deferred = (await decisions())!;
    const undo = await as(w.staff, () => saveScopeDecision({ boqId: w.boqId, key: "synthetic-scope", decision: null, expected: deferred, schedule: "DSR 2023", changedBy: STAFF }));
    expect(undo).toMatchObject({ status: "saved", historyRecorded: true, record: null });
    expect(await decisions()).toBeNull();

    const scopeRows = (await log(w)).filter((x) => x.field === "dsr_scope_decision").map((x) => [x.old_value, x.new_value?.replace(/ \(.*$/, "")]);
    expect(scopeRows).toEqual([
      ["undecided: synthetic-scope", "accepted: synthetic-scope"],
      ["accepted: synthetic-scope", "rejected: synthetic-scope"],
      ["rejected: synthetic-scope", "deferred: synthetic-scope"],
      ["deferred: synthetic-scope", "undecided: synthetic-scope"],
    ]);
  });
});

describe("8. Schedule rate", () => {
  it("applies the schedule rate with its history rows; a stale line is refused", async () => {
    const w = await world({ changeLog: true });
    const id = await addLine(w, { description: "SYNTHETIC item", unit: "sqm", qty: 10, quantity_status: "MEASURED", dsr_code: "99.2" });
    const item = { id: "dsr-synthetic-2", source: "DSR", rate_year: "2023", code: "99.2", chapter: "SYNTHETIC", subhead: null, description: "SYNTHETIC", unit: "sqm", rate: 250 };
    const ln = { id, dsr_code: "99.2", dsr_rate: null, custom_rate: null, unit: "sqm" };
    const schedule = { source: "DSR", year: "2023" };
    expect(await as(w.staff, () => applyScheduleRate({ boqId: w.boqId, line: ln, item: item as never, schedule, changedBy: STAFF }))).toEqual({ status: "applied", manualRateStillApplies: false });
    expect(Number((await line(w, id)).dsr_rate)).toBe(250);
    expect((await log(w)).map((x) => [x.field, x.old_value, x.new_value])).toEqual([["dsr_rate", null, "250 (DSR 2023 99.2)"]]);
    // The same stale view again (dsr_rate was null) is refused.
    expect(await as(w.staff2, () => applyScheduleRate({ boqId: w.boqId, line: ln, item: { ...item, rate: 300 } as never, schedule, changedBy: STAFF_2 }))).toEqual({ status: "conflict" });
    expect(Number((await line(w, id)).dsr_rate)).toBe(250);
  });
});

describe("9. Manual rate edit", () => {
  it("writes the rate and one history row; undo is the reverse edit; stale is refused", async () => {
    const w = await world({ changeLog: true });
    const id = await addLine(w, { description: "SYNTHETIC item", unit: "sqm", qty: 10, quantity_status: "MEASURED", dsr_rate: 200 });
    const ln = { id, custom_rate: null, dsr_rate: 200, unit: "sqm" };
    expect(await as(w.staff, () => applyManualRateEdit({ boqId: w.boqId, line: ln as never, newRate: 180, changedBy: STAFF }))).toEqual({ status: "applied" });
    expect(Number((await line(w, id)).custom_rate)).toBe(180);
    expect(await as(w.staff2, () => applyManualRateEdit({ boqId: w.boqId, line: ln as never, newRate: 170, changedBy: STAFF_2 }))).toEqual({ status: "conflict" });
    expect(await as(w.staff, () => applyManualRateEdit({ boqId: w.boqId, line: { ...ln, custom_rate: 180 } as never, newRate: null, changedBy: STAFF }))).toEqual({ status: "applied" });
    expect((await line(w, id)).custom_rate).toBeNull();
    expect((await log(w)).map((x) => [x.field, x.old_value, x.new_value])).toEqual([["custom_rate", null, "180"], ["custom_rate", "180", null]]);
  });

  it("without the change log, nothing is written (the rate edit needs its audit row)", async () => {
    const w = await world({ changeLog: false });
    const id = await addLine(w, { description: "SYNTHETIC item", unit: "sqm", qty: 10, quantity_status: "MEASURED", dsr_rate: 200 });
    expect(await as(w.staff, () => applyManualRateEdit({ boqId: w.boqId, line: { id, custom_rate: null, dsr_rate: 200, unit: "sqm" } as never, newRate: 180, changedBy: STAFF }))).toEqual({ status: "audit_unavailable" });
    expect((await line(w, id)).custom_rate).toBeNull();
  });
});

describe("10. Change-history access under row-level security", () => {
  let w: World;
  beforeAll(async () => {
    w = await world({ changeLog: true });
    const id = await addLine(w, { description: "SYNTHETIC", unit: "nos", qty: 1, quantity_status: "MEASURED" });
    await as(w.staff, () => saveLineEdit({ boqId: w.boqId, line: { id, qty: 1, unit: "nos" }, patch: { qty: 2 }, changedBy: STAFF }));
  });

  it("the project owner can read the BOQ's history but cannot write to it", async () => {
    const read = await w.owner.from("boq_line_change_log").select("field").eq("boq_id", w.boqId);
    expect(read).toEqual({ data: [{ field: "qty" }], error: null });
    const write = await w.owner.from("boq_line_change_log").insert({ boq_id: w.boqId, field: "qty", old_value: "2", new_value: "3" });
    expect(write.error?.message).toMatch(/row-level security/);
  });

  it("only staff may write lines: the project owner's edit is refused by row-level security", async () => {
    const id = await addLine(w, { description: "SYNTHETIC owner", unit: "nos", qty: 1, quantity_status: "MEASURED" });
    const r = await as(w.owner, () => saveLineEdit({ boqId: w.boqId, line: { id, qty: 1, unit: "nos" }, patch: { qty: 5 }, changedBy: OWNER }));
    expect(r).toEqual({ status: "conflict" }); // 0 rows visible to update: nothing written
    expect(Number((await line(w, id)).qty)).toBe(1);
  });

  it("a signed-in user with no role and no project sees nothing", async () => {
    const stranger = "00000000-0000-4000-8000-00000000000d";
    await createUser(w.db, stranger);
    const read = await clientFor(w.db, stranger).from("boq_line_change_log").select("field").eq("boq_id", w.boqId);
    expect(read).toEqual({ data: [], error: null });
  });
});
