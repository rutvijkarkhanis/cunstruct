// MISSING-SCOPE SUGGESTIONS FROM THE SCHEDULE — a short list of work the BOQ
// may be missing, each one traceable to something the schedule itself says.
//
// Implemented rule (the reliable subset):
//   SCHEDULE EXCLUSION — when a BOQ line reliably matches a schedule item whose
//   description says it EXCLUDES the cost of centering/shuttering or of
//   reinforcement, that work is measured and paid as separate schedule items
//   ("Centering and shuttering …", "Steel reinforcement for R.C.C. work …").
//   If no line in the BOQ covers it, it is suggested.
//
// Not implemented (stated as limitations, never guessed): other exclusion
// clauses (fittings, purlins, pipes, finishing …) whose companion item depends
// on context; estimating-practice companions the schedule does not state
// (masonry → plaster → paint); anything inferred from drawings.
//
// A suggestion is never a quantity and never a rate. Accepting one adds a
// line whose quantity is PENDING until it is measured from the drawings; its
// rate is matched separately.
import { exclusionClauses, matchableDescription, normalizeText, scheduleLabel, type DsrItem } from "./catalogue";
import type { DsrIndex, MatchResult } from "./match";

export type ScopeRule = "excluded_formwork" | "excluded_reinforcement";

export interface ScopeLine {
  id: string;
  description: string | null;
  unit: string | null;
  dsr_code?: string | null;
  section?: string | null;
  included?: boolean | null;
  external_key?: string | null;
}

export interface ScopeTrigger { lineId: string; description: string; dsrCode: string; clause: string }
export interface ScopeDuplicate { lineId: string; description: string; why: string }

export interface ScopeSuggestion {
  /** Stable across reloads: rule + schedule chapter. */
  key: string;
  rule: ScopeRule;
  title: string;
  /** What the work is. */
  what: string;
  /** Why it was surfaced — the schedule's own words, quoted. */
  why: string;
  triggers: ScopeTrigger[];
  /** Schedule items the person chooses from on Accept (none is pre-chosen). */
  options: DsrItem[];
  /** What is not known yet. */
  missingEvidence: string;
  /** Existing lines that may already cover it — the person decides. */
  possibleDuplicates: ScopeDuplicate[];
  nextDecision: string;
  /** Lines already created by accepting this suggestion (external_key dsr-scope:<key>:<code>). */
  acceptedLineIds: string[];
}

interface RuleDef {
  rule: ScopeRule;
  clause: RegExp;            // in the trigger item's exclusion clause
  option: RegExp;            // schedule items that ARE this work (matched on the item's own text)
  covers: RegExp;            // a BOQ line whose own text (exclusions removed) names this work
  title: string;
  what: string;
  missingEvidence: string;
}

const RULES: RuleDef[] = [
  {
    rule: "excluded_formwork",
    clause: /\b(centering|centring|shuttering)\b/i,
    option: /^centering and shuttering\b/i,
    covers: /\b(centering|centring|shuttering|formwork|form work)\b/,
    title: "Formwork (centering and shuttering)",
    what: "Temporary formwork for the concrete — centering, shuttering, strutting and propping — which the schedule measures and pays as separate items.",
    missingEvidence: "No quantity: the formwork area has to be measured from the drawings for each element type. None is assumed.",
  },
  {
    rule: "excluded_reinforcement",
    clause: /\breinforcement\b/i,
    option: /^steel reinforcement for r\.?c\.?c\.? work\b/i,
    covers: /\b(reinforcement|rebar|rebars|tmt|thermo mechanically treated|steel bars?)\b/,
    title: "Steel reinforcement",
    what: "Reinforcement steel for the R.C.C. work, which the schedule measures and pays as separate items (by weight).",
    missingEvidence: "No quantity: reinforcement weight has to come from the structural drawings or bar-bending schedule. None is assumed.",
  },
];

const chapterOf = (code: string) => code.split(".")[0];
/** A line's own text with any "excluding …" clauses removed — "RCC excluding
 *  reinforcement" does not cover reinforcement. */
const ownText = (d: string | null) => {
  let t = d ?? "";
  for (const c of exclusionClauses(t)) t = t.replace(c, " ");
  return normalizeText(t.replace(/\b(excluding|exclusive of)\b(\s+the)?(\s+cost\s+of)?/gi, " "));
};

