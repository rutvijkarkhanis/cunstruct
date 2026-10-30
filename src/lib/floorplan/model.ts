// FLOOR PLAN MODEL — the editable building: walls in millimetres, each with
// its source and status, plus the derived quantities.
//
// PURE. Every wall is either read from the drawing (with the ids of the lines
// it came from) or drawn by the user; a candidate stays "candidate" until the
// user confirms it. Heights are never assumed: a wall without its own height
// uses the storey height the user enters, and with neither it has no height,
// no 3D extrusion and no area or volume.

import type { Point } from "./geometry";
import type { Scale } from "./scale";
import type { WallCandidate } from "./walls";

export type WallSource = "drawing" | "manual";
export type WallStatus = "candidate" | "confirmed";

export interface Wall {
  id: string;
  start: Point; // mm
  end: Point; // mm
  thicknessMm: number;
  /** Own height; null = use the storey height. */
  heightMm: number | null;
  source: WallSource;
  status: WallStatus;
  /** For drawing walls: page and the two line ids. */
  evidence?: { page: number; lines: [string, string] };
}

export interface BuildingModel {
  scale: Scale | null;
  storeyHeightMm: number | null;
  walls: Wall[];
}

export const emptyModel = (): BuildingModel => ({ scale: null, storeyHeightMm: null, walls: [] });

const positive = (v: number | null | undefined) => typeof v === "number" && Number.isFinite(v) && v > 0;

export function wallsFromCandidates(cands: WallCandidate[], startId = 1): Wall[] {
  return cands.map((c, i) => ({
    id: `W${startId + i}`,
    start: c.start,
    end: c.end,
    thicknessMm: c.thicknessMm,
    heightMm: null,
    source: "drawing",
    status: "candidate",
    evidence: { page: c.page, lines: c.evidence },
  }));
}

export function nextWallId(walls: Wall[]): string {
  const n = walls.reduce((m, w) => Math.max(m, Number(w.id.replace(/^W/, "")) || 0), 0);
  return `W${n + 1}`;
}

export function addManualWall(m: BuildingModel, start: Point, end: Point, thicknessMm: number): BuildingModel {
  if (!positive(thicknessMm)) throw new Error("Enter the wall thickness in millimetres.");
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) <= 0) throw new Error("A wall needs two different end points.");
  const w: Wall = { id: nextWallId(m.walls), start, end, thicknessMm, heightMm: null, source: "manual", status: "confirmed" };
  return { ...m, walls: [...m.walls, w] };
}

export type WallEdit = Partial<Pick<Wall, "thicknessMm" | "heightMm" | "start" | "end" | "status">>;

export function updateWall(m: BuildingModel, id: string, edit: WallEdit): BuildingModel {
  if (edit.thicknessMm !== undefined && !positive(edit.thicknessMm)) throw new Error("Thickness must be a positive number of millimetres.");
  if (edit.heightMm !== undefined && edit.heightMm !== null && !positive(edit.heightMm)) throw new Error("Height must be a positive number of millimetres.");
  return { ...m, walls: m.walls.map((w) => (w.id === id ? { ...w, ...edit } : w)) };
}

/** Set a wall's length by moving its end point along the wall's own line. */
export function setWallLength(m: BuildingModel, id: string, lengthMm: number): BuildingModel {
  if (!positive(lengthMm)) throw new Error("Length must be a positive number of millimetres.");
  const w = m.walls.find((x) => x.id === id);
  if (!w) return m;
  const L = wallLength(w);
  const end: Point = [w.start[0] + ((w.end[0] - w.start[0]) / L) * lengthMm, w.start[1] + ((w.end[1] - w.start[1]) / L) * lengthMm];
  return updateWall(m, id, { end });
}

export const deleteWall = (m: BuildingModel, id: string): BuildingModel => ({ ...m, walls: m.walls.filter((w) => w.id !== id) });

export const wallLength = (w: Wall) => Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);

export function effectiveHeight(m: BuildingModel, w: Wall): number | null {
  if (positive(w.heightMm)) return w.heightMm;
  return positive(m.storeyHeightMm) ? m.storeyHeightMm : null;
}

export interface WallQuantities {
  walls: number;
  confirmed: number;
  candidates: number;
  /** Sum of centreline lengths, m. */
  lengthM: number;
  /** One face, length x height, m² (null when any wall has no height). */
  faceAreaM2: number | null;
  /** length x thickness x height, m³ (null when any wall has no height). */
  volumeM3: number | null;
  /** What these figures do and don't account for. */
  basis: string;
}

/** Gross quantities of the CONFIRMED walls only: centreline length; corner
 *  overlaps and openings are not deducted. Candidates are counted, not
 *  measured. */
export function quantities(m: BuildingModel): WallQuantities {
  const confirmed = m.walls.filter((w) => w.status === "confirmed");
  let len = 0, area = 0, vol = 0, allHeights = true;
  for (const w of confirmed) {
    const L = wallLength(w) / 1000;
    len += L;
    const h = effectiveHeight(m, w);
    if (h == null) { allHeights = false; continue; }
    area += L * (h / 1000);
    vol += L * (w.thicknessMm / 1000) * (h / 1000);
  }
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    walls: m.walls.length,
    confirmed: confirmed.length,
    candidates: m.walls.length - confirmed.length,
    lengthM: r(len),
    faceAreaM2: confirmed.length && allHeights ? r(area) : null,
    volumeM3: confirmed.length && allHeights ? r(vol) : null,
    basis: "Confirmed walls only. Gross: centreline length × height (× thickness for volume); corner overlaps and door/window openings are not deducted.",
  };
}
