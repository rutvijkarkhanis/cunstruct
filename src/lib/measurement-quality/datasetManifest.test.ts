import { describe, it, expect } from "vitest";
import { assertDevelopmentSet, assertUsable, changeRole, DatasetManifest, DATASET_MANIFEST_SCHEMA, type DatasetRole } from "./datasetManifest";

// SYNTHETIC manifests only.
const H = (c: string) => c.repeat(64);
const manifest = (role: DatasetRole, over: Partial<DatasetManifest> = {}): DatasetManifest => DatasetManifest.parse({
  schema: DATASET_MANIFEST_SCHEMA, dataset_id: `T-${role}`, description: "synthetic", role,
  role_history: [{ from: null, to: role, date: "2026-10-30", decided_by: "owner", reason: "initial split" }],
  files: [{ name: "a.pdf", sha256: H("a"), pages: 1, producer: null, text_layer: "yes", content: "native-vector", multiple_scales_on_one_sheet: false }],
  annotations: { provenance: "none", independent: false, reviewer: null, verification_date: null, reference_file: null, reference_sha256: null },
  ...over,
});

describe("dataset roles", () => {
  it("development data may be used for development and tuning", () => {
    expect(() => assertUsable(manifest("development"), "tuning")).not.toThrow();
  });

  it("a holdout cannot enter a development benchmark, or even be inspected, without a release authorization", () => {
    expect(() => assertDevelopmentSet([manifest("development"), manifest("holdout")])).toThrow(/role "holdout"/);
    expect(() => assertUsable(manifest("holdout"), "intake-diagnostic")).toThrow(/does not permit/);
    expect(() => assertUsable(manifest("holdout"), "release-holdout")).toThrow(/no recorded release authorization/);
  });

  it("an authorized holdout is usable once, and only with the engine it was authorized for", () => {
    const m = manifest("holdout", { release_authorization: { by: "owner", date: "2026-11-01", engine_fingerprint: H("e") } });
    expect(() => assertUsable(m, "release-holdout", { engineFingerprint: H("e") })).not.toThrow();
    expect(() => assertUsable(m, "release-holdout", { engineFingerprint: H("f") })).toThrow(/authorized only for engine/);
  });

  it("validation data cannot be used for tuning", () => {
    expect(() => assertUsable(manifest("validation"), "tuning")).toThrow(/does not permit "tuning"/);
    expect(() => assertUsable(manifest("validation"), "validation")).not.toThrow();
  });

  it("raster validation data is kept separate from native-vector validation", () => {
    const raster = manifest("validation", { modality: "raster" });
    expect(() => assertUsable(raster, "validation")).toThrow(/cannot be used as native-vector validation/);
    expect(() => assertUsable(raster, "raster-validation")).not.toThrow();
    expect(() => assertUsable(manifest("validation"), "raster-validation")).toThrow(/needs a raster dataset/);
  });

  it("a frozen holdout cannot be validated just because its file is present", () => {
    const c03 = manifest("holdout", { files: [{ name: "duplex.pdf", sha256: H("d"), status: "present", pages: 29, producer: null, text_layer: "unknown", content: "unknown", scales: [], viewports: [], multiple_scales_on_one_sheet: null, pages_in_scope: [7] }] });
    for (const p of ["validation", "development-benchmark", "review-packages", "intake-diagnostic"] as const) expect(() => assertUsable(c03, p)).toThrow(/role "holdout"/);
  });

  it("out-of-domain data is a negative test only, never a measurement benchmark", () => {
    expect(() => assertUsable(manifest("out-of-domain"), "development-benchmark")).toThrow();
    expect(() => assertUsable(manifest("out-of-domain"), "negative-test")).not.toThrow();
  });
});

describe("role changes", () => {
  it("validation → development needs the recorded validation run", () => {
    expect(() => changeRole(manifest("validation"), { to: "development", date: "2026-12-01", decided_by: "owner", reason: "done" })).toThrow(/recorded validation run/);
    const m = changeRole(manifest("validation"), { to: "development", date: "2026-12-01", decided_by: "owner", reason: "validation complete", completed_run: { report: "r.md", sha256: H("b") } });
    expect(m.role).toBe("development");
    expect(m.role_history).toHaveLength(2);
  });

  it("nothing that has been looked at can become a holdout", () => {
    expect(() => changeRole(manifest("development"), { to: "holdout", date: "2026-12-01", decided_by: "owner", reason: "x" })).toThrow(/cannot become a holdout/);
  });

  it("a manifest whose role disagrees with its history is invalid", () => {
    const bad = { ...manifest("development"), role: "validation" as const };
    expect(DatasetManifest.safeParse(bad).success).toBe(false);
    expect(() => assertUsable(bad, "validation")).toThrow(/invalid manifest/);
  });

  it("a present file must carry its full hash; a pending one may not yet", () => {
    const f = { name: "c.pdf", sha256: null, pages: null, producer: null, text_layer: "unknown", content: "unknown", multiple_scales_on_one_sheet: null };
    expect(DatasetManifest.safeParse({ ...manifest("validation"), files: [{ ...f, status: "present" }] }).success).toBe(false);
    expect(DatasetManifest.safeParse({ ...manifest("validation"), files: [{ ...f, status: "pending" }] }).success).toBe(true);
  });
});
