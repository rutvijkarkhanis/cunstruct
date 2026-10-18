/**
 * Cunstruct design tokens (plan item D1).
 *
 * Single source of truth for the values in `tokens.css`. The contrast test
 * (`contrast.test.ts`) computes WCAG ratios from THIS file and also checks
 * that `tokens.css` declares exactly these values, so the two cannot drift.
 *
 * Colours are HSL triplets ("H S% L%") — the same convention as the existing
 * shadcn variables in src/index.css — so they can be used as
 * `hsl(var(--ds-…))`.
 *
 * Rules (see docs/design/DESIGN-SYSTEM.md):
 *  - UI chrome is neutral; colour carries meaning only, and never alone:
 *    every state is colour + icon + text label (WCAG 2.2 SC 1.4.1).
 *  - Text pairs meet 4.5:1 (SC 1.4.3); icons, borders and focus rings meet
 *    3:1 (SC 1.4.11).
 *  - Interactive targets are at least 24×24 CSS px (SC 2.5.8).
 *  - Drawings always render on the light palette, in either theme.
 */

export type Theme = "light" | "dark";

/** Semantic review/evidence states shared with the prototype team. */
export const STATES = [
  "VERIFIED_HUMAN",
  "MACHINE_UNVERIFIED",
  "NEEDS_REVIEW",
  "BLOCKING",
  "PENDING_QTY",
  "UNAVAILABLE",
  "EXCLUDED",
] as const;
export type SemanticState = (typeof STATES)[number];

/** Icon identifiers (mapped to lucide-react glyphs in StatusBadge). */
export type StateIcon = "check" | "dotted-circle" | "triangle" | "octagon" | "hourglass" | "slash-circle" | "minus-circle";

export interface StateMeta {
  /** Visible text label — always rendered next to the icon. */
  label: string;
  icon: StateIcon;
  /** Hue family, for documentation only. */
  hue: "green" | "neutral" | "amber" | "red" | "grey" | "muted";
  /** Badge treatment: filled tint, or outline-only on the surface. */
  fill: "solid" | "outline";
  /** Border line style. */
  border: "solid" | "dotted" | "dashed";
  /** Cell content in this state is struck through (EXCLUDED). */
  strike?: boolean;
  /** One-line meaning for the design-system page and docs. */
  meaning: string;
}

export const STATE_META: Record<SemanticState, StateMeta> = {
  VERIFIED_HUMAN: {
    label: "Verified", icon: "check", hue: "green", fill: "solid", border: "solid",
    meaning: "A person checked this against the drawing.",
  },
  MACHINE_UNVERIFIED: {
    label: "Not yet checked", icon: "dotted-circle", hue: "neutral", fill: "solid", border: "dotted",
    meaning: "Machine-extracted; no person has checked it yet.",
  },
  NEEDS_REVIEW: {
    label: "Needs review", icon: "triangle", hue: "amber", fill: "solid", border: "solid",
    meaning: "Flagged for a person to look at before it can be trusted.",
  },
  BLOCKING: {
    label: "Blocking", icon: "octagon", hue: "red", fill: "solid", border: "solid",
    meaning: "Must be resolved before the BOQ can be signed off.",
  },
  PENDING_QTY: {
    label: "Quantity pending", icon: "hourglass", hue: "amber", fill: "outline", border: "solid",
    meaning: "The line exists but its quantity is unresolved — never shown as 0.",
  },
  UNAVAILABLE: {
    label: "No evidence", icon: "slash-circle", hue: "grey", fill: "solid", border: "solid",
    meaning: "No drawing evidence was found for this value.",
  },
  EXCLUDED: {
    label: "Excluded", icon: "minus-circle", hue: "muted", fill: "outline", border: "dashed", strike: true,
    meaning: "Deliberately left out of totals; kept visible, struck through.",
  },
};

/** Per-state colours. */
export interface StateColors {
  /** Badge label + icon colour, drawn on `bg`. */
  fg: string;
  /** Badge fill. */
  bg: string;
  /** Badge outline. */
  border: string;
  /** State-tinted text drawn directly on the plain surface (grid cells). */
  text: string;
}

/** Neutral base palette for a theme. */
export interface BaseColors {
  /** Page background. */
  bg: string;
  /** Card / grid surface. */
  surface: string;
  /** Body text. */
  fg: string;
  /** Secondary text. */
  mutedFg: string;
  /** Primary action fill (navy — the existing --primary). */
  primary: string;
  primaryFg: string;
  /** Boundary of form controls (inputs, nudge buttons) — 3:1 required. */
  controlBorder: string;
  /** Keyboard focus ring — 3:1 required. */
  focusRing: string;
  /** Decorative dividers (no contrast requirement). */
  divider: string;
}

