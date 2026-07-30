// Plain-English BOQ knowledge base. Centralised so the info hints, the
// explainer panel, and the templates glossary all speak with one voice.
// Written for someone who has never produced a bill of quantities before.

export interface BasisDoc {
  key: string;
  label: string;
  drivenBy: string;
  plain: string;
  example: string;
}

/** The six ways the engine can turn a dimension into a quantity. */
export const QTY_BASES: BasisDoc[] = [
  {
    key: "per_floor_sqft",
    label: "per floor sq.ft",
    drivenBy: "Total floor area of all rooms",
    plain: "Anything that covers the ground — floor tiles, flooring, tile adhesive, grout.",
    example: "600 sq.ft floor × 1.0 = 600 sq.ft of tiles (before wastage).",
  },
  {
    key: "per_wall_sqft",
    label: "per wall sq.ft",
    drivenBy: "Paintable wall area (perimeter × height − 15% for doors/windows)",
    plain: "Anything applied to walls — putty, primer, emulsion paint, plaster.",
    example: "1,200 wall sq.ft × 1⁄40 = 30 bags of wall putty.",
  },
  {
    key: "per_point",
    label: "per electrical point",
    drivenBy: "Sum of the 'Points' you enter for each room",
    plain: "Electrical rough-in — wire, conduit, switches, sockets, boxes.",
    example: "40 points × 15 = 600 m of wire.",
  },
  {
    key: "per_bathroom",
    label: "per bathroom",
    drivenBy: "Number of rooms marked as 'bathroom'",
    plain: "Sanitaryware & plumbing — WC, wash basin, CP fittings, CPVC pipe.",
    example: "3 bathrooms × 1 = 3 wash basins.",
  },
  {
    key: "per_room",
    label: "per room",
    drivenBy: "Total room count",
    plain: "One-per-room items — door frames, shutters, ceiling fans, lights.",
    example: "8 rooms × 1 = 8 door frames.",
  },
  {
    key: "per_sqft",
    label: "per built-up sq.ft",
    drivenBy: "Project built-up area (from Project basics, else floor area)",
    plain: "Structural bulk materials — cement, sand, aggregate, TMT steel, bricks.",
    example: "1,000 sq.ft × 0.4 = 400 bags of cement.",
  },
];

export interface TierDoc {
  key: "economy" | "standard" | "premium";
  label: string;
  note: string;
}

/** Finish quality tiers — tune the wastage buffer on every line. */
export const QUALITY_TIERS: TierDoc[] = [
  { key: "economy", label: "Economy", note: "Budget finishes. Trims the wastage buffer (~2% tighter) to keep the estimate lean." },
  { key: "standard", label: "Standard", note: "Typical mid-range finishes with standard wastage. The sensible default." },
  { key: "premium", label: "Premium", note: "High-end finishes with more cutting/patterns — adds ~4% wastage buffer so you don't run short." },
];

// ---- Concept notes (reused verbatim in tooltips) --------------------------

export const NOTE = {
  whatIsBoq:
    "A Bill of Quantities (BOQ) is the itemised shopping list for a construction stage — every material, with how much of it you need. Cunstruct builds it for you from your rooms and a standard per-stage checklist, so nothing gets forgotten.",
  whyRooms:
    "Quantities aren't guessed — they're calculated. Each material is tied to a dimension (floor area, wall area, electrical points, bathroom count…). Enter your rooms once and every line recalculates from the right measurement.",
  whatIsStage:
    "A construction stage (Foundation, Electrical Rough-In, Painting…). Each stage has its own standard material checklist. Stages like Pre-Construction or Handover have no physical materials, so they're intentionally empty.",
  onboard:
    "This material isn't in Cunstruct's catalog yet, so it can't be priced or ordered right now. We still show the quantity you need, and on submit it's logged to the Onboarding Queue — a signal to add it to the catalog based on real demand.",
  wastage:
    "Extra material added on top of the raw quantity to cover offcuts, breakage and site loss. Shown as '+X% wastage' in each line. Tiles need more; steel needs less. Your quality tier nudges this up or down.",
  packRounding:
    "Some materials only sell in whole units (a bag of cement, a box of tiles). After wastage, the quantity is rounded UP to the nearest sellable pack so you're never short.",
  matchKeyword:
    "How a checklist item finds a real product in the catalog. Either link an exact SKU, or give a keyword (e.g. 'putty') and we match any product whose name contains it. No match → the item becomes an onboarding opportunity.",
  qtyFormula:
    "Picks ONE dimension and the ratio to multiply it by. The engine reads the bases top-to-bottom and uses the first one you fill in. Leave all blank for a flat quantity, or set 'per unit'.",
  orderVsOnboard:
    "On submit: in-catalog items become a real order at live prices (plus a WhatsApp briefing), and out-of-catalog items are sent to the Onboarding Queue. You never lose a line — you either order it or flag it to stock.",
} as const;
