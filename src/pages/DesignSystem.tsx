/**
 * Design-system reference page (plan item D1 evidence).
 *
 * Route: /design-system. Not linked from any navigation. Renders in local
 * development for anyone; in a production build only for signed-in staff
 * (ops/admin via useAuth().isStaff). Everyone else gets the ordinary 404,
 * so the route's existence is not advertised. Marked noindex.
 */
import { useState, type ReactNode } from "react";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@/context/AuthContext";
import NotFound from "@/pages/NotFound";
import { StatusBadge } from "@/design/StatusBadge";
import { MoneyCell } from "@/design/MoneyCell";
import { QuantityCell } from "@/design/QuantityCell";
import { NumericNudge, ReorderButtons } from "@/design/DragAlternative";
import { formatINR, formatINRCompact, formatQuantity } from "@/design/money";
import { contrastPairs, contrastRatio, REQUIRED } from "@/design/contrast";
import {
  MIN_TARGET_PX,
  RADII,
  SPACING,
  STATES,
  STATE_META,
  THEMES,
  TYPE_SCALE,
  baseVar,
  stateVar,
  type SemanticState,
  type Theme,
} from "@/design/tokens";
import "@/design/tokens.css";

const MONEY_SAMPLES: (number | null)[] = [48200000, 3860000, 1234567, 99960, 1500, 0, -1234567, null];

const GRID_ROWS: { item: string; qty: number | null; unit: string; rate: number | null; state: SemanticState }[] = [
  { item: "PCC 1:4:8 below footings", qty: 42.75, unit: "m³", rate: 6845, state: "VERIFIED_HUMAN" },
  { item: "RCC M25 columns", qty: 18.2, unit: "m³", rate: 9120, state: "MACHINE_UNVERIFIED" },
  { item: "Brickwork 230 mm", qty: 312.4, unit: "m³", rate: 7480, state: "NEEDS_REVIEW" },
  { item: "Reinforcement Fe500", qty: 14250, unit: "kg", rate: 86, state: "BLOCKING" },
  { item: "Plaster 12 mm internal", qty: null, unit: "m²", rate: 312, state: "PENDING_QTY" },
  { item: "Waterproofing terrace", qty: null, unit: "m²", rate: null, state: "UNAVAILABLE" },
  { item: "False ceiling (by client)", qty: 120, unit: "m²", rate: 1150, state: "EXCLUDED" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ name, cssVar, value }: { name: string; cssVar: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className="inline-block h-6 w-6 shrink-0 rounded border ds-divider"
        style={{ background: `hsl(var(${cssVar}))` }}
        aria-hidden="true"
      />
      <span>
        <code>{cssVar}</code> <span className="ds-muted">({name}: {value})</span>
      </span>
    </div>
  );
}

