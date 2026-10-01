import { describe, it, expect } from "vitest";
import { markersForAll, markersForCategory, markersForType, markersForInstance, withPdfGeometry } from "./drawingMarkers";
import { groupByCategory } from "./typeGrouping";
import type { StoredReviewItem } from "./reviewStore";
import type { LocationObservation } from "./locationObservations";
import { instancesForType } from "./typeInstances";
import type { DrawingGeometry } from "./drawingGeometry";

function item(overrides: Partial<StoredReviewItem["ai"]> & { key: string; item: string }): StoredReviewItem {
  return { id: overrides.key, reviewStatus: "PENDING_REVIEW", ai: { quantity: 1, confidence: 0.9, aiStatus: "MEASURED", ...overrides } };
}
function obs(overrides: Partial<LocationObservation> & { id: string; mark: string }): LocationObservation {
  return {
    observationType: "opening", scopeHint: null, locationText: null, attributes: {},
    evidence: { evidence: [{ bbox: [0, 0, 10, 10], page: 1 }] },
    evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const w1 = item({
  key: "W1", item: "Window W1", quantity: 2, unit: "nos",
  source: { document: "d", page: 1, evidence: [{ bbox: [1, 1, 2, 2], page: 1, claim: "quantity" }] },
});
const w2 = item({
  key: "W2", item: "Window W2", quantity: 1, unit: "nos",
  source: { document: "d", page: 1, evidence: [{ bbox: [3, 3, 4, 4], page: 1 }] },
});
const d1 = item({ key: "D1", item: "Door D1", quantity: 1, unit: "nos", source: { document: "d", page: 1, evidence: [{ bbox: [5, 5, 6, 6], page: 1 }] } });

const groups = groupByCategory([w1, w2, d1]);
const windows = groups.find((g) => g.category === "Windows")!;
const doors = groups.find((g) => g.category === "Doors")!;

describe("markersForAll", () => {
  it("includes every real evidence box from every type, all muted, nothing singled out", () => {
    const markers = markersForAll(groups, new Map());
    expect(markers).toHaveLength(3); // one evidence box per item
    expect(markers.every((m) => m.emphasis === "muted")).toBe(true);
    expect(markers.map((m) => m.reviewItemId).sort()).toEqual(["D1", "W1", "W2"]);
  });

  it("uses real LOCATION instances instead of evidence when a type has them — never both", () => {
    const instances = instancesForType({ key: "W1" }, [obs({ id: "o1", mark: "W1" }), obs({ id: "o2", mark: "W1" })]);
    const map = new Map([["W1", instances]]);
    const markers = markersForAll(groups, map);
    const w1Markers = markers.filter((m) => m.reviewItemId === "W1");
    expect(w1Markers).toHaveLength(2);
    expect(w1Markers.every((m) => m.kind === "instance")).toBe(true);
    // W2/D1 still fall back to their own evidence.
    expect(markers.filter((m) => m.reviewItemId === "W2")[0].kind).toBe("evidence");
  });

  it("drops a box with no resolvable page — never places it on whatever page happens to be open", () => {
    const noPage = item({ key: "X1", item: "Thing X1", source: { document: "d", evidence: [{ bbox: [0, 0, 1, 1] }] } });
    const g = groupByCategory([noPage]);
    expect(markersForAll(g, new Map())).toEqual([]);
  });
});

describe("markersForCategory", () => {
  it("emphasizes every type in the selected category as secondary, and contributes nothing from other categories", () => {
    const markers = markersForCategory(windows, new Map());
    expect(markers.map((m) => m.reviewItemId).sort()).toEqual(["W1", "W2"]);
    expect(markers.every((m) => m.emphasis === "secondary")).toBe(true);

    const doorMarkers = markersForCategory(doors, new Map());
    expect(doorMarkers.map((m) => m.reviewItemId)).toEqual(["D1"]);
  });
});

describe("markersForType", () => {
  it("highlights ALL real instances of the selected type together as secondary — 'these make up this type'", () => {
    const instances = instancesForType({ key: "W1" }, [obs({ id: "o1", mark: "W1" }), obs({ id: "o2", mark: "W1" }), obs({ id: "o3", mark: "W2" })]);
    const markers = markersForType(w1, "Windows", instances);
    expect(markers).toHaveLength(2); // only W1's own instances (o1, o2) — instancesForType already filtered o3 out
    expect(markers.every((m) => m.kind === "instance" && m.emphasis === "secondary")).toBe(true);
  });

  it("falls back to the type's own evidence when it has no real instances — never fabricates one", () => {
    const markers = markersForType(w1, "Windows", []);
    expect(markers).toHaveLength(1);
    expect(markers[0].kind).toBe("evidence");
  });

  it("flags an instance whose recorded dimension disagrees with its parent type's declared dimension", () => {
    const differing = item({ key: "W3", item: "Window W3", dimension: "3' x 4'", source: { document: "d", evidence: [] } });
    const instances = instancesForType({ key: "W3", dimension: "3' x 4'" }, [obs({ id: "o1", mark: "W3", attributes: { dimension: "4' x 5'" } })]);
    const markers = markersForType(differing, "Windows", instances);
    expect(markers[0].differsFromType).toBe(true);
  });
});

describe("markersForInstance", () => {
  it("gives the focused instance primary emphasis and its siblings secondary — never hides them", () => {
    const instances = instancesForType({ key: "W1" }, [obs({ id: "o1", mark: "W1" }), obs({ id: "o2", mark: "W1" })]);
    const markers = markersForInstance(w1, "Windows", instances, "o2");
    const focused = markers.find((m) => m.id === "o2:0")!;
    const sibling = markers.find((m) => m.id === "o1:0")!;
    expect(focused.emphasis).toBe("primary");
    expect(sibling.emphasis).toBe("secondary");
    expect(markers).toHaveLength(2); // the sibling is still present, just subordinate
  });

  it("falls back to markersForType's behavior when the requested id isn't one of this type's instances", () => {
    const instances = instancesForType({ key: "W1" }, [obs({ id: "o1", mark: "W1" })]);
    const markers = markersForInstance(w1, "Windows", instances, "does-not-exist");
    expect(markers.every((m) => m.emphasis === "secondary")).toBe(true);
  });
});

describe("marker labels", () => {
  it("labels a single instance with just the type key, and multiple instances with an ordinal", () => {
    const single = instancesForType({ key: "W1" }, [obs({ id: "o1", mark: "W1" })]);
    expect(markersForType(w1, "Windows", single)[0].label).toBe("W1");

    const multi = instancesForType({ key: "W1" }, [obs({ id: "o1", mark: "W1" }), obs({ id: "o2", mark: "W1" })]);
    const labels = markersForType(w1, "Windows", multi).map((m) => m.label).sort();
    expect(labels).toEqual(["W1 #1", "W1 #2"]);
  });
});

function pdfPolygon(bbox: [number, number, number, number], page = 1): DrawingGeometry {
  return {
    type: "polygon", page,
    points: [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]]],
    bbox, source: "PDF", confidenceTier: "deterministic",
  };
}

