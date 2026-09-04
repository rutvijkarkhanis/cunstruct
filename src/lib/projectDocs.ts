// Types + small vocabularies for the project-workspace entities (Phase 0/2).
// These mirror the DB tables added in 20260901000000_project_workspace.sql. The
// Supabase client is queried untyped for these tables (as the existing boq/boq_line
// queries are), so results are cast to these interfaces at the call site.

export interface ProjectScope {
  id: string;
  project_id: string;
  name: string;
  kind: string | null;
  sort: number;
  status: string;
  created_at?: string;
}

export interface ProjectDocument {
  id: string;
  project_id: string;
  name: string;
  doc_type: string | null;
  discipline: string | null;
  current_revision_id: string | null;
  status: string;
  created_at?: string;
}

export interface DocumentRevision {
  id: string;
  document_id: string;
  label: string;
  revision_date: string | null;
  source: string;
  file_path: string | null;
  external_url: string | null;
  page_count: number | null;
  eval_json?: unknown;
  analysed_at?: string | null;
  status: string;
  created_at?: string;
  mime_type?: string | null;
  file_size?: number | null;
  original_filename?: string | null;
}

export interface BoqDocumentLink {
  id: string;
  boq_id: string;
  document_id: string;
  analyzed_revision_id: string | null;
  applicability_note: string | null;
}

// Free vocabularies — suggestions only, never enforced (the DB columns are free text
// so any project-specific value is allowed). Kept here so the UI stays consistent.
export const DOC_TYPES = [
  "Architectural", "Structural", "Electrical", "Plumbing", "HVAC", "Landscape",
  "Interior", "Elevation", "Door/Window Schedule", "BOQ", "Specification", "Evaluation", "Other",
];

export const DISCIPLINES = [
  "Architectural", "Structural", "Electrical", "Plumbing", "HVAC", "Landscape",
  "Interior", "Civil", "Fire", "Other",
];

// Scope kind is a free string; these are common suggestions, not a fixed set, and
// deliberately NOT limited to floors.
export const SCOPE_KINDS = [
  "floor", "common", "structural", "external", "landscape", "mep", "interior", "site", "pool", "other",
];
