import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { coverageGaps, reopenGap, resolveGap, type CoverageGap, type GapResolution } from "@/lib/preview/coverage";
import { CoveragePanel } from "@/preview/CoveragePanel";
import {
  DEMO_COVERAGE, DEMO_DRAWING_REVISION, DEMO_MATERIALITY, DEMO_REVIEWER, DEMO_REVISION_A, DEMO_SEED, DEMO_TOLERABLE_ERROR,
} from "@/preview/fixtures";
import { RevisionDeltaPanel } from "@/preview/RevisionDeltaPanel";
import { SurfacePanel, type PreviewLine } from "@/preview/shared";
import { statePill } from "@/preview/statePill";
import { SignOffPanel } from "@/preview/SignOffPanel";
import { VerifyQueuePanel } from "@/preview/VerifyQueuePanel";

type Surface = "workspace" | "verify" | "coverage" | "signoff" | "revision";

const INITIAL_LINES: PreviewLine[] = [
  {
    id: "L-01",
    description: "Excavation in foundation trenches",
    unit: "m³",
    quantity: 24,
    quantityState: "established",
    rate: 420,
    reviewState: "needs_review",
    region: "A-102 · Grid B3–D5",
    note: "Quantity and drawing region need reviewer confirmation.",
  },
  {
    id: "L-02",
    description: "PCC below footings",
    unit: "m³",
    quantity: 6.5,
    quantityState: "established",
    rate: 6200,
    reviewState: "accepted",
    region: "S-201 · Footing detail",
    note: "Illustrative reviewed line.",
  },
  {
    id: "L-03",
    description: "Reinforcement steel",
    unit: "kg",
    quantity: 0,
    quantityState: "pending",
    rate: 68,
    reviewState: "needs_review",
    region: "S-203 · Bar schedule",
    note: "No established quantity. A monetary amount must not be shown.",
  },
  {
    id: "L-04",
    description: "Additional formwork quantity",
    unit: "m²",
    quantity: 0,
    quantityState: "confirmed_zero",
    rate: 720,
    reviewState: "accepted",
    region: "S-201 · Footing detail",
    note: "A confirmed zero is distinct from a pending quantity.",
  },
  {
    id: "L-05",
    description: "Brickwork above plinth",
    unit: "m³",
    quantity: 18.2,
    quantityState: "established",
    rate: 7400,
    reviewState: "needs_review",
    region: "A-103 · Wall layout",
    note: "Illustrative quantity and rate; not a measured project result.",
  },
];

const INITIAL_GAPS = coverageGaps({ ...DEMO_COVERAGE, lines: DEMO_COVERAGE.lineLinks });

const QUEUE_IDS = new Set(INITIAL_LINES.filter((line) => line.reviewState === "needs_review").map((line) => line.id));

const SURFACES: { id: Surface; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "verify", label: "Verify queue" },
  { id: "coverage", label: "Coverage map" },
  { id: "signoff", label: "Sign-off sheet" },
  { id: "revision", label: "Revision delta" },
];

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const formatQuantity = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);


function amountFor(line: PreviewLine): number | null {
  if (line.quantityState === "pending") return null;
  return Math.round(line.quantity * line.rate);
}


