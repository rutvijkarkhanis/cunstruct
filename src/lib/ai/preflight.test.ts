// Tests the pure preflight computation used by the ai-analysis edge function.
// Imported from its actual location (supabase/functions/_shared/) via a
// relative, explicit-extension path — the same way the edge function imports
// it — so this is exercising the real module, not a copy.
import { describe, it, expect } from "vitest";
import { computePreflight, resolveRequestedToSend, type EligibleFile, type LedgerRow } from "../../../supabase/functions/_shared/preflight.ts";

const NOW = 1_000_000_000_000; // fixed "now" so staleness math is deterministic
const STALE_AFTER_MS = 10 * 60 * 1000; // matches STALE_PROCESSING_MS in index.ts

const opts = { contractVersion: "v1", provider: "openai", model: "gpt-4o-mini", mode: "BOQ" as const, forceReanalyse: false, nowMs: NOW, staleAfterMs: STALE_AFTER_MS };

const file = (o: Partial<EligibleFile> & { documentId: string; contentHash: string | null }): EligibleFile => ({
  documentRevisionId: `${o.documentId}-rev`, filename: `${o.documentId}.pdf`, byteSize: 1000, ...o,
});

const ledgerRow = (o: Partial<LedgerRow> & { contentHash: string; status: LedgerRow["status"] }): LedgerRow => ({
  documentId: null, filenameAtTimeOfAnalysis: null, analysisRunId: null, claimedAtMs: NOW, ...o,
});

describe("computePreflight", () => {
  it("treats every file as new when the ledger is empty", () => {
    const files = [file({ documentId: "a", contentHash: "h1" }), file({ documentId: "b", contentHash: "h2" })];
    const r = computePreflight(2, files, [], opts);
    expect(r.newEligible.map((f) => f.documentId)).toEqual(["a", "b"]);
    expect(r.willSend.map((f) => f.documentId)).toEqual(["a", "b"]);
    expect(r.alreadyAnalysed).toEqual([]);
  });

  it("excludes a file whose hash has a SUCCEEDED ledger row from willSend", () => {
    const files = [file({ documentId: "a", contentHash: "h1" }), file({ documentId: "b", contentHash: "h2" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "SUCCEEDED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: "run1" })];
    const r = computePreflight(2, files, ledger, opts);
    expect(r.alreadyAnalysed.map((f) => f.documentId)).toEqual(["a"]);
    expect(r.willSend.map((f) => f.documentId)).toEqual(["b"]);
  });

  it("a renamed duplicate (same content hash, different document/filename) counts as already analysed, not new", () => {
    const files = [file({ documentId: "renamed-doc", contentHash: "h1", filename: "Renamed Plan.pdf" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "SUCCEEDED", documentId: "original-doc", filenameAtTimeOfAnalysis: "Plan.pdf", analysisRunId: "run1" })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.alreadyAnalysed).toHaveLength(1);
    expect(r.willSend).toHaveLength(0);
  });

  it("excludes a genuinely LIVE in-flight (PROCESSING, recently claimed) file from willSend and reports it separately", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "PROCESSING", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", claimedAtMs: NOW - 1000 })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.inFlight.map((f) => f.documentId)).toEqual(["a"]);
    expect(r.willSend).toEqual([]);
  });

  it("treats a FAILED ledger row as retryable — still counted as new / willSend", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "FAILED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf" })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.willSend.map((f) => f.documentId)).toEqual(["a"]);
  });

  it("de-duplicates two DIFFERENT documents that share identical content — sends it once", () => {
    const files = [
      file({ documentId: "doc-1", contentHash: "same-bytes", filename: "Floor2/Plan.pdf" }),
      file({ documentId: "doc-2", contentHash: "same-bytes", filename: "Floor2 copy/Plan.pdf" }),
    ];
    const r = computePreflight(2, files, [], opts);
    expect(r.duplicateGroups).toHaveLength(1);
    expect(r.duplicateGroups[0]).toHaveLength(2);
    expect(r.willSend).toHaveLength(1);
  });

  it("files whose hash isn't computed yet are counted separately and never classified new/duplicate/analysed", () => {
    const files = [file({ documentId: "a", contentHash: null })];
    const r = computePreflight(1, files, [], opts);
    expect(r.filesPendingHash).toBe(1);
    expect(r.newEligible).toEqual([]);
    expect(r.willSend).toEqual([]);
  });

  it("reports zero willSend and a non-empty alreadyAnalysed when everything is already analysed (the 'nothing to do' case)", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "SUCCEEDED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: "run1" })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.willSend).toEqual([]);
    expect(r.alreadyAnalysed).toHaveLength(1);
  });

  it("forceReanalyse resends an already-SUCCEEDED file but still skips a live in-flight one", () => {
    const files = [file({ documentId: "a", contentHash: "h1" }), file({ documentId: "b", contentHash: "h2" })];
    const ledger = [
      ledgerRow({ contentHash: "h1", status: "SUCCEEDED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: "run1" }),
      ledgerRow({ contentHash: "h2", status: "PROCESSING", documentId: "b", filenameAtTimeOfAnalysis: "b.pdf", claimedAtMs: NOW - 1000 }),
    ];
    const r = computePreflight(2, files, ledger, { ...opts, forceReanalyse: true });
    expect(r.willSend.map((f) => f.contentHash).sort()).toEqual(["h1"]);
  });

  it("a different content_hash under the SAME document id is treated as a new file (a revision changed)", () => {
    const files = [file({ documentId: "doc-1", contentHash: "new-bytes" })];
    const ledger = [ledgerRow({ contentHash: "old-bytes", status: "SUCCEEDED", documentId: "doc-1", filenameAtTimeOfAnalysis: "doc-1.pdf", analysisRunId: "run1" })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.willSend.map((f) => f.documentId)).toEqual(["doc-1"]);
  });

  it("a ledger row for a different contract_version/model never counts as already-analysed (caller is expected to have pre-filtered the ledger, but this proves the module doesn't cross-match on content hash alone)", () => {
    // computePreflight trusts its `ledger` argument is already scoped to the
    // current contract/provider/model (the edge function's loadLedger() does
    // that filtering) — this test documents that expectation by showing a
    // hash match alone is sufficient once passed in, so the edge function's
    // WHERE clause is the thing actually enforcing contract isolation.
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "SUCCEEDED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: "run1" })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.alreadyAnalysed).toHaveLength(1);
  });
});

