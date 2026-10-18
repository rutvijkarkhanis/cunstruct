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
//   E1 sets:    BENCH_E1_ROOT=<benchmark-inputs/E1> BENCH_OUT=<dir> [BENCH_E1_CHECK_ONLY=1] \
//                 npx vitest run --config scripts/benchmark/vitest.bench.config.ts score-set-a
//               Checks every set folder against the E1 kit (e1Intake.ts), writes
//               e1-intake.json, and scores the complete sets only, each against its
//               gold reference. CHECK_ONLY writes the intake report without scoring.
// Without the inputs it verifies the frozen hashes only. Outputs stay local
// (BENCH_OUT); never commit them. See docs/benchmarks/BENCHMARK-EXECUTION-PLAN.md.
import { describe, it, expect, vi } from "vitest";
import { resolve, dirname } from "node:path";

vi.mock("@/integrations/supabase/client", async () => await import("@/lib/e2e/inMemorySupabase"));

import { seedCatalogue } from "@/lib/dsr/seedFixture";
import { FROZEN_V1_1, frozenHashesNow } from "./gates";
import { buildPricingIndex } from "./metrics";
import { runManifest, runSet, setOutcome } from "./runner";
import { checkE1Root, manifestFromE1 } from "./e1Intake";
import { mkdirSync, writeFileSync } from "node:fs";

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

  it.runIf(!!env.BENCH_E1_ROOT)("checks the E1 sets and scores the complete ones against their gold references", async () => {
    expect(frozenHashesNow()).toEqual(FROZEN_V1_1);
    const out = resolve(env.BENCH_OUT ?? "benchmark-inputs/e1-out");
    mkdirSync(out, { recursive: true });
    const { sets, portfolio, ignoredFolders, localExclusions } = checkE1Root(env.BENCH_E1_ROOT!);
    console.log(`E1 root: ${sets.length} set folder(s); ignored (not S01-style): ${ignoredFolders.join(", ") || "none"}; local excluded hashes: ${localExclusions}`);
    const { manifest, refused } = manifestFromE1(sets);
    writeFileSync(resolve(out, "e1-intake.json"), JSON.stringify({ portfolio, sets, refused: refused.map((r) => r.id), ignoredFolders, localExclusions }, null, 2));
    for (const s of sets) console.log(`${s.id}: ${s.complete ? "complete" : `incomplete — ${s.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`).join("; ")}`}`);
    console.log(`E1: ${portfolio.complete} of ${portfolio.sets} sets complete; plan count ${portfolio.meetsPlanCount ? "met" : "NOT met"}, spread ${portfolio.meetsPlanSpread ? "met" : "NOT met"}${portfolio.missing.length ? ` (${portfolio.missing.join("; ")})` : ""}`);
    if (env.BENCH_E1_CHECK_ONLY || manifest.sets.length === 0) return;
    writeFileSync(resolve(out, "manifest.json"), JSON.stringify(manifest, null, 2));
    const { results } = await runManifest(resolve(out, "manifest.json"), out, buildPricingIndex(seedCatalogue()));
    for (const r of results) console.log(`${r.id} [${r.role}]: ${setOutcome(r)}`);
    const errors = results.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
