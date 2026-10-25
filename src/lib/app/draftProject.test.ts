import { describe, it, expect, vi, beforeEach } from "vitest";

// A tiny `projects` table: records what was written and answers like PostgREST.
const db = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[],
  updates: [] as { patch: Record<string, unknown>; id: unknown }[],
  insertError: null as null | { message: string },
  updateRows: 1,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "projects") throw new Error(`unexpected table ${table}`);
      return {
        insert: (row: Record<string, unknown>) => {
          db.inserts.push(row);
          return { select: () => ({ single: async () => (db.insertError ? { data: null, error: db.insertError } : { data: { id: "p-new", name: row.name }, error: null }) }) };
        },
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: unknown) => ({
            select: async () => { db.updates.push({ patch, id }); return { data: Array.from({ length: db.updateRows }, () => ({ id })), error: null }; },
          }),
        }),
      };
    },
  },
}));

import { allowServerProcessing, checkDrawingFiles, createDraftProject, draftProjectName, renameProject } from "./draftProject";

beforeEach(() => { db.inserts = []; db.updates = []; db.insertError = null; db.updateRows = 1; });

describe("draft project from drawings", () => {
  it("names the draft after the first drawing, or a dated placeholder", () => {
    expect(draftProjectName([{ name: "GF Plan.pdf" }, { name: "Section.pdf" }])).toBe("GF Plan (draft)");
    expect(draftProjectName([], new Date("2026-10-25T10:00:00Z"))).toMatch(/^Untitled project 25 Oct 2026$/);
  });

  it("applies the existing drawing rules: PDF only, not empty", () => {
    const [pdf, png, empty] = checkDrawingFiles([
      { name: "a.pdf", type: "application/pdf", size: 10 },
      { name: "b.png", type: "image/png", size: 10 },
      { name: "c.pdf", type: "application/pdf", size: 0 },
    ]);
    expect(pdf).toMatchObject({ ok: true, error: null });
    expect(png).toMatchObject({ ok: false, error: "Only PDF drawings are supported." });
    expect(empty).toMatchObject({ ok: false, error: "The file is empty." });
  });

  it("records the signed-in user as owner and account manager, and asks nothing else", async () => {
    await createDraftProject({ name: "GF Plan (draft)", userId: "u1", allowServerProcessing: false });
    expect(db.inserts).toEqual([{ name: "GF Plan (draft)", owner_id: "u1", account_manager_id: "u1", ai_processing_enabled: false }]);
  });

  it("turns server processing on only when the person chose it", async () => {
    await createDraftProject({ name: "x", userId: "u1", allowServerProcessing: true });
    expect(db.inserts[0].ai_processing_enabled).toBe(true);
  });

  it("a refused insert is an error, never a silent success", async () => {
    db.insertError = { message: "new row violates row-level security policy" };
    await expect(createDraftProject({ name: "x", userId: "u1", allowServerProcessing: false })).rejects.toThrow("row-level security");
  });

  it("allowing server processing, or renaming, that changes no row says so", async () => {
    db.updateRows = 0;
    await expect(allowServerProcessing("p1")).rejects.toThrow(/could not be updated/);
    await expect(renameProject("p1", "New name")).rejects.toThrow(/could not be renamed/);
    db.updateRows = 1;
    await allowServerProcessing("p1");
    await renameProject("p1", "  Tower A  ");
    expect(db.updates.slice(-2)).toEqual([{ patch: { ai_processing_enabled: true }, id: "p1" }, { patch: { name: "Tower A" }, id: "p1" }]);
    await expect(renameProject("p1", "   ")).rejects.toThrow("Enter a project name.");
  });
});
