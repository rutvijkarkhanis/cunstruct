// Tests for the public share-link request-handling logic
// (supabase/functions/workspace-share/handler.ts). That module can't be
// exercised via index.ts/Deno.serve under Vitest at all (`npm:` specifiers,
// Deno globals) — handleBootstrap/handleDrawingUrl/handleBoqLines are pure,
// dependency-injected functions instead, same precedent as
// findSimilarHandler.test.ts importing supabase/functions/ai-analysis's own
// pure module straight into a Vitest file.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  handleBootstrap, handleDrawingUrl, handleBoqLines, isLinkActive,
  type ShareReadDeps,
} from "../../../supabase/functions/workspace-share/handler";

function deps(overrides: Partial<ShareReadDeps> = {}): ShareReadDeps {
  return {
    getProject: vi.fn(async (projectId: string) => ({ id: projectId, name: "Srikakulam Apartment" })),
    listDocuments: vi.fn(async () => []),
    listScopes: vi.fn(async () => []),
    listBoqs: vi.fn(async () => []),
    getDocumentForProject: vi.fn(async () => ({ name: "Sheet 1.pdf", filePath: "p1/sheet1.pdf", pageTitles: null })),
    createSignedUrl: vi.fn(async () => "https://example.supabase.co/signed/sheet1.pdf"),
    getBoqForProject: vi.fn(async (_projectId: string, boqId: string) => ({ id: boqId, name: "Floor 1", spec: {} })),
    listBoqLines: vi.fn(async () => []),
    ...overrides,
  };
}

