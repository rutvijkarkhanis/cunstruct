// PROJECT JOURNEY — the staff application shell for the step-by-step project
// flow (Projects → Overview → Drawings → BOQ → Export & History). It composes
// existing data and components; the Ops console and its routes are untouched
// and stay one click away.
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2, LogOut } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn("px-2.5 py-1.5 rounded-md text-sm whitespace-nowrap",
    isActive ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:text-foreground");

export default function AppLayout() {
  const { user, loading, rolesReady, isStaff, signOut } = useAuth();
  const location = useLocation();

  // Role-based routing waits for roles: before they load, isStaff is
  // unknown, and redirecting then would send staff to the contractor home.
  if (loading || (user && !rolesReady)) {
    return (
      <div role="status" className="min-h-screen bg-background flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (!user) return <Navigate to={`/auth?returnUrl=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!isStaff) return <Navigate to="/my-projects" replace />;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <a href="#app-main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 h-12 flex items-center gap-3">
          <Link to="/app/projects" className="font-bold shrink-0">Cunstruct</Link>
          <nav aria-label="Main" className="flex items-center gap-1 min-w-0 overflow-x-auto">
            <NavLink to="/app/projects" className={navClass}>Projects</NavLink>
            <NavLink to="/ops" end className={navClass}>Ops console</NavLink>
          </nav>
          <Button variant="ghost" size="sm" className="ml-auto gap-1.5 shrink-0" onClick={signOut}>
            <LogOut className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Sign out</span>
            <span className="sr-only sm:hidden">Sign out</span>
          </Button>
        </div>
      </header>
      <main id="app-main" tabIndex={-1} className="flex-1 min-w-0 focus:outline-none">
        <Outlet />
      </main>
    </div>
  );
}
