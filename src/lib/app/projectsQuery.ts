// The projects list read shared by the Projects page and the guide's project
// picker: one query key, one shape. Row-level security decides which projects
// a user sees; nothing here filters or widens that.
import { supabase } from "@/integrations/supabase/client";
import type { AppProjectRow } from "./projects";

export const appProjectsKey = ["app-projects"] as const;

export async function loadAppProjects(): Promise<AppProjectRow[]> {
  const { data, error } = await supabase.from("projects")
    .select("id, name, client_name, location, project_type, status, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AppProjectRow[];
}