/** One full theme: base palette, states, a sample grid and a drawing. */
function ThemePanel({ theme }: { theme: Theme }) {
  const t = THEMES[theme];
  const rows = GRID_ROWS.filter((r) => r.state !== "EXCLUDED");
  const total = rows.reduce((s, r) => (r.qty != null && r.rate != null ? s + r.qty * r.rate : s), 0);
  return (
    <div data-ds-theme={theme} className="ds-page rounded-lg border ds-divider p-4 space-y-6 min-w-0">
      <h2 className="text-xl font-semibold capitalize">{theme} theme</h2>

      <Section title="Base palette">
        <div className="grid gap-1 sm:grid-cols-2">
          {(Object.keys(t.base) as (keyof typeof t.base)[]).map((k) => (
            <Swatch key={k} name={k} cssVar={baseVar(k)} value={t.base[k]} />
          ))}
        </div>
      </Section>

      <Section title="Semantic states (colour + icon + text)">
        <ul className="space-y-2">
          {STATES.map((s) => (
            <li key={s} className="flex flex-wrap items-center gap-3">
              <span className="w-40 shrink-0">
                <StatusBadge state={s} />
              </span>
              <span className="text-sm ds-muted min-w-0 flex-1">
                <code>{s}</code> — {STATE_META[s].meaning}
              </span>
              <span className="text-xs ds-muted">
                label {contrastRatio(t.states[s].fg, t.states[s].bg).toFixed(1)}:1 · border{" "}
                {contrastRatio(t.states[s].border, t.base.surface).toFixed(1)}:1
              </span>
            </li>
          ))}
        </ul>
        <details className="text-xs">
          <summary className="cursor-pointer ds-focus">State CSS variables</summary>
          <div className="mt-2 grid gap-1">
            {STATES.flatMap((s) =>
              (["fg", "bg", "border", "text"] as const).map((p) => (
                <Swatch key={s + p} name={p} cssVar={stateVar(s, p)} value={t.states[s][p]} />
              )),
            )}
          </div>
        </details>
      </Section>

      <Section title="BOQ grid sample">
        <div className="overflow-x-auto">
          <table className="ds-surface w-full text-sm border-collapse">
            <thead>
              <tr className="border-b ds-divider text-left">
                <th className="p-2 font-medium">Item</th>
                <th className="p-2 font-medium">Status</th>
                <th className="p-2 font-medium text-right">Qty</th>
                <th className="p-2 font-medium text-right">Rate</th>
                <th className="p-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {GRID_ROWS.map((r) => {
                const amount = r.qty != null && r.rate != null ? r.qty * r.rate : null;
                return (
                  <tr key={r.item} className="border-b ds-divider">
                    <td className="p-2">{r.item}</td>
                    <td className="p-2">
                      <StatusBadge state={r.state} />
                    </td>
                    <td className="p-2 text-right">
                      <QuantityCell value={r.qty} unit={r.unit} state={r.state} decimals={r.unit === "kg" ? 0 : 2} />
                    </td>
                    <td className="p-2 text-right">
                      <MoneyCell value={r.rate} state={r.state === "EXCLUDED" ? "EXCLUDED" : undefined} />
                    </td>
                    <td className="p-2 text-right">
                      <MoneyCell value={amount} state={r.state === "EXCLUDED" ? "EXCLUDED" : undefined} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="p-2 font-medium" colSpan={4}>
                  Known total (excludes pending, unavailable and excluded lines)
                </td>
                <td className="p-2 text-right font-semibold">
                  <MoneyCell value={total} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-sm">
          Summary: <strong>{formatINRCompact(total)}</strong> known · 2 lines without a quantity
        </p>
      </Section>

      <Section title="Drawing (always light)">
        <div className="ds-drawing rounded border ds-divider p-2">
          <svg viewBox="0 0 320 140" role="img" aria-label="Sample floor plan: two rooms and a door" className="w-full h-auto">
            <rect x="10" y="10" width="300" height="120" fill="none" stroke="currentColor" strokeWidth="4" />
            <line x1="170" y1="10" x2="170" y2="130" stroke="currentColor" strokeWidth="3" />
            <path d="M170 90 A30 30 0 0 1 200 60" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <text x="80" y="75" fontSize="12" fill="currentColor">Living 4.2 × 3.6</text>
            <text x="205" y="45" fontSize="12" fill="currentColor">Bed 3.0 × 3.6</text>
          </svg>
        </div>
      </Section>
    </div>
  );
}

function DesignSystemContent() {
  const [len, setLen] = useState<number | null>(4.2);
  const [pending, setPending] = useState<number | null>(null);
  const [order, setOrder] = useState(["Ground floor", "First floor", "Terrace"]);
  const move = (i: number, d: -1 | 1) =>
    setOrder((o) => {
      const n = [...o];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  const pairs = contrastPairs();
  const failing = pairs.filter((p) => contrastRatio(p.fg, p.bg) < REQUIRED[p.kind]);

  return (
    <div data-ds-theme="light" className="ds-page min-h-screen">
      <Helmet>
        <title>Design system | Cunstruct</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <main className="mx-auto max-w-7xl space-y-10 px-4 py-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Cunstruct design system</h1>
          <p className="ds-muted max-w-3xl text-sm">
            Plan item D1. Neutral UI; colour carries meaning only and never alone (WCAG 2.2 SC 1.4.1). Text ≥ 4.5:1
            (1.4.3), icons and boundaries ≥ 3:1 (1.4.11), targets ≥ {MIN_TARGET_PX}px (2.5.8), a non-drag
            alternative for every drag (2.5.7). Source: <code>src/design/</code>, docs:{" "}
            <code>docs/design/DESIGN-SYSTEM.md</code>.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <ThemePanel theme="light" />
          <ThemePanel theme="dark" />
        </div>

        <Section title="Money and numbers">
          <p className="text-sm ds-muted">
            Grids: <code>formatINR</code> — whole rupees, en-IN lakh/crore grouping. Summaries only:{" "}
            <code>formatINRCompact</code>. Missing is “—”, never 0. Tabular figures, right-aligned.
          </p>
          <div className="overflow-x-auto">
            <table className="ds-surface text-sm border-collapse">
              <thead>
                <tr className="border-b ds-divider">
                  <th className="p-2 text-left font-medium">Input</th>
                  <th className="p-2 text-right font-medium">formatINR (grid)</th>
                  <th className="p-2 text-right font-medium">formatINRCompact (summary)</th>
                  <th className="p-2 text-right font-medium">formatQuantity</th>
                </tr>
              </thead>
              <tbody>
                {MONEY_SAMPLES.map((n, i) => (
                  <tr key={i} className="border-b ds-divider">
                    <td className="p-2">
                      <code>{String(n)}</code>
                    </td>
                    <td className="p-2 ds-num">{formatINR(n)}</td>
                    <td className="p-2 ds-num">{formatINRCompact(n)}</td>
                    <td className="p-2 ds-num">{formatQuantity(n == null ? null : n / 1000)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="grid gap-8 md:grid-cols-3">
          <Section title="Type scale">
            {Object.entries(TYPE_SCALE).map(([k, [size, lh]]) => (
              <p key={k} style={{ fontSize: size, lineHeight: `${lh}px` }}>
                {k} — {size}/{lh}px ₹12,34,567
              </p>
            ))}
          </Section>
          <Section title="Spacing (4px grid)">
            {Object.entries(SPACING).map(([k, px]) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <code className="w-8">{k}</code>
                <span className="inline-block h-3 ds-primary" style={{ width: px }} aria-hidden="true" />
                <span>{px}px</span>
              </div>
            ))}
          </Section>
          <Section title="Radii">
            <div className="flex flex-wrap gap-3">
              {Object.entries(RADII).map(([k, px]) => (
                <div key={k} className="text-center text-xs">
                  <div className="h-12 w-12 border-2" style={{ borderRadius: px, borderColor: "hsl(var(--ds-control-border))" }} />
                  {k}
                </div>
              ))}
            </div>
          </Section>
        </div>

        <Section title={`Targets (minimum ${MIN_TARGET_PX}×${MIN_TARGET_PX}px, WCAG 2.5.8)`}>
          <div className="flex items-end gap-4 text-xs">
            <div className="text-center">
              <div className="ds-target ds-control" style={{ width: MIN_TARGET_PX, height: MIN_TARGET_PX }} />
              minimum
            </div>
            <div className="text-center">
              <div className="ds-control h-8 w-8" />
              default 32px
            </div>
          </div>
        </Section>

        <Section title="Non-drag alternatives (WCAG 2.5.7)">
          <div className="flex flex-wrap gap-10">
            <div className="space-y-2">
              <p className="text-sm font-medium">NumericNudge — instead of dragging a handle</p>
              <NumericNudge label="Wall length" unit="m" value={len} step={0.1} min={0} onChange={setLen} />
              <p className="text-sm ds-muted">Type, click −/+, or ArrowUp/ArrowDown (Shift ×10).</p>
              <NumericNudge label="Plaster area" unit="m²" value={pending} onChange={setPending} />
              <p className="text-sm ds-muted">Unresolved: −/+ stay disabled until a value is typed.</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">ReorderButtons — instead of drag-to-reorder</p>
              <ol className="space-y-1">
                {order.map((name, i) => (
                  <li key={name} className="flex items-center gap-2 text-sm">
                    <ReorderButtons
                      itemLabel={name}
                      isFirst={i === 0}
                      isLast={i === order.length - 1}
                      onMoveUp={() => move(i, -1)}
                      onMoveDown={() => move(i, 1)}
                    />
                    {name}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Section>

        <Section title={`Automated contrast checks (${pairs.length} pairs, ${failing.length} failing)`}>
          <p className="text-sm ds-muted">
            Same computation as <code>src/design/contrast.test.ts</code>, which fails CI if any pair falls below its
            threshold.
          </p>
          <div className="overflow-x-auto">
            <table className="ds-surface text-xs border-collapse">
              <thead>
                <tr className="border-b ds-divider">
                  <th className="p-1 text-left font-medium">Theme</th>
                  <th className="p-1 text-left font-medium">Pair</th>
                  <th className="p-1 text-right font-medium">Ratio</th>
                  <th className="p-1 text-right font-medium">Needs</th>
                  <th className="p-1 text-left font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => {
                  const r = contrastRatio(p.fg, p.bg);
                  const ok = r >= REQUIRED[p.kind];
                  return (
                    <tr key={p.theme + p.name} className="border-b ds-divider">
                      <td className="p-1">{p.theme}</td>
                      <td className="p-1">{p.name}</td>
                      <td className="p-1 ds-num">{r.toFixed(2)}:1</td>
                      <td className="p-1 ds-num">{REQUIRED[p.kind]}:1</td>
                      <td className="p-1">{ok ? "Pass" : "FAIL"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      </main>
    </div>
  );
}

export default function DesignSystem() {
  const { loading, rolesReady, isStaff } = useAuth();
  const isDev = import.meta.env.DEV;
  if (!isDev && (loading || (!rolesReady && !isStaff))) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }
  if (!isDev && !isStaff) return <NotFound />;
  return <DesignSystemContent />;
}
