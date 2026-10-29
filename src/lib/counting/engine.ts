// INSTANCE COUNTING ENGINE — drawing observations in, candidate instances,
// per-type counts and explicit unresolved cases out (contract.ts).
//
// Stages, in order:
//   1. validate      — malformed input dropped with a reason (normalize.ts)
//   2. sheets        — view, floor, typical, layout fingerprint (sheets.ts)
//   3. observe       — tags from text runs; door swings from vectors
//                      (doorSwings.ts); supplied symbol detections
//   4. de-duplicate  — overlapping detections of one object merged; an
//                      over-printed tag read once
//   5. associate     — tag ↔ symbol only when each is the other's clearly
//                      nearest partner; anything closer to a tie is ambiguous
//   6. schedule      — a tagged candidate linked to the schedule entry with
//                      its mark; missing or contradicting entries reported
//   7. cross-view    — elevation/section/detail tags become references to
//                      the type, never added to the count
//   8. sheet checks  — the same plan supplied twice is counted once; two
//                      different plans for one floor are a conflict
//   9. count         — per type per floor; a quantity only when every
//                      candidate is confirmed and nothing on the sheet could
//                      change the number
//  10. totals        — drawing total vs the schedule's printed quantity, only
//                      when the drawing set is complete; agreement is
//                      reported, never used to upgrade a count
//
// CONFIRMED means: a symbol was detected, exactly one printed tag is clearly
// its nearest, the tag reads cleanly from a PDF/CAD text layer, the mark has
// one consistent schedule entry of the same category, and the sheet is a
// plan of an identified floor. Two independent signals (a drawn symbol and a
// schedule-documented tag), as instanceReconciliation.ts requires for GREEN.
// It is still a review-queue item, never written to a BOQ by this engine.

import { isGeometryMatch } from "../review/geometryFusion";
import { buildDrawingInventory, ROW_GAP_LINES, runBox } from "../review/drawingInventory";
import type {
  Bbox, CandidateInstance, CountingInput, CountingResult, CountingSheetInput, CountStatus, CrossViewReference,
  ElementCategory, MarkTotal, ObservedEvidence, RecognitionMethod, ScheduleAssociation, ScheduleEntryInput,
  SheetSummary, TagAssociation, TypeCount, UnresolvedCase, UnresolvedKind,
} from "./contract";
import { COUNTING_CONTRACT_VERSION, COUNTING_ENGINE } from "./contract";
import { categoryOfDescription, categoryOfMark, parseTag } from "./categories";
import { DOOR_LEAF_MM, findDoorSwings, groupDoorSymbols } from "./doorSwings";
import { canonicalJson, fnv1a, layoutFingerprint, sheetKeyOf, summarizeSheet } from "./sheets";
import { validateInput } from "./normalize";

/** Every tunable in one place, echoed into result.provenance.thresholds. */
export const COUNTING_THRESHOLDS = {
  /** A tag may sit at most this many symbol diagonals from a symbol's box… */
  tagReachSymbolDiagonals: 1.0,
  /** …plus this many tag text heights. */
  tagReachTextHeights: 3,
  /** Second-nearest must be at least this many times further than nearest. */
  associationMargin: 1.5,
  /** Distances below this many text heights count as touching for the margin. */
  touchingTextHeights: 0.5,
  /** Two runs of the same tag text overlapping this much are one print. */
  duplicateTagIoU: 0.5,
} as const;

type Pt = [number, number];
const T = COUNTING_THRESHOLDS;
const centre = (b: Bbox): Pt => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const diag = (b: Bbox) => Math.hypot(b[2] - b[0], b[3] - b[1]);
const union = (boxes: Bbox[]): Bbox => [
  Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
  Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3])),
];
const inside = (b: Bbox, outer: Bbox) => {
  const [cx, cy] = centre(b);
  return cx >= outer[0] && cx <= outer[2] && cy >= outer[1] && cy <= outer[3];
};
function pointToBox([x, y]: Pt, b: Bbox): number {
  const dx = Math.max(b[0] - x, 0, x - b[2]);
  const dy = Math.max(b[1] - y, 0, y - b[3]);
  return Math.hypot(dx, dy);
}
const round2 = (v: number) => Math.round(v * 100) / 100;
const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const STATUS_RANK: Record<CountStatus, number> = { confirmed: 0, pending_review: 1, ambiguous: 2, conflicting: 3, rejected: 4 };
const worst = (a: CountStatus, b: CountStatus) => (STATUS_RANK[a] >= STATUS_RANK[b] ? a : b);

interface TagObs { ev: ObservedEvidence; height: number; duplicates: string[] }
interface SymbolObs {
  ev: ObservedEvidence;
  category: ElementCategory;
  methods: RecognitionMethod[];
  memberIds: string[];
  suppliedMark?: string;
  notes: string[];
}

interface SheetWork {
  sheet: CountingSheetInput;
  summary: SheetSummary;
  tags: TagObs[];
  symbols: SymbolObs[];
}

