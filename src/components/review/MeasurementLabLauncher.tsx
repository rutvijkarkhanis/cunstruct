// Admin-only entry point to the Measurement Lab from the BOQ Review Workstation. The lab (and with it
// both measurement engines) is lazy-loaded only when an admin opens it, so the engines never load for
// anyone else and are not part of the workstation's own bundle. Renders nothing for non-admins.
import { lazy, Suspense, useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const MeasurementLabPanel = lazy(() => import("./MeasurementLabPanel"));

/** While the lab is open, no key press may reach the workstation behind it: the workstation listens on
 *  `window` for its own shortcuts (verify, edit, flag, pending, next/previous), which act on the
 *  production review. Stopping keydown at `document` (bubble phase) leaves every handler inside the lab
 *  — including portaled menus and the dialog's own Escape handling — working as before. */
function useContainKeys(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    document.addEventListener("keydown", stop);
    return () => document.removeEventListener("keydown", stop);
  }, [active]);
}
const typing = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)); };

export default function MeasurementLabLauncher({ floating = false }: { floating?: boolean }) {
  const { roles } = useAuth();
  const [open, setOpen] = useState(false);
  const isAdmin = roles.includes("admin");
  useContainKeys(open && isAdmin);
  if (!isAdmin) return null;
  return (
    <>
      <Button variant={floating ? "outline" : "ghost"} size="sm" className={floating ? "fixed bottom-4 right-4 z-40 shadow" : "h-8 text-xs"} onClick={() => setOpen(true)}>
        <FlaskConical className="w-4 h-4 mr-1" />Measurement Lab
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-7xl max-h-[94vh] overflow-y-auto"
          // Esc clears the lab's measurement selection first (the review workspace handles it); with nothing selected it closes the lab as before
          onEscapeKeyDown={(e) => { if (!typing(e.target) && (e.target as Element | null)?.closest?.('[data-lab-esc="clear"]')) e.preventDefault(); }}>
          <DialogTitle>Measurement Lab</DialogTitle>
          <DialogDescription>Evaluate the measurement engines on a drawing. Experimental; admin only; never changes the BOQ.</DialogDescription>
          {open && <Suspense fallback={<p className="text-sm text-muted-foreground">Loading the lab…</p>}><MeasurementLabPanel /></Suspense>}
        </DialogContent>
      </Dialog>
    </>
  );
}