describe("withPdfGeometry — additive geometry upgrade", () => {
  it("is a no-op when no PDF shapes are supplied — box-only behavior unchanged", () => {
    const markers = markersForAll(groups, new Map());
    const upgraded = withPdfGeometry(markers, new Map());
    expect(upgraded).toEqual(markers);
  });

  it("attaches real geometry to the one marker whose box matches a real PDF shape, leaving others untouched", () => {
    const markers = markersForAll(groups, new Map());
    // W1's evidence box is [1,1,2,2] (see the `w1` fixture above) — give it a
    // matching PDF polygon; W2/D1 have no matching shape on this page.
    const shapesByPage = new Map([[1, [pdfPolygon([1, 1, 2, 2])]]]);
    const upgraded = withPdfGeometry(markers, shapesByPage);

    const w1Marker = upgraded.find((m) => m.reviewItemId === "W1")!;
    expect(w1Marker.geometry).toBeDefined();
    expect(w1Marker.geometry!.type).toBe("polygon");
    expect(w1Marker.geometry!.source).toBe("HYBRID");
    expect(w1Marker.box).toEqual({ bbox: [1, 1, 2, 2], page: 1, claim: "quantity" }); // box untouched

    const w2Marker = upgraded.find((m) => m.reviewItemId === "W2")!;
    expect(w2Marker.geometry).toBeUndefined(); // no matching shape — unchanged
    const d1Marker = upgraded.find((m) => m.reviewItemId === "D1")!;
    expect(d1Marker.geometry).toBeUndefined();
  });

  it("never upgrades an ambiguous match (two shapes overlapping one box) — box fallback preserved", () => {
    const markers = markersForAll(groups, new Map());
    const shapesByPage = new Map([[1, [pdfPolygon([1, 1, 2, 2]), pdfPolygon([1.05, 1.05, 2.05, 2.05])]]]);
    const upgraded = withPdfGeometry(markers, shapesByPage);
    const w1Marker = upgraded.find((m) => m.reviewItemId === "W1")!;
    expect(w1Marker.geometry).toBeUndefined();
  });

  it("upgrades an instance marker (LOCATION origin) the same way as an evidence marker", () => {
    const instances = instancesForType({ key: "W1" }, [obs({ id: "o1", mark: "W1" })]); // evidence bbox [0,0,10,10] per the `obs` fixture
    const markers = markersForType(w1, "Windows", instances);
    const shapesByPage = new Map([[1, [pdfPolygon([0, 0, 10, 10])]]]);
    const upgraded = withPdfGeometry(markers, shapesByPage);
    expect(upgraded[0].kind).toBe("instance");
    expect(upgraded[0].geometry?.source).toBe("HYBRID");
  });
});
