import { describe, it, expect } from "vitest";
import { buildFolderTree, folderBreadcrumb, parseRelativePath, looksLikePdf } from "./documentFolders";
import type { DocumentFolder } from "./projectDocs";

const folder = (o: Partial<DocumentFolder> & { id: string }): DocumentFolder => ({
  project_id: "p1", parent_id: null, name: o.id, sort: 0, ...o,
});

describe("buildFolderTree", () => {
  it("nests children under their parent, arbitrarily deep", () => {
    const flat = [
      folder({ id: "a", name: "Floor 2" }),
      folder({ id: "b", name: "Plumbing", parent_id: "a" }),
      folder({ id: "c", name: "Riser Diagrams", parent_id: "b" }),
      folder({ id: "d", name: "Terrace" }),
    ];
    const tree = buildFolderTree(flat);
    expect(tree.map((n) => n.name)).toEqual(["Floor 2", "Terrace"]);
    const floor2 = tree.find((n) => n.name === "Floor 2")!;
    expect(floor2.children.map((n) => n.name)).toEqual(["Plumbing"]);
    expect(floor2.children[0].children.map((n) => n.name)).toEqual(["Riser Diagrams"]);
  });

  it("treats a folder with an unresolvable parent_id as a root rather than dropping it", () => {
    const flat = [folder({ id: "orphan", name: "Orphan", parent_id: "missing-parent" })];
    const tree = buildFolderTree(flat);
    expect(tree.map((n) => n.name)).toEqual(["Orphan"]);
  });

  it("sorts by sort, then name, at every level", () => {
    const flat = [
      folder({ id: "b", name: "Beta", sort: 1 }),
      folder({ id: "a", name: "Alpha", sort: 0 }),
      folder({ id: "z", name: "Zed", sort: 0 }),
    ];
    expect(buildFolderTree(flat).map((n) => n.name)).toEqual(["Alpha", "Zed", "Beta"]);
  });

  it("returns an empty tree for an empty list", () => {
    expect(buildFolderTree([])).toEqual([]);
  });
});

describe("folderBreadcrumb", () => {
  const flat = [
    folder({ id: "a", name: "Floor 2" }),
    folder({ id: "b", name: "Plumbing", parent_id: "a" }),
    folder({ id: "c", name: "Riser Diagrams", parent_id: "b" }),
  ];

  it("returns an empty array for null (root/unfiled)", () => {
    expect(folderBreadcrumb(null, flat)).toEqual([]);
  });

  it("returns the full path from root to the given folder", () => {
    expect(folderBreadcrumb("c", flat)).toEqual(["Floor 2", "Plumbing", "Riser Diagrams"]);
  });

  it("returns a single-element path for a root folder", () => {
    expect(folderBreadcrumb("a", flat)).toEqual(["Floor 2"]);
  });

  it("never hangs on a cyclic parent chain (defensive — should never occur in practice)", () => {
    const cyclic = [folder({ id: "x", name: "X", parent_id: "y" }), folder({ id: "y", name: "Y", parent_id: "x" })];
    expect(folderBreadcrumb("x", cyclic)).toEqual(["Y", "X"]);
  });
});

describe("parseRelativePath", () => {
  it("splits nested folder segments from the filename", () => {
    expect(parseRelativePath("Floor 2/Plumbing/Plan.pdf")).toEqual({ folderSegments: ["Floor 2", "Plumbing"], fileName: "Plan.pdf" });
  });

  it("handles a file directly inside the selected root folder", () => {
    expect(parseRelativePath("Terrace/Pool Detail.pdf")).toEqual({ folderSegments: ["Terrace"], fileName: "Pool Detail.pdf" });
  });

  it("drops blank segments from stray slashes", () => {
    expect(parseRelativePath("Floor 2//Plan.pdf")).toEqual({ folderSegments: ["Floor 2"], fileName: "Plan.pdf" });
  });

  it("handles a bare filename with no folder segments", () => {
    expect(parseRelativePath("Plan.pdf")).toEqual({ folderSegments: [], fileName: "Plan.pdf" });
  });
});

describe("looksLikePdf", () => {
  it("accepts a correct MIME type", () => {
    expect(looksLikePdf({ name: "x.pdf", type: "application/pdf" })).toBe(true);
  });
  it("accepts a .pdf extension even with a missing/wrong MIME type (common for folder-picker files)", () => {
    expect(looksLikePdf({ name: "Plan.PDF", type: "" })).toBe(true);
  });
  it("rejects a non-PDF file", () => {
    expect(looksLikePdf({ name: "notes.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe(false);
  });
});