export default function EngineeringPreview() {
  const enabled =
    import.meta.env.DEV ||
    import.meta.env.VITE_CUNSTRUCT_ENGINEERING_PREVIEW === "true";
  const [surface, setSurface] = useState<Surface>("workspace");
  const [lines, setLines] = useState<PreviewLine[]>(INITIAL_LINES);
  const [gaps, setGaps] = useState<CoverageGap[]>(INITIAL_GAPS);

  // This surface is disabled in production unless explicitly feature-enabled.
  // All records are local constants/state: no Supabase client, query, or write.
  const totals = useMemo(() => {
    const priced = lines.reduce((sum, line) => sum + (amountFor(line) ?? 0), 0);
    const pending = lines.filter((line) => line.quantityState === "pending").length;
    return { priced, pending };
  }, [lines]);

  if (!enabled) return <Navigate to="/ops" replace />;

  const updateLine = (id: string, update: Partial<PreviewLine>) => {
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...update } : line)),
    );
  };

  const reviewable = lines.filter((line) => line.reviewState === "needs_review");
  // The queue keeps every line that started out needing review, so a demo
  // accept or correction stays visible with its outcome instead of vanishing.
  const queue = lines.filter((line) => QUEUE_IDS.has(line.id));

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        <header className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Cunstruct · Engineering preview
              </div>
              <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
                Workspace concept
              </h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Mock-only interaction prototype. Nothing here is saved to a project or database.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Internal only · not a certified BOQ
            </span>
          </div>

          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <strong>Illustrative data only.</strong> Quantities, rates, drawing references and revision values below are synthetic. This preview does not measure drawings, verify DSR compliance, calculate defensible residual error, or certify a BOQ.
          </div>

          <div className="flex flex-wrap gap-2 border-b pb-3" role="tablist" aria-label="Engineering preview surfaces">
            {SURFACES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={surface === item.id}
                onClick={() => setSurface(item.id)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  surface === item.id
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-foreground hover:bg-muted"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Illustrative BOQ lines" value={String(lines.length)} detail="Mock records" />
          <Metric label="Awaiting review" value={String(reviewable.length)} detail="Local demo state" />
          <Metric label="Quantity pending" value={String(totals.pending)} detail="Excluded from money totals" />
          <Metric label="Illustrative priced subtotal" value={formatMoney(totals.priced)} detail="Not a project estimate" />
        </div>

        {surface === "workspace" && (
          <SurfacePanel
            title="Workspace"
            description="Drawing context and BOQ grid in one view. The drawing pane is a schematic placeholder, not an uploaded drawing."
          >
            <div className="grid min-w-0 gap-4 xl:grid-cols-[1.05fr_1.4fr]">
              <div className="rounded-xl border bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Drawing canvas</div>
                    <div className="text-xs text-muted-foreground">Fixture: DRAWING-DEMO-01 · no source file loaded</div>
                  </div>
                  <span className="rounded border px-2 py-1 text-xs text-muted-foreground">Scale unconfirmed</span>
                </div>
                <div className="relative flex min-h-80 items-center justify-center overflow-hidden rounded-md border bg-white p-4">
                  <div className="absolute inset-6 border border-slate-300" />
                  <div className="absolute inset-x-14 top-12 bottom-16 border-2 border-slate-500" />
                  <div className="absolute left-1/2 top-12 bottom-16 border-l border-dashed border-slate-400" />
                  <div className="absolute left-14 right-14 top-1/2 border-t border-dashed border-slate-400" />
                  <div className="absolute left-[25%] top-[30%] h-10 w-16 border-2 border-sky-500 bg-sky-100/60" />
                  <div className="absolute right-[25%] bottom-[28%] h-12 w-20 border-2 border-amber-500 bg-amber-100/60" />
                  <div className="relative z-10 rounded bg-white/90 px-3 py-2 text-center text-xs text-slate-700 shadow-sm">
                    Schematic only
                    <br />
                    Not a real drawing
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  No measurement is inferred from this schematic. A line without verified drawing evidence remains unverified.
                </p>
              </div>

              <div className="min-w-0 rounded-xl border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                  <div>
                    <div className="font-semibold">BOQ grid</div>
                    <div className="text-xs text-muted-foreground">Demo schedule · values are illustrative</div>
                  </div>
                  <button type="button" onClick={() => setSurface("verify")} className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
                    Open verify queue
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[650px] text-left text-sm">
                    <thead className="bg-muted/60 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-3 font-medium">Item</th>
                        <th className="px-3 py-3 font-medium">Qty</th>
                        <th className="px-3 py-3 font-medium">Rate</th>
                        <th className="px-3 py-3 font-medium">Amount</th>
                        <th className="px-3 py-3 font-medium">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => (
                        <tr key={line.id} className="border-t align-top">
                          <td className="max-w-64 px-3 py-3">
                            <div className="font-medium">{line.description}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{line.id} · {line.region}</div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                            {line.quantityState === "pending" ? "—" : `${formatQuantity(line.quantity)} ${line.unit}`}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatMoney(line.rate)}</td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums font-medium">
                            {amountFor(line) === null ? "—" : formatMoney(amountFor(line)!)}
                          </td>
                          <td className="px-3 py-3">{statePill(line.quantityState)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </SurfacePanel>
        )}

        {surface === "verify" && (
          <VerifyQueuePanel queue={queue} materiality={DEMO_MATERIALITY} onUpdate={updateLine} />
        )}

        {surface === "coverage" && (
          <CoveragePanel
            gaps={gaps}
            reviewer={DEMO_REVIEWER}
            onResolve={(id: string, r: GapResolution) => setGaps((g) => resolveGap(g, id, r))}
            onReopen={(id: string) => setGaps((g) => reopenGap(g, id))}
          />
        )}

        {surface === "signoff" && (
          <SignOffPanel
            lines={lines}
            gaps={gaps}
            noDetectionRegionIds={DEMO_COVERAGE.regions.filter((r) => r.detections === 0).map((r) => r.id)}
            materiality={DEMO_MATERIALITY}
            tolerableError={DEMO_TOLERABLE_ERROR}
            seed={DEMO_SEED}
            reviewer={DEMO_REVIEWER}
            drawingRevision={DEMO_DRAWING_REVISION}
          />
        )}

        {surface === "revision" && <RevisionDeltaPanel revisionA={DEMO_REVISION_A} current={lines} />}
        <footer className="border-t pt-4 text-xs text-muted-foreground">
          Owner-only engineering preview · deterministic fixture data · no persistence · not a benchmark · not a commercial release
        </footer>
      </div>
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
