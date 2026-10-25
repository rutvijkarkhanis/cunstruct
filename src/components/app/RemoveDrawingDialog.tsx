// Confirming the removal of one drawing from a project. Names the exact file,
// says what happens to the records that cite it, and stays open on failure
// with the reason, so the person can try again; nothing is removed until
// they press Remove.
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { countLinesCitingDocument, type RemoveDocumentResult } from "@/hooks/useDocumentManagement";

export interface DrawingToRemove { id: string; name: string; fileName: string; revisionCount: number }

export default function RemoveDrawingDialog({ drawing, onCancel, onRemove, onRemoved }: {
  drawing: DrawingToRemove | null;
  onCancel: () => void;
  onRemove: (id: string) => Promise<RemoveDocumentResult>;
  onRemoved: (r: Extract<RemoveDocumentResult, { ok: true }>, drawing: DrawingToRemove) => void;
}) {
  const [lines, setLines] = useState<number | null | "error">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setLines(null);
    if (!drawing) return;
    let live = true;
    countLinesCitingDocument(drawing.id).then((n) => { if (live) setLines(n); }, () => { if (live) setLines("error"); });
    return () => { live = false; };
  }, [drawing]);

  const remove = async () => {
    if (!drawing) return;
    setBusy(true);
    setError(null);
    try {
      const r = await onRemove(drawing.id);
      if ("error" in r) setError(r.error);
      else onRemoved(r, drawing);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The drawing was not removed.");
    } finally { setBusy(false); }
  };

  return (
    <AlertDialog open={!!drawing} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this drawing?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-medium text-foreground break-all" data-testid="remove-drawing-file">{drawing?.fileName}</span> will be
                removed from this project{drawing && drawing.revisionCount > 1 ? `, with all ${drawing.revisionCount} of its revisions` : ""}, and its
                stored file deleted. Other drawings are not affected.
              </p>
              <p>
                {lines === null ? "Checking which BOQ lines cite it…"
                  : lines === "error" ? "Could not check which BOQ lines cite it. Any that do will keep their quantities but lose the link to this drawing."
                  : lines > 0 ? `${lines} BOQ line${lines === 1 ? " cites" : "s cite"} it: ${lines === 1 ? "it keeps its" : "they keep their"} quantities, but the link to this drawing is removed.`
                  : "No BOQ line cites it."}
                {" "}Review items taken from it stay in the review history; they cannot be applied to a BOQ once their drawing is removed.
              </p>
              {error && <p role="alert" className="text-destructive">{error} Nothing else was changed; you can try again.</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={() => void remove()} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden="true" />}{busy ? "Removing…" : error ? "Try again" : "Remove"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
