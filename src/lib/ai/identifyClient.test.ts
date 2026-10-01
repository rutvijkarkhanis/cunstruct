import { describe, it, expect, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

import { identifyAtPoint } from "./identifyClient";

describe("identifyAtPoint", () => {
  it("invokes the ai-analysis function with action: identify and the given args", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, result: { schemaVersion: "cunstruct.identify.v1", point: { page: 1, x: 1, y: 2 }, candidates: [] } }, error: null });
    const res = await identifyAtPoint({ projectId: "proj-1", documentId: "doc-1", page: 1, point: { x: 1, y: 2 }, nearbyText: ["W1"] });
    expect(invokeMock).toHaveBeenCalledWith("ai-analysis", {
      body: { action: "identify", projectId: "proj-1", documentId: "doc-1", page: 1, point: { x: 1, y: 2 }, nearbyText: ["W1"] },
    });
    expect(res.ok).toBe(true);
    expect(res.result?.candidates).toEqual([]);
  });

  it("throws when the function invocation itself errors (transport failure)", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("network down") });
    await expect(identifyAtPoint({ projectId: "proj-1", documentId: "doc-1", page: 1, point: { x: 0, y: 0 } })).rejects.toThrow("network down");
  });
});