describe("handleBootstrap", () => {
  it("returns the project, documents, scopes, and boqs", async () => {
    const d = deps({
      listDocuments: vi.fn(async () => [{ id: "doc-1", name: "Sheet 1.pdf", docType: "plan", discipline: "architectural", status: "uploaded", pageCount: 3 }]),
      listScopes: vi.fn(async () => [{ id: "scope-1", name: "Floor 1", kind: "floor", sort: 0 }]),
      listBoqs: vi.fn(async () => [{ id: "boq-1", name: "Floor 1 BOQ", scopeId: "scope-1", lineCount: 52 }]),
    });
    const res = await handleBootstrap({ projectId: "proj-1" }, d);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    if (res.body.ok) {
      expect(res.body.project).toEqual({ id: "proj-1", name: "Srikakulam Apartment" });
      expect(res.body.documents).toHaveLength(1);
      expect(res.body.scopes).toHaveLength(1);
      expect(res.body.boqs).toHaveLength(1);
    }
  });

  it("returns 404 when the project no longer exists", async () => {
    const d = deps({ getProject: vi.fn(async () => null) });
    const res = await handleBootstrap({ projectId: "gone" }, d);
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

describe("handleDrawingUrl", () => {
  it("returns a signed URL for a document that belongs to this project", async () => {
    const d = deps();
    const res = await handleDrawingUrl({ projectId: "proj-1", documentId: "doc-1" }, d);
    expect(res.status).toBe(200);
    if (res.body.ok) expect(res.body.fileUrl).toBe("https://example.supabase.co/signed/sheet1.pdf");
  });

  it("requires documentId", async () => {
    const res = await handleDrawingUrl({ projectId: "proj-1" }, deps());
    expect(res.status).toBe(400);
  });

  it("never returns a document belonging to a DIFFERENT project — the core cross-project leak this design exists to prevent", async () => {
    const getDocumentForProject = vi.fn(async () => null); // the real implementation returns null on project mismatch
    const d = deps({ getDocumentForProject });
    const res = await handleDrawingUrl({ projectId: "proj-1", documentId: "doc-from-another-project" }, d);
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(getDocumentForProject).toHaveBeenCalledWith("proj-1", "doc-from-another-project");
  });

  it("honestly reports a document with no stored file rather than signing nothing", async () => {
    const d = deps({ getDocumentForProject: vi.fn(async () => ({ name: "Empty", filePath: null, pageTitles: null })) });
    const res = await handleDrawingUrl({ projectId: "proj-1", documentId: "doc-1" }, d);
    expect(res.status).toBe(404);
  });
});

describe("handleBoqLines", () => {
  const LINES = [
    { id: "l1", description: "RCC footing", unit: "cum", qty: 10, included: true, section: "Structural", sort: 0, dsrRate: 100, customRate: null },
    { id: "l2", description: "Excluded item", unit: "nos", qty: 2, included: false, section: "Structural", sort: 1, dsrRate: 50, customRate: null },
  ];

  it("never returns a BOQ belonging to a DIFFERENT project — the core cross-project leak this design exists to prevent", async () => {
    const getBoqForProject = vi.fn(async () => null);
    const res = await handleBoqLines({ projectId: "proj-1", boqId: "boq-from-elsewhere", showPricing: true }, deps({ getBoqForProject }));
    expect(res.status).toBe(404);
    expect(getBoqForProject).toHaveBeenCalledWith("proj-1", "boq-from-elsewhere");
  });

  it("requires boqId", async () => {
    const res = await handleBoqLines({ projectId: "proj-1", showPricing: true }, deps());
    expect(res.status).toBe(400);
  });

  it("always re-verifies ownership with listBoqLines, passing the SAME projectId getBoqForProject was just checked against — never a different or client-suppliable value", async () => {
    const listBoqLines = vi.fn(async () => LINES);
    const d = deps({ listBoqLines });
    await handleBoqLines({ projectId: "proj-1", boqId: "boq-1", showPricing: true }, d);
    expect(listBoqLines).toHaveBeenCalledWith("proj-1", "boq-1");
  });

  it("defense-in-depth: even if getBoqForProject were ever wrong, listBoqLines's own independent project check (simulated here by it returning []) still prevents another project's lines from being returned — never substitutes a foreign BOQ's real rows", async () => {
    // Simulates index.ts's real behavior for a mismatch: its listBoqLines
    // independently re-queries `boq` scoped to (id, project_id) before ever
    // touching boq_line, and returns [] when that second check fails — this
    // mock stands in for that DB-level guard, which can't be exercised here
    // without a real database (see the module's own getBoqLines comment).
    const d = deps({ listBoqLines: vi.fn(async () => []) });
    const res = await handleBoqLines({ projectId: "proj-1", boqId: "boq-1", showPricing: true }, d);
    expect(res.status).toBe(200);
    if (!res.body.ok) throw new Error("expected ok");
    // Reported the same honest way as a genuinely empty BOQ — never an
    // error that would hint a mismatch happened, and never another
    // project's real line data.
    expect(res.body.lines).toEqual([]);
  });

  it("showPricing: false genuinely OMITS rate/amount/commercials keys, not just zeroes them", async () => {
    const d = deps({ listBoqLines: vi.fn(async () => LINES) });
    const res = await handleBoqLines({ projectId: "proj-1", boqId: "boq-1", showPricing: false }, d);
    expect(res.status).toBe(200);
    if (!res.body.ok) throw new Error("expected ok");
    expect(res.body.commercials).toBeUndefined();
    const line = (res.body.lines as Record<string, unknown>[])[0];
    expect(Object.keys(line).sort()).toEqual(["description", "id", "included", "qty", "section", "sort", "unit"].sort());
    expect("rate" in line).toBe(false);
    expect("amount" in line).toBe(false);
  });

  it("showPricing: true includes rate/amount per line and a commercials waterfall matching an independent computation", async () => {
    const d = deps({
      listBoqLines: vi.fn(async () => LINES),
      getBoqForProject: vi.fn(async () => ({ id: "boq-1", name: "Floor 1", spec: { gstPct: 18, overheadPct: 15, contingencyPct: 3, cessPct: 1, costIndexPct: 0 } })),
    });
    const res = await handleBoqLines({ projectId: "proj-1", boqId: "boq-1", showPricing: true }, d);
    expect(res.status).toBe(200);
    if (!res.body.ok) throw new Error("expected ok");
    const lines = res.body.lines as { id: string; rate: number | null; amount: number | null }[];
    expect(lines[0]).toMatchObject({ id: "l1", rate: 100, amount: 1000 }); // included line: 10 * 100
    expect(lines[1]).toMatchObject({ id: "l2", rate: 50, amount: 100 }); // excluded from the total below, but still shown

    // Independently reproduce the CPWD waterfall from boqDsrDocument.ts's own
    // computeCommercials to confirm this module's local copy stays identical.
    const round = (n: number) => Math.round(n);
    const works = round(1000); // only the included line (l1) counts toward the total
    const worksAdjusted = works + round(works * 0);
    const contingencyAmt = round(worksAdjusted * 0.03);
    const overheadAmt = round(worksAdjusted * 0.15);
    const subTotal = worksAdjusted + contingencyAmt + overheadAmt;
    const cessAmt = round(subTotal * 0.01);
    const taxable = subTotal + cessAmt;
    const gstAmt = round(taxable * 0.18);
    const grandTotal = taxable + gstAmt;

    const commercials = res.body.commercials as { works: number; subTotal: number; grandTotal: number };
    expect(commercials.works).toBe(works);
    expect(commercials.subTotal).toBe(subTotal);
    expect(commercials.grandTotal).toBe(grandTotal);
  });
});

describe("isLinkActive", () => {
  const now = Date.parse("2026-10-02T00:00:00Z");

  it("is active with no expiry and no revocation", () => {
    expect(isLinkActive({ revoked_at: null, expires_at: null }, now)).toBe(true);
  });

  it("is active with a future expiry", () => {
    expect(isLinkActive({ revoked_at: null, expires_at: "2099-01-01T00:00:00Z" }, now)).toBe(true);
  });

  it("is inactive once expired", () => {
    expect(isLinkActive({ revoked_at: null, expires_at: "2020-01-01T00:00:00Z" }, now)).toBe(false);
  });

  it("is inactive once revoked, even with no expiry", () => {
    expect(isLinkActive({ revoked_at: "2026-09-01T00:00:00Z", expires_at: null }, now)).toBe(false);
  });

  it("is inactive when both revoked and expired", () => {
    expect(isLinkActive({ revoked_at: "2026-09-01T00:00:00Z", expires_at: "2020-01-01T00:00:00Z" }, now)).toBe(false);
  });
});

describe("workspace-share handler — structural zero-write guarantee", () => {
  const HANDLER_SRC = readFileSync(join(__dirname, "../../../supabase/functions/workspace-share/handler.ts"), "utf8");

  it("ShareReadDeps declares no write method — every member is a narrow read closure", () => {
    const ifaceMatch = HANDLER_SRC.match(/export interface ShareReadDeps \{([\s\S]*?)\n\}/);
    expect(ifaceMatch).not.toBeNull();
    const body = ifaceMatch![1];
    for (const writeWord of ["insert", "update", "upsert", "delete", "SupabaseClient"]) {
      expect(body).not.toContain(writeWord);
    }
  });

  it("handler.ts never calls .insert(/.update(/.upsert( anywhere", () => {
    expect(/\.insert\(/.test(HANDLER_SRC)).toBe(false);
    expect(/\.update\(/.test(HANDLER_SRC)).toBe(false);
    expect(/\.upsert\(/.test(HANDLER_SRC)).toBe(false);
  });
});

describe("workspace-share index.ts — the one permitted write is scoped and singular", () => {
  const INDEX_SRC = readFileSync(join(__dirname, "../../../supabase/functions/workspace-share/index.ts"), "utf8");

  it("never calls .insert(/.upsert(/.delete( anywhere", () => {
    expect(/\.insert\(/.test(INDEX_SRC)).toBe(false);
    expect(/\.upsert\(/.test(INDEX_SRC)).toBe(false);
    expect(/\.delete\(/.test(INDEX_SRC)).toBe(false);
  });

  it("calls .update( exactly once, and only against project_share_link", () => {
    const updateCalls = [...INDEX_SRC.matchAll(/\.update\(/g)];
    expect(updateCalls).toHaveLength(1);
    // The statement containing the single .update( call must itself name
    // project_share_link — never projects/boq/boq_line/etc.
    const idx = updateCalls[0].index!;
    const statement = INDEX_SRC.slice(Math.max(0, idx - 200), idx);
    expect(statement).toContain('from("project_share_link")');
  });

  it("the one write targets last_accessed_at only", () => {
    const match = INDEX_SRC.match(/\.update\(\{([^}]*)\}\)/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("last_accessed_at");
  });
});

describe("supabase/config.toml — workspace-share is declared with verify_jwt disabled, nothing else touched", () => {
  const CONFIG_SRC = readFileSync(join(__dirname, "../../../supabase/config.toml"), "utf8");

  it("declares [functions.workspace-share] with verify_jwt = false", () => {
    const match = CONFIG_SRC.match(/\[functions\.workspace-share\]([\s\S]*?)(?=\n\[|$)/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/verify_jwt\s*=\s*false/);
  });

  it("leaves [functions.ai-analysis] exactly as-is — no verify_jwt override added there", () => {
    const match = CONFIG_SRC.match(/\[functions\.ai-analysis\]([\s\S]*?)(?=\n\[|$)/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toMatch(/verify_jwt/);
  });

  it("declares no other function's verify_jwt setting — the change is scoped to workspace-share alone", () => {
    const verifyJwtLines = [...CONFIG_SRC.matchAll(/verify_jwt\s*=\s*\w+/g)];
    expect(verifyJwtLines).toHaveLength(1);
  });

  it("keeps the project_id setting untouched", () => {
    expect(CONFIG_SRC).toContain('project_id = "dkgjsobfljqoggalivzt"');
  });
});

describe("workspace-share index.ts — listBoqLines independently re-verifies project ownership in its own real DB query", () => {
  // Confirms, at the source level, that the ACTUAL implementation (not just
  // the mock used above) re-checks boq.project_id before ever touching
  // boq_line — this is the real DB-level guard; the handler.ts-level tests
  // above only prove handler.ts wires projectId through correctly, since a
  // real database isn't available under Vitest.
  const INDEX_SRC = readFileSync(join(__dirname, "../../../supabase/functions/workspace-share/index.ts"), "utf8");

  it("listBoqLines queries boq scoped to BOTH id and project_id before reading boq_line", () => {
    const fnMatch = INDEX_SRC.match(/async listBoqLines\(projectId, boqId\) \{([\s\S]*?)\n {4}\},/);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![1];
    expect(body).toMatch(/from\("boq"\)/);
    expect(body).toMatch(/\.eq\("id", boqId\)/);
    expect(body).toMatch(/\.eq\("project_id", projectId\)/);
    // The ownership check happens before the boq_line query, not after.
    const boqCheckIdx = body.indexOf('from("boq")');
    const boqLineQueryIdx = body.indexOf('from("boq_line")');
    expect(boqCheckIdx).toBeGreaterThan(-1);
    expect(boqLineQueryIdx).toBeGreaterThan(boqCheckIdx);
  });
});
