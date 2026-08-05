import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generateLines } from "@/lib/boqDsrGenerate";
import { explodeMaterials, type Coefficient } from "@/lib/boqExplode";
import type { Spec } from "@/lib/boqSpec";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Trash2, Wand2, Search, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

interface DsrItem { id: string; code: string; description: string | null; unit: string | null; rate: number | null; chapter: string | null; }
interface BoqLine {
  id: string; section: string | null; dsr_code: string | null; description: string | null;
  unit: string | null; qty: number; dsr_rate: number | null; included: boolean; source: string; sort: number;
}

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export default function OpsBoqBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [showBrowser, setShowBrowser] = useState(false);
  const [view, setView] = useState<"lines" | "materials">("lines");

  const { data: boq } = useQuery({
    queryKey: ["boq", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("boq")
        .select("id, name, status, project_id, spec").eq("id", id).single();
      if (error) throw error;
      return data as { id: string; name: string; status: string; project_id: string | null; spec: Spec };
    },
    enabled: !!id,
  });

  const { data: project } = useQuery({
    queryKey: ["boq-project", boq?.project_id],
    queryFn: async () => {
      const { data } = await supabase.from("projects")
        .select("id, name, area_sqft, floors").eq("id", boq!.project_id!).single();
      return data as { id: string; name: string; area_sqft: number | null; floors: number | null } | null;
    },
    enabled: !!boq?.project_id,
  });

  // All billable DSR items — used for both generation matching and the browser.
  const { data: dsrItems = [] } = useQuery({
    queryKey: ["dsr-items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("dsr_item")
        .select("id, code, description, unit, rate, chapter").eq("billable", true).order("code");
      if (error) throw error;
      return (data ?? []) as DsrItem[];
    },
  });

  const { data: lines = [], isLoading: linesLoading } = useQuery({
    queryKey: ["boq-lines", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("boq_line")
        .select("id, section, dsr_code, description, unit, qty, dsr_rate, included, source, sort")
        .eq("boq_id", id).order("sort");
      if (error) throw error;
      return (data ?? []) as BoqLine[];
    },
    enabled: !!id,
  });

  const refetchLines = () => qc.invalidateQueries({ queryKey: ["boq-lines", id] });

  // AOR coefficients for the DSR codes present on this BOQ, for the material schedule.
  const codes = useMemo(
    () => [...new Set(lines.map((l) => l.dsr_code).filter(Boolean))] as string[],
    [lines],
  );
  const { data: coeffs = [] } = useQuery({
    queryKey: ["boq-coeffs", codes],
    enabled: codes.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("dsr_coefficient")
        .select("item_code, kind, resource, qty, unit, product_id").in("item_code", codes);
      if (error) throw error;
      return (data ?? []) as Coefficient[];
    },
  });

  const schedule = useMemo(() => {
    const byCode = new Map<string, Coefficient[]>();
    for (const c of coeffs) { const a = byCode.get(c.item_code) ?? []; a.push(c); byCode.set(c.item_code, a); }
    return explodeMaterials(
      lines.map((l) => ({ dsr_code: l.dsr_code, qty: l.qty, included: l.included })),
      byCode,
    );
  }, [lines, coeffs]);

  // Exact code → DSR item, for resolving generated lines (no fuzzy matching).
  const byDsrCode = useMemo(() => {
    const m = new Map<string, DsrItem>();
    for (const it of dsrItems) m.set(it.code, it);
    return m;
  }, [dsrItems]);

  const generate = async () => {
    if (!boq) return;
    setBusy(true);
    try {
      const generated = generateLines(boq.spec ?? {}, {
        area_sqft: project?.area_sqft ?? null, floors: project?.floors ?? null,
      });
      // Regenerate auto lines; keep anything the user added by hand.
      await supabase.from("boq_line").delete().eq("boq_id", id).eq("source", "auto");
      const rows = generated.map((g, i) => {
        const dsr = byDsrCode.get(g.code);   // exact code lookup
        return {
          boq_id: id, section: g.section, dsr_code: g.code,
          description: dsr?.description ?? g.label,
          unit: dsr?.unit ?? g.unit, qty: g.qty, dsr_rate: dsr?.rate ?? null,
          source: "auto", sort: i,
        };
      });
      const { error } = await supabase.from("boq_line").insert(rows);
      if (error) throw error;
      const priced = rows.filter((r) => r.dsr_rate != null).length;
      toast.success(`Generated ${rows.length} lines · ${priced} priced from DSR`);
      refetchLines();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  const addFromCatalog = async (it: DsrItem) => {
    const { error } = await supabase.from("boq_line").insert({
      boq_id: id, section: it.chapter ?? "Other", dsr_code: it.code,
      description: it.description, unit: it.unit, qty: 1, dsr_rate: it.rate,
      source: "manual", sort: 999,
    });
    if (error) return toast.error(error.message);
    toast.success(`Added ${it.code}`);
    refetchLines();
  };

  const updateLine = async (lineId: string, patch: Partial<BoqLine>) => {
    const { error } = await supabase.from("boq_line").update(patch).eq("id", lineId);
    if (error) toast.error(error.message); else refetchLines();
  };
  const removeLine = async (lineId: string) => {
    await supabase.from("boq_line").delete().eq("id", lineId);
    refetchLines();
  };

  const grouped = useMemo(() => {
    const g = new Map<string, BoqLine[]>();
    for (const l of lines) {
      const s = l.section ?? "Other";
      if (!g.has(s)) g.set(s, []);
      g.get(s)!.push(l);
    }
    return [...g.entries()];
  }, [lines]);

  const total = useMemo(() =>
    lines.filter((l) => l.included).reduce((sum, l) => sum + l.qty * (l.dsr_rate ?? 0), 0),
    [lines]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return dsrItems.filter((it) =>
      it.code.toLowerCase().includes(q) || (it.description ?? "").toLowerCase().includes(q)
    ).slice(0, 40);
  }, [search, dsrItems]);

  if (!boq) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">{boq.name}</h1>
          <p className="text-sm text-muted-foreground">
            {project?.name ?? "Standalone"} · {lines.length} lines · <Badge variant="outline">{boq.status}</Badge>
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">BOQ value (DSR rates)</div>
          <div className="text-xl font-semibold">{inr(total)}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={generate} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
          {lines.some((l) => l.source === "auto") ? "Regenerate from questionnaire" : "Generate from questionnaire"}
        </Button>
        <Button variant="outline" onClick={() => setShowBrowser((s) => !s)}>
          <Plus className="h-4 w-4 mr-2" />Add DSR item
        </Button>
        <div className="ml-auto inline-flex rounded-md border p-0.5">
          <Button size="sm" variant={view === "lines" ? "secondary" : "ghost"} onClick={() => setView("lines")}>Lines</Button>
          <Button size="sm" variant={view === "materials" ? "secondary" : "ghost"} onClick={() => setView("materials")}>
            <Layers className="h-4 w-4 mr-1" />Material schedule
          </Button>
        </div>
      </div>

      {showBrowser && (
        <Card>
          <CardHeader className="pb-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search DSR by code or description…"
                value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            </div>
          </CardHeader>
          <CardContent className="max-h-80 overflow-y-auto divide-y">
            {searchResults.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {search ? "No matches" : `${dsrItems.length} DSR items — type to search`}
              </p>
            )}
            {searchResults.map((it) => (
              <div key={it.id} className="flex items-center gap-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-muted-foreground">{it.code} · {it.unit}</div>
                  <div className="text-sm truncate">{it.description}</div>
                </div>
                <div className="text-sm tabular-nums">{it.rate != null ? inr(it.rate) : "—"}</div>
                <Button size="sm" variant="ghost" onClick={() => addFromCatalog(it)}><Plus className="h-4 w-4" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {view === "materials" ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Material &amp; labour schedule</CardTitle>
            <p className="text-xs text-muted-foreground">
              Exploded from {schedule.matchedCodes} DSR code{schedule.matchedCodes === 1 ? "" : "s"} via the AOR.
              {schedule.unmatchedCodes.length > 0 && ` ${schedule.unmatchedCodes.length} line${schedule.unmatchedCodes.length === 1 ? "" : "s"} have no AOR data yet.`}
            </p>
          </CardHeader>
          <CardContent>
            {schedule.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No AOR coefficients matched these lines. Generate lines with DSR codes, or the AOR has no data for them.
              </p>
            ) : (
              (["material", "labour", "plant"] as const).map((kind) => {
                const rows = schedule.rows.filter((r) => r.kind === kind);
                if (!rows.length) return null;
                return (
                  <div key={kind} className="mb-4 last:mb-0">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                      {kind === "material" ? "Materials" : kind === "labour" ? "Labour" : "Plant & machinery"}
                    </div>
                    {rows.map((r, i) => (
                      <div key={i} className="grid grid-cols-[1fr_6rem_4rem] items-center gap-2 py-1.5 border-b last:border-0">
                        <span className="text-sm">{r.resource}</span>
                        <span className="text-sm tabular-nums text-right">{r.qty.toLocaleString("en-IN")}</span>
                        <span className="text-xs text-muted-foreground">{r.unit}</span>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      ) : linesLoading ? (
        <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>
      ) : lines.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          No lines yet. Generate from the questionnaire or add DSR items.
        </CardContent></Card>
      ) : (
        grouped.map(([section, secLines]) => {
          const secTotal = secLines.filter((l) => l.included).reduce((s, l) => s + l.qty * (l.dsr_rate ?? 0), 0);
          return (
            <Card key={section}>
              <CardHeader className="pb-2 flex-row items-center justify-between">
                <CardTitle className="text-base">{section}</CardTitle>
                <span className="text-sm text-muted-foreground tabular-nums">{inr(secTotal)}</span>
              </CardHeader>
              <CardContent className="space-y-1">
                {secLines.map((l) => (
                  <div key={l.id} className={cn("grid grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_1fr_5rem_5rem_6rem_auto] items-center gap-2 py-1.5 border-b last:border-0",
                    !l.included && "opacity-40")}>
                    <input type="checkbox" checked={l.included}
                      onChange={(e) => updateLine(l.id, { included: e.target.checked })} />
                    <div className="min-w-0">
                      <div className="text-sm truncate">{l.description}</div>
                      <div className="text-xs font-mono text-muted-foreground">{l.dsr_code ?? "no DSR code"}</div>
                    </div>
                    <Input type="number" className="h-8 hidden sm:block" defaultValue={l.qty}
                      onBlur={(e) => { const v = Number(e.target.value); if (v !== l.qty) updateLine(l.id, { qty: v }); }} />
                    <span className="text-xs text-muted-foreground hidden sm:block">{l.unit}</span>
                    <span className="text-sm tabular-nums text-right hidden sm:block">
                      {l.dsr_rate != null ? inr(l.qty * l.dsr_rate) : "—"}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => removeLine(l.id)}>
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
