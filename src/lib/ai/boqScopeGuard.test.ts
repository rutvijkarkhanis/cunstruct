// Phase A structural guard — proves the ai-analysis edge function's three
// boq_id touchpoints (ledger read, claim insert, reclaim update) all gate on
// the SAME modeRequiresBoqScope(mode) predicate rather than three
// hand-written copies of "is this a BOQ-flavored mode" that could drift
// apart. computePreflight.test.ts proves the LOGIC is correct given an
// already-scoped ledger; this proves the edge function actually scopes that
// ledger (and the claim it inserts) consistently — "preflight and claim
// insertion agree" can't silently regress into reading one identity and
// writing another. Source-level, same technique
// findSimilarHandler.test.ts/shareWorkspaceHandler.test.ts already use for
// their own zero-write guarantees, since index.ts is a Deno entrypoint with
// no live-DB test harness in this suite.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../../../supabase/functions/ai-analysis/index.ts"), "utf-8");

describe("ai-analysis index.ts — BOQ-scoped claim identity agrees across read and write", () => {
  it("rejects a BOQ/BOQ_AND_LOCATION request with no boqId before ever touching the ledger", () => {
    expect(source).toMatch(/modeRequiresBoqScope\(mode\)\s*&&\s*!input\.boqId/);
  });

  it("the ledger query (read side) gates its boq_id filter on modeRequiresBoqScope", () => {
    const loadLedgerBody = source.slice(source.indexOf("async function loadLedger"), source.indexOf("async function isAdminCaller"));
    expect(loadLedgerBody).toContain('query.eq("boq_id"');
    expect(loadLedgerBody).toMatch(/if \(modeRequiresBoqScope\(mode\)\)/);
  });

  it("the claim insert (write side) sets boq_id from the identical modeRequiresBoqScope predicate", () => {
    expect(source).toMatch(/boq_id:\s*modeRequiresBoqScope\(mode\)\s*\?\s*input\.boqId\s*:\s*null/);
  });

  it("the reclaim update (write side) scopes by the same predicate, never crossing BOQ identities on reclaim", () => {
    expect(source).toMatch(/modeRequiresBoqScope\(mode\)\s*\?\s*reclaimQuery\.eq\("boq_id",\s*input\.boqId\)\s*:\s*reclaimQuery\.is\("boq_id",\s*null\)/);
  });

  it("modeRequiresBoqScope is imported from the single shared contract module, not redefined locally", () => {
    expect(source).toMatch(/import\s*\{[^}]*modeRequiresBoqScope[^}]*\}\s*from\s*"\.\.\/_shared\/contract\.ts"/);
    expect(source.match(/function modeRequiresBoqScope/g)).toBeNull();
  });
});
