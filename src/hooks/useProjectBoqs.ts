// Shared by WorkspaceContext.tsx's DrawingHome (its "Review" button's own
// "does this project have a BOQ yet" check) and ProjectWorkspace.tsx's
// mobile "Review & Identify" CTA on the drawing canvas — same queryKey in
// both places, so React Query dedupes/shares the one fetch and the two
// callers can never disagree about whether a BOQ exists. Pulled into its
// own file (rather than exported alongside WorkspaceContext's default
// component export) purely to avoid a react-refresh/only-export-components
// lint warning — no behavior change from how it lived inline before.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProjectBoqSummary {
  id: string;
  name: string;
  created_at: string;
}

export function useProjectBoqs(projectId: string) {
  return useQuery({
    queryKey: ["workspace-project-boqs", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectBoqSummary[]> => {
      const { data } = await supabase.from("boq").select("id, name, created_at").eq("project_id", projectId).order("created_at", { ascending: false });
      return (data ?? []) as ProjectBoqSummary[];
    },
  });
}