// ── Stage 3/4: observe and de-duplicate ─────────────────────────────────────

function scheduleBoxesOn(sheet: CountingSheetInput, schedule: ScheduleEntryInput[]): Bbox[] {
  const out: Bbox[] = [];
  for (const e of schedule) {
    const src = e.source;
    if (!src) continue;
    const sameDoc = src.documentId ? src.documentId === sheet.documentId : !!src.document && src.document === sheet.documentName;
    if (!sameDoc) continue;
    for (const b of src.evidence) if ((b.page ?? src.page) === sheet.page) out.push(b.bbox);
  }
  return out;
}

const OPENING_WORD = /\b(DOORS?|WINDOWS?|VENTILATORS?)\b/i;

/** Run indexes that sit on an opening-schedule row — on the same line as a
 *  size the existing inventory rule classifies as an opening size, or a
 *  description naming a door, window or ventilator — and only on a sheet that prints a schedule
 *  title. A tag beside a plan door with no schedule title is never caught. */
function scheduleRowRunIndexes(sheet: CountingSheetInput): Set<number> {
  const out = new Set<number>();
  if (!sheet.runs.some((r) => /\bSCHEDULES?\b/i.test(r.text))) return out;
  const inv = buildDrawingInventory([{ documentId: sheet.documentId, page: sheet.page, pageSize: sheet.pageSize, textLayer: sheet.textLayer, runs: sheet.runs }]);
  const rowMates = inv.candidates.filter((c) => c.kind === "opening_size" || c.kind === "opening_label" || OPENING_WORD.test(c.text));
  inv.candidates.forEach((c, i) => {
    if (!parseTag(c.text)) return;
    const [dx, dy] = c.direction, h = c.lineHeight || 1;
    const [cx, cy] = centre(c.box as Bbox);
    const along = (b: Bbox) => [b[0] * dx + b[1] * dy, b[2] * dx + b[3] * dy].sort((a, z) => a - z);
    const [a1, a2] = along(c.box as Bbox);
    const onRow = rowMates.some((m) => {
      if (m.direction[0] * dx + m.direction[1] * dy <= 0.99) return false;
      const [mx, my] = centre(m.box as Bbox);
      if (Math.abs((mx - cx) * -dy + (my - cy) * dx) > h / 2) return false;
      const [b1, b2] = along(m.box as Bbox);
      return Math.max(b1 - a2, a1 - b2) <= ROW_GAP_LINES * h;
    });
    if (onRow) out.add(i);
  });
  return out;
}

