// WORKBENCH PREVIEW — the Review section: the existing review screen
// (BoqReviewWorkstation, unchanged review engine, decisions and Apply) for the
// workbench's selected BOQ, embedded the same way the Ops workspace embeds it
// (injected boqId). Back and "View updated BOQ" lead to the workbench's BOQ
// section (injected returnTo), so review never leaves for /ops. Who can see
// it is unchanged: AppLayout and OpsLayout both admit staff only (isStaff),
// and the workstation's own admin-only checks run as they do in /ops.
// Mounted only when WORKBENCH_PREVIEW_ENABLED (App.tsx).
import { lazy, Suspense, useLayoutEffect, useState, type CSSProperties } from "react";
import { Link, useLocation } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectShell } from "./projectShellContext";
import { useSelectedBoq } from "./useSelectedBoq";
import BoqPicker from "./BoqPicker";
import { journeyPath, manageBoqsPath, inWorkbench } from "@/lib/app/journey";

const BoqReviewWorkstation = lazy(() => import("@/pages/ops/BoqReviewWorkstation"));

/** What the page lays out below `el`: each ancestor's later siblings and its
 *  bottom padding and border, up to <body>. Independent of `el`'s own height,
 *  so measuring never feeds back into itself. */
function spaceBelow(el: HTMLElement): number {
  let total = 0;
  for (let node: HTMLElement = el; node.parentElement && node !== document.body; node = node.parentElement) {
    const last = node.parentElement.lastElementChild as HTMLElement | null;
    if (last && last !== node) total += Math.max(0, last.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom);
    const cs = getComputedStyle(node.parentElement);
    total += parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth);
  }
  return total;
}

/** The review panes' height that fills the viewport below everything above
 *  them (app, project and workbench headers, the review screen's own top
 *  bar), in document coordinates — so at the top of the page the panes end
 *  at the bottom of the window and the page itself does not scroll. Read by
 *  the workstation as --rw-pane-h (its min-height still applies). */
function usePaneHeight(el: HTMLDivElement | null) {
  const [h, setH] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const panes = el.querySelector<HTMLElement>("[data-rw-panes]");
      if (!panes) return;
      const top = panes.getBoundingClientRect().top + window.scrollY;
      setH(Math.max(0, Math.floor(window.innerHeight - top - spaceBelow(panes))));
    };
    measure();
    const mo = new MutationObserver(measure); // the panes appear once the review data has loaded
    mo.observe(el, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    return () => { mo.disconnect(); window.removeEventListener("resize", measure); };
  }, [el]);
  return h;
}

export default function WorkbenchReview() {
  const { projectId } = useProjectShell();
  const { pathname, search } = useLocation();
  const sel = useSelectedBoq(projectId);
  // A callback ref: the box mounts only once the BOQs have loaded.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const paneH = usePaneHeight(box);

  if (sel.loading) return <div role="status" aria-label="Loading review"><Skeleton className="h-40 w-full" /></div>;
  if (sel.error) return <div role="alert" className="rounded-md border p-4 text-sm">Could not load this project's BOQs.</div>;
  if (!sel.selected) {
    return (
      <div className="rounded-md border p-8 text-center space-y-2">
        <h2 className="font-semibold">No BOQ to review into yet</h2>
        <p className="text-sm text-muted-foreground">
          Reviewed quantities are applied to a BOQ. <Link to={manageBoqsPath(projectId, `${pathname}${search}`)} className="underline">Create a BOQ</Link> for this project first.
        </p>
      </div>
    );
  }
  const boqId = sel.selected.id;
  return (
    <div className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold mr-auto">Review quantities</h2>
        <BoqPicker boqs={sel.boqs} value={boqId} onChange={sel.select} />
      </div>
      {sel.requestedMissing && (
        <p role="note" className="text-sm text-muted-foreground">The BOQ in this link is not part of this project; showing “{sel.selected.name}”.</p>
      )}
      <div ref={setBox} style={paneH != null ? ({ "--rw-pane-h": `${paneH}px` } as CSSProperties) : undefined}>
      <Suspense fallback={<div role="status" aria-label="Loading review screen"><Skeleton className="h-64 w-full" /></div>}>
        {/* Keyed by BOQ: switching BOQs starts the review screen afresh, never mixing items. */}
        <BoqReviewWorkstation key={boqId} boqId={boqId} returnTo={inWorkbench(journeyPath(projectId, "boq", boqId))} />
      </Suspense>
      </div>
    </div>
  );
}
