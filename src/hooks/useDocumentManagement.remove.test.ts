// removeProjectDocument: the drawing row goes first (the database removes its
// revisions and clears references to it), then its stored files — never a
// shared file, never another drawing, never another project's row.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const store = vi.hoisted(() => ({
  docs: [] as Row[], revs: [] as Row[], log: [] as string[],
  failRevRead: false, failDelete: false, failRefCheck: false, storageKeeps: new Set<string>(),
}));

// The untyped client, as PostgREST would answer: eq/in filters, delete with
// a representation, and the ON DELETE CASCADE of document_revision.
vi.mock("@/lib/untypedDb", () => ({
  db: {
    from: (table: string) => {
      const filters: [string, string, unknown][] = [];
      let op: "select" | "delete" = "select";
      const rows = () => (table === "project_document" ? store.docs : store.revs).filter((r) =>
        filters.every(([k, c, v]) => (c === "eq" ? r[k] === v : (v as unknown[]).includes(r[k]))));
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.delete = () => { op = "delete"; return q; };
      q.eq = (k: string, v: unknown) => { filters.push([k, "eq", v]); return q; };
      q.in = (k: string, v: unknown[]) => { filters.push([k, "in", v]); return q; };
      (q as { then: unknown }).then = (resolve: (r: unknown) => void) => {
        if (op === "delete") {
          store.log.push(`delete ${table}`);
          if (store.failDelete) return resolve({ data: null, error: { message: "permission denied for table project_document" } });
          const hit = rows();
          store.docs = store.docs.filter((d) => !hit.includes(d));
          store.revs = store.revs.filter((r) => !hit.some((d) => d.id === r.document_id)); // cascade
          return resolve({ data: hit.map((d) => ({ id: d.id })), error: null });
        }
        const isRefCheck = filters.some(([, c]) => c === "in");
        store.log.push(isRefCheck ? "check shared files" : `read ${table}`);
        if (table === "document_revision" && !isRefCheck && store.failRevRead) return resolve({ data: null, error: { message: "down" } });
        if (isRefCheck && store.failRefCheck) return resolve({ data: null, error: { message: "down" } });
        return resolve({ data: rows(), error: null });
      };
      return q;
    },
  },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/review/drawingStorage", async (orig) => ({
  ...(await orig<typeof import("@/lib/review/drawingStorage")>()),
  removeDrawingFiles: vi.fn(async (paths: string[]) => {
    store.log.push(`remove files ${paths.join(",")}`);
    return { removed: paths.filter((p) => !store.storageKeeps.has(p)), notRemoved: paths.filter((p) => store.storageKeeps.has(p)) };
  }),
}));

import { removeProjectDocument } from "./useDocumentManagement";

beforeEach(() => {
  store.docs = [
    { id: "wrong", project_id: "p1" }, { id: "plan", project_id: "p1" }, { id: "elsewhere", project_id: "p2" },
  ];
  store.revs = [
    { id: "w1", document_id: "wrong", file_path: "p1/wrong/w1.pdf" },
    { id: "w2", document_id: "wrong", file_path: "p1/wrong/w2.pdf" },
    { id: "w3", document_id: "wrong", file_path: null }, // a pasted revision: no file
    { id: "pl1", document_id: "plan", file_path: "p1/plan/pl1.pdf" },
  ];
  store.log = []; store.failRevRead = false; store.failDelete = false; store.failRefCheck = false; store.storageKeeps = new Set();
});

describe("removeProjectDocument", () => {
  it("removes the drawing row first, then exactly its stored files; the other drawing and its file are untouched", async () => {
    expect(await removeProjectDocument("p1", "wrong")).toEqual({ ok: true, filesNotRemoved: [] });
    expect(store.log).toEqual([
      "read document_revision", "delete project_document", "check shared files", "remove files p1/wrong/w1.pdf,p1/wrong/w2.pdf",
    ]);
    expect(store.docs.map((d) => d.id)).toEqual(["plan", "elsewhere"]);
    expect(store.revs.map((r) => r.id)).toEqual(["pl1"]);
  });

  it("is scoped to the project: another project's drawing is not removed, and no file is touched", async () => {
    const r = await removeProjectDocument("p1", "elsewhere");
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/not found in this project, or you do not have permission/) });
    expect(store.docs.map((d) => d.id)).toContain("elsewhere");
    expect(store.log.some((l) => l.startsWith("remove files"))).toBe(false);
  });

  it("a refused delete leaves the drawing and its files exactly as they were", async () => {
    store.failDelete = true;
    expect(await removeProjectDocument("p1", "wrong")).toEqual({ ok: false, error: "The drawing was not removed: permission denied for table project_document" });
    expect(store.docs.map((d) => d.id)).toContain("wrong");
    expect(store.log.some((l) => l.startsWith("remove files"))).toBe(false);
  });

  it("if its files cannot be read first, nothing is removed", async () => {
    store.failRevRead = true;
    expect((await removeProjectDocument("p1", "wrong")).ok).toBe(false);
    expect(store.log).toEqual(["read document_revision"]);
  });

  it("a file another revision still uses is kept", async () => {
    store.revs.push({ id: "x", document_id: "plan", file_path: "p1/wrong/w2.pdf" });
    expect(await removeProjectDocument("p1", "wrong")).toEqual({ ok: true, filesNotRemoved: ["p1/wrong/w2.pdf"] });
    expect(store.log).toContain("remove files p1/wrong/w1.pdf");
  });

  it("if the shared-file check fails, every file is kept rather than risk a shared one", async () => {
    store.failRefCheck = true;
    expect(await removeProjectDocument("p1", "wrong")).toEqual({ ok: true, filesNotRemoved: ["p1/wrong/w1.pdf", "p1/wrong/w2.pdf"] });
    expect(store.log).toContain("remove files ");
  });

  it("a file storage keeps is reported, not hidden; the drawing is still removed", async () => {
    store.storageKeeps.add("p1/wrong/w1.pdf");
    expect(await removeProjectDocument("p1", "wrong")).toEqual({ ok: true, filesNotRemoved: ["p1/wrong/w1.pdf"] });
    expect(store.docs.map((d) => d.id)).not.toContain("wrong");
  });
});
