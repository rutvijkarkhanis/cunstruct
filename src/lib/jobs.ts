/**
 * Curated job phrasings shown in search.
 * Each maps to a kit id from src/lib/kits.ts (KIT_DEFS).
 * Keywords are matched against the user's typed query (case-insensitive substring).
 */
export type JobDef = {
  id: string;
  label: string; // "Fix leakage"
  kitId: string; // matches KitDef.id
  keywords: string[];
};

export const JOB_DEFS: JobDef[] = [
  {
    id: "fix-leakage",
    label: "Fix a leakage",
    kitId: "plumbing",
    keywords: ["leak", "leakage", "drip", "pipe", "tap", "valve", "plumb"],
  },
  {
    id: "mount-tv",
    label: "Mount a TV",
    kitId: "wall-mounting",
    keywords: ["tv", "mount", "bracket", "wall mount", "shelf"],
  },
  {
    id: "install-lights",
    label: "Install lights",
    kitId: "site-setup",
    keywords: ["light", "bulb", "led", "lamp", "fitting", "ceiling"],
  },
  {
    id: "wall-drilling",
    label: "Drill into a wall",
    kitId: "wall-mounting",
    keywords: ["drill", "hole", "bore", "wall"],
  },
  {
    id: "drilling-cutting",
    label: "Drilling & cutting work",
    kitId: "drilling-cutting",
    keywords: ["drill", "cut", "grind", "disc", "wheel", "saw"],
  },
  {
    id: "switch-wiring",
    label: "Add a switch or wiring",
    kitId: "electrical",
    keywords: ["switch", "wire", "wiring", "socket", "electric", "mcb", "tape"],
  },
  {
    id: "hang-shelf",
    label: "Hang a shelf or frame",
    kitId: "wall-mounting",
    keywords: ["shelf", "frame", "screw", "anchor", "plug", "nail", "hang"],
  },
  {
    id: "fasten-bolt",
    label: "Fasten or bolt something",
    kitId: "fastening",
    keywords: ["screw", "bolt", "nail", "anchor", "fasten", "nut"],
  },
  {
    id: "wall-repair",
    label: "Repair a wall crack",
    kitId: "wall-repair",
    keywords: ["crack", "putty", "primer", "paint", "patch", "fill", "wall"],
  },
  {
    id: "carpentry",
    label: "Carpentry / wood work",
    kitId: "carpentry",
    keywords: ["wood", "carpentry", "saw", "glue", "adhesive"],
  },
  {
    id: "site-setup",
    label: "Set up a temporary site",
    kitId: "site-setup",
    keywords: ["site", "temporary", "extension", "rose", "bulb", "holder"],
  },
  {
    id: "maintenance",
    label: "General site maintenance",
    kitId: "maintenance",
    keywords: ["maintenance", "fix", "repair", "tool"],
  },
];

/** Quick jobs shown by default (no query). Order matters. */
export const DEFAULT_JOB_IDS = [
  "fix-leakage",
  "mount-tv",
  "install-lights",
  "wall-drilling",
];

/** Popular product search terms shown by default. */
export const POPULAR_SEARCHES = [
  "Drill machine",
  "Wall plugs",
  "PVC pipe",
  "M seal",
  "Fevicol",
];
