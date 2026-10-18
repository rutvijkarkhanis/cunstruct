// Mapper: Cunstruct BOQ lines → tender items. Item number first, then an exact
// (case- and whitespace-insensitive) description match with the same unit. No
// fuzzy matching: a rate is never carried to a different item. Anything that
// matches more than one way is a gap, not a guess.
import { normItemNo, normText, normUnit } from "./cells";
import type { CunstructLine, Gap, Mapping, Match, ReadTender, TenderItem } from "./types";

const key = (i: TenderItem) => `${i.sheet}!${i.row}`;

export function mapLinesToTender(read: ReadTender, lines: CunstructLine[]): Mapping {
  const items = read.tables.flatMap((t) => t.items);
  const byNo = new Map<string, TenderItem[]>();
  for (const i of items) byNo.set(i.itemNo, [...(byNo.get(i.itemNo) ?? []), i]);

  const candidates = new Map<string, { item: TenderItem; lines: { line: CunstructLine; basis: Match["basis"] }[] }>();
  const unmatchedLines: Mapping["unmatchedLines"] = [];
  const unitMismatch = new Map<string, string>();

  for (const line of lines) {
    let found: TenderItem[] = [];
    let basis: Match["basis"] = "item_no";
    const no = line.tenderItemNo ? normItemNo(line.tenderItemNo) : "";
    if (no) {
      found = byNo.get(no) ?? [];
      if (found.length === 1 && normUnit(found[0].unit) !== normUnit(line.unit)) {
        unitMismatch.set(key(found[0]), `line ${line.id} is in ${line.unit ?? "no unit"}, the tender item in ${found[0].unit}`);
        unmatchedLines.push({ line, detail: `item ${no}: unit ${line.unit ?? "—"} differs from the tender's ${found[0].unit}` });
        continue;
      }
    }
    if (!found.length) {
      basis = "description_and_unit";
      found = items.filter((i) => normText(i.description) === normText(line.description) && normUnit(i.unit) === normUnit(line.unit));
    }
    if (found.length === 0) {
      unmatchedLines.push({ line, detail: no ? `no tender item ${no}, and no item with the same description and unit` : "no tender item with the same description and unit" });
      continue;
    }
    if (found.length > 1) {
      unmatchedLines.push({ line, detail: `matches ${found.length} tender items (${found.map((i) => `${i.sheet} row ${i.row}`).join(", ")}); none is chosen` });
      for (const i of found) {
        const c = candidates.get(key(i)) ?? { item: i, lines: [] };
        c.lines.push({ line, basis });
        candidates.set(key(i), c);
      }
      continue;
    }
    const c = candidates.get(key(found[0])) ?? { item: found[0], lines: [] };
    c.lines.push({ line, basis });
    candidates.set(key(found[0]), c);
  }

  const matches: Match[] = [];
  const gaps: Gap[] = [];
  for (const item of items) {
    const c = candidates.get(key(item));
    if (!c) {
      const um = unitMismatch.get(key(item));
      gaps.push(um ? { item, reason: "unit_mismatch", detail: um } : { item, reason: "no_line", detail: "no Cunstruct line matches this item" });
      continue;
    }
    // Ambiguous if the item has several lines, or its only line also matched other items.
    const lineIds = c.lines.map((l) => l.line.id);
    const multiItem = c.lines.some((l) => unmatchedLines.some((u) => u.line.id === l.line.id));
    if (c.lines.length > 1 || multiItem) {
      gaps.push({ item, reason: "ambiguous", detail: `lines ${lineIds.join(", ")} match this item ambiguously; no rate is written` });
      continue;
    }
    const { line, basis } = c.lines[0];
    if (line.rate == null || !Number.isFinite(line.rate)) {
      gaps.push({ item, reason: "no_rate", detail: `line ${line.id} has no rate` });
      continue;
    }
    matches.push({ item, line, basis });
  }
  // A line that won an item but lost to ambiguity is reported once, as unmatched.
  for (const g of gaps.filter((x) => x.reason === "ambiguous")) {
    for (const l of candidates.get(key(g.item))!.lines) {
      if (!unmatchedLines.some((u) => u.line.id === l.line.id)) unmatchedLines.push({ line: l.line, detail: `ambiguous on ${g.item.sheet} row ${g.item.row}` });
    }
  }
  return { matches, gaps, unmatchedLines };
}
