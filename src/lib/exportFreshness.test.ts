import { describe, it, expect } from "vitest";
import { PDF_REREAD_FAILED_MESSAGE, rereadFailedMessage, rereadForExport } from "./exportFreshness";

const ok = <T,>(v: T) => () => Promise.resolve(v);
const fail = () => Promise.reject(new Error("network down"));

describe("rereadForExport — the lines and the commercial settings, re-read together", () => {
  it("returns both when both reads succeed", async () => {
    expect(await rereadForExport(ok([1]), ok({ _gst_pct: 12 }))).toEqual({ ok: true, lines: [1], settings: { _gst_pct: 12 } });
  });
  it("names the read that failed", async () => {
    expect(await rereadForExport(fail, ok({}))).toEqual({ ok: false, failed: "lines" });
    expect(await rereadForExport(ok([]), fail)).toEqual({ ok: false, failed: "settings" });
    expect(await rereadForExport(fail, fail)).toEqual({ ok: false, failed: "both" });
  });
});

describe("rereadFailedMessage", () => {
  it("keeps the existing lines wording", () => {
    expect(rereadFailedMessage("lines", "pdf")).toBe(PDF_REREAD_FAILED_MESSAGE);
    expect(rereadFailedMessage("lines", "csv")).toBe("Could not re-read the BOQ lines, so nothing was exported. Try again.");
  });
  it("a settings failure names the settings, never the lines", () => {
    expect(rereadFailedMessage("settings", "csv")).toBe("Could not re-read the BOQ's commercial settings (contingency, overheads, cess, GST), so nothing was exported. Try again.");
    expect(rereadFailedMessage("settings", "pdf")).not.toContain("BOQ lines");
    expect(rereadFailedMessage("both", "pdf")).toContain("the BOQ lines or the BOQ's commercial settings");
  });
});
