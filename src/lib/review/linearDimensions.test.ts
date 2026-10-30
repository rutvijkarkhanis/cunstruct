import { describe, it, expect } from "vitest";
import type { DrawingGeometry } from "./drawingGeometry";
import type { ExtractedTextRun } from "./pdfGeometry";
import { calibratePage, extractLinearDimensions, parseLinearDimensionText, scaleNoteRatio } from "./linearDimensions";

// SYNTHETIC plan only. 1 page unit = 20 printed units (e.g. 20 mm).
const shape = (type: DrawingGeometry["type"], points: [number, number][]): DrawingGeometry => {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { type, page: 1, points, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], source: "PDF", confidenceTier: "deterministic" };
};
const line = (x0: number, y0: number, x1: number, y1: number) => shape("line", [[x0, y0], [x1, y1]]);
const H = 3;
/** Horizontal text centred on x with its baseline at y. */
const text = (t: string, x: number, y: number): ExtractedTextRun => {
  const width = 0.6 * H * t.length;
  return { page: 1, text: t, x: x - width / 2, y, width, height: H, direction: [1, 0] };
};
/** Text reading bottom-to-top, centred on y, baseline at x. */
const vtext = (t: string, x: number, y: number): ExtractedTextRun => {
  const width = 0.6 * H * t.length;
  return { page: 1, text: t, x, y: y + width / 2, width, height: H, direction: [0, -1] };
};
/** A horizontal dimension: line at y from x0 to x1 with extension lines that end just past it. */
const hdim = (y: number, x0: number, x1: number, ...marks: number[]) =>
  [line(x0, y, x1, y), ...[x0, x1, ...marks].map((x) => line(x, y - 10, x, y + 2))];

function plan(extra: { shapes?: DrawingGeometry[]; runs?: ExtractedTextRun[] } = {}) {
  const shapes = [
    ...hdim(100, 0, 250, 100), // chain 0-100-250
    ...hdim(115, 0, 250), // overall 0-250
    line(60, 50, 60, 180), // a wall running straight through both lines: not a terminator
    ...hdim(150, 400, 500), // 100 long, labelled 4000: a mislabel
    ...hdim(200, 0, 100), // the same 0-100 stretch again, lower down
    line(600, 0, 600, 100), line(590, 0, 602, 0), line(590, 100, 602, 100), // vertical 0-100
    shape("path", [[290, 300], [290, 306], [296, 306], [296, 300]]), // a bubble
    ...(extra.shapes ?? []),
  ];
  const runs = [
    text("2000", 50, 98), text("3000", 175, 98), text("5000", 125, 113),
    text("4000", 450, 148), text("1500", 900, 700), text("2000", 50, 198),
    vtext("2000", 598, 50), text("1", 293, 304),
    ...(extra.runs ?? []),
  ];
  return extractLinearDimensions({ page: 1, shapes, textRuns: runs });
}
const byText = (r: ReturnType<typeof plan>, t: string, i = 0) => r.dimensions.filter((d) => d.text === t)[i];

describe("notation", () => {
  it.each([
    ["3900", 3900, null], ["3,900", 3900, null], ["3.9 m", 3.9, "m"], ["390cm", 390, "cm"], ["4500 mm", 4500, "mm"],
    ["12'-6\"", 150, "in"], ["12' 6 1/2\"", 150.5, "in"], ["6'-0 3/4\"", 72.75, "in"], ["9\"", 9, "in"], ["3/4\"", 0.75, "in"],
    ["12'", 144, "in"], ["5’-2”", 62, "in"],
  ])("%s → %s %s", (t, value, unit) => {
    expect(parseLinearDimensionText(t)).toMatchObject({ value, unit });
  });
  it.each(["5'14\"", "01", "1/3\"", "A103", "01/29/21", "1:25", "0", "3900 X 3500", "BEDROOM"])("%s is not one length", (t) => {
    expect(parseLinearDimensionText(t)).toBeNull();
  });
  it("a scale note's ratio is read; other numbers are not", () => {
    expect(scaleNoteRatio("SCALE 1 : 100")).toBe(100);
    expect(scaleNoteRatio("1:25")).toBe(25);
    expect(scaleNoteRatio("01/29/21")).toBeNull();
  });
});