function observeSheet(sheet: CountingSheetInput, summary: SheetSummary, schedule: ScheduleEntryInput[]): SheetWork {
  const key = summary.sheetKey;
  const excluded = [...(sheet.excludedRegions ?? []).map((r) => r.bbox), ...scheduleBoxesOn(sheet, schedule)];
  const rowRuns = scheduleRowRunIndexes(sheet);
  let excludedTags = 0;

  const rawTags: TagObs[] = [];
  sheet.runs.forEach((run, i) => {
    const parsed = parseTag(run.text);
    if (!parsed) return;
    const bbox = runBox(run) as Bbox;
    if (rowRuns.has(i) || excluded.some((x) => inside(bbox, x))) { excludedTags++; return; }
    rawTags.push({
      ev: { id: `${key}:run:${i}`, kind: "tag_text", documentId: sheet.documentId, page: sheet.page, bbox, text: run.text.trim(), tag: parsed },
      height: run.height,
      duplicates: [],
    });
  });
  if (excludedTags) summary.notes.push(`${excludedTags} tag(s) inside a schedule, legend or excluded region were not treated as plan occurrences.`);

  // An over-printed tag (same text, boxes overlapping) is one print.
  const tags: TagObs[] = [];
  for (const t of rawTags) {
    const same = tags.find((u) => u.ev.text === t.ev.text && isGeometryMatch(u.ev.bbox, t.ev.bbox));
    if (same) same.duplicates.push(t.ev.id);
    else tags.push(t);
  }
  const overprinted = tags.filter((t) => t.duplicates.length);
  if (overprinted.length) summary.notes.push(`Over-printed tag text read once: ${overprinted.map((t) => `${t.ev.text} (${1 + t.duplicates.length}×)`).join(", ")}.`);

  const raw: SymbolObs[] = [];
  const countsHere = summary.view === "plan" || summary.view === "mixed" || summary.view === "unknown";
  if (countsHere) {
    const { swings, arcsWithoutLeaf } = findDoorSwings(sheet.shapes);
    if (arcsWithoutLeaf) summary.notes.push(`${arcsWithoutLeaf} arc(s) with no leaf line were not treated as doors.`);
    for (const sym of groupDoorSymbols(swings)) {
      const shapeIds = sym.swings.flatMap((s) => s.shapeIndexes).map((i) => `${key}:shape:${i}`);
      const notes: string[] = [];
      if (sym.kind === "double_swing_geometry") notes.push("Two door leaves meeting at one opening were grouped as one double door; check it is not two doors.");
      if (sheet.unitsPerMm) {
        const mm = sym.swings.map((s) => Math.round(s.radius / sheet.unitsPerMm!));
        const out = mm.filter((w) => w < DOOR_LEAF_MM[0] || w > DOOR_LEAF_MM[1]);
        if (out.length) notes.push(`Leaf width ${out.join(", ")} mm is outside ${DOOR_LEAF_MM[0]}–${DOOR_LEAF_MM[1]} mm; it may be a cupboard shutter or a gate.`);
      }
      raw.push({
        ev: { id: shapeIds[0], kind: "symbol", documentId: sheet.documentId, page: sheet.page, bbox: sym.bbox, method: sym.kind },
        category: "door", methods: [sym.kind], memberIds: shapeIds, notes,
      });
    }
    if (swings.length && !sheet.unitsPerMm) summary.notes.push("No sheet scale supplied: door leaf widths were not checked.");
    for (const s of sheet.symbols ?? []) {
      raw.push({
        ev: { id: `${key}:sym:${s.id}`, kind: "symbol", documentId: sheet.documentId, page: sheet.page, bbox: s.bbox, method: s.method },
        category: s.category, methods: [s.method], memberIds: [`${key}:sym:${s.id}`], suppliedMark: s.mark, notes: [],
      });
    }
  }

  // Overlapping detections of one category are one object (union-find, so
  // the grouping does not depend on visiting order).
  const parent = raw.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      if (raw[i].category === raw[j].category && isGeometryMatch(raw[i].ev.bbox, raw[j].ev.bbox)) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, SymbolObs[]>();
  raw.forEach((s, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(s));
  const symbols: SymbolObs[] = [...groups.values()].map((g) => {
    if (g.length === 1) return g[0];
    const marks = [...new Set(g.map((s) => s.suppliedMark).filter((m): m is string => !!m))];
    return {
      ev: { ...g[0].ev, bbox: union(g.map((s) => s.ev.bbox)) },
      category: g[0].category,
      methods: [...new Set(g.flatMap((s) => s.methods))].sort() as RecognitionMethod[],
      memberIds: g.flatMap((s) => s.memberIds).sort(byStr),
      suppliedMark: marks.length === 1 ? marks[0] : undefined,
      notes: [...new Set(g.flatMap((s) => s.notes)), ...(marks.length > 1 ? [`Merged detections carry different marks (${marks.join(", ")}).`] : [])],
    };
  });
  return { sheet, summary, tags, symbols };
}

// ── Stage 5: association ────────────────────────────────────────────────────

function compatible(tag: TagObs, sym: SymbolObs): boolean {
  const c = tag.ev.tag!.category;
  return c === null || c === sym.category;
}

interface Option<T> { other: T; d: number }

function reach(tag: TagObs, sym: SymbolObs): number | null {
  const raw = pointToBox(centre(tag.ev.bbox), sym.ev.bbox);
  const limit = T.tagReachSymbolDiagonals * diag(sym.ev.bbox) + T.tagReachTextHeights * tag.height;
  return raw <= limit ? raw / tag.height : null;
}

const clearlyNearest = <X>(opts: Option<X>[]) =>
  opts.length === 1 || opts[1].d >= T.associationMargin * Math.max(opts[0].d, T.touchingTextHeights);

interface Draft {
  category: ElementCategory;
  mark: string | null;
  symbols: SymbolObs[];
  tags: TagObs[];
  tag: TagAssociation;
  status: CountStatus;
  reasons: string[];
  methods: RecognitionMethod[];
}

function associate(work: SheetWork, unresolved: (kind: UnresolvedKind, message: string, extra?: Partial<UnresolvedCase>) => void): Draft[] {
  const { tags, symbols, summary } = work;
  const tagOpts = new Map<TagObs, Option<SymbolObs>[]>();
  const symOpts = new Map<SymbolObs, Option<TagObs>[]>();
  for (const t of tags) tagOpts.set(t, []);
  for (const s of symbols) symOpts.set(s, []);
  for (const t of tags) {
    for (const s of symbols) {
      if (!compatible(t, s)) continue;
      const d = reach(t, s);
      if (d === null) continue;
      tagOpts.get(t)!.push({ other: s, d });
      symOpts.get(s)!.push({ other: t, d });
    }
  }
  const sortOpts = <X extends { ev: ObservedEvidence }>(o: Option<X>[]) => o.sort((a, b) => a.d - b.d || byStr(a.other.ev.id, b.other.ev.id));
  tagOpts.forEach(sortOpts);
  symOpts.forEach(sortOpts);

  const drafts: Draft[] = [];
  const usedTags = new Set<TagObs>();

  for (const s of symbols) {
    const opts = symOpts.get(s)!;
    const draft: Draft = {
      category: s.category, mark: null, symbols: [s], tags: [], status: "pending_review", reasons: [...s.notes], methods: [...s.methods],
      tag: { status: "none", reason: "No tag within reach of this symbol." },
    };
    if (opts.length === 0) {
      if (s.suppliedMark) {
        draft.mark = s.suppliedMark;
        draft.tag = { status: "none", reason: `No printed tag; mark "${s.suppliedMark}" comes from the ${s.methods.join("/")} detection only.` };
        draft.reasons.push(draft.tag.reason);
      } else {
        draft.reasons.push("Untagged: no printed tag near this symbol, so its type is unknown.");
        unresolved("untagged_candidate", `Untagged ${s.category} symbol on ${summary.sheetKey}.`, { sheetKey: summary.sheetKey, evidenceIds: [s.ev.id] });
      }
      drafts.push(draft);
      continue;
    }
    const nearest = opts[0].other;
    const tagNearest = tagOpts.get(nearest)![0]?.other === s;
    const contenders = opts.filter((o) => o.d < T.associationMargin * Math.max(opts[0].d, T.touchingTextHeights));
    const marks = [...new Set(contenders.map((o) => (o.other.ev.tag!.status === "readable" ? o.other.ev.tag!.mark : `?${o.other.ev.text}`)))];
    if (clearlyNearest(opts) && tagNearest && clearlyNearest(tagOpts.get(nearest)!)) {
      const parsed = nearest.ev.tag!;
      usedTags.add(nearest);
      draft.tags = [nearest];
      draft.tag = {
        status: "unique", tagId: nearest.ev.id, distance: round2(opts[0].d),
        margin: opts.length > 1 ? round2(opts[1].d / Math.max(opts[0].d, T.touchingTextHeights)) : undefined,
        reason: "Each is the other's clearly nearest partner.",
      };
      draft.methods.push("plan_tag");
      if (parsed.status === "readable") {
        draft.mark = parsed.mark;
        if (s.suppliedMark && s.suppliedMark !== parsed.mark) {
          draft.status = "conflicting";
          draft.reasons.push(`Printed tag ${parsed.mark} disagrees with the detection's own mark ${s.suppliedMark}.`);
          unresolved("contradictory_association", `${summary.sheetKey}: printed tag ${parsed.mark} vs detected mark ${s.suppliedMark} on one symbol.`, { sheetKey: summary.sheetKey, evidenceIds: [s.ev.id, nearest.ev.id] });
        }
      } else {
        draft.status = "ambiguous";
        draft.reasons.push(parsed.status === "multiple" ? `Tag "${nearest.ev.text}" names more than one mark.` : parsed.reason);
      }
    } else if (marks.length > 1) {
      draft.status = "conflicting";
      draft.tag = { status: "ambiguous", competitorIds: contenders.map((o) => o.other.ev.id), reason: `Different tags (${marks.join(", ")}) are about equally near this symbol.` };
      draft.reasons.push(draft.tag.reason);
      unresolved("contradictory_association", `${summary.sheetKey}: ${draft.tag.reason}`, { sheetKey: summary.sheetKey, evidenceIds: [s.ev.id, ...draft.tag.competitorIds!] });
    } else {
      draft.status = "ambiguous";
      draft.mark = contenders[0].other.ev.tag!.status === "readable" ? (contenders[0].other.ev.tag as { mark: string }).mark : null;
      draft.tag = {
        status: "ambiguous", competitorIds: [...new Set([...contenders.map((o) => o.other.ev.id), ...tagOpts.get(nearest)!.map((o) => o.other.ev.id)])].sort(byStr),
        reason: tagNearest ? "More than one tag is about equally near this symbol." : `The nearest tag ${nearest.ev.text} is nearer to another symbol, or equally near to several.`,
      };
      draft.reasons.push(draft.tag.reason);
    }
    drafts.push(draft);
  }

  for (const t of tags) {
    if (usedTags.has(t)) continue;
    const parsed = t.ev.tag!;
    const hasSymbols = tagOpts.get(t)!.length > 0;
    if (hasSymbols) {
      // Near symbols but not uniquely theirs: the symbol drafts already carry
      // the ambiguity. Recorded once here so the tag itself is visible.
      unresolved("ambiguous_tag", `${summary.sheetKey}: tag "${t.ev.text}" could belong to more than one symbol.`, { sheetKey: summary.sheetKey, evidenceIds: [t.ev.id, ...tagOpts.get(t)!.map((o) => o.other.ev.id)] });
      continue;
    }
    if (parsed.status !== "readable") {
      unresolved("unreadable_tag", `${summary.sheetKey}: ${parsed.status === "multiple" ? `tag "${t.ev.text}" names more than one mark` : parsed.reason}`, { sheetKey: summary.sheetKey, evidenceIds: [t.ev.id] });
      continue;
    }
    const detected = symbols.some((s) => s.category === parsed.category);
    drafts.push({
      category: parsed.category, mark: parsed.mark, symbols: [], tags: [t], status: "pending_review", methods: ["plan_tag"],
      tag: { status: "tag_only", tagId: t.ev.id, reason: "A printed tag with no detected symbol near it." },
      reasons: [detected
        ? `Tag ${parsed.mark} has no detected ${parsed.category} symbol near it.`
        : `Tag ${parsed.mark}: no ${parsed.category} symbol was detected on this sheet (this version detects swing doors only, plus supplied detections).`],
    });
    unresolved("unmatched_tag", `${summary.sheetKey}: tag ${parsed.mark} with no detected symbol.`, { sheetKey: summary.sheetKey, mark: parsed.mark, evidenceIds: [t.ev.id] });
  }
  return drafts;
}

// ── Stage 6: schedule ───────────────────────────────────────────────────────

function scheduleIndex(schedule: ScheduleEntryInput[]) {
  const byMark = new Map<string, ScheduleEntryInput[]>();
  for (const e of schedule) (byMark.get(e.mark) ?? byMark.set(e.mark, []).get(e.mark)!).push(e);
  return byMark;
}

const normText = (s: string | undefined) => (s ?? "").toUpperCase().replace(/\s+/g, " ").replace(/\s*[xX×]\s*/g, "x").trim();

/** Entries sharing a mark contradict each other when they state different
 *  sizes or categories. Repeats that agree (the same schedule printed on two
 *  sheets) do not. */
function entriesConflict(entries: ScheduleEntryInput[]): string | null {
  const dims = [...new Set(entries.map((e) => normText(e.dimension)).filter(Boolean))];
  if (dims.length > 1) return `sizes ${dims.join(" / ")}`;
  const cats = [...new Set(entries.map((e) => e.category ?? categoryOfDescription(e.description)).filter(Boolean))];
  if (cats.length > 1) return `categories ${cats.join(" / ")}`;
  const qty = [...new Set(entries.map((e) => e.scheduledQuantity).filter((q): q is number => q != null))];
  if (qty.length > 1) return `printed quantities ${qty.join(" / ")}`;
  return null;
}

function scheduleFor(draft: Draft, byMark: Map<string, ScheduleEntryInput[]>, supplied: boolean): ScheduleAssociation {
  if (!draft.mark) return { status: "no_mark", entryIds: [], reason: "No mark, so no schedule entry can be looked up." };
  if (!supplied) return { status: "no_schedule_supplied", entryIds: [], reason: "No schedule was supplied; the type is not independently documented." };
  const entries = byMark.get(draft.mark) ?? [];
  if (entries.length === 0) return { status: "no_entry", entryIds: [], reason: `The schedule has no entry for ${draft.mark}.` };
  const ids = entries.map((e) => e.id).sort(byStr);
  const conflict = entriesConflict(entries);
  if (conflict) return { status: "conflicting_entries", entryIds: ids, reason: `Schedule entries for ${draft.mark} disagree (${conflict}).` };
  const cat = entries[0].category ?? categoryOfDescription(entries[0].description) ?? categoryOfMark(draft.mark);
  if (cat && cat !== draft.category) return { status: "category_mismatch", entryIds: ids, reason: `The schedule lists ${draft.mark} as a ${cat}; the drawing shows a ${draft.category}.` };
  return { status: "matched", entryIds: ids, reason: `Schedule entry for ${draft.mark}.` };
}

// ── The engine ──────────────────────────────────────────────────────────────

export function countInstances(rawInput: CountingInput): CountingResult {
  const { input, rejected } = validateInput(rawInput);
  const sheetsIn = [...input.sheets].sort((a, b) => byStr(a.documentId, b.documentId) || a.page - b.page);
  const unresolved: UnresolvedCase[] = [];
  const add = (kind: UnresolvedKind, message: string, extra: Partial<UnresolvedCase> = {}) =>
    unresolved.push({ id: "", kind, message, ...extra });
  for (const r of rejected) add("invalid_input", `${r.where}: ${r.reason}`);

  // Repeated (documentId, page) pairs: the later copy is dropped, not counted twice.
  const seen = new Set<string>();
  const sheets = sheetsIn.filter((s) => {
    const k = sheetKeyOf(s);
    if (seen.has(k)) { add("invalid_input", `Sheet ${k} supplied more than once; the repeat was ignored.`, { sheetKey: k }); return false; }
    seen.add(k);
    return true;
  });

  const byMark = scheduleIndex(input.schedule);
  const scheduleSupplied = input.schedule.length > 0;
  for (const [mark, entries] of byMark) {
    const c = entriesConflict(entries);
    if (c) add("conflicting_schedule_entries", `Schedule entries for ${mark} disagree (${c}).`, { mark, scheduleEntryIds: entries.map((e) => e.id).sort(byStr) });
  }

  // Stages 2–5.
  const works: SheetWork[] = sheets.map((s) => observeSheet(s, summarizeSheet(s), input.schedule));
  const references: CrossViewReference[] = [];
  const instances: CandidateInstance[] = [];

  for (const w of works) {
    const { summary } = w;
    if (w.sheet.textLayer === "absent") {
      add("unreadable_sheet", `${summary.sheetKey} has no text layer (raster or blank); nothing on it was counted and coverage for it is unknown.`, { sheetKey: summary.sheetKey });
    }
    if (["elevation", "section", "detail"].includes(summary.view)) {
      w.tags.forEach((t, i) => {
        const p = t.ev.tag!;
        references.push({ id: `${summary.sheetKey}:ref:${i}`, mark: p.status === "readable" ? p.mark : null, view: summary.view, sheetKey: summary.sheetKey, evidence: t.ev });
      });
      continue;
    }
    if (summary.view === "schedule") continue;

    if (summary.view === "mixed") add("mixed_view_sheet", `${summary.sheetKey}: ${summary.notes[0]} Nothing on it is confirmed until the plan region is separated.`, { sheetKey: summary.sheetKey });
    if (summary.floorStatus !== "identified" && (w.tags.length || w.symbols.length)) {
      add("floor_unidentified", `${summary.sheetKey}: ${summary.floorStatus === "conflict" ? "its titles name more than one floor" : "no floor title found"}; its counts cannot be placed on a floor or checked against repeats.`, { sheetKey: summary.sheetKey });
    }
    if (summary.typical) add("typical_floor_multiplier", `${summary.sheetKey} is a typical-floor plan; how many floors it stands for is not established, so its counts are per one floor and stay unresolved.`, { sheetKey: summary.sheetKey });

    const drafts = associate(w, add);
    const sheetReasons: string[] = [];
    if (summary.view === "mixed") sheetReasons.push("Sheet mixes a plan with other views.");
    if (summary.view === "unknown") sheetReasons.push("Sheet view not identified from its titles.");
    if (summary.floorStatus !== "identified") sheetReasons.push("Floor not identified.");

    const ordered = drafts
      .map((d) => ({ d, region: union([...d.symbols.map((s) => s.ev.bbox), ...d.tags.map((t) => t.ev.bbox)]) }))
      .sort((a, b) => a.region[1] - b.region[1] || a.region[0] - b.region[0] || byStr((a.d.symbols[0] ?? a.d.tags[0]).ev.id, (b.d.symbols[0] ?? b.d.tags[0]).ev.id));
    ordered.forEach(({ d, region }, n) => {
      const schedule = scheduleFor(d, byMark, scheduleSupplied);
      const reasons = [...sheetReasons, ...d.reasons];
      let status = d.status;
      if (d.tags.length && w.sheet.textSource === "ocr") reasons.push("Tag text was read by OCR; confirm the reading.");
      if (schedule.status === "conflicting_entries" || schedule.status === "category_mismatch") {
        status = worst(status, "conflicting");
        reasons.push(schedule.reason);
      } else if (schedule.status !== "matched" && schedule.status !== "no_mark") {
        reasons.push(schedule.reason);
      }
      if (schedule.status === "no_entry") add("instance_without_schedule_entry", `${summary.sheetKey}: ${d.mark} is on the plan but not in the schedule.`, { sheetKey: summary.sheetKey, mark: d.mark! });
      if (status === "confirmed" || status === "pending_review") status = reasons.length === 0 && d.symbols.length && d.tag.status === "unique" ? "confirmed" : "pending_review";
      const id = `${summary.sheetKey}:inst:${n + 1}`;
      const merged = d.symbols.flatMap((s) => s.memberIds);
      const duplicateGroup = d.symbols.length && merged.length > 1 && !d.symbols[0].methods.includes("double_swing_geometry")
        ? { memberIds: merged, reason: "Overlapping detections of one object were merged." } : undefined;
      if (duplicateGroup) add("duplicate_detection", `${summary.sheetKey}: ${merged.length} overlapping detections merged into ${id}.`, { sheetKey: summary.sheetKey, candidateIds: [id], evidenceIds: merged });
      instances.push({
        id, category: d.category, proposedType: d.mark, sheetKey: summary.sheetKey, documentId: w.sheet.documentId, page: w.sheet.page,
        floor: summary.floor, region,
        observed: { symbols: d.symbols.map((s) => s.ev), tags: d.tags.map((t) => t.ev) },
        interpretation: { tag: d.tag, schedule, duplicateGroup, crossViewReferenceIds: [] },
        recognition: { methods: [...new Set(d.methods)].sort() as RecognitionMethod[], confidence: null },
        status, reasons: status === "confirmed" ? [] : reasons,
      });
    });
  }

  // Stage 7: cross-view references link to the type, never to the count.
  for (const inst of instances) {
    inst.interpretation.crossViewReferenceIds = references.filter((r) => r.mark && r.mark === inst.proposedType).map((r) => r.id);
  }
  const planMarks = new Set(instances.map((i) => i.proposedType).filter(Boolean));
  for (const mark of [...new Set(references.map((r) => r.mark).filter((m): m is string => !!m))].sort(byStr)) {
    if (!planMarks.has(mark)) add("plan_absent", `${mark} appears only on elevations/sections/details; those views are not counted and no plan occurrence was found.`, { mark, evidenceIds: references.filter((r) => r.mark === mark).map((r) => r.evidence.id) });
  }

  // Stage 8: the same floor on more than one plan sheet.
  for (const w of works) {
    w.summary.layoutFingerprint = layoutFingerprint(
      w.sheet,
      w.tags.map((t) => Number(t.ev.id.split(":run:")[1])),
      w.symbols.map((s) => s.ev.bbox),
    );
  }
  const plans = works.filter((w) => w.summary.view === "plan" || w.summary.view === "mixed");
  const byFloor = new Map<string, SheetWork[]>();
  for (const w of plans) if (w.summary.floor) (byFloor.get(w.summary.floor) ?? byFloor.set(w.summary.floor, []).get(w.summary.floor)!).push(w);
  const conflictFloors = new Set<string>();
  for (const [floor, group] of byFloor) {
    if (group.length < 2) continue;
    const first = group[0];
    const distinct = new Set(group.map((g) => g.summary.layoutFingerprint));
    if (distinct.size === 1) {
      for (const dup of group.slice(1)) {
        add("duplicate_sheet", `${dup.summary.sheetKey} shows the same ${floor} layout as ${first.summary.sheetKey}; counted once.`, { sheetKey: dup.summary.sheetKey });
        for (const inst of instances.filter((i) => i.sheetKey === dup.summary.sheetKey)) {
          inst.status = "rejected";
          inst.interpretation.duplicateOf = first.summary.sheetKey;
          inst.reasons = [`Repeat of sheet ${first.summary.sheetKey} (same floor, same layout).`];
        }
      }
    } else {
      conflictFloors.add(floor);
      add("conflicting_sheets", `${floor} is shown on ${group.length} sheets with different layouts (${group.map((g) => g.summary.sheetKey).join(", ")}); which is current is not established.`, { sheetKey: first.summary.sheetKey });
      for (const inst of instances.filter((i) => i.floor === floor && plans.some((p) => p.summary.sheetKey === i.sheetKey))) {
        inst.status = worst(inst.status, "conflicting");
        inst.reasons.push(`${floor} has more than one, different, plan sheet.`);
      }
    }
  }
  // Same layout, different floors: real repeated floors. Reported, not merged.
  const byPrint = new Map<string, SheetWork[]>();
  for (const w of plans) if (w.summary.layoutFingerprint !== "empty") (byPrint.get(w.summary.layoutFingerprint) ?? byPrint.set(w.summary.layoutFingerprint, []).get(w.summary.layoutFingerprint)!).push(w);
  for (const group of byPrint.values()) {
    const floors = [...new Set(group.map((g) => g.summary.floor ?? g.summary.sheetKey))];
    if (floors.length > 1) for (const g of group) g.summary.notes.push(`Same opening layout as ${group.filter((o) => o !== g).map((o) => o.summary.sheetKey).join(", ")}; counted separately because the titles name different floors.`);
  }

  // Stage 9: counts per type per floor.
  const sheetByKey = new Map(works.map((w) => [w.summary.sheetKey, w.summary]));
  const live = instances.filter((i) => i.status !== "rejected");
  const groupKey = (i: CandidateInstance) => `${i.category}|${i.proposedType ?? "untagged"}|${i.floor ?? `sheet:${i.sheetKey}`}`;
  const groups = new Map<string, CandidateInstance[]>();
  for (const i of live) (groups.get(groupKey(i)) ?? groups.set(groupKey(i), []).get(groupKey(i))!).push(i);

  // Anything on a sheet that could be another instance of a category.
  const openOnSheet = (sheetKey: string, category: ElementCategory) => {
    const r: string[] = [];
    const untagged = live.filter((i) => i.sheetKey === sheetKey && i.category === category && !i.proposedType).length;
    if (untagged) r.push(`${untagged} untagged ${category} candidate(s) on ${sheetKey} could be this type.`);
    const loose = unresolved.filter((u) => u.sheetKey === sheetKey && (u.kind === "ambiguous_tag" || u.kind === "unreadable_tag" || u.kind === "contradictory_association")).length;
    if (loose) r.push(`${loose} ambiguous or unreadable tag(s) on ${sheetKey}.`);
    return r;
  };

  const counts: TypeCount[] = [...groups.entries()].sort(([a], [b]) => byStr(a, b)).map(([id, members]) => {
    const first = members[0];
    const sheetKeys = [...new Set(members.map((m) => m.sheetKey))].sort(byStr);
    const confirmed = members.filter((m) => m.status === "confirmed").length;
    const reasons: string[] = [];
    if (confirmed < members.length) reasons.push(`${members.length - confirmed} of ${members.length} candidate(s) not confirmed.`);
    for (const k of sheetKeys) {
      reasons.push(...openOnSheet(k, first.category).filter(() => first.proposedType !== null));
      if (sheetByKey.get(k)?.typical) reasons.push(`${k} is a typical-floor plan; the number of floors it stands for is not established.`);
    }
    let conflictingValues: TypeCount["conflictingValues"];
    if (first.floor && conflictFloors.has(first.floor)) {
      conflictingValues = sheetKeys.map((k) => ({ value: members.filter((m) => m.sheetKey === k).length, basis: `candidates on ${k}` }));
    }
    const resolved = reasons.length === 0 && first.proposedType !== null;
    return {
      id, category: first.category, mark: first.proposedType, floor: first.floor, sheetKeys,
      candidateIds: members.map((m) => m.id),
      confirmedCount: confirmed,
      quantity: resolved ? confirmed : null,
      status: resolved ? "resolved" : "unresolved",
      reasons: [...new Set(reasons)],
      scheduleEntryIds: [...new Set(members.flatMap((m) => m.interpretation.schedule.entryIds))].sort(byStr),
      conflictingValues,
    } satisfies TypeCount;
  });

  // Stage 10: drawing set completeness and schedule totals.
  const setReasons: string[] = [];
  const supplied = new Set(sheets.map((s) => (s.sheetNumber ?? "").trim().toUpperCase()).filter(Boolean));
  for (const e of input.expectedSheets ?? []) {
    if (!supplied.has(e.sheetNumber.trim().toUpperCase())) {
      add("missing_sheet", `Sheet ${e.sheetNumber}${e.title ? ` (${e.title})` : ""} is listed but was not supplied.`);
      setReasons.push(`Sheet ${e.sheetNumber} missing.`);
    }
  }
  for (const w of works) if (w.sheet.textLayer === "absent") setReasons.push(`${w.summary.sheetKey} unreadable.`);
  if (plans.length === 0) setReasons.push("No plan sheet was supplied.");
  if (!(input.expectedSheets ?? []).length) setReasons.push("No sheet register supplied: whether every floor is present is not established.");
  const complete = setReasons.length === 0;

  const markTotals: MarkTotal[] = [];
  const allMarks = [...new Set([...byMark.keys(), ...counts.map((c) => c.mark).filter((m): m is string => !!m)])].sort(byStr);
  for (const mark of allMarks) {
    const mc = counts.filter((c) => c.mark === mark);
    const entries = byMark.get(mark) ?? [];
    const category = mc[0]?.category ?? entries[0]?.category ?? categoryOfMark(mark) ?? "door";
    const sq = [...new Set(entries.map((e) => e.scheduledQuantity).filter((q): q is number => q != null))];
    const scheduledQuantity = sq.length === 1 ? sq[0] : null;
    if (entries.length && mc.length === 0) {
      add("schedule_entry_without_instance", `The schedule lists ${mark} but no plan occurrence was found. It may be on a sheet not supplied, unbuilt, or missed — it is not counted as 0.`, { mark, scheduleEntryIds: entries.map((e) => e.id).sort(byStr) });
    }
    const allResolved = mc.length > 0 && mc.every((c) => c.status === "resolved");
    const drawingTotal = allResolved && complete ? mc.reduce((s, c) => s + c.quantity!, 0) : null;
    let comparison: MarkTotal["comparison"] = "not_comparable";
    let reason: string;
    if (scheduledQuantity == null) reason = sq.length > 1 ? "The schedule prints different quantities for this mark." : "The schedule prints no quantity for this mark.";
    else if (drawingTotal == null) reason = !complete ? `Drawing set not complete (${setReasons.join(" ")})` : "Not every floor's count for this mark is resolved.";
    else if (drawingTotal === scheduledQuantity) { comparison = "agree"; reason = `Drawings and schedule both give ${drawingTotal}. Agreement is reported; it does not prove either is right.`; }
    else {
      comparison = "disagree";
      reason = `Drawings total ${drawingTotal}; the schedule prints ${scheduledQuantity}.`;
      add("schedule_count_conflict", `${mark}: ${reason} Neither is chosen.`, { mark, scheduleEntryIds: entries.map((e) => e.id).sort(byStr) });
      for (const c of mc) {
        c.status = "unresolved";
        c.quantity = null;
        c.reasons.push(`${reason} Which is right is for the reviewer.`);
      }
    }
    markTotals.push({ mark, category, drawingTotal: comparison === "disagree" ? null : drawingTotal, scheduledQuantity, scheduleEntryIds: entries.map((e) => e.id).sort(byStr), comparison, reason });
  }

  // Stable ids and order for the unresolved list.
  const kindOrder = (k: UnresolvedKind) => k;
  unresolved.sort((a, b) => byStr(kindOrder(a.kind), kindOrder(b.kind)) || byStr(a.sheetKey ?? "", b.sheetKey ?? "") || byStr(a.message, b.message));
  unresolved.forEach((u, i) => (u.id = `unresolved:${i + 1}`));

  return {
    contractVersion: COUNTING_CONTRACT_VERSION,
    sheets: works.map((w) => w.summary),
    instances,
    references,
    counts,
    markTotals,
    unresolved,
    rejectedInputs: rejected,
    drawingSet: { complete, reasons: setReasons },
    provenance: {
      engine: COUNTING_ENGINE,
      inputDigest: fnv1a(canonicalJson({ ...input, sheets: sheets })),
      thresholds: { ...COUNTING_THRESHOLDS },
    },
  };
}
