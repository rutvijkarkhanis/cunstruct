import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase as catalogSupabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrendingUp, AlertTriangle } from "lucide-react";
import { formatINR } from "@/lib/forecastEngine";

interface CatalogRow {
  id: string;
  name: string | null;
  brand: string | null;
  main_category: string | null;
  subcategory: string | null;
  unit: string | null;
  cost_price: number | null;
  selling_price: number | null;
  profit_margin: number | null;
  calc_margin_pct: number | null;
  model: string | null;
  stage: string | null;
  role: string | null;
  credit_risk: string | null;
  status: string | null;
  image_url: string | null;
}

const MODELS = ["Trade", "Hook", "Broker"] as const;
type Model = (typeof MODELS)[number];

const DEFAULTS: Record<Model, { margin: number; creditWeight: number; revenue: number }> = {
  Trade: { margin: 25, creditWeight: 0.5, revenue: 500000 },
  Hook: { margin: 12, creditWeight: 0.4, revenue: 400000 },
  Broker: { margin: 3, creditWeight: 0, revenue: 800000 },
};

const num = (v: number | null | undefined) => (v == null || isNaN(Number(v)) ? 0 : Number(v));

function groupBy(rows: CatalogRow[], key: keyof CatalogRow) {
  const map = new Map<string, { count: number; value: number; marginSum: number; marginN: number }>();
  for (const r of rows) {
    const k = (r[key] as string) ?? "—";
    const g = map.get(k) ?? { count: 0, value: 0, marginSum: 0, marginN: 0 };
    g.count += 1;
    g.value += num(r.selling_price);
    if (r.calc_margin_pct != null) { g.marginSum += num(r.calc_margin_pct); g.marginN += 1; }
    map.set(k, g);
  }
  return [...map.entries()]
    .map(([name, g]) => ({ name, count: g.count, value: g.value, avgMargin: g.marginN ? g.marginSum / g.marginN : 0 }))
    .sort((a, b) => b.value - a.value);
}

