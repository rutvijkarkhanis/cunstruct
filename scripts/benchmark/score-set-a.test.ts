// BENCHMARK SCORING DRIVER — runs the frozen extraction acceptance protocol
// (docs/benchmarks/extraction-acceptance-protocol.md, amended by
// extraction-acceptance-protocol-v1.1.md) on one drawing or on every set of a
// manifest. It only CALLS the frozen functions (runEndToEnd, scoreEndToEnd,
// validateReferenceBoq, systemItemsOf) unchanged; gates.ts reads the gates off
// their report and metrics.ts adds per-category metrics from the same report.
//
// Not part of the test suite (outside vitest.config include). Run with:
//   Many sets:  BENCH_MANIFEST=<manifest .json> BENCH_OUT=<dir> \
//                 npx vitest run --config scripts/benchmark/vitest.bench.config.ts score-set-a
//   One set:    BENCH_ANALYSIS=<extractor output .json> BENCH_REFERENCE=<reference .json> \
//                 BENCH_DRAWING_SHA=<sha256 of the drawing PDF> BENCH_CONTRACT=<{lineId:"in"|"out"} .json> \
//                 [BENCH_PAGE_SIZES=<{"1":{"width":..,"height":..}} .json>] [BENCH_DOC_NAME=...] \
//                 [BENCH_DECISIONS=<review decisions .json>] BENCH_OUT=<dir> \
//                 npx vitest run --config scripts/benchmark/vitest.bench.config.ts score-set-a
// Without the inputs it verifies the frozen hashes only. Outputs stay local
// (BENCH_OUT); never commit them. See docs/benchmarks/BENCHMARK-EXECUTION-PLAN.md.
import { describe, it, expect, vi } from "vitest";
import { resolve, dirname } from "node:path";

vi.mock("@/integrations/supabase/client", async () => await import("@/lib/e2e/inMemorySupabase"));

import { seedCatalogue } from "@/lib/dsr/seedFixture";
import { FROZEN_V1_1, frozenHashesNow } from "./gates";
import { buildPricingIndex } from "./metrics";
import { runManifest, runSet, setOutcome } from "./runner";

export { FROZEN_V1_1, gates, type GateResult } from "./gates";

const env = process.env;

describe("Benchmark scoring (protocol v1.1)", () => {
  it("frozen software matches protocol v1.1 §2", () => {
    expect(frozenHashesNow()).toEqual(FROZEN_V1_1);
  });

  it.runIf(!!env.BENCH_ANALYSIS && !!env.BENCH_REFERENCE)("scores one drawing", async () => {
    expect(frozenHashesNow()).toEqual(FROZEN_V1_1);
    const out = resolve(env.BENCH_OUT ?? "benchmark-inputs/set-a-out");
    const r = await runSet({
      id: "set-a", role: "acceptance", documentName: env.BENCH_DOC_NAME ?? "Set A drawing",
      drawingSha256: env.BENCH_DRAWING_SHA ?? "", analysis: resolve(env.BENCH_ANALYSIS!), reference: resolve(env.BENCH_REFERENCE!),
      contract: env.BENCH_CONTRACT ? resolve(env.BENCH_CONTRACT) : {}, pageSizes: env.BENCH_PAGE_SIZES ? resolve(env.BENCH_PAGE_SIZES) : undefined,
      decisions: env.BENCH_DECISIONS ? resolve(env.BENCH_DECISIONS) : undefined,
    }, dirname(out), out, buildPricingIndex(seedCatalogue()));
    expect(r.error, r.error).toBeUndefined();
    console.log(setOutcome(r));
    console.log(JSON.stringify(r.gates, null, 2));
  });

  it.runIf(!!env.BENCH_MANIFEST)("scores every set of the manifest", async () => {
    expect(frozenHashesNow()).toEqual(FROZEN_V1_1);
    const out = resolve(env.BENCH_OUT ?? "benchmark-inputs/bench-out");
    const { results, summary } = await runManifest(resolve(env.BENCH_MANIFEST!), out, buildPricingIndex(seedCatalogue()));
    for (const s of summary.sets) console.log(`${s.id} [${s.role}]: ${s.outcome}`);
    console.log(`summary: ${resolve(out, "summary.json")}`);
    const errors = results.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
