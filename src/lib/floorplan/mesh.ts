// FLOOR PLAN MESH — what the 3D viewer draws, as plain numbers (no three.js
// here, so it can be tested). Units are metres. Plan x maps to 3D x, plan y
// (down the page) maps to 3D z, height is 3D y.

import { effectiveHeight, wallLength, type BuildingModel, type Wall } from "./model";

export interface WallBox {
  id: string;
  /** Centre of the box, m. */
  center: [number, number, number];
  /** Length along the wall, height, thickness, m. */
  size: [number, number, number];
  /** Rotation about the vertical axis, radians. */
  rotationY: number;
  status: Wall["status"];
}

/** One box per wall that has a height. Walls without a height are left out
 *  (and listed by the caller), never drawn at a made-up height. */
export function wallBoxes(m: BuildingModel): { boxes: WallBox[]; withoutHeight: string[] } {
  const boxes: WallBox[] = [];
  const withoutHeight: string[] = [];
  for (const w of m.walls) {
    const h = effectiveHeight(m, w);
    const L = wallLength(w);
    if (h == null) { withoutHeight.push(w.id); continue; }
    if (L <= 0) continue;
    const cx = (w.start[0] + w.end[0]) / 2000, cz = (w.start[1] + w.end[1]) / 2000;
    boxes.push({
      id: w.id,
      center: [cx, h / 2000, cz],
      size: [L / 1000, h / 1000, w.thicknessMm / 1000],
      rotationY: -Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]),
      status: w.status,
    });
  }
  return { boxes, withoutHeight };
}

/** Plan extent of all walls (m), for framing the camera and the ground grid. */
export function planBounds(m: BuildingModel): { min: [number, number]; max: [number, number] } | null {
  if (!m.walls.length) return null;
  const xs = m.walls.flatMap((w) => [w.start[0], w.end[0]]).map((v) => v / 1000);
  const zs = m.walls.flatMap((w) => [w.start[1], w.end[1]]).map((v) => v / 1000);
  return { min: [Math.min(...xs), Math.min(...zs)], max: [Math.max(...xs), Math.max(...zs)] };
}
