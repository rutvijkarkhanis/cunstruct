// SHARED BOQ MANAGEMENT — Phase 11 Stage C3. The one implementation of
// project-scope/BOQ reads and plain-BOQ creation, extracted from
// ProjectBoqs.tsx so the existing BOQ list page and the new Workspace BOQ
// context consume the exact same persistence logic — never two independent
// read/creation paths for the same data.
//
// Reuses the EXISTING data model unchanged: project_scope, boq, boq_line.
// No new schema, no new BOQ identity system.
//
// Deliberately NOT extracted here (these remain ProjectBoqs-only, since
// Workspace's compact BOQ context never needs them): import/generate-from-
// JSON, move-into-project, rename, reorder, delete, share-as-PDF. Those are
// page-specific presentation flows with their own bespoke line-insertion or
// re-parenting logic — extracting them would pull UI concerns into this
// shared layer for no consumer that needs them.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import type { ProjectScope } from "@/lib/projectDocs";

export type { ProjectScope };
export interface BoqRow {
  id: string; name: string; description: string | null; scope_id: string | null; sort: number; status: string;
  discipline: string;
  /** Commercial waterfall inputs (cost index / contingency / overhead / cess /
   *  GST percentages) — the SAME column OpsBoqBuilder reads/writes. Exposed
   *  here so any consumer that needs the authoritative grand total (not just
   *  a line-sum) can compute it via boqDsrDocument's computeCommercials()
   *  instead of reimplementing the waterfall. */
  spec: Record<string, unknown>;
}

/** Sentinel value for "create a new scope" in a scope <Select>, shared so
 *  both consumers recognize the same marker. */
export const NEW_SCOPE = "__new__";

export interface CreateBoqParams {
  name: string;
  description?: string;
  /** An existing project_scope id, or NEW_SCOPE to create one inline. */
  scopeId: string;
  newScopeName?: string;
  newScopeKind?: string;
  /** One of disciplines.ts's 5 keys (civil/plumbing/electrical/hvac/fire).
   *  Omit to preserve the existing behavior exactly: the `boq.discipline`
   *  column's own DB default ('civil') applies, same as every BOQ created
   *  before this field existed — this is NOT a redundant default written
   *  here, it's leaving the key out of the insert payload entirely so
   *  Postgres decides, unchanged from today. */
  discipline?: string;
}

export function useBoqManagement(projectId: string | undefined | null) {
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data: scopes } = useQuery({
    queryKey: ["project-scopes", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("project_scope")
        .select("id, project_id, name, kind, sort, status").eq("project_id", projectId!).order("sort");
      return (data ?? []) as ProjectScope[];
    },
  });

  const { data: boqs } = useQuery({
    queryKey: ["project-boqs", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("boq")
        .select("id, name, description, scope_id, sort, status, spec, discipline").eq("project_id", projectId!)
        .order("sort").order("created_at");
      return (data ?? []) as BoqRow[];
    },
  });

  const { data: counts } = useQuery({
    queryKey: ["project-boq-counts", projectId, (boqs ?? []).map((b) => b.id).join(",")],
    enabled: !!boqs?.length,
    queryFn: async () => {
      const out: Record<string, number> = {};
      await Promise.all((boqs ?? []).map(async (b) => {
        const { count } = await supabase.from("boq_line").select("id", { count: "exact", head: true }).eq("boq_id", b.id);
        out[b.id] = count ?? 0;
      }));
      return out;
    },
  });

  const scopeName = (sid: string | null) => scopes?.find((s) => s.id === sid)?.name ?? "—";

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["project-scopes", projectId] });
    qc.invalidateQueries({ queryKey: ["project-boqs", projectId] });
  };

  /** Resolve (creating if needed) the scope to use for a new/moved BOQ. Used
   *  by plain creation here, and by ProjectBoqs' own import/generate/move
   *  flows — one scope-resolution implementation, not several. */
  const resolveScopeId = async (scopeId: string, newScopeName: string, newScopeKind: string): Promise<string | null> => {
    if (!scopeId) { toast.error("Select or create a scope"); return null; }
    if (scopeId !== NEW_SCOPE) return scopeId;
    if (!newScopeName.trim()) { toast.error("Enter the new scope name"); return null; }
    const { data, error } = await supabase.from("project_scope")
      .insert({ project_id: projectId, name: newScopeName.trim(), kind: newScopeKind, sort: scopes?.length ?? 0 })
      .select("id").single();
    if (error) { toast.error(error.message); return null; }
    return (data as { id: string }).id;
  };

  const [creatingBoq, setCreatingBoq] = useState(false);
  /** Plain BOQ creation (no import/generation) — the one flow Workspace's
   *  "Create BOQ" dialog needs. Returns the new BOQ id, or null on failure
   *  (a toast has already been shown). Navigation/form-reset are the
   *  caller's presentation concern, not this hook's. */
  const createBoq = async (params: CreateBoqParams): Promise<string | null> => {
    if (!projectId) return null;
    if (!params.name.trim()) { toast.error("Enter a BOQ name"); return null; }
    setCreatingBoq(true);
    try {
      const sid = await resolveScopeId(params.scopeId, params.newScopeName ?? "", params.newScopeKind ?? "floor");
      if (!sid) return null;
      const { data, error } = await supabase.from("boq")
        .insert({ project_id: projectId, name: params.name.trim(), description: params.description?.trim() || null, scope_id: sid, sort: boqs?.length ?? 0, spec: {}, created_by: user?.id, discipline: params.discipline })
        .select("id").single();
      if (error) throw error;
      toast.success("BOQ created");
      invalidateAll();
      return (data as { id: string }).id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create BOQ");
      return null;
    } finally {
      setCreatingBoq(false);
    }
  };

  return { scopes, boqs, counts, scopeName, creatingBoq, createBoq, resolveScopeId, invalidateAll };
}

export type BoqManagement = ReturnType<typeof useBoqManagement>;
