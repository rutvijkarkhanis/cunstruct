import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard,
  Building2,
  Layers,
  Link2,
  Sparkles,
  AlertTriangle,
  MessageSquare,
  TrendingUp,
  PackagePlus,
  ClipboardList,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/ops", end: true, label: "Overview", icon: LayoutDashboard },
  { to: "/ops/projects", label: "Projects", icon: Building2 },
  { to: "/ops/stages", label: "Stage Master", icon: Layers },
  { to: "/ops/mappings", label: "Stage Mappings", icon: Link2 },
  { to: "/ops/boq-templates", label: "BOQ Templates", icon: ClipboardList },
  { to: "/ops/forecasts", label: "Forecasts", icon: Sparkles },
  { to: "/ops/projections", label: "Business Forecast", icon: TrendingUp },
  { to: "/ops/onboarding", label: "Onboarding Queue", icon: PackagePlus },
  { to: "/ops/anomalies", label: "Anomalies", icon: AlertTriangle },
  { to: "/ops/briefings", label: "WhatsApp Briefings", icon: MessageSquare },
];

export default function OpsLayout() {
  const { user, loading, isStaff, signOut } = useAuth();
  const navigate = useNavigate();

  const { data: pendingCount } = useQuery({
    queryKey: ["pending-review-count"],
    enabled: !!user && isStaff,
    refetchInterval: 30000,
    queryFn: async () => {
      const { count } = await supabase
        .from("projects").select("id", { count: "exact", head: true })
        .eq("status", "pending_review");
      return count ?? 0;
    },
  });

  useEffect(() => {
    if (!loading && !user) navigate("/auth");
  }, [user, loading, navigate]);

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!user) return null;

  if (!isStaff) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">Operations access required</h1>
          <p className="text-sm text-muted-foreground">
            Your account does not have ops or admin role. Ask an admin to grant you access.
          </p>
          <Button variant="outline" onClick={signOut}>Sign out</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <div className="font-bold text-lg">Cunstruct</div>
          <div className="text-xs text-muted-foreground">Operations Console</div>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={(e) => item.disabled && e.preventDefault()}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive && !item.disabled
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent text-foreground",
                  item.disabled && "opacity-40 cursor-not-allowed",
                )
              }
            >
              <item.icon className="w-4 h-4" />
              <span>{item.label}</span>
              {item.to === "/ops/projects" && pendingCount ? (
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-white">
                  {pendingCount}
                </span>
              ) : null}
              {item.disabled && (
                <span className="ml-auto text-[10px] uppercase tracking-wide">soon</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t space-y-2">
          <div className="text-xs text-muted-foreground truncate">{user.email}</div>
          <Button variant="outline" size="sm" className="w-full" onClick={signOut}>
            <LogOut className="w-3 h-3 mr-1" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}