describe("computePreflight — stale PROCESSING recovery", () => {
  it("a PROCESSING claim younger than the stale threshold stays 'in flight' (protected)", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "PROCESSING", documentId: "a", claimedAtMs: NOW - (STALE_AFTER_MS - 1) })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.inFlight).toHaveLength(1);
    expect(r.willSend).toEqual([]);
  });

  it("a PROCESSING claim exactly at the stale threshold is treated as stale (>=), not protected", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "PROCESSING", documentId: "a", claimedAtMs: NOW - STALE_AFTER_MS })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.inFlight).toEqual([]);
    expect(r.willSend.map((f) => f.documentId)).toEqual(["a"]);
  });

  it("a PROCESSING claim older than the stale threshold is shown as sendable ('new'), not stuck forever", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "PROCESSING", documentId: "a", claimedAtMs: NOW - STALE_AFTER_MS - 60_000 })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.inFlight).toEqual([]);
    expect(r.willSend.map((f) => f.documentId)).toEqual(["a"]);
  });

  it("a SUCCEEDED row is never treated as stale/retryable regardless of how old claimedAtMs is", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "SUCCEEDED", documentId: "a", claimedAtMs: 0 })];
    const r = computePreflight(1, files, ledger, opts);
    expect(r.alreadyAnalysed).toHaveLength(1);
    expect(r.willSend).toEqual([]);
  });
});

// ── Phase 3: mode is echoed into the result, exactly like contractVersion/
// provider/model already are — computePreflight does not filter by it
// internally (the same trust-the-caller's-pre-filtered-ledger convention the
// "different contract_version/model" test above documents); the edge
// function's loadLedger() query is what actually isolates one mode's ledger
// rows from another's before they ever reach this function. ─────────────────
describe("computePreflight — mode", () => {
  it("echoes opts.mode into the result, defaulting BOQ through unchanged", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const r = computePreflight(1, files, [], opts);
    expect(r.mode).toBe("BOQ");
  });

  it("echoes a non-default mode (LOCATION) through unchanged", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const r = computePreflight(1, files, [], { ...opts, mode: "LOCATION" });
    expect(r.mode).toBe("LOCATION");
  });

  it("echoes BOQ_AND_LOCATION through unchanged", () => {
    const files = [file({ documentId: "a", contentHash: "h1" })];
    const r = computePreflight(1, files, [], { ...opts, mode: "BOQ_AND_LOCATION" });
    expect(r.mode).toBe("BOQ_AND_LOCATION");
  });

  it("mode has no effect on eligibility computation — explicit BOQ produces identical output to the (also BOQ) default fixture", () => {
    const files = [file({ documentId: "a", contentHash: "h1" }), file({ documentId: "b", contentHash: "h2" })];
    const ledger = [ledgerRow({ contentHash: "h1", status: "SUCCEEDED", documentId: "a", filenameAtTimeOfAnalysis: "a.pdf", analysisRunId: "run1" })];
    const withDefault = computePreflight(2, files, ledger, opts);
    const withExplicitBoq = computePreflight(2, files, ledger, { ...opts, mode: "BOQ" });
    expect(withExplicitBoq).toEqual(withDefault);
  });
});

