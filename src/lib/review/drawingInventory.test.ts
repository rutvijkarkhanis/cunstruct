import { describe, it, expect } from "vitest";
import {
  buildDrawingInventory, classifyText, labelKey, parseDimensionPair, runBox, textPageFromPdfExtraction,
  type DrawingTextPage, type DrawingTextRun,
} from "./drawingInventory";
import { syntheticPlanText } from "./__fixtures__/syntheticPlanText";

const run = (text: string, x: number, y: number, width = 30, height = 6, direction: [number, number] = [1, 0]): DrawingTextRun =>
  ({ text, origin: [x, y], direction, width, height });
const page = (runs: DrawingTextRun[], pageNo = 1): DrawingTextPage =>
  ({ documentId: "doc", page: pageNo, pageSize: { width: 595, height: 842 }, textLayer: "available", runs });

describe("parseDimensionPair", () => {
  it("reads feet-inches pairs exactly, in whole inches", () => {
    expect(parseDimensionPair(`14'2" X 12'4"`)).toEqual({ first: { value: 170, unit: "in", text: `14'2"` }, second: { value: 148, unit: "in", text: `12'4"` } });
    expect(parseDimensionPair(`8' X 5'6"`)?.first.value).toBe(96);
    expect(parseDimensionPair(`12'5"x4'`)?.second.value).toBe(48);
    expect(parseDimensionPair(`12'-6" × 10'`)?.first.value).toBe(150);
  });

  it("reads metric pairs with their units, and keeps differing units visible", () => {
    expect(parseDimensionPair("3.5 x 4.2 m")).toEqual({ first: { value: 3.5, unit: "m", text: "3.5", unitStated: false }, second: { value: 4.2, unit: "m", text: "4.2m" } });
    expect(parseDimensionPair("3500mm x 4.2m")).toMatchObject({ first: { unit: "mm" }, second: { unit: "m" } });
  });

  it("rejects impossible inches, single lengths, areas and unitless numbers", () => {
    for (const t of [`5'14" X 6'`, `9'-3"`, "3960 SQFT", "3500 x 4200", `6'6" WIDE BALCONY`]) expect(parseDimensionPair(t)).toBeNull();
  });
});

describe("classifyText — conservative", () => {
  it.each([
    ["MASTER BEDROOM", "space_label", "room"], ["W.R", "space_label", "room"], ["W.I.C", "space_label", "room"],
    ["DRESS", "space_label", "room"], ["LIFT", "space_label", "room"], ["6'6\" WIDE PASSAGE", "space_label", "circulation"],
    ["10' WIDE BALCONY", "space_label", "outdoor"],
  ])("%s is a %s (%s)", (text, kind, spaceClass) => {
    expect(classifyText(text)).toMatchObject({ kind, spaceClass });
  });

  it.each(["DRESS UNIT", "OH STORAGE", "WARDROBE", "SHOWER", "WC", "PLASMA", "SB1", "15 AMP", "SECURITY GATE", "FLAT AREA", "STUDY UNIT"])(
    "%s is not a space", (text) => {
      expect(classifyText(text).kind).not.toBe("space_label");
    });

  it("recognises dimensions, lengths, areas and sheet titles", () => {
    expect(classifyText(`15'6" X 12'3"`).kind).toBe("room_dimension");
    expect(classifyText(`9'-3"`).kind).toBe("length_annotation");
    expect(classifyText("(SLAB AREA - 4202 SFT)").kind).toBe("area_annotation");
    expect(classifyText("FIRST FLOOR PLAN")).toEqual({ kind: "sheet_title", floorText: "FIRST FLOOR" });
    expect(classifyText("DOOR.NO: 12-34-56/7(8), 4TH FLOOR,").kind).not.toBe("sheet_title");
  });

  it("labelKey ignores case and punctuation", () => {
    expect(labelKey("W.R")).toBe(labelKey("wr"));
    expect(labelKey("Children Bedroom-1")).toBe(labelKey("CHILDREN BEDROOM 1"));
  });
});

describe("runBox — canonical page boxes for any reading direction", () => {
  it("horizontal text sits above its baseline", () => {
    expect(runBox(run("W.R", 325, 224.8, 11.8, 6.1))).toEqual([325, 218.70000000000002, 336.8, 224.8]);
  });
  it("bottom-to-top text extends up the page from its origin and left of its baseline", () => {
    expect(runBox(run("PASSAGE", 212, 385, 67, 7, [0, -1]))).toEqual([205, 318, 212, 385]);
  });
});

describe("buildDrawingInventory", () => {
  it("identifies each page's floor from its sheet title, and reports conflicts and absences", () => {
    const inv = buildDrawingInventory([
      page([run("FIRST FLOOR PLAN", 135, 806, 148, 15)], 1),
      page([run("SECOND FLOOR PLAN", 122, 807, 165, 15), run("THIRD FLOOR PLAN", 122, 30, 165, 15)], 2),
      page([run("KITCHEN", 10, 10)], 3),
    ]);
    expect(inv.pages.map((p) => p.floor)).toEqual([
      { status: "identified", floor: "First Floor", candidateId: "doc:p1:0" },
      { status: "conflict", floors: ["Second Floor", "Third Floor"] },
      { status: "unidentified" },
    ]);
  });

  it("a page with no text layer is marked absent, with no candidates", () => {
    const p = textPageFromPdfExtraction("doc", { page: 4, pageSize: { width: 595, height: 842 }, textRuns: [] });
    expect(p.textLayer).toBe("absent");
    const inv = buildDrawingInventory([p]);
    expect(inv.candidates).toEqual([]);
    expect(inv.pages[0].textLayer).toBe("absent");
  });

  it("on a whole plan, keeps every repeated W.R / W.I.C label as its own candidate", () => {
    const inv = buildDrawingInventory(syntheticPlanText("plan"));
    const count = (pageNo: number, key: string) =>
      inv.candidates.filter((c) => c.page === pageNo && c.kind === "space_label" && labelKey(c.text) === key).length;
    expect([count(1, "WR"), count(1, "WIC")]).toEqual([3, 0]);
    expect([count(2, "WR"), count(2, "WIC")]).toEqual([0, 2]);
    expect(inv.pages.map((p) => p.floor.status === "identified" && p.floor.floor)).toEqual(["First Floor", "Second Floor"]);
  });

});

