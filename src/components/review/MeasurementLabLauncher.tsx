// Admin-only entry point to the Measurement Lab from the BOQ Review Workstation. The lab (and with it
// both measurement engines) is lazy-loaded only when an admin opens it, so the engines never load for
// anyone else and are not part of the workstation's own bundle. Renders nothing for non-admins.
import { lazy, Suspense, useState } from "react";
import { FlaskConical } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const MeasurementLabPanel = lazy(() => import("./MeasurementLabPanel"));

export default function MeasurementLabLauncher({ floating = false }: { floating?: boolean }) {
  const { roles } = useAuth();
  const [open, setOpen] = useState(false);
  if (!roles.includes("admin")) return null;
  return (
    <>
      <Button variant={floating ? "outline" : "ghost"} size="sm" className={floating ? "fixed bottom-4 right-4 z-40 shadow" : "h-8 text-xs"} onClick={() => setOpen(true)}>
        <FlaskConical className="w-4 h-4 mr-1" />Measurement Lab
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogTitle>Measurement Lab</DialogTitle>
          <DialogDescription>Evaluate the measurement engines on a drawing. Experimental; admin only; never changes the BOQ.</DialogDescription>
          {open && <Suspense fallback={<p className="text-sm text-muted-foreground">Loading the lab…</p>}><MeasurementLabPanel /></Suspense>}
        </DialogContent>
      </Dialog>
    </>
  );
}