export default function OpsProjections() {
  const { data: rows, isLoading, isError, error } = useQuery({
    queryKey: ["catalog_enriched"],
    queryFn: async () => {
      const { data, error } = await catalogSupabase
        .from("catalog_enriched")
        .select("id, name, brand, main_category, subcategory, unit, cost_price, selling_price, profit_margin, calc_margin_pct, model, stage, role, credit_risk, status, image_url");
      if (error) throw error;
      return (data ?? []) as CatalogRow[];
    },
  });

  const kpis = useMemo(() => {
    const list = rows ?? [];
    const count = list.length;
    const catalogueValue = list.reduce((s, r) => s + num(r.selling_price), 0);
    const totalCost = list.reduce((s, r) => s + num(r.cost_price), 0);
    const blendedMargin = catalogueValue > 0 ? ((catalogueValue - totalCost) / catalogueValue) * 100 : 0;
    const negMargin = list.filter(r => num(r.selling_price) <= num(r.cost_price)).length;
    const noImage = list.filter(r => !r.image_url).length;
    return { count, catalogueValue, blendedMargin, negMargin, noImage };
  }, [rows]);

  const byModel = useMemo(() => groupBy(rows ?? [], "model"), [rows]);
  const byCreditRisk = useMemo(() => groupBy(rows ?? [], "credit_risk"), [rows]);

  // Section 2 — editable monthly projection inputs per model.
  const [inputs, setInputs] = useState<Record<Model, { revenue: number; margin: number }>>({
    Trade: { revenue: DEFAULTS.Trade.revenue, margin: DEFAULTS.Trade.margin },
    Hook: { revenue: DEFAULTS.Hook.revenue, margin: DEFAULTS.Hook.margin },
    Broker: { revenue: DEFAULTS.Broker.revenue, margin: DEFAULTS.Broker.margin },
  });

  const projection = useMemo(() => {
    const perModel = MODELS.map((m) => {
      const revenue = num(inputs[m].revenue);
      const margin = num(inputs[m].margin);
      const monthlyGP = (revenue * margin) / 100;
      const creditCarried = revenue * DEFAULTS[m].creditWeight;
      return { model: m, revenue, margin, monthlyGP, creditCarried };
    });
    const monthlyGP = perModel.reduce((s, r) => s + r.monthlyGP, 0);
    const creditCarried = perModel.reduce((s, r) => s + r.creditCarried, 0);
    return { perModel, monthlyGP, creditCarried, annualGP: monthlyGP * 12, workingCapital: creditCarried };
  }, [inputs]);

  const setInput = (m: Model, field: "revenue" | "margin", value: number) =>
    setInputs(prev => ({ ...prev, [m]: { ...prev[m], [field]: value } }));

  if (isError) {
    return (
      <div className="p-8 space-y-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" /> Business Forecast
        </h1>
        <Card className="p-6 space-y-2">
          <p className="text-sm text-destructive font-medium">Couldn't load the catalogue view.</p>
          <p className="text-xs text-muted-foreground font-mono break-all">
            {(error as any)?.message ?? String(error)}
          </p>
          <p className="text-sm text-muted-foreground">
            If <code>catalog_enriched</code> doesn't exist yet, create it in the Supabase SQL editor
            (the setup SQL was shared with this page), then reload.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" /> Business Forecast
        </h1>
        <p className="text-sm text-muted-foreground">Catalogue economics and a monthly GP / working-capital projection.</p>
      </div>

      {/* SECTION 1 — Overview */}
      <section className="space-y-4">
        <h2 className="font-semibold text-lg">Catalogue overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi label="Products" value={isLoading ? "…" : kpis.count.toLocaleString("en-IN")} />
          <Kpi label="Catalogue value" value={isLoading ? "…" : formatINR(kpis.catalogueValue)} />
          <Kpi label="Blended margin" value={isLoading ? "…" : `${kpis.blendedMargin.toFixed(1)}%`} />
          <Kpi
            label="Data flags"
            value={isLoading ? "…" : `${kpis.negMargin + kpis.noImage}`}
            sub={isLoading ? undefined : `${kpis.negMargin} priced ≤ cost · ${kpis.noImage} no image`}
            tone={(kpis.negMargin + kpis.noImage) > 0 ? "warn" : undefined}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BreakdownTable title="By model" groups={byModel} />
          <BreakdownTable title="By credit risk" groups={byCreditRisk} />
        </div>
      </section>

      {/* SECTION 2 — Monthly projection */}
      <section className="space-y-4">
        <h2 className="font-semibold text-lg">Monthly projection</h2>
        <Card className="p-5 overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-2 pr-3">Model</th>
                <th className="py-2 px-3">Monthly revenue (₹)</th>
                <th className="py-2 px-3">Margin %</th>
                <th className="py-2 px-3 text-right">Monthly GP</th>
                <th className="py-2 pl-3 text-right">Credit carried</th>
              </tr>
            </thead>
            <tbody>
              {projection.perModel.map((r) => (
                <tr key={r.model} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{r.model}</td>
                  <td className="py-2 px-3">
                    <Input
                      type="number" min={0} className="h-8 w-32"
                      value={inputs[r.model].revenue}
                      onChange={(e) => setInput(r.model, "revenue", Math.max(0, +e.target.value))}
                    />
                  </td>
                  <td className="py-2 px-3">
                    <Input
                      type="number" min={0} className="h-8 w-20"
                      value={inputs[r.model].margin}
                      onChange={(e) => setInput(r.model, "margin", Math.max(0, +e.target.value))}
                    />
                  </td>
                  <td className="py-2 px-3 text-right font-medium">{formatINR(r.monthlyGP)}</td>
                  <td className="py-2 pl-3 text-right">
                    {r.model === "Broker"
                      ? <span className="text-emerald-600 dark:text-emerald-400">{formatINR(0)}</span>
                      : formatINR(r.creditCarried)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 font-semibold">
                <td className="py-2 pr-3">Total</td>
                <td className="py-2 px-3">{formatINR(projection.perModel.reduce((s, r) => s + r.revenue, 0))}</td>
                <td className="py-2 px-3">—</td>
                <td className="py-2 px-3 text-right">{formatINR(projection.monthlyGP)}</td>
                <td className="py-2 pl-3 text-right">{formatINR(projection.creditCarried)}</td>
              </tr>
            </tbody>
          </table>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Kpi label="Monthly GP" value={formatINR(projection.monthlyGP)} />
          <Kpi label="Annual GP" value={formatINR(projection.annualGP)} sub="Monthly GP × 12" />
          <Kpi label="Working capital" value={formatINR(projection.workingCapital)} sub="Total credit carried" tone="warn" />
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Broker carries ₹0 credit — the brand finances that revenue, so it doesn't tie up your working capital.
        </p>
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${tone === "warn" ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}

function BreakdownTable({ title, groups }: { title: string; groups: { name: string; count: number; value: number; avgMargin: number }[] }) {
  return (
    <Card className="p-5 overflow-x-auto">
      <div className="font-medium mb-3">{title}</div>
      <table className="w-full text-sm min-w-[380px]">
        <thead>
          <tr className="text-left text-xs text-muted-foreground border-b">
            <th className="py-1.5 pr-3">Group</th>
            <th className="py-1.5 px-3 text-right">Count</th>
            <th className="py-1.5 px-3 text-right">Value</th>
            <th className="py-1.5 pl-3 text-right">Avg margin</th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 && (
            <tr><td colSpan={4} className="py-4 text-center text-muted-foreground text-xs">No data</td></tr>
          )}
          {groups.map((g) => (
            <tr key={g.name} className="border-b last:border-0">
              <td className="py-1.5 pr-3 font-medium">{g.name}</td>
              <td className="py-1.5 px-3 text-right">{g.count.toLocaleString("en-IN")}</td>
              <td className="py-1.5 px-3 text-right">{formatINR(g.value)}</td>
              <td className="py-1.5 pl-3 text-right">{g.avgMargin.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
