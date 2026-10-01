// WORKSPACE SOURCES — pure grouping logic for the Sources rail.
//
// Groups the project's REAL documents (project_document rows, already
// persisted) by their own `discipline` field when set, else `docType`, else
// "Other" — never invents a discipline/grouping the data doesn't have. This
// mirrors the reference mockup's "Architectural / Structural / MEP / ..."
// grouping using a column the schema already carries, rather than adding a
// new one.

export interface SourceDocument {
  id: string;
  name: string;
  docType: string | null;
  discipline: string | null;
  status: string;
  pageCount: number | null;
}

export interface SourceGroup {
  label: string;
  documents: SourceDocument[];
}

const UNGROUPED_LABEL = "Other";

/** Stable order: groups with a real discipline/type first (in first-seen
 *  order), "Other" always last — so undisciplined documents don't visually
 *  dominate a project that mostly has real groupings. */
export function groupSourcesByDiscipline(documents: SourceDocument[]): SourceGroup[] {
  const order: string[] = [];
  const byLabel = new Map<string, SourceDocument[]>();
  for (const doc of documents) {
    const label = doc.discipline?.trim() || doc.docType?.trim() || UNGROUPED_LABEL;
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    byLabel.get(label)!.push(doc);
  }
  order.sort((a, b) => (a === UNGROUPED_LABEL ? 1 : b === UNGROUPED_LABEL ? -1 : 0));
  return order.map((label) => ({ label, documents: byLabel.get(label)! }));
}
