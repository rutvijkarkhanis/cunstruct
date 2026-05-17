import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Building2,
  Layers,
  Link2,
  Sparkles,
  AlertTriangle,
  MessageSquare,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/ops", end: true, label: "Overview", icon: LayoutDashboard },
  { to: "/ops/projects", label: "Projects", icon: Building2 },
  { to: "/ops/stages", label: "Stage Master", icon: Layers },
  { to: "/ops/mappings", label: "Stage Mappings", icon: Link2 },
  { to: "/ops/forecasts", label: "Forecasts", icon: Sparkles, disabled: true },
  { to: "/ops/anomalies", label: "Anomalies", icon: AlertTriangle, disabled: true },
  { to: "/ops/briefings", label: "WhatsApp Briefings", icon: MessageSquare, disabled: true },
];

export default function OpsLayout() {
  const { user, loading, isStaff, signOut } = useAuth();
  const navigate = useNavigate();

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