// Revision delta (B9 logic, preview only): synthetic revision A against the
// preview's current demo state (revision B), via src/lib/preview/revisionDelta.ts.
import { formatINR, formatQuantity } from "@/design/money";
import { revisionDelta } from "@/lib/preview/revisionDelta";
import type { EngineLine } from "@/lib/preview/types";
import { Notice, SurfacePanel } from "./shared";

const signed = (n: number, f: (x: number) => string) => (n > 0 ? `+${f(n)}` : f(n));
const qty = (q: number | null, unit: string) => (q == null ? "Pending" : `${formatQuantity(q)} ${unit}`);

export function RevisionDeltaPanel({ revisionA, current }: { revisionA: EngineLine[]; current: EngineLine[] }) {
  const rows = revisionDelta(revisionA, current);
  const resets = rows.filter((r) => r.resetsVerification).length;
  return (
    <SurfacePanel
      title="Revision delta"
      description="Synthetic revision A compared with the current demo state, sorted by the size of the rupee change. Demo corrections in the verify queue show up here."
    >
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">BOQ line</th>
              <th className="px-4 py-3 font-medium">Revision A</th>
              <th className="px-4 py-3 font-medium">Revision B</th>
              <th className="px-4 py-3 font-medium">Δ quantity</th>
              <th className="px-4 py-3 font-medium">Illustrative Δ₹</th>
              <th className="px-4 py-3 font-medium">Verification</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-4 py-4 font-medium">{r.description}</td>
                <td className="whitespace-nowrap px-4 py-4 tabular-nums">{qty(r.oldQuantity, r.unit)}</td>
                <td className="whitespace-nowrap px-4 py-4 tabular-nums">{qty(r.newQuantity, r.unit)}</td>
                <td className="whitespace-nowrap px-4 py-4 tabular-nums">{r.deltaQuantity == null ? "—" : `${signed(r.deltaQuantity, (x) => formatQuantity(x))} ${r.unit}`}</td>
                <td className="whitespace-nowrap px-4 py-4 font-medium tabular-nums">{r.deltaRs == null ? "Not priced — quantity or rate unknown" : signed(r.deltaRs, formatINR)}</td>
                <td className="px-4 py-4 text-xs">{r.resetsVerification ? "Reset to unverified" : "Unchanged"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Notice>
        {resets} line(s) reset to unverified; only lines whose inputs changed are reset. Figures are illustrative: this surface does not inspect real drawing revisions or calculate a project variance.
      </Notice>
    </SurfacePanel>
  );
}
