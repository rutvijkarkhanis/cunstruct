// COUNTING RESULT → EXISTING CONTRACTS. No new import path and no schema
// change: a counting result is written as
//
//   - cunstruct.analysis.v1 items, one per TypeCount (mark × floor). These go
//     through parseAnalysisV1 → review queue → explicit Apply like any other
//     analysis. A resolved count is MEASURED with its quantity; anything else
//     is PENDING with quantity null — never 0 — and, where sources disagree,
//     `candidates` (which parseAnalysisV1 itself forces to PENDING);
//   - cunstruct.observation.v1 observations, one `opening` per candidate
//     instance (rejected repeats left out) and one `schedule_entry` per
//     schedule mark, so typeInstances.ts / instanceReconciliation.ts see the
//     same per-occurrence facts they already understand.
//
// Mark-level checks (a drawing total that disagrees with the schedule) are
// emitted as CHECK: items with both values as candidates, the same shape PR
// #230's schedule reader uses for a printed total that does not add up.
//
// Every string here is built from the result; nothing is added that the
// result does not hold. Unresolved cases that have no item of their own
// (an untagged symbol, an unreadable tag) are carried in the notes of the
// affected item and in result.unresolved.

import type { CandidateInstance, CountingResult, ElementCategory, TypeCount } from "./contract";

const NAME: Record<ElementCategory, string> = { door: "Door", window: "Window", ventilator: "Ventilator" };

function evidenceFor(instances: CandidateInstance[]) {
  const boxes: { bbox: number[]; page: number; claim: "location" | "general"; label: string }[] = [];
  for (const i of instances) {
    for (const s of i.observed.symbols) boxes.push({ bbox: s.bbox, page: s.page, claim: "location", label: `${i.proposedType ?? "untagged"} symbol (${s.method})` });
    for (const t of i.observed.tags) boxes.push({ bbox: t.bbox, page: t.page, claim: "location", label: `tag "${t.text}"` });
  }
  return boxes;
}

function itemFor(count: TypeCount, byId: Map<string, CandidateInstance>, docName: Map<string, string | undefined>) {
  const members = count.candidateIds.map((id) => byId.get(id)!);
  const first = members[0];
  const resolved = count.status === "resolved";
  const what = count.mark ? `${NAME[count.category]} ${count.mark}` : `Untagged ${count.category}s`;
  const where = count.floor ?? `sheet ${first.sheetKey}`;
  const candidates = (count.conflictingValues ?? []).map((v) => ({ value: v.value, unit: "nos", basis: v.basis }));
  const statusLine = members.map((m) => `${m.id}: ${m.status}${m.reasons.length ? ` — ${m.reasons.join(" ")}` : ""}`).join(" | ");
  return {
    key: count.mark ?? `UNTAGGED:${count.category}:${first.sheetKey}`,
    item: what,
    quantity: resolved ? count.quantity : null,
    unit: "nos",
    location: count.floor ?? undefined,
    source: {
      document_id: first.documentId,
      document: docName.get(first.documentId),
      page: first.page,
      evidence: evidenceFor(members),
    },
    confidence: null,
    status: resolved ? "MEASURED" : "PENDING",
    calculation: resolved
      ? `Counted ${count.quantity} distinct ${what} instance(s) on ${count.sheetKeys.join(", ")}; each has a detected symbol, one clearly nearest printed tag and a matching schedule entry.`
      : undefined,
    notes: [
      resolved ? null : `Unresolved (${where}): ${count.reasons.join(" ")} ${members.length} candidate(s) observed; ${count.confirmedCount} confirmed.`,
      `Candidates — ${statusLine}`,
    ].filter(Boolean).join(" "),
    ...(candidates.length ? { candidates } : {}),
  };
}

export interface CountingPayloads {
  analysis: { schema_version: "cunstruct.analysis.v1"; source_drawing?: { sha256: string; filename?: string; extractor: string }; items: Record<string, unknown>[] };
  observations: { schema_version: "cunstruct.observation.v1"; observations: Record<string, unknown>[] };
}

export function toCountingPayloads(
  result: CountingResult,
  documents: { documentId: string; name?: string; sha256?: string }[] = [],
): CountingPayloads {
  const byId = new Map(result.instances.map((i) => [i.id, i]));
  const docName = new Map(documents.map((d) => [d.documentId, d.name]));
  const items: Record<string, unknown>[] = result.counts.map((c) => itemFor(c, byId, docName));

  for (const t of result.markTotals) {
    if (t.comparison !== "disagree") continue;
    const counts = result.counts.filter((c) => c.mark === t.mark);
    const drawn = counts.reduce((s, c) => s + c.confirmedCount, 0);
    const first = byId.get(counts[0].candidateIds[0])!;
    items.push({
      key: `CHECK:count:${t.mark}`,
      item: `Count check — ${NAME[t.category]} ${t.mark}: drawings ${drawn}, schedule ${t.scheduledQuantity}`,
      quantity: null,
      unit: "nos",
      source: { document_id: first.documentId, page: first.page, evidence: evidenceFor(counts.flatMap((c) => c.candidateIds.map((id) => byId.get(id)!))) },
      confidence: null,
      status: "PENDING",
      candidates: [
        { value: drawn, unit: "nos", basis: `confirmed plan instances across ${counts.map((c) => c.floor ?? c.sheetKeys.join("+")).join(", ")}` },
        { value: t.scheduledQuantity, unit: "nos", basis: "quantity printed in the schedule" },
      ],
      notes: `${t.reason} Neither value is chosen; check which is right.`,
    });
  }

  // source_drawing ties an import to one stored file — only when every item
  // comes from one document whose hash is known.
  const docIds = [...new Set(result.instances.map((i) => i.documentId))];
  const doc = docIds.length === 1 ? documents.find((d) => d.documentId === docIds[0]) : undefined;

  const observations: Record<string, unknown>[] = result.instances
    .filter((i) => i.status !== "rejected")
    .map((i) => ({
      observation_type: "opening",
      mark: i.proposedType ?? undefined,
      scope_hint: NAME[i.category],
      location_text: i.floor ?? undefined,
      evidence_completeness: i.observed.symbols.length ? "FULL" : "PARTIAL",
      source: { document_id: i.documentId, page: i.page, evidence: evidenceFor([i]) },
    }));
  // Schedule rows are reported as LIMITED observations: their own evidence
  // boxes live in the schedule source, not in this result.
  for (const t of result.markTotals) {
    if (!t.scheduleEntryIds.length) continue;
    observations.push({
      observation_type: "schedule_entry",
      mark: t.mark,
      scope_hint: NAME[t.category],
      evidence_completeness: "LIMITED",
      source: {},
    });
  }

  return {
    analysis: {
      schema_version: "cunstruct.analysis.v1",
      ...(doc?.sha256 ? { source_drawing: { sha256: doc.sha256, filename: doc.name, extractor: result.provenance.engine } } : {}),
      items,
    },
    observations: { schema_version: "cunstruct.observation.v1", observations },
  };
}