export interface ThemeTokens { base: BaseColors; states: Record<SemanticState, StateColors> }

/** The existing brand values from src/index.css — kept exactly. */
export const BRAND = {
  primary: "220 25% 14%", // navy, --primary
  accent: "36 95% 54%", // amber, --accent
} as const;

export const THEMES: Record<Theme, ThemeTokens> = {
  light: {
    base: {
      bg: "40 20% 97%",
      surface: "0 0% 100%",
      fg: "220 20% 10%",
      mutedFg: "220 10% 38%",
      primary: BRAND.primary,
      primaryFg: "40 20% 97%",
      controlBorder: "220 8% 52%",
      focusRing: "220 25% 14%",
      divider: "40 10% 88%",
    },
    states: {
      VERIFIED_HUMAN: { fg: "150 70% 22%", bg: "145 55% 93%", border: "150 55% 34%", text: "150 70% 22%" },
      MACHINE_UNVERIFIED: { fg: "220 10% 30%", bg: "220 12% 94%", border: "220 8% 48%", text: "220 10% 30%" },
      // Amber fill is the existing --accent; navy text on it is ~8:1.
      NEEDS_REVIEW: { fg: BRAND.primary, bg: BRAND.accent, border: "30 90% 30%", text: "30 90% 28%" },
      BLOCKING: { fg: "0 72% 35%", bg: "0 85% 95%", border: "0 70% 45%", text: "0 72% 35%" },
      PENDING_QTY: { fg: "28 90% 27%", bg: "0 0% 100%", border: "32 95% 36%", text: "28 90% 27%" },
      UNAVAILABLE: { fg: "220 8% 30%", bg: "220 8% 90%", border: "220 6% 48%", text: "220 8% 30%" },
      EXCLUDED: { fg: "220 6% 38%", bg: "0 0% 100%", border: "220 6% 50%", text: "220 6% 38%" },
    },
  },
  dark: {
    base: {
      bg: "220 25% 8%",
      surface: "220 22% 12%",
      fg: "40 20% 95%",
      mutedFg: "220 10% 70%",
      primary: "40 20% 95%",
      primaryFg: BRAND.primary,
      controlBorder: "220 8% 55%",
      focusRing: BRAND.accent,
      divider: "220 15% 22%",
    },
    states: {
      VERIFIED_HUMAN: { fg: "145 60% 75%", bg: "150 45% 14%", border: "150 50% 45%", text: "145 60% 75%" },
      MACHINE_UNVERIFIED: { fg: "220 10% 80%", bg: "220 12% 18%", border: "220 8% 58%", text: "220 10% 80%" },
      NEEDS_REVIEW: { fg: BRAND.primary, bg: BRAND.accent, border: BRAND.accent, text: "36 95% 60%" },
      BLOCKING: { fg: "0 85% 82%", bg: "0 50% 17%", border: "0 75% 60%", text: "0 85% 82%" },
      PENDING_QTY: { fg: "36 95% 66%", bg: "220 22% 12%", border: BRAND.accent, text: "36 95% 66%" },
      UNAVAILABLE: { fg: "220 8% 78%", bg: "220 8% 22%", border: "220 6% 55%", text: "220 8% 78%" },
      EXCLUDED: { fg: "220 6% 68%", bg: "220 22% 12%", border: "220 6% 50%", text: "220 6% 68%" },
    },
  },
};

/** Spacing scale (px), 4-px grid. */
export const SPACING = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;

/** Corner radii (px). */
export const RADII = { none: 0, sm: 4, md: 6, lg: 12, pill: 9999 } as const;

/** Type scale: [font-size px, line-height px]. */
export const TYPE_SCALE = {
  xs: [12, 16],
  sm: [14, 20],
  base: [16, 24],
  lg: [18, 28],
  xl: [20, 28],
  "2xl": [24, 32],
} as const;

/** WCAG 2.2 SC 2.5.8 (AA) minimum pointer-target size, CSS px. */
export const MIN_TARGET_PX = 24;

/** Kebab-case value used in `data-state` attributes / CSS selectors: NEEDS_REVIEW → "needs-review". */
export function stateAttr(state: SemanticState): string {
  return state.toLowerCase().replace(/_/g, "-");
}

/** CSS custom-property name for a token, e.g. dsVar("state", "BLOCKING", "fg") → "--ds-blocking-fg". */
export function stateVar(state: SemanticState, part: keyof StateColors): string {
  return `--ds-${stateAttr(state)}-${part}`;
}

export function baseVar(part: keyof BaseColors): string {
  return `--ds-${part.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}`;
}