// Unitless metric sizes ("3850 X 3500"): read as numbers, but given a unit
// only by an explicit note on the same page — never from their magnitude.
describe("unitless dimension pairs and unit evidence", () => {
  const sized = (text: string) => classifyText(text).dimension;

  it("parses plain-number pairs with any separator and spacing, keeping the printed text and leaving the unit open", () => {
    for (const [text, a, b] of [["3850 X 3500", 3850, 3500], ["1350x980", 1350, 980], ["2277.50 x 2400", 2277.5, 2400], ["1350 × 1182.5", 1350, 1182.5], ["  3500X3715 ", 3500, 3715]] as const) {
      expect(sized(text)).toMatchObject({ first: { value: a, unit: null }, second: { value: b, unit: null }, unitBasis: { kind: "unresolved" } });
    }
    expect(sized("2277.50 x 2400")!.first.text).toBe("2277.50");
  });

  it("rejects malformed or incomplete pairs instead of guessing", () => {
    for (const text of ["2277.50 x 2400 |", "3850 X", "X 3500", "0 x 3500", "3850 X 3500 X 2400", "3850 - 3500", "1350 x 1182.505", "a X 3500", "3850 sins"]) {
      expect(classifyText(text).kind).not.toBe("room_dimension");
    }
  });

  it("existing formats are unchanged: feet-inches and metric with printed units carry no unit basis", () => {
    expect(parseDimensionPair(`15'6" X 12'3"`)).toEqual({ first: { value: 186, unit: "in", text: `15'6"` }, second: { value: 147, unit: "in", text: `12'3"` } });
    expect(parseDimensionPair("3500mm x 4.2m")).toMatchObject({ first: { unit: "mm" }, second: { unit: "m" } });
    expect(parseDimensionPair("3850 X 3500")).toBeNull();
  });

  it("recognises unit notes", () => {
    expect(classifyText("ALL DIMENSIONS ARE IN MM")).toEqual({ kind: "unit_note", unitNote: "mm" });
    expect(classifyText("Note: all dimensions in millimetres unless noted")).toMatchObject({ unitNote: "mm" });
    expect(classifyText("All dimensions are in feet and inches unless specified.")).toMatchObject({ unitNote: "ft-in" });
    expect(classifyText("Total Area (G.F.) 187.14 Sqm").kind).toBe("area_annotation");
  });

  const pageWith = (texts: string[], pageNo = 1): DrawingTextPage =>
    page(texts.map((t, i) => run(t, 50, 50 + i * 40, 60)), pageNo);
  const dimOf = (inv: ReturnType<typeof buildDrawingInventory>, text: string, pageNo = 1) =>
    inv.candidates.find((c) => c.page === pageNo && c.text === text)!.dimension!;

  it("with an explicit mm note on the page, unitless sizes take mm and record where it came from", () => {
    const inv = buildDrawingInventory([pageWith(["ALL DIMENSIONS ARE IN MM", "BED ROOM", "3850 X 3500"])]);
    const d = dimOf(inv, "3850 X 3500");
    expect(d.first).toEqual({ value: 3850, unit: "mm", text: "3850" });
    expect(d.unitBasis).toEqual({ kind: "page_note", candidateId: "doc:p1:0", note: "ALL DIMENSIONS ARE IN MM" });
    expect(d.normalization).toContain(`Unit mm from the page note "ALL DIMENSIONS ARE IN MM"`);
  });

  it("without a note — even with metric area statements on the page — the unit stays unresolved", () => {
    const inv = buildDrawingInventory([pageWith(["BED ROOM", "3850 X 3500", "One Unit Area 42.95 Sqm", "SCALE 1:100"])]);
    expect(dimOf(inv, "3850 X 3500")).toMatchObject({ first: { unit: null }, unitBasis: { kind: "unresolved" } });
  });

  it("a note on another page does not apply; conflicting or non-metric notes leave it unresolved", () => {
    const inv = buildDrawingInventory([pageWith(["ALL DIMENSIONS ARE IN MM"], 1), pageWith(["3850 X 3500"], 2)]);
    expect(dimOf(inv, "3850 X 3500", 2).unitBasis!.kind).toBe("unresolved");
    const conflict = buildDrawingInventory([pageWith(["ALL DIMENSIONS ARE IN MM", "ALL DIMENSIONS ARE IN METRES", "3850 X 3500"])]);
    expect(dimOf(conflict, "3850 X 3500").unitBasis).toEqual({ kind: "unresolved", reason: "This page's notes state different units (mm, m)." });
    const feet = buildDrawingInventory([pageWith(["ALL DIMENSIONS ARE IN FEET AND INCHES", "3850 X 3500"])]);
    expect(dimOf(feet, "3850 X 3500")).toMatchObject({ first: { unit: null }, unitBasis: { kind: "unresolved" } });
  });
});
