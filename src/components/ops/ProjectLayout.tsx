import { NavLink, Outlet, useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { ArrowLeft, LayoutDashboard, FileText, Calculator, PackageSearch, Activity } from "lucide-react";

// The project sub-workspace shell: a header + tab nav (Overview / Documents / BOQs /
// Procurement / Activity) with an <Outlet/> for the active section. The project — not
// a BOQ or a PDF — is the parent workspace.
const TABS = [
  { to: "", end: true, label: "Overview", icon: LayoutDashboard },
  { to: "documents", label: "Documents", icon: FileText },
  { to: "boqs", label: "BOQs", icon: Calculator },
  { to: "procurement", label: "Procurement", icon: PackageSearch },
  { to: "activity", label: "Activity", icon: Activity },
];

export default function ProjectLayout() {
  const { id } = useParams<{ id: string }>();
  const { data: project } = useQuery({
    queryKey: ["project-header", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from("projects")
        .select("id, name, client_name, location, project_type, status").eq("id", id!).single();
      return data as { id: string; name: string; client_name: string | null; location: string | null; project_type: string | null; status: string } | null;
    },
  });

  return (
    <div className="min-w-0">
      <div className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 md:px-6 pt-4">
          <Link to="/ops/projects" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Projects
          </Link>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-xl font-bold">{project?.name ?? "Project"}</h1>
            <span className="text-xs text-muted-foreground">
              {[project?.client_name, project?.location, project?.project_type].filter(Boolean).join(" · ")}
            </span>
          </div>
          <nav className="mt-3 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <NavLink
                key={t.to || "overview"}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-md border-b-2 -mb-px whitespace-nowrap transition-colors",
                    isActive
                      ? "border-primary text-primary font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )
                }
              >
                <t.icon className="h-4 w-4" />{t.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
      <div className="max-w-6xl mx-auto p-4 md:p-6">
        <Outlet />
      </div>
    </div>
  );
}
