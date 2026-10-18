import { useMemo, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";

type QuantityState = "established" | "confirmed_zero" | "pending";
type ReviewState = "needs_review" | "accepted" | "corrected";
type Surface = "workspace" | "verify" | "coverage" | "signoff" | "revision";

interface PreviewLine {
  id: string;
  description: string;
  unit: string;
  quantity: number;
  quantityState: QuantityState;
  rate: number;
  reviewState: ReviewState;
  region: string;
  note: string;
}

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

const quantityLabel: Record<QuantityState, string> = {
  established: "Quantity established",
  confirmed_zero: "Confirmed zero",
  pending: "Quantity pending",
};

const reviewLabel: Record<ReviewState, string> = {
  needs_review: "Needs review",
  accepted: "Accepted in demo",
  corrected: "Corrected in demo",
};

function statePill(state: QuantityState | ReviewState) {
  const labels: Record<QuantityState | ReviewState, string> = {
    established: "Established",
    confirmed_zero: "Confirmed zero",
    pending: "Quantity pending",
    needs_review: "Needs review",
    accepted: "Accepted · demo",
    corrected: "Corrected · demo",
  };
  const classes: Record<QuantityState | ReviewState, string> = {
    established: "border-sky-200 bg-sky-50 text-sky-800",
    confirmed_zero: "border-violet-200 bg-violet-50 text-violet-800",
    pending: "border-amber-200 bg-amber-50 text-amber-900",
    needs_review: "border-amber-200 bg-amber-50 text-amber-900",
    accepted: "border-emerald-200 bg-emerald-50 text-emerald-800",
    corrected: "border-indigo-200 bg-indigo-50 text-indigo-800",
  };
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${classes[state]}`}>
      {labels[state]}
    </span>
  );
}

function amountFor(line: PreviewLine): number | null {
  if (line.quantityState === "pending") return null;
  return Math.round(line.quantity * line.rate);
}

function SurfacePanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default function EngineeringPreview() {
  const enabled =
    import.meta.env.DEV ||
    import.meta.env.VITE_CUNSTRUCT_ENGINEERING_PREVIEW === "true";
  const [surface, setSurface] = useState<Surface>("workspace");
  const [lines, setLines] = useState<PreviewLine[]>(INITIAL_LINES);
  const [coverageReviewed, setCoverageReviewed] = useState<string[]>([]);

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
  const coverageRows = [
    { id: "legend", title: "Drawing legend items", detail: "One symbol has no linked BOQ line." },
    { id: "regions", title: "Regions without detections", detail: "Two illustrative regions have no linked quantity." },
    { id: "scope", title: "Expected scope", detail: "One expected work item needs a decision or exclusion reason." },
  ];

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
          <SurfacePanel
            title="Verify queue"
            description="Illustrative review ordering. Actions below update only the local preview state and are discarded when the page reloads."
          >
            <div className="overflow-hidden rounded-xl border bg-card">
              {reviewable.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="font-medium">No demo lines awaiting review</div>
                  <p className="mt-1 text-sm text-muted-foreground">Reset by reloading the page.</p>
                </div>
              ) : reviewable.map((line) => (
                <article key={line.id} className="grid gap-3 border-b p-4 last:border-b-0 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">{line.id}</span>
                      {statePill(line.quantityState)}
                    </div>
                    <h3 className="font-semibold">{line.description}</h3>
                    <p className="text-sm text-muted-foreground">{line.note}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span>Quantity: <strong>{line.quantityState === "pending" ? "Pending" : `${formatQuantity(line.quantity)} ${line.unit}`}</strong></span>
                      <span>Illustrative rate: <strong>{formatMoney(line.rate)}</strong></span>
                      <span>Illustrative amount: <strong>{amountFor(line) === null ? "Not priced — pending" : formatMoney(amountFor(line)!)}</strong></span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <button type="button" onClick={() => updateLine(line.id, { reviewState: "accepted" })} className="rounded-md border border-emerald-300 px-3 py-2 text-sm hover:bg-emerald-50">
                      Accept in demo
                    </button>
                    <button
                      type="button"
                      onClick={() => updateLine(line.id, {
                        quantity: line.quantityState === "pending" ? 1 : Math.round((line.quantity + 0.5) * 100) / 100,
                        quantityState: "established",
                        reviewState: "corrected",
                      })}
                      className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                    >
                      Correct in demo
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </SurfacePanel>
        )}

        {surface === "coverage" && (
          <SurfacePanel
            title="Coverage map"
            description="Illustrates how gaps could be surfaced. These rows are seeded examples, not detections from real drawings."
          >
            <div className="grid gap-3 lg:grid-cols-3">
              {coverageRows.map((row) => {
                const reviewed = coverageReviewed.includes(row.id);
                return (
                  <article key={row.id} className="rounded-xl border bg-card p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold">{row.title}</h3>
                      {statePill(reviewed ? "accepted" : "needs_review")}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{row.detail}</p>
                    <button
                      type="button"
                      onClick={() => setCoverageReviewed((old) => reviewed ? old.filter((id) => id !== row.id) : [...old, row.id])}
                      className="mt-5 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                    >
                      {reviewed ? "Undo demo review" : "Mark reviewed in demo"}
                    </button>
                  </article>
                );
              })}
            </div>
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              Demo review state is not a certification, an omission-catch result, or evidence of drawing coverage.
            </p>
          </SurfacePanel>
        )}

        {surface === "signoff" && (
          <SurfacePanel
            title="Sign-off sheet"
            description="Shows the intended summary structure without creating a certificate or calculating a research metric."
          >
            <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
              <div className="overflow-hidden rounded-xl border bg-card">
                <div className="border-b p-4">
                  <h3 className="font-semibold">Pre-certification checklist</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Illustrative checklist state only.</p>
                </div>
                {[
                  ["Key lines", "Review is incomplete"],
                  ["Coverage gaps", `${coverageReviewed.length} of ${coverageRows.length} demo rows marked reviewed`],
                  ["Pending quantities", `${totals.pending} line(s) remain pending`],
                  ["Reference comparison", "No independent reference set loaded"],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-wrap items-center justify-between gap-2 border-b p-4 last:border-b-0">
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-sm text-muted-foreground">{value}</span>
                  </div>
                ))}
              </div>
              <aside className="space-y-3 rounded-xl border bg-card p-5">
                <div className="text-sm font-semibold">Certification status</div>
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">
                  Not certified
                </div>
                <p className="text-sm text-muted-foreground">
                  Residual ₹ error, omission catch rate and high-value catch rate are not calculated. No benchmark reference or frozen study pack exists in this preview.
                </p>
                <button type="button" disabled className="w-full cursor-not-allowed rounded-md border px-3 py-2 text-sm text-muted-foreground opacity-70">
                  Certification unavailable
                </button>
              </aside>
            </div>
          </SurfacePanel>
        )}

        {surface === "revision" && (
          <SurfacePanel
            title="Revision delta"
            description="Illustrative revision comparison. The displayed differences are pre-seeded examples, not calculated from drawing revisions."
          >
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">BOQ line</th>
                    <th className="px-4 py-3 font-medium">Revision A</th>
                    <th className="px-4 py-3 font-medium">Revision B</th>
                    <th className="px-4 py-3 font-medium">Δ quantity</th>
                    <th className="px-4 py-3 font-medium">Illustrative Δ₹</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "Excavation in foundation trenches", a: "21.0 m³", b: "24.0 m³", delta: "+3.0 m³", money: "+₹1,260" },
                    { name: "PCC below footings", a: "6.5 m³", b: "6.5 m³", delta: "0.0 m³", money: "₹0" },
                    { name: "Brickwork above plinth", a: "16.8 m³", b: "18.2 m³", delta: "+1.4 m³", money: "+₹10,360" },
                  ].map((row) => (
                    <tr key={row.name} className="border-t">
                      <td className="px-4 py-4 font-medium">{row.name}</td>
                      <td className="whitespace-nowrap px-4 py-4 tabular-nums">{row.a}</td>
                      <td className="whitespace-nowrap px-4 py-4 tabular-nums">{row.b}</td>
                      <td className="whitespace-nowrap px-4 py-4 tabular-nums">{row.delta}</td>
                      <td className="whitespace-nowrap px-4 py-4 font-medium tabular-nums">{row.money}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              Delta figures are illustrative placeholders. This surface does not inspect actual revisions or calculate a project variance.
            </p>
          </SurfacePanel>
        )}
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
