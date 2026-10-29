// CATEGORY PROFILES and TAG PARSING for the counting engine.
//
// A tag is a short mark printed beside an element on a plan ("D1", "W-2",
// "SD3"). Its prefix proposes a category; nothing here decides that the tag
// belongs to any particular symbol (engine.ts does that, with its reasons).
//
// Tag text is read exactly as printed. OCR letter/digit confusions ("DO" for
// "D0", "WI" for "W1") are NOT silently mapped here — a text that looks like
// a tag but doesn't parse cleanly is returned as unreadable, so a reviewer
// reads it, rather than becoming a mark the drawing may not say.

import type { ElementCategory, ParsedTag } from "./contract";

export interface CategoryProfile {
  category: ElementCategory;
  /** Tag prefixes, longest first so "SD" wins over "D". */
  prefixes: string[];
  /** Words that name this category in a schedule description. */
  keywords: RegExp;
}

export const CATEGORY_PROFILES: CategoryProfile[] = [
  { category: "door", prefixes: ["SD", "FD", "MD", "D"], keywords: /\bDOORS?\b/i },
  { category: "window", prefixes: ["FW", "KW", "W"], keywords: /\bWINDOWS?\b/i },
  { category: "ventilator", prefixes: ["V"], keywords: /\bVENTILATORS?\b/i },
];

const PREFIXES = CATEGORY_PROFILES.flatMap((p) => p.prefixes.map((prefix) => ({ prefix, category: p.category })))
  .sort((a, b) => b.prefix.length - a.prefix.length || a.prefix.localeCompare(b.prefix));

const PREFIX_ALT = PREFIXES.map((p) => p.prefix).join("|");
// "D1", "D-1", "D 1", "D1A", "W12".
const CLEAN_TAG = new RegExp(`^(${PREFIX_ALT})[-\\s]?(\\d{1,3}[A-Z]?)$`);
// Two marks in one label: "W1/W2", "D1, D2".
const MULTI_TAG = new RegExp(`^((?:${PREFIX_ALT})[-\\s]?\\d{1,3}[A-Z]?)(?:\\s*[/,&]\\s*((?:${PREFIX_ALT})[-\\s]?\\d{1,3}[A-Z]?))+$`);
// A tag prefix followed by something that is not a clean number: "DO", "W?",
// "D1?", "W-l". Only short tokens qualify — "DOOR" and "WALL" are words.
const TAG_LIKE = new RegExp(`^(${PREFIX_ALT})[-\\s]?[0-9OISZ?]{1,3}[A-Z?]?$`);
const WORDS = /^(DO|SO|NO|TO|WE|VI)$/;

export function categoryOfPrefix(prefix: string): ElementCategory | null {
  return PREFIXES.find((p) => p.prefix === prefix)?.category ?? null;
}

/** "D-1" → "D1". The canonical spelling every comparison uses. */
export function canonicalMark(text: string): string | null {
  const m = CLEAN_TAG.exec(text.trim().toUpperCase());
  return m ? `${m[1]}${m[2]}` : null;
}

export function categoryOfMark(mark: string): ElementCategory | null {
  const m = CLEAN_TAG.exec(mark.trim().toUpperCase());
  return m ? categoryOfPrefix(m[1]) : null;
}

/** Category from a schedule description, when exactly one profile's word
 *  appears in it ("TOILET DOOR" → door). */
export function categoryOfDescription(text: string | undefined): ElementCategory | null {
  if (!text) return null;
  const hits = CATEGORY_PROFILES.filter((p) => p.keywords.test(text));
  return hits.length === 1 ? hits[0].category : null;
}

/** Parse one text run as a tag, or null when it isn't tag-shaped at all. */
export function parseTag(raw: string): ParsedTag | null {
  const text = raw.trim();
  const upper = text.toUpperCase();
  // Only a run printed entirely in capitals is a tag. "Do", "So" in a note
  // are words.
  if (!text || text !== upper || text.length > 16) return null;
  const clean = canonicalMark(upper);
  if (clean) return { status: "readable", mark: clean, category: categoryOfMark(clean)! };
  if (MULTI_TAG.test(upper)) {
    const marks = [...new Set(upper.split(/\s*[/,&]\s*/).map((t) => canonicalMark(t)).filter((m): m is string => !!m))].sort();
    const cats = [...new Set(marks.map((m) => categoryOfMark(m)))];
    return { status: "multiple", marks, category: cats.length === 1 ? cats[0] : null };
  }
  // Without a digit or "?", only a very short token ("WI", "DS") can be a
  // misread tag; "DOOR" is a word.
  const misread = TAG_LIKE.test(upper) && !WORDS.test(upper) && (/[\d?]/.test(upper) || upper.length <= 3);
  if (misread) {
    const prefix = PREFIXES.find((p) => upper.startsWith(p.prefix));
    return {
      status: "unreadable",
      category: prefix?.category ?? null,
      reason: `"${text}" looks like a tag but does not read as one (a letter where a digit should be, or a "?").`,
    };
  }
  return null;
}