export const scopeLineKey = (suggestionKey: string, code: string) => `dsr-scope:${suggestionKey}:${code}`;

/**
 * Suggestions for one BOQ against one schedule. `matches` are the line
 * matches already computed (matchLine) — only RELIABLE ones trigger a rule.
 */
export function scopeSuggestions(lines: ScopeLine[], matches: Map<string, MatchResult>, ix: DsrIndex): ScopeSuggestion[] {
  const included = lines.filter((l) => l.included !== false);
  const byKey = new Map<string, ScopeSuggestion>();

  for (const def of RULES) {
    for (const l of included) {
      const m = matches.get(l.id);
      if (m?.verdict !== "reliable") continue;
      const item = m.candidates[0].item;
      const clause = exclusionClauses(item.description).find((c) => def.clause.test(c));
      if (!clause) continue;
      const ch = chapterOf(item.code);
      // The separate items for this work: in the trigger's own chapter when the
      // schedule has them there, else wherever the schedule has them.
      const all = ix.items.filter((i) => def.option.test(matchableDescription(i.description)));
      const options = all.some((i) => chapterOf(i.code) === ch) ? all.filter((i) => chapterOf(i.code) === ch) : all;
      if (!options.length) continue;
      const key = `${def.rule}:${chapterOf(options[0].code)}`;
      const s = byKey.get(key) ?? {
        key, rule: def.rule, title: def.title, what: def.what, triggers: [], options,
        why: "", missingEvidence: def.missingEvidence, possibleDuplicates: [], acceptedLineIds: [],
        nextDecision: "",
      };
      s.triggers.push({ lineId: l.id, description: l.description ?? "", dsrCode: item.code, clause });
      byKey.set(key, s);
    }
  }

  const out: ScopeSuggestion[] = [];
  for (const s of byKey.values()) {
    const def = RULES.find((r) => r.rule === s.rule)!;
    // Any schedule item that IS this work counts as cover, in whatever chapter.
    const optionCodes = new Set(ix.items.filter((i) => def.option.test(matchableDescription(i.description))).map((o) => o.code));
    const triggerIds = new Set(s.triggers.map((t) => t.lineId));
    // Lines created by accepting this suggestion.
    s.acceptedLineIds = lines.filter((l) => (l.external_key ?? "").startsWith(`dsr-scope:${s.key}:`)).map((l) => l.id);
    // Covered: an included line already carries one of the options' codes, or
    // reliably matches one — no suggestion.
    const covered = included.some((l) => !triggerIds.has(l.id) && !s.acceptedLineIds.includes(l.id) && (
      (l.dsr_code && optionCodes.has(l.dsr_code.trim()))
      || (matches.get(l.id)?.verdict === "reliable" && optionCodes.has(matches.get(l.id)!.candidates[0].item.code))));
    if (covered) continue;
    // Possible duplicates: lines whose own wording names the work.
    s.possibleDuplicates = included
      .filter((l) => !triggerIds.has(l.id) && !s.acceptedLineIds.includes(l.id) && def.covers.test(ownText(l.description)))
      .map((l) => ({ lineId: l.id, description: l.description ?? "", why: "Its description names this work, but it has no matching schedule code." }));
    const t = s.triggers[0];
    const more = s.triggers.length > 1 ? ` (and ${s.triggers.length - 1} more line${s.triggers.length > 2 ? "s" : ""})` : "";
    s.why = `${scheduleLabel(ix.source, ix.year)} item ${t.dsrCode}, matched to “${t.description}”${more}, is stated as “excluding the cost of ${t.clause}”. That work is paid under separate items, and no line in this BOQ covers it.`;
    s.nextDecision = s.acceptedLineIds.length
      ? "Accepted: measure the quantity on the drawings, then match its rate."
      : s.possibleDuplicates.length
        ? "Check whether the line(s) below already cover this. If not, accept and choose the schedule item(s); otherwise reject."
        : "Accept and choose the schedule item(s) that apply (the quantity stays pending until measured), reject if it is not part of this work, or defer.";
    out.push(s);
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export const SCOPE_LIMITATIONS = [
  "Only work the schedule itself says is excluded from a matched item (formwork and reinforcement) is suggested.",
  "Lines without a reliable schedule match cannot trigger a suggestion.",
  "Other exclusions (fittings, purlins, pipes, finishing) and estimating-practice companions are not suggested.",
  "A suggestion never sets a quantity or a rate.",
] as const;