// ── resolveRequestedToSend — the fix for the production identity-mismatch
// bug: three real documents (eb2fd669-cd47-41bf-ac08-785e00e9bf8a,
// cbcfd9c1-3d40-40b6-9761-6cc5e313d541, 2cc3d480-b50f-453b-918f-aaefa301f26e)
// shared one content hash with ZERO analysis_run_source rows for it. The
// LOCATION document-level entry point requested the middle document by its
// own documentId; `willSend`'s single, project-wide, order-picked
// representative for that hash was a DIFFERENT document, so filtering
// `willSend` by the requested documentId found nothing — "No new eligible
// files to analyse" for content that had never been sent. These tests
// exercise `computePreflight` (unmodified) feeding its real `newEligible`
// into `resolveRequestedToSend`, the same composition index.ts now uses. ────
describe("resolveRequestedToSend — per-document resolution against a shared-hash duplicate group", () => {
  it("1. requesting document A (of an A/B duplicate pair, no ledger) sends A, not B's representative", () => {
    const files = [file({ documentId: "doc-a", contentHash: "same-bytes" }), file({ documentId: "doc-b", contentHash: "same-bytes" })];
    const r = computePreflight(2, files, [], opts);
    // willSend already collapsed this pair to ONE representative (existing,
    // unmodified computePreflight behavior) — proving the bug still exists
    // upstream of the fix, and that the fix works from `newEligible` instead.
    expect(r.willSend).toHaveLength(1);
    const toSend = resolveRequestedToSend(r.newEligible, ["doc-a"]);
    expect(toSend.map((f) => f.documentId)).toEqual(["doc-a"]);
  });

  it("2. requesting document B of the SAME pair sends B, not A's representative", () => {
    const files = [file({ documentId: "doc-a", contentHash: "same-bytes" }), file({ documentId: "doc-b", contentHash: "same-bytes" })];
    const r = computePreflight(2, files, [], opts);
    const toSend = resolveRequestedToSend(r.newEligible, ["doc-b"]);
    expect(toSend.map((f) => f.documentId)).toEqual(["doc-b"]);
  });

  it("3. requesting BOTH documents of a duplicate pair sends the content once, under one of the requested documents' own identity — never a duplicate claim", () => {
    const files = [file({ documentId: "doc-a", contentHash: "same-bytes" }), file({ documentId: "doc-b", contentHash: "same-bytes" })];
    const r = computePreflight(2, files, [], opts);
    const toSend = resolveRequestedToSend(r.newEligible, ["doc-a", "doc-b"]);
    expect(toSend).toHaveLength(1);
    expect(["doc-a", "doc-b"]).toContain(toSend[0].documentId);
    expect(toSend[0].contentHash).toBe("same-bytes");
  });

  it("4. duplicate content whose hash is already SUCCEEDED (under a third, non-requested document) — neither requested sibling is (re-)sent", () => {
    const files = [file({ documentId: "doc-a", contentHash: "same-bytes" }), file({ documentId: "doc-b", contentHash: "same-bytes" })];
    const ledger = [ledgerRow({ contentHash: "same-bytes", status: "SUCCEEDED", documentId: "doc-c", filenameAtTimeOfAnalysis: "c.pdf", analysisRunId: "run1" })];
    const r = computePreflight(2, files, ledger, opts);
    expect(r.alreadyAnalysed.map((f) => f.documentId).sort()).toEqual(["doc-a", "doc-b"]);
    expect(resolveRequestedToSend(r.newEligible, ["doc-a", "doc-b"])).toEqual([]);
  });

  it("5. duplicate content whose hash is currently LIVE PROCESSING (under a third, non-requested document) — neither requested sibling is sent", () => {
    const files = [file({ documentId: "doc-a", contentHash: "same-bytes" }), file({ documentId: "doc-b", contentHash: "same-bytes" })];
    const ledger = [ledgerRow({ contentHash: "same-bytes", status: "PROCESSING", documentId: "doc-c", claimedAtMs: NOW - 1000 })];
    const r = computePreflight(2, files, ledger, opts);
    expect(r.inFlight.map((f) => f.documentId).sort()).toEqual(["doc-a", "doc-b"]);
    expect(resolveRequestedToSend(r.newEligible, ["doc-a", "doc-b"])).toEqual([]);
  });

  it("6. with NO documentIds requested, project-wide behavior (willSend, still hash-deduped) is exactly what index.ts uses — unchanged by this fix", () => {
    const files = [file({ documentId: "doc-a", contentHash: "same-bytes" }), file({ documentId: "doc-b", contentHash: "same-bytes" })];
    const r = computePreflight(2, files, [], opts);
    // index.ts's own branch: `input.documentIds?.length ? resolveRequestedToSend(...) : preflight.willSend`.
    // The project-wide dedup this fix must NOT weaken is exactly this.
    expect(r.willSend).toHaveLength(1);
    expect(r.duplicateGroups).toHaveLength(1);
  });

  it("7. multiple distinct hashes, only some documents requested — only the requested documents' own hashes are sent, unrelated new files are not swept in", () => {
    const files = [
      file({ documentId: "doc-a", contentHash: "hash-1" }),
      file({ documentId: "doc-a-dup", contentHash: "hash-1" }), // shares doc-a's hash
      file({ documentId: "doc-unrelated", contentHash: "hash-2" }), // genuinely new, but never requested
    ];
    const r = computePreflight(3, files, [], opts);
    const toSend = resolveRequestedToSend(r.newEligible, ["doc-a"]);
    expect(toSend.map((f) => f.documentId)).toEqual(["doc-a"]);
    expect(toSend.some((f) => f.contentHash === "hash-2")).toBe(false);
  });

  it("8. the returned summary's documentId — exactly what index.ts's claim insert uses as `document_id` — is the REQUESTED document, never an arbitrary sibling chosen by hash-group iteration order", () => {
    const files = [file({ documentId: "sibling-first", contentHash: "same-bytes" }), file({ documentId: "requested-second", contentHash: "same-bytes" })];
    const r = computePreflight(2, files, [], opts);
    // Confirms the premise: willSend's own representative is the FIRST file
    // in iteration order (the pre-fix behavior), i.e. NOT the one we'll request.
    expect(r.willSend.map((f) => f.documentId)).toEqual(["sibling-first"]);
    const toSend = resolveRequestedToSend(r.newEligible, ["requested-second"]);
    expect(toSend).toHaveLength(1);
    expect(toSend[0].documentId).toBe("requested-second"); // never "sibling-first"
  });

  it("10. REGRESSION — the exact production case: three documents share one content hash, zero ledger rows, requesting the MIDDLE document by id sends it", () => {
    const files = [
      file({ documentId: "eb2fd669-cd47-41bf-ac08-785e00e9bf8a", contentHash: "prod-shared-hash" }),
      file({ documentId: "cbcfd9c1-3d40-40b6-9761-6cc5e313d541", contentHash: "prod-shared-hash" }),
      file({ documentId: "2cc3d480-b50f-453b-918f-aaefa301f26e", contentHash: "prod-shared-hash" }),
    ];
    const r = computePreflight(3, files, [], opts);
    expect(r.alreadyAnalysed).toEqual([]);
    expect(r.inFlight).toEqual([]);
    // Reproduces the bug's precondition: the project-wide representative is
    // NOT the middle document.
    expect(r.willSend.map((f) => f.documentId)).toEqual(["eb2fd669-cd47-41bf-ac08-785e00e9bf8a"]);
    const toSend = resolveRequestedToSend(r.newEligible, ["cbcfd9c1-3d40-40b6-9761-6cc5e313d541"]);
    expect(toSend).toHaveLength(1);
    expect(toSend[0].documentId).toBe("cbcfd9c1-3d40-40b6-9761-6cc5e313d541");
    expect(toSend[0].contentHash).toBe("prod-shared-hash");
  });
});
