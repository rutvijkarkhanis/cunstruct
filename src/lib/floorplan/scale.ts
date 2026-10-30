// FLOOR PLAN SCALE — how many millimetres one page unit stands for.
//
// PURE. A scale is never assumed. It comes from either:
//   - a calibration: two points the user picks on the plan plus the real
//     distance between them, which the user types; or
//   - a printed scale note ("SCALE 1:100"), offered only as a SUGGESTION the
//     user must confirm, because a sheet can be printed or exported at a
//     different size from the one its note assumes.

import { dist, type Point } from "./geometry";

/** PDF page units are points: 1 pt = 25.4/72 mm on the printed sheet. */
export const MM_PER_POINT = 25.4 / 72;

export interface Scale {
  mmPerUnit: number;
  source: "calibration" | "scale-note";
  /** What it rests on, for traceability. */
  evidence: string;
}

export function calibrate(p: Point, q: Point, realMm: number): Scale {
  const d = dist(p, q);
  if (!(d > 0)) throw new Error("Pick two different points to calibrate.");
  if (!(Number.isFinite(realMm) && realMm > 0)) throw new Error("Enter the real distance between the points, in millimetres.");
  return {
    mmPerUnit: realMm / d,
    source: "calibration",
    evidence: `${Math.round(realMm)} mm between (${p[0].toFixed(1)}, ${p[1].toFixed(1)}) and (${q[0].toFixed(1)}, ${q[1].toFixed(1)}) on the page`,
  };
}

export interface ScaleSuggestion {
  ratio: number;
  text: string;
  /** Position of the note on the page, so the user can check it. */
  at: Point;
  /** mm per page unit IF the sheet is at its intended paper size. */
  mmPerUnit: number;
}

const SCALE_NOTE = /\b1\s*:\s*(\d{1,4})\b/;

/** Printed scale notes on the page ("1:100", "SCALE 1 : 50"). Suggestions
 *  only; several different notes on one sheet are all returned. */
export function scaleSuggestions(textRuns: { text: string; x: number; y: number }[]): ScaleSuggestion[] {
  const seen = new Map<number, ScaleSuggestion>();
  for (const t of textRuns) {
    const m = SCALE_NOTE.exec(t.text);
    if (!m) continue;
    const ratio = Number(m[1]);
    if (ratio < 1 || ratio > 2000 || seen.has(ratio)) continue;
    seen.set(ratio, { ratio, text: t.text.trim(), at: [t.x, t.y], mmPerUnit: ratio * MM_PER_POINT });
  }
  return [...seen.values()].sort((a, b) => a.ratio - b.ratio);
}

export function fromScaleNote(s: ScaleSuggestion): Scale {
  return { mmPerUnit: s.mmPerUnit, source: "scale-note", evidence: `printed note "${s.text}" (1:${s.ratio}), confirmed by the user` };
}
