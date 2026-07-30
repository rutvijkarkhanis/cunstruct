// Turns room-by-room dimensions into the quantity drivers the BOQ engine needs.
// All lengths are in feet; areas in square feet.

export interface Room {
  room_type?: string | null;
  length_ft?: number | null;
  width_ft?: number | null;
  height_ft?: number | null;
  count?: number | null;
  electrical_points?: number | null;
}

export interface Dimensions {
  floorAreaSqft: number;
  wallAreaSqft: number;
  rooms: number;
  bathrooms: number;
  points: number;
}

// Fraction of gross wall area taken up by doors/windows, deducted from paintable/
// plasterable wall area. 15% is a common rule-of-thumb.
export const OPENING_FACTOR = 0.15;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeDimensions(rooms: Room[]): Dimensions {
  let floor = 0;
  let wall = 0;
  let count = 0;
  let bathrooms = 0;
  let points = 0;

  for (const r of rooms ?? []) {
    const l = Number(r.length_ft) || 0;
    const w = Number(r.width_ft) || 0;
    const h = Number(r.height_ft) || 0;
    const c = Math.max(1, Math.floor(Number(r.count) || 1));

    floor += l * w * c;
    // Wall area = perimeter × height, less openings.
    wall += 2 * (l + w) * h * c * (1 - OPENING_FACTOR);
    count += c;
    if ((r.room_type ?? "").toLowerCase() === "bathroom") bathrooms += c;
    points += (Number(r.electrical_points) || 0) * c;
  }

  return {
    floorAreaSqft: round1(floor),
    wallAreaSqft: round1(wall),
    rooms: count,
    bathrooms,
    points,
  };
}

/** A blank dimensions object (used when a project has no rooms yet). */
export const EMPTY_DIMENSIONS: Dimensions = {
  floorAreaSqft: 0,
  wallAreaSqft: 0,
  rooms: 0,
  bathrooms: 0,
  points: 0,
};
