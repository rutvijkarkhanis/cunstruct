import { NavLink, Outlet, useParams, Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { ArrowLeft, LayoutDashboard, FileText, Calculator, PackageSearch, Activity } from "lucide-react";

// The project sub-workspace shell: a header + tab nav with an <Outlet/> for the
// active section. The project — not a BOQ or a PDF — is the parent workspace.
//
// Tabs are grouped, not just listed: PRIMARY_TABS are the drawing → AI →
// review → BOQ pipeline this product is actually about, and get the bold,
// larger treatment. SECONDARY_TABS (Procurement, Activity) still route
// exactly as before — nothing here changes what's reachable, only how loud
// each destination is.
const PRIMARY_TABS = [
  { to: "", end: true, label: "Overview", icon: LayoutDashboard },
  { to: "documents", label: "Documents", icon: FileText },
  { to: "boqs", label: "BOQs", icon: Calculator },
];
const SECONDARY_TABS = [
  { to: "procurement", label: "Procurement", icon: PackageSearch },
  { to: "activity", label: "Activity", icon: Activity },
];

// Review is a focused drawing-inspection mode, not another project tab: the
// breadcrumb/title/tab chrome below would only compete with the canvas for
// space and attention, and BoqReviewWorkstation already renders its own
// compact back+position bar — so quieting this here never leaves the user
// without a way out, just stops duplicating chrome above it. Detected by
// the URL shape only; routing itself, and every other project page, are
// untouched.
const REVIEW_MODE_RE = /\/boqs\/[^/]+\/review\/?$/;

// Phase 11 Stage B: the unified workspace is the same kind of full-bleed,
// canvas-first surface Review already is — it supplies its own compact
// header (ProjectWorkspace's own) and, in mode=review, embeds the exact
// same BoqReviewWorkstation this chrome already steps aside for. Same
// reasoning, same scope: URL-shape detection only, every other route and
// this component's own tab chrome stay exactly as they are.
const WORKSPACE_MODE_RE = /\/workspace\/?$/;

export default function ProjectLayout() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const isReviewMode = REVIEW_MODE_RE.test(location.pathname) || WORKSPACE_MODE_RE.test(location.pathname);
  const { data: project } = useQuery({
    queryKey: ["project-header", id],
    enabled: !!id && !isReviewMode,
    queryFn: async () => {
      const { data } = await supabase.from("projects")
        .select("id, name, client_name, location, project_type, status").eq("id", id!).single();
      return data as { id: string; name: string; client_name: string | null; location: string | null; project_type: string | null; status: string } | null;
    },
  });

  if (isReviewMode) {
    // No max-w-6xl/padding cap either — the drawing canvas should use the
    // full remaining viewport, not the same centered reading-width column
    // Overview/Documents/BOQs use. BoqReviewWorkstation supplies its own
    // padding.
    return (
      <div className="min-w-0">
        <Outlet />
      </div>
    );
  }

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
          <nav className="mt-3 flex items-baseline gap-1 overflow-x-auto">
            {PRIMARY_TABS.map((t) => (
              <NavLink
                key={t.to || "overview"}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold rounded-t-md border-b-2 -mb-px whitespace-nowrap transition-colors",
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )
                }
              >
                <t.icon className="h-4 w-4" />{t.label}
              </NavLink>
            ))}
            {/* Visual separator, not a route boundary — everything to its right
                still works exactly as it did, just presented as secondary. */}
            <span className="h-4 w-px bg-border mx-1.5 self-center" aria-hidden="true" />
            {SECONDARY_TABS.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-2 text-xs rounded-t-md border-b-2 -mb-px whitespace-nowrap transition-colors",
                    isActive
                      ? "border-primary/60 text-foreground"
                      : "border-transparent text-muted-foreground/70 hover:text-muted-foreground",
                  )
                }
              >
                <t.icon className="h-3.5 w-3.5" />{t.label}
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
