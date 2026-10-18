// Coverage map (B6 logic, preview only): gaps from src/lib/preview/coverage.ts
// over synthetic drawing items. Each gap must be resolved or excluded with a
// reason; the demo keeps that state locally.
import { useState } from "react";
import { coverageStatus, type CoverageGap, type GapResolution } from "@/lib/preview/coverage";
import { Notice, SurfacePanel } from "./shared";

const KIND_TITLE: Record<CoverageGap["kind"], string> = {
  legend: "Legend items with no BOQ line",
  region: "Regions with no detection and no line",
  scope: "Expected scope with no line",
};

export function CoveragePanel({ gaps, reviewer, onResolve, onReopen }: {
  gaps: CoverageGap[];
  reviewer: string;
  onResolve: (gapId: string, resolution: GapResolution) => void;
  onReopen: (gapId: string) => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const status = coverageStatus(gaps);
  const at = () => new Date().toISOString();
  return (
    <SurfacePanel
      title="Coverage map"
      description="What the BOQ may have missed. Seeded synthetic drawing items, not detections from real drawings."
    >
      <p className="text-sm text-muted-foreground">
        {status.open} open · {status.resolved} resolved · {status.excluded} excluded with a reason —{" "}
        {status.cleared ? "every gap is resolved or excluded" : "certification needs every gap resolved or excluded with a reason"}.
      </p>
      <div className="grid gap-3 lg:grid-cols-3">
        {(Object.keys(KIND_TITLE) as CoverageGap["kind"][]).map((kind) => (
          <article key={kind} className="space-y-3 rounded-xl border bg-card p-5">
            <h3 className="font-semibold">{KIND_TITLE[kind]}</h3>
            {gaps.filter((g) => g.kind === kind).length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
            {gaps.filter((g) => g.kind === kind).map((g) => (
              <div key={g.id} className="space-y-2 rounded-md border p-3">
                <div className="text-sm font-medium">{g.label}</div>
                {g.resolution ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {g.resolution.type === "resolved" ? "Resolved" : "Excluded"} · {g.resolution.reason} · {g.resolution.by} (demo)
                    </p>
                    <button type="button" onClick={() => onReopen(g.id)} className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted">
                      Reopen in demo
                    </button>
                  </>
                ) : (
                  <>
                    <label className="block text-xs text-muted-foreground" htmlFor={`reason-${g.id}`}>Reason, or the line that now covers it</label>
                    <input
                      id={`reason-${g.id}`}
                      value={reasons[g.id] ?? ""}
                      onChange={(e) => setReasons((r) => ({ ...r, [g.id]: e.target.value }))}
                      className="w-full rounded-md border px-2 py-1.5 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={!(reasons[g.id] ?? "").trim()} onClick={() => onResolve(g.id, { type: "resolved", reason: reasons[g.id], by: reviewer, at: at() })} className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
                        Resolve in demo
                      </button>
                      <button type="button" disabled={!(reasons[g.id] ?? "").trim()} onClick={() => onResolve(g.id, { type: "excluded", reason: reasons[g.id], by: reviewer, at: at() })} className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
                        Exclude with reason
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </article>
        ))}
      </div>
      <Notice>Demo review state is not a certification, an omission-catch result, or evidence of drawing coverage.</Notice>
    </SurfacePanel>
  );
}
