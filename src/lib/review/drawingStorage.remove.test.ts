import { describe, it, expect, vi, beforeEach } from "vitest";

const storage = vi.hoisted(() => ({ answer: { data: [] as { name: string }[] | null, error: null as null | { message: string } }, calls: [] as string[][] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ remove: async (paths: string[]) => { storage.calls.push(paths); return storage.answer; } }) } },
}));

import { removeDrawingFiles } from "./drawingStorage";

beforeEach(() => { storage.calls = []; });

describe("removeDrawingFiles", () => {
  it("counts a file as removed only when storage says it removed it", async () => {
    storage.answer = { data: [{ name: "p1/d/r1.pdf" }], error: null }; // storage policy kept r2
    expect(await removeDrawingFiles(["p1/d/r1.pdf", "p1/d/r2.pdf"])).toEqual({ removed: ["p1/d/r1.pdf"], notRemoved: ["p1/d/r2.pdf"] });
  });
  it("an error removes nothing, as far as the caller knows", async () => {
    storage.answer = { data: null, error: { message: "down" } };
    expect(await removeDrawingFiles(["p1/d/r1.pdf"])).toEqual({ removed: [], notRemoved: ["p1/d/r1.pdf"] });
  });
  it("no paths: storage is not called", async () => {
    expect(await removeDrawingFiles([])).toEqual({ removed: [], notRemoved: [] });
    expect(storage.calls).toEqual([]);
  });
});
