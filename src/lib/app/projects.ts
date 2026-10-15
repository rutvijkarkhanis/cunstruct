// Projects list rules for the project journey.

export interface AppProjectRow {
  id: string; name: string; client_name: string | null; location: string | null;
  project_type: string | null; status: string; created_at: string;
}

export function projectMatches(p: AppProjectRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [p.name, p.client_name, p.location, p.project_type].some((v) => (v ?? "").toLowerCase().includes(needle));
}

const STATUS_LABEL: Record<string, string> = { pending_review: "Pending review", active: "Active", completed: "Completed" };
export const projectStatusLabel = (s: string) => STATUS_LABEL[s] ?? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
