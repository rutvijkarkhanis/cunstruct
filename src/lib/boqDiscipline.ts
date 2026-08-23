// Discipline evidence gate — a discipline only generates scope when that
// discipline actually has evidence in the SUPPLIED drawing set.
//
// The existence of a project type (or the fact that a building has floors) must
// NEVER by itself activate a discipline's generic template. If no structural /
// civil drawing is supplied, Cunstruct must not invent columns, beams, slabs,
// RCC, reinforcement, shuttering, foundations, excavation or masonry from the
// residential template; the discipline is simply "not assessable" and stays out
// of the priced BOQ (not zeroed, not fabricated). The same holds for Electrical,
// Plumbing, HVAC, Fire and Architectural: a discipline is activated by drawing
// evidence, never by project type.
//
// Three states are distinguished (see disciplineState):
//   not_assessable — the discipline has no evidence in the supplied drawings →
//                    its generic template scope is withheld from the priced BOQ.
//   present        — the discipline is evidenced and an item is present/quantified.
//   pending        — the discipline is evidenced and the item is identified but
//                    not yet measurable (qty null) → kept visible as pending.
//
// This gate applies ONLY to drawing-driven BOQs (spec seeded from an evaluation).
// A pure questionnaire/archetype BOQ carries no drawing set, so the operator's
// questionnaire is the intent and every discipline stays active as before.

import { classifyDiscipline } from "./chatgptEval";
import type { Spec } from "./boqSpec";
import type { DrawingSummary } from "./boqDrawing";
import type { GeneratedLine } from "./boqDsrGenerate";

export type Discipline = "structural" | "architectural" | "electrical" | "plumbing" | "hvac" | "fire";

// Structural / civil-works labels — RCC, framing, foundations, masonry, concrete.
// Kept separate from architectural finishes (which classifyDiscipline lumps as "civil").
const STRUCTURAL_LABEL = /\b(rcc|r\.?c\.?c|column|beam|slab|footing|foundation|excavation|reinforcement|reinforcing|shuttering|centering|formwork|lintel|plinth|pcc|d\.?p\.?c|masonry|brickwork|blockwork|concrete)\b/i;

/** Map a requirement / line label to its engineering discipline. Structural is
 *  detected first (RCC/framing/masonry); everything classifyDiscipline calls
 *  "civil" (finishes, doors, joinery, flooring) is architectural. */
export function disciplineOf(label: string | null | undefined): Discipline {
  const l = (label ?? "").trim().toLowerCase();
  if (!l) return "architectural";
  if (STRUCTURAL_LABEL.test(l)) return "structural";
  // Explicit discipline-category words first (e.g. "Electrical points",
  // "HVAC / AC points", "Plumbing points") — classifyDiscipline is tuned to
  // specific fixtures and misses the bare discipline noun and some plurals.
  if (/\belectric|\bmcb\b|\brccb\b|distribution board|switch\s*board|\bswitchboard\b|earthing|earth\s*pit|meter\s*board|incomer|main\s*panel/.test(l)) return "electrical";
  if (/\bplumb|sanitary/.test(l)) return "plumbing";
  if (/\bhvac\b|air.?condition|\bmechanical\b/.test(l)) return "hvac";
  if (/\bfire\b/.test(l)) return "fire";
  const k = classifyDiscipline(l);            // civil | electrical | plumbing | hvac | fire
  return k === "civil" ? "architectural" : (k as Discipline);
}

/** The identified-discipline words the evaluator uses → engineering discipline.
 *  "Civil" is civil/structural works; "Architectural"/"Furniture" are the
 *  finishes/joinery scope. */
function mapIdentified(word: string): Discipline | undefined {
  const w = word.trim().toLowerCase();
  if (/civil|structural/.test(w)) return "structural";
  if (/architect|furnitur|interior/.test(w)) return "architectural";
  if (/electric/.test(w)) return "electrical";
  if (/plumb|sanitary/.test(w)) return "plumbing";
  if (/hvac|mechanical|air.?condition/.test(w)) return "hvac";
  if (/fire/.test(w)) return "fire";
  return undefined;
}

/** The discipline a generated template line belongs to. Structural is taken from
 *  the allocation scope layer (substructure/structure) so the classification is
 *  authoritative for framing lines; everything else is read from the label. */
export function lineDiscipline(l: GeneratedLine): Discipline {
  if (l.scope === "substructure" || l.scope === "structure") return "structural";
  return disciplineOf(l.label);
}

/** The disciplines that have evidence in the supplied drawing set, or `null` when
 *  the BOQ is not drawing-driven (a pure questionnaire/archetype BOQ — no gate).
 *  Evidence = the evaluation's identified disciplines UNION any discipline that
 *  actually has a drawing requirement item (so it also works on specs saved
 *  before disciplines were carried, and reflects items itemised but not listed). */
export function assessableDisciplines(spec: Spec): Set<Discipline> | null {
  const s = spec as Record<string, unknown>;
  if (s._source !== "chatgpt") return null;              // not drawing-driven → don't gate
  const set = new Set<Discipline>();
  const identified = Array.isArray(s._disciplines) ? (s._disciplines as unknown[]) : [];
  for (const d of identified) { const m = mapIdentified(String(d)); if (m) set.add(m); }
  const items = (s._drawing as DrawingSummary | undefined)?.items ?? [];
  for (const it of items) if (it.match?.trim()) set.add(disciplineOf(it.match));
  return set.size ? set : null;                          // degenerate (no evidence) → don't gate
}

/** Withhold template lines whose discipline has no evidence in the supplied
 *  drawing set. Drawing-derived lines are never withheld (they ARE the evidence).
 *  Pure filter — never fabricates, mutates, zeroes or reorders a quantity. */
export function withAssessableDisciplines(lines: GeneratedLine[], spec: Spec): GeneratedLine[] {
  const assessable = assessableDisciplines(spec);
  if (!assessable) return lines;                         // no drawing assessment → keep all
  return lines.filter((l) => l.drawing || assessable.has(lineDiscipline(l)));
}

/** Report the state of a discipline for THIS BOQ: not_assessable (no drawing
 *  evidence), present (evidenced, at least one quantified item), or pending
 *  (evidenced, only unquantified/qty-null items). Drawing-driven BOQs only. */
export function disciplineState(spec: Spec, discipline: Discipline): "not_assessable" | "present" | "pending" | "not_drawing_driven" {
  const assessable = assessableDisciplines(spec);
  if (!assessable) return "not_drawing_driven";
  if (!assessable.has(discipline)) return "not_assessable";
  const items = ((spec as Record<string, unknown>)._drawing as DrawingSummary | undefined)?.items ?? [];
  const mine = items.filter((it) => it.match?.trim() && disciplineOf(it.match) === discipline);
  if (mine.some((it) => it.qty != null)) return "present";
  return mine.length ? "pending" : "present";           // evidenced by identified list but no items → present
}
