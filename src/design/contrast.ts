/**
 * WCAG 2.x contrast maths for design tokens ("H S% L%" triplets).
 * Used by contrast.test.ts (the gate) and the design-system page (display).
 */
import { STATES, THEMES, type Theme } from "./tokens";

/** Parse "H S% L%" → [h, s, l] with s,l in 0..1. */
export function parseHsl(triplet: string): [number, number, number] {
  const m = triplet.trim().match(/^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) throw new Error(`Not an "H S% L%" triplet: ${triplet}`);
  return [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100];
}

/** HSL → sRGB, each channel 0..1. */
export function hslToRgb(triplet: string): [number, number, number] {
  const [h, s, l] = parseHsl(triplet);
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** WCAG relative luminance. */
export function relativeLuminance(triplet: string): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hslToRgb(triplet).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 4.5:1 body text (SC 1.4.3) or 3:1 non-text UI / icons (SC 1.4.11). */
export type PairKind = "text" | "ui";
export const REQUIRED: Record<PairKind, number> = { text: 4.5, ui: 3 };

export interface ContrastPair {
  theme: Theme;
  name: string;
  fg: string;
  bg: string;
  kind: PairKind;
}

/**
 * Every foreground/background pair the design system actually renders.
 * Adding a token that is drawn on a surface means adding its pair here.
 */
export function contrastPairs(): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  for (const theme of ["light", "dark"] as Theme[]) {
    const { base, states } = THEMES[theme];
    const p = (name: string, fg: string, bg: string, kind: PairKind) => pairs.push({ theme, name, fg, bg, kind });
    for (const [surfName, surf] of [["bg", base.bg], ["surface", base.surface]] as const) {
      p(`fg on ${surfName}`, base.fg, surf, "text");
      p(`mutedFg on ${surfName}`, base.mutedFg, surf, "text");
      p(`controlBorder on ${surfName}`, base.controlBorder, surf, "ui");
      p(`focusRing on ${surfName}`, base.focusRing, surf, "ui");
      p(`primary (button fill) on ${surfName}`, base.primary, surf, "ui");
    }
    p("primaryFg on primary", base.primaryFg, base.primary, "text");
    for (const s of STATES) {
      const c = states[s];
      p(`${s} label on badge`, c.fg, c.bg, "text");
      p(`${s} icon on badge`, c.fg, c.bg, "ui");
      // Badge outline must stand out from wherever the badge sits.
      p(`${s} border on bg`, c.border, base.bg, "ui");
      p(`${s} border on surface`, c.border, base.surface, "ui");
      // Cells tint only their text with the state colour, on the plain surface.
      p(`${s} text on surface`, c.text, base.surface, "text");
      p(`${s} text on bg`, c.text, base.bg, "text");
    }
  }
  return pairs;
}