describe("calibration from the page's own dimensions", () => {
  it("needs three agreeing dimensions with different values", () => {
    expect(calibratePage([{ value: 2000, length: 100 }, { value: 3000, length: 150 }])).toBeNull();
    expect(calibratePage([{ value: 2000, length: 100 }, { value: 2000, length: 100 }, { value: 2000, length: 100 }])).toBeNull();
    expect(calibratePage([{ value: 2000, length: 100 }, { value: 3000, length: 150 }, { value: 5000, length: 250 }, { value: 4000, length: 100 }]))
      .toMatchObject({ valuePerPoint: 20, support: 3, distinctValues: 3 });
  });
});

describe("dimension strings on a synthetic plan", () => {
  const r = plan();

  it("calibrates the page from its dimensions, not from any note", () => {
    expect(r.scale).toMatchObject({ valuePerPoint: 20, mmPerPoint: null });
  });

  it("finds each text's line and the terminators either side; a wall passing through is not one", () => {
    const d = byText(r, "2000");
    expect(d.status).toBe("consistent");
    expect(d.span).toMatchObject({ start: [0, 100], end: [100, 100], length: 100 });
    expect(d.measured).toEqual({ value: 2000, mm: null });
  });

  it("reads text running bottom-to-top against its vertical line", () => {
    const d = r.dimensions.find((x) => x.text === "2000" && x.span?.start[0] === 600)!;
    expect(d.status).toBe("consistent");
    expect(d.span!.length).toBe(100);
  });

  it("a value that disagrees with its drawn length is a conflict, never consistent", () => {
    const d = byText(r, "4000");
    expect(d.status).toBe("conflict");
    expect(d.measured!.value).toBe(2000);
    expect(d.reasons.join(" ")).toMatch(/does not match the drawn length/);
  });

  it("text with no line beside it is unassociated", () => {
    expect(byText(r, "1500")).toMatchObject({ status: "unassociated", span: null, measured: null });
  });

  it("a number inside a bubble is excluded, with the reason kept", () => {
    expect(r.dimensions.some((d) => d.text === "1")).toBe(false);
    expect(r.excluded).toEqual([expect.objectContaining({ text: "1", reason: expect.stringMatching(/tag inside a small closed outline/) })]);
  });

  it("chains and the overall dimension that totals them are related, and the sum is checked", () => {
    const a = byText(r, "2000"), b = byText(r, "3000"), o = byText(r, "5000");
    expect(a.role).toBe("chain");
    expect(b.chain).toBe(a.chain);
    expect(o).toMatchObject({ role: "overall", covers: { ids: [a.id, b.id], sum: 5000, agrees: true } });
  });

  it("the same value over the same stretch is flagged as a possible repeat, not removed", () => {
    const second = byText(r, "2000", 1);
    expect(second.possibleRepeatOf).toBe(byText(r, "2000").id);
    expect(second.status).toBe("consistent");
    expect(second.reasons.join(" ")).toMatch(/Confirm before counting both/);
  });

  it("without a unit printed or noted there is no millimetre value", () => {
    expect(byText(r, "2000")).toMatchObject({ unit: null, unitBasis: "none", statedMm: null });
  });

  it("a page unit note gives the unit; a scale note that disagrees with the calibration is reported", () => {
    const n = plan({ runs: [text("ALL DIMENSIONS ARE IN MM", 300, 600), text("SCALE 1:100", 300, 620)] });
    expect(byText(n, "2000")).toMatchObject({ unit: "mm", unitBasis: "page-note", statedMm: 2000, measured: { value: 2000, mm: 2000 } });
    expect(n.scale!.mmPerPoint).toBe(20);
    expect(n.scaleNotes).toEqual([expect.objectContaining({ ratio: 100, agreesWithCalibration: false })]);
  });

  it("without enough agreeing dimensions nothing is checked", () => {
    const only = extractLinearDimensions({ page: 1, shapes: hdim(100, 0, 100), textRuns: [text("2000", 50, 98)] });
    expect(only.scale).toBeNull();
    expect(only.dimensions[0].status).toBe("unchecked");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(r));
  });
});
