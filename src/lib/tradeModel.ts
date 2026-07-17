// Trade / Hook / Broker classification + the estimated margin each model implies.
// Margins mirror the DEFAULTS in src/pages/ops/OpsProjections.tsx so the
// Forecasts page and the Business Forecast page tell the same story.

export type TradeModel = "Trade" | "Hook" | "Broker";

export const MODEL_MARGIN: Record<TradeModel, number> = {
  Trade: 25, // you buy and resell — full margin
  Hook: 12, // loss-leader / attach item — thinner margin
  Broker: 3, // brand finances it, you broker the deal — thin margin
};

export const MODEL_BLURB: Record<TradeModel, string> = {
  Trade: "You buy and resell — full margin (~25%).",
  Hook: "Attach / loss-leader item — thinner margin (~12%).",
  Broker: "Brand finances the deal, you broker it — thin margin (~3%).",
};

// Category buckets — same mapping the catalog_enriched view uses for `model`.
const BROKER_CATS = ["building materials", "structural"];
const HOOK_CATS = ["electrical", "fan", "fixtures & fittings"];

// Name keywords, used only when we have no catalog category (e.g. seed SKUs).
const BROKER_WORDS = [
  "cement", "sand", "aggregate", "steel", "tmt", "rebar", "concrete",
  "brick", "block", "rmc", "grit", "stone", "plaster",
];
const HOOK_WORDS = [
  "wire", "cable", "switch", "socket", "mcb", "fan", "light", "lamp",
  "led", "fixture", "fitting", "conduit",
];

export function classifyModel(category?: string | null, name?: string | null): TradeModel {
  const c = (category ?? "").toLowerCase().trim();
  if (c) {
    if (BROKER_CATS.includes(c)) return "Broker";
    if (HOOK_CATS.includes(c)) return "Hook";
    return "Trade";
  }
  const n = (name ?? "").toLowerCase();
  if (BROKER_WORDS.some((w) => n.includes(w))) return "Broker";
  if (HOOK_WORDS.some((w) => n.includes(w))) return "Hook";
  return "Trade";
}
