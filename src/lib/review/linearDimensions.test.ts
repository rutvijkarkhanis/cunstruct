import { describe, it, expect } from "vitest";
import type { DrawingGeometry } from "./drawingGeometry";
import type { ExtractedTextRun } from "./pdfGeometry";
import { calibratePage, extractLinearDimensions, parseLinearDimensionText, relateAcrossPages, scaleNoteRatio } from "./linearDimensions";

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
/** A short oblique tick crossing a horizontal line at (x, y) — the dimension's terminator. */
const tick = (x: number, y: number) => line(x - 1.5, y + 1.5, x + 1.5, y - 1.5);
/** A horizontal dimension: line at y from x0 to x1, extension lines that end just past it, and a tick where each meets the line. */
const hdim = (y: number, x0: number, x1: number, ...marks: number[]) =>
  [line(x0, y, x1, y), ...[x0, x1, ...marks].flatMap((x) => [line(x, y - 10, x, y + 2), tick(x, y)])];

function plan(extra: { shapes?: DrawingGeometry[]; runs?: ExtractedTextRun[] } = {}) {
  const shapes = [
    ...hdim(100, 0, 250, 100), // chain 0-100-250
    ...hdim(115, 0, 250), // overall 0-250
    line(60, 50, 60, 180), // a wall running straight through both lines: not a terminator
    ...hdim(150, 400, 500), // 100 long, labelled 4000: a mislabel
    ...hdim(200, 0, 100), // the same 0-100 stretch again, lower down
    line(600, 0, 600, 100), line(590, 0, 602, 0), line(590, 100, 602, 100), tick(600, 0), tick(600, 100), // vertical 0-100
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

  it("a number beside a round tag, overlapping only the tag's box, is still read as a dimension", () => {
    // a door tag's circle (700-712, 300-312) and a "620" whose baseline sits inside the
    // circle's box but whose text is below the circle's middle, on its own dimension line
    const beside = plan({
      shapes: [shape("path", [[700, 300], [700, 312], [712, 312], [712, 300]]), ...hdim(312, 690, 722)],
      runs: [text("D3", 706, 307), text("620", 706, 311)],
    });
    expect(beside.excluded.some((e) => e.text === "620")).toBe(false);
    expect(byText(beside, "620")).toBeDefined();
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

describe("a dimension line interrupted by its own text (common in CAD exports)", () => {
  // "2000" centred on x=150, baseline y=401 (width 7.2, so it covers 146.4-153.6);
  // dimension line at y=400 from x=100 to x=200 with extension lines at both ends.
  const ext = [line(100, 390, 100, 402), line(200, 390, 200, 402), tick(100, 400), tick(200, 400)];
  const read = (pieces: DrawingGeometry[], extra: DrawingGeometry[] = []) =>
    extractLinearDimensions({ page: 1, shapes: [...pieces, ...ext, ...extra], textRuns: [text("2000", 150, 401)] }).dimensions[0];

  it("reads the two pieces either side of the text as one line, and says so", () => {
    const d = read([line(100, 400, 145, 400), line(155, 400, 200, 400)]);
    expect(d.line).toMatchObject({ a: [100, 400], b: [200, 400], joinedAcrossText: true });
    expect(d.span).toMatchObject({ start: [100, 400], end: [200, 400], length: 100, ends: ["stroke-tick", "stroke-tick"] });
  });

  it("an unbroken line is not marked as joined", () => {
    expect(read([line(100, 400, 200, 400)]).line).toEqual({ a: [100, 400], b: [200, 400] });
  });

  it("does not join across a gap that something crosses (the text would sit over two dimensions)", () => {
    const d = read([line(100, 400, 145, 400), line(155, 400, 200, 400)], [line(150, 395, 150, 405)]);
    expect(d.line).toBeNull();
    expect(d.status).toBe("unassociated");
  });

  it("does not join pieces whose gap is much wider than the text", () => {
    const d = read([line(100, 400, 120, 400), line(180, 400, 200, 400)]);
    expect(d.line).toBeNull();
    expect(d.status).toBe("unassociated");
  });
});

describe("scale per drawing region, each dimension checked against the others", () => {
  // two viewports on one sheet: a plan at 20 units/pt (left) and a detail at 5 units/pt (right, far away)
  const plan2 = (extra: { shapes?: DrawingGeometry[]; runs?: ExtractedTextRun[] } = {}) => extractLinearDimensions({
    page: 1,
    shapes: [...hdim(100, 0, 100), ...hdim(130, 0, 150), ...hdim(160, 0, 75), // plan: 2000, 3000, 1500
      ...hdim(100, 2000, 2080), ...hdim(130, 2000, 2060), ...hdim(160, 2000, 2040), // detail: 400, 300, 200
      ...(extra.shapes ?? [])],
    textRuns: [text("2000", 50, 98), text("3000", 75, 128), text("1500", 37.5, 158), text("400", 2040, 98), text("300", 2030, 128), text("200", 2020, 158), ...(extra.runs ?? [])],
  });

  it("finds a separate scale for each region; neither is snapped to a standard ratio", () => {
    const r = plan2();
    expect(r.regions.map((g) => g.valuePerPoint).sort((a, b) => a - b)).toEqual([5, 20]);
    expect(r.dimensions.every((d) => d.status === "consistent")).toBe(true);
  });

  it("validates each dimension against the OTHER members of its region, and records that", () => {
    const d = byText(plan2(), "2000");
    expect(d.scaleCheck).toMatchObject({ valuePerPoint: 20, basedOn: 2, deviation: 0 });
  });

  it("a region of only three can still check each against the other two; with fewer it can't check at all", () => {
    const r = extractLinearDimensions({ page: 1, shapes: [...hdim(100, 0, 100), ...hdim(130, 0, 150)], textRuns: [text("2000", 50, 98), text("3000", 75, 128)] });
    expect(r.regions).toEqual([]);
    expect(r.dimensions.map((d) => d.decisions.scale)).toEqual(["unavailable", "unavailable"]);
  });

  it("a dimension where regions of different scales overlap is not checked against either", () => {
    // a second detail at 5 units/pt placed just below the plan, so the two regions' extents overlap
    // around y=180; a dimension there that belongs to neither group can't be given one scale
    const r = plan2({
      shapes: [...hdim(200, 0, 80), ...hdim(230, 0, 60), ...hdim(260, 0, 40), ...hdim(180, 20, 70)],
      runs: [text("400", 40, 198), text("300", 30, 228), text("200", 20, 258), text("999", 45, 178)],
    });
    const d = byText(r, "999");
    expect(d.decisions.scale).toBe("unavailable");
    expect(d.reasons.join(" ")).toMatch(/regions of different scales meet/);
  });

  it("only text that says SCALE is a scale note; a slope ratio is not", () => {
    const r = plan2({ runs: [text("SCALE 1:50", 500, 500), text("slope 1:12", 600, 600)] });
    expect(r.scaleNotes.map((n) => n.ratio)).toEqual([50]);
  });
});

describe("separate decisions per stage", () => {
  it("a consistent dimension with no element at its ends is held, not accepted, with the reason", () => {
    const d = byText(plan(), "3000");
    expect(d.decisions).toMatchObject({ line: "found", endpoints: "valid-pair", scale: "consistent", overall: "hold" });
    expect(d.decisions.association).not.toBe("associated");
    expect(d.reasons.join(" ")).toMatch(/can be tied|cannot be tied|could be measured from more than one/);
  });

  it("text with no dimension line is rejected; a line without terminators is rejected too", () => {
    expect(byText(plan(), "1500").decisions).toMatchObject({ line: "not-found", overall: "reject" });
    const bare = extractLinearDimensions({ page: 1, shapes: [line(0, 100, 100, 100)], textRuns: [text("2000", 50, 98)] }).dimensions[0];
    expect(bare.decisions).toMatchObject({ line: "found", endpoints: "unresolved", overall: "reject" });
  });

  it("of two equally close lines, the one with a terminator either side of the text is chosen, and that is recorded", () => {
    // text baseline at y=98: the dimension line at y=99 (with ticks) and a parallel line at y=97 are equally close.
    // The other line ends nowhere near a terminator (10-90). (Had it ended exactly at the extension lines it would be
    // a valid perpendicular-stroke dimension line too, and the text would rightly be ambiguous.)
    const r = extractLinearDimensions({ page: 1, shapes: [...hdim(99, 0, 100), line(10, 97, 90, 97)], textRuns: [text("2000", 50, 98)] });
    expect(r.dimensions[0].decisions.line).toBe("chosen-by-endpoints");
    expect(r.dimensions[0].span).toMatchObject({ start: [0, 99], end: [100, 99] });
    expect(r.dimensions[0].reasons.join(" ")).toMatch(/alone has a terminator either side/);
  });

  it("an accepted dimension needs every stage: text, line, endpoints, scale, unit and association", () => {
    // grid bubbles at both ends with grid lines drawn from their outlines through the ticks
    const bubbles = (xs: number[], labels: string[]) => xs.flatMap((x, k) => [shape("path", [[x - 4, 56], [x + 4, 56], [x + 4, 64], [x - 4, 64]]), line(x, 64, x, 200)]);
    const r = extractLinearDimensions({
      page: 1,
      shapes: [...hdim(100, 0, 100), ...hdim(130, 0, 150), ...hdim(160, 0, 75), ...bubbles([0, 100], ["1", "2"])],
      textRuns: [text("ALL DIMENSIONS ARE IN MM", 300, 300), text("2000", 50, 98), text("3000", 75, 128), text("1500", 37.5, 158), text("1", 0, 61.5), text("2", 100, 61.5)],
    });
    const d = byText(r, "2000");
    expect(d.association).toMatchObject({ decision: "associated", measures: "grid-to-grid" });
    expect(d.decisions.overall).toBe("acceptable");
    expect(d.statedMm).toBe(2000);
  });
});

describe("the same grids dimensioned on different views", () => {
  const sheet = (page: number, value: string) => {
    const shapes = [...hdim(100, 0, 100), ...hdim(130, 0, 150), ...hdim(160, 0, 75),
      ...[0, 100].flatMap((x) => [shape("path", [[x - 4, 56], [x + 4, 56], [x + 4, 64], [x - 4, 64]]), line(x, 64, x, 200)])];
    return extractLinearDimensions({ page, shapes, textRuns: [text(value, 50, 98), text("3000", 75, 128), text("1500", 37.5, 158), text("9", 0, 61.5), text("10", 100, 61.5)] });
  };

  it("different printed values for the same pair of grids are a conflict, held on every view; no value is chosen", () => {
    const a = sheet(1, "2000"), b = sheet(4, "2000");
    // the second sheet prints a different value over the same grids (drawn at the same length)
    const c = sheet(5, "1990");
    relateAcrossPages([a, b, c]);
    const all = [byText(a, "2000"), byText(b, "2000"), c.dimensions.find((d) => d.text === "1990")!];
    for (const d of all.filter((x) => x.association?.measures === "grid-to-grid")) {
      expect(d.crossView).toMatchObject({ conflict: true });
      expect(d.decisions.overall).not.toBe("acceptable");
    }
  });
});
