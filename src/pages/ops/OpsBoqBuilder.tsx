import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generateForDiscipline, disciplineByKey } from "@/lib/disciplines";
import { computeDimensions } from "@/lib/dimensions";
import { explodeMaterials, type Coefficient } from "@/lib/boqExplode";
import { computeCommercials, openDsrQuote, buildBoqCsv, downloadCsv, type QuoteSubHead, type CsvRow } from "@/lib/boqDsrDocument";
import { openIntakeForm } from "@/lib/boqIntakeForm";
import type { Spec } from "@/lib/boqSpec";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Trash2, Wand2, Search, Layers, FileDown, Sheet, Ruler, ClipboardList, Percent } from "lucide-react";
import { cn } from "@/lib/utils";

interface DsrItem { id: string; code: string; description: string | null; unit: string | null; rate: number | null; chapter: string | null; }
interface BoqLine {
  id: string; section: string | null; dsr_code: string | null; description: string | null;
  unit: string | null; qty: number; dsr_rate: number | null; custom_rate: number | null;
  cost: number | null;
  included: boolean; source: string; sort: number;
}
/** The rate in effect: the estimator's case-specific override, else the DSR reference. */
const effRate = (l: BoqLine) => l.custom_rate ?? l.dsr_rate;

interface RoomRow {
  id: string; name: string | null; room_type: string;
  length_ft: number; width_ft: number; height_ft: number; count: number; electrical_points: number;
}
const ROOM_TYPES = ["room", "bedroom", "living", "kitchen", "bathroom", "balcony", "utility", "pooja"];

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export default function OpsBoqBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [showBrowser, setShowBrowser] = useState(false);
  const [view, setView] = useState<"lines" | "make" | "materials">("lines");
  const [targetMargin, setTargetMargin] = useState(15);

  const { data: boq } = useQuery({
    queryKey: ["boq", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("boq")
        .select("id, name, status, project_id, spec, discipline").eq("id", id).single();
      if (error) throw error;
      return data as { id: string; name: string; status: string; project_id: string | null; spec: Spec; discipline: string };
    },
    enabled: !!id,
  });

  const { data: project } = useQuery({
    queryKey: ["boq-project", boq?.project_id],
    queryFn: async () => {
      const { data } = await supabase.from("projects")
        .select("id, name, area_sqft, floors, client_name, location, project_type, scope").eq("id", boq!.project_id!).single();
      return data as { id: string; name: string; area_sqft: number | null; floors: number | null; client_name: string | null; location: string | null; project_type: string | null; scope: string | null } | null;
    },
    enabled: !!boq?.project_id,
  });

  // Room-by-room dimensions drive accurate quantities (falls back to built-up
  // heuristics when the project has no rooms). Shared with the template BOQ.
  const { data: rooms = [] } = useQuery({
    queryKey: ["boq-rooms", boq?.project_id],
    enabled: !!boq?.project_id,
    queryFn: async () => {
      const { data } = await supabase.from("project_rooms")
        .select("id, name, room_type, length_ft, width_ft, height_ft, count, electrical_points")
        .eq("project_id", boq!.project_id!).order("created_at");
      return (data ?? []) as RoomRow[];
    },
  });
  const dims = useMemo(() => computeDimensions(rooms), [rooms]);
  const hasRooms = rooms.length > 0;

  // All billable DSR items — used for both generation matching and the browser.
  // DSR catalog browser: search server-side (the table has 2,758 rows — loading
  // them all silently truncated at Supabase's 1000-row cap, which is why half the
  // generated lines couldn't find their rate).
  const { data: searchResults = [] } = useQuery({
    queryKey: ["dsr-search", search],
    enabled: search.trim().length >= 2,
    queryFn: async () => {
      const q = search.trim().replace(/[%,]/g, " ");
      const { data, error } = await supabase.from("dsr_item")
        .select("id, code, description, unit, rate, chapter")
        .eq("billable", true)
        .or(`code.ilike.%${q}%,description.ilike.%${q}%`)
        .limit(40);
      if (error) throw error;
      return (data ?? []) as DsrItem[];
    },
  });

  const { data: lines = [], isLoading: linesLoading } = useQuery({
    queryKey: ["boq-lines", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("boq_line")
        .select("id, section, dsr_code, description, unit, qty, dsr_rate, custom_rate, cost, included, source, sort")
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

  const generate = async () => {
    if (!boq) return;
    setBusy(true);
    try {
      const generated = generateForDiscipline(boq.discipline ?? "civil", boq.spec ?? {}, {
        area_sqft: project?.area_sqft ?? null, floors: project?.floors ?? null,
      }, hasRooms ? dims : undefined);
      // Fetch the live DSR rows for exactly the codes we need (not a capped
      // load-all), so every generated line resolves its description/unit/rate.
      const codes = [...new Set(generated.map((g) => g.code).filter(Boolean))] as string[];
      const { data: dsrRows, error: dsrErr } = await supabase.from("dsr_item")
        .select("code, description, unit, rate, chapter").in("code", codes);
      if (dsrErr) throw dsrErr;
      const byDsrCode = new Map<string, { code: string; description: string | null; unit: string | null; rate: number | null; chapter: string | null }>();
      for (const r of dsrRows ?? []) byDsrCode.set(r.code, r);
      // Regenerate auto lines; keep anything the user added by hand.
      await supabase.from("boq_line").delete().eq("boq_id", id).eq("source", "auto");
      const rows = generated.map((g, i) => {
        const dsr = byDsrCode.get(g.code);   // exact code lookup
        return {
          // section holds the DSR sub-head (type of work); the construction
          // stage is derived from the code at render/export time.
          boq_id: id, section: dsr?.chapter ?? g.section, dsr_code: g.code,
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

  const sumIncl = (ls: BoqLine[]) => ls.filter((l) => l.included).reduce((s, l) => s + l.qty * (effRate(l) ?? 0), 0);

  // Group by DSR sub-head (type of work), ordered by chapter number — which is
  // also the construction sequence. Each sub-head gets a number; items within
  // are numbered <sub-head>.01, .02 … like a real tender BOQ. NS lines last.
  const bySubhead = useMemo(() => {
    const groups = new Map<string, BoqLine[]>();
    for (const l of lines) {
      const sec = l.section ?? "Other";
      if (!groups.has(sec)) groups.set(sec, []);
      groups.get(sec)!.push(l);
    }
    const chapterNo = (ls: BoqLine[]) => {
      const coded = ls.find((l) => l.dsr_code);
      return coded ? parseInt(coded.dsr_code!.split(".")[0], 10) || 900 : 999;  // uncoded/NS last
    };
    return [...groups.entries()]
      .sort((a, b) => chapterNo(a[1]) - chapterNo(b[1]) || a[0].localeCompare(b[0]))
      .map(([name, ls], gi) => {
        const no = gi + 1;
        let item = 0;
        const rows = ls.map((l) => ({ line: l, no: `${no}.${String(++item).padStart(2, "0")}` }));
        return { no, name, rows, subtotal: sumIncl(ls) };
      });
  }, [lines]);

  const total = useMemo(() =>
    lines.filter((l) => l.included).reduce((sum, l) => sum + l.qty * (effRate(l) ?? 0), 0),
    [lines]);

  // "Make" (margin) = quote − your cost, per line and overall.
  const make = useMemo(() => {
    let quote = 0, cost = 0, hasCost = false;
    for (const l of lines) {
      if (!l.included) continue;
      quote += l.qty * (effRate(l) ?? 0);
      if (l.cost != null) { cost += l.qty * l.cost; hasCost = true; }
    }
    return { quote, cost, make: quote - cost, marginPct: quote > 0 ? ((quote - cost) / quote) * 100 : 0, hasCost };
  }, [lines]);

  // Commercials (cost index, contingency, overhead, cess, GST) live in boq.spec
  // so no migration is needed. Defaults follow common CPWD practice.
  const spec = useMemo(() => (boq?.spec ?? {}) as Spec, [boq?.spec]);
  const commercials = useMemo(() => {
    const pct = (k: string, d: number) => Number(spec[k] ?? d);
    return computeCommercials(total, {
      costIndexPct: pct("_cost_index_pct", 0),
      contingencyPct: pct("_contingency_pct", 3),
      overheadPct: pct("_overhead_pct", 15),
      cessPct: pct("_cess_pct", 1),
      gstPct: pct("_gst_pct", 18),
    });
  }, [total, spec]);

  const saveCommercials = async (patch: Record<string, number | string>) => {
    if (!boq) return;
    await supabase.from("boq").update({ spec: { ...(boq.spec ?? {}), ...patch } }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["boq", id] });
  };

  // ---- Rooms editor (drives accurate quantities) --------------------------
  const [showRooms, setShowRooms] = useState(false);
  const [roomDraft, setRoomDraft] = useState<RoomRow[] | null>(null);
  const [savingRooms, setSavingRooms] = useState(false);
  const draftRooms = roomDraft ?? rooms;
  const draftDims = useMemo(() => computeDimensions(draftRooms), [draftRooms]);
  const editRoom = (i: number, patch: Partial<RoomRow>) =>
    setRoomDraft((d) => (d ?? rooms).map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRoom = () =>
    setRoomDraft((d) => [...(d ?? rooms), { id: crypto.randomUUID(), name: "", room_type: "bedroom", length_ft: 10, width_ft: 10, height_ft: 10, count: 1, electrical_points: 4 }]);
  const delRoom = (i: number) => setRoomDraft((d) => (d ?? rooms).filter((_, idx) => idx !== i));
  const saveRooms = async () => {
    if (!boq?.project_id) return;
    setSavingRooms(true);
    try {
      await supabase.from("project_rooms").delete().eq("project_id", boq.project_id);
      if (draftRooms.length) {
        const { error } = await supabase.from("project_rooms").insert(draftRooms.map((r) => ({
          project_id: boq.project_id, name: r.name || null, room_type: r.room_type,
          length_ft: r.length_ft, width_ft: r.width_ft, height_ft: r.height_ft,
          count: r.count, electrical_points: r.electrical_points,
        })));
        if (error) throw error;
      }
      setRoomDraft(null);
      qc.invalidateQueries({ queryKey: ["boq-rooms", boq.project_id] });
      toast.success("Rooms saved — Regenerate to apply the new quantities");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save rooms");
    } finally {
      setSavingRooms(false);
    }
  };

  const gen = () => new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const firmName = String(spec._firm_name ?? "").trim() || null;
  const firmTagline = String(spec._firm_tagline ?? "").trim() || null;

  const exportQuote = (blankRates = false) => {
    const subheads: QuoteSubHead[] = bySubhead.map((sh) => ({
      no: sh.no, name: sh.name, subtotal: sh.subtotal,
      lines: sh.rows.filter(({ line }) => line.included).map(({ line, no }) => {
        const rate = effRate(line);
        return { no, code: line.dsr_code, spec: line.description ?? "", qty: line.qty, unit: line.unit ?? "", rate, amount: rate != null ? line.qty * rate : null };
      }),
    })).filter((sh) => sh.lines.length > 0);

    const ok = openDsrQuote({
      boqName: boq!.name,
      projectName: project?.name, clientName: project?.client_name, location: project?.location,
      builtUpSqft: project?.area_sqft, floors: project?.floors,
      generatedOn: gen(), rateYear: "2023",
      projectType: project?.project_type,
      flatsPerFloor: Number(spec._flats_per_floor ?? spec.flats_per_floor) || null,
      firmName, firmTagline, blankRates,
      subheads,
      abstract: subheads.map((sh) => ({ no: sh.no, name: sh.name, amount: sh.subtotal })),
      commercials,
    });
    if (!ok) toast.error("Allow pop-ups to export");
  };

  const printIntake = (blank: boolean) => {
    const ok = openIntakeForm({
      projectName: project?.name, projectType: project?.project_type, scope: project?.scope,
      clientName: project?.client_name, location: project?.location,
      builtUpSqft: project?.area_sqft, floors: project?.floors,
      firmName, firmTagline, generatedOn: gen(), spec, rooms, blank,
    });
    if (!ok) toast.error("Allow pop-ups to print the form");
  };

  const exportExcel = () => {
    const rows: CsvRow[] = bySubhead.flatMap((sh) =>
      sh.rows.filter(({ line }) => line.included).map(({ line, no }) => ({
        subhead: `${sh.no}.00 ${sh.name}`, itemNo: no, code: line.dsr_code,
        spec: line.description ?? "", unit: line.unit ?? "", qty: line.qty, rate: effRate(line),
      })));
    if (!rows.length) return toast.error("Nothing to export yet");
    downloadCsv(`${boq!.name.replace(/[^\w]+/g, "_")}_BOQ.csv`, buildBoqCsv(rows, { boqName: boq!.name, project: project?.name, generatedOn: gen() }));
  };

  if (!boq) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">{boq.name}</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <Badge>{disciplineByKey(boq.discipline).name}</Badge>
            {project?.name ?? "Standalone"} · {lines.length} lines · <Badge variant="outline">{boq.status}</Badge>
          </p>
          <p className="text-xs mt-0.5">
            {hasRooms
              ? <span className="text-emerald-600 dark:text-emerald-400">Quantities from {rooms.length} rooms · {dims.floorAreaSqft.toLocaleString("en-IN")} sqft measured</span>
              : <span className="text-amber-600 dark:text-amber-500">Quantities estimated from built-up area — add rooms for accuracy</span>}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Grand total (incl. GST)</div>
          <div className="text-xl font-semibold">{inr(commercials.grandTotal)}</div>
          <div className="text-xs text-muted-foreground">works {inr(total)}</div>
          {make.hasCost && (
            <div className={cn("text-xs font-medium", make.marginPct >= targetMargin ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-500")}>
              make {inr(make.make)} · {make.marginPct.toFixed(1)}%
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={generate} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
          {lines.some((l) => l.source === "auto") ? "Regenerate from questionnaire" : "Generate from questionnaire"}
        </Button>
        <Button variant="outline" onClick={() => setShowBrowser((s) => !s)}>
          <Plus className="h-4 w-4 mr-2" />Add DSR item
        </Button>
        {boq.project_id && (
          <Button variant={hasRooms ? "outline" : "default"} onClick={() => setShowRooms((s) => !s)}>
            <Ruler className="h-4 w-4 mr-2" />Rooms{rooms.length ? ` (${rooms.length})` : ""}
          </Button>
        )}
        <Button variant="outline" onClick={() => printIntake(false)} title="Printable project details form — pre-filled where known, blank lines to complete by hand">
          <ClipboardList className="h-4 w-4 mr-2" />Intake form
        </Button>
        <Button variant="outline" onClick={() => exportQuote(false)} disabled={lines.length === 0}>
          <FileDown className="h-4 w-4 mr-2" />Export quote
        </Button>
        <Button variant="outline" onClick={() => exportQuote(true)} disabled={lines.length === 0}
          title="Rates left blank — issue to contractors to price">
          <FileDown className="h-4 w-4 mr-2" />Blank BOQ
        </Button>
        <Button variant="outline" onClick={exportExcel} disabled={lines.length === 0}>
          <Sheet className="h-4 w-4 mr-2" />Export to Excel
        </Button>
        <div className="ml-auto inline-flex rounded-md border p-0.5">
          <Button size="sm" variant={view === "lines" ? "secondary" : "ghost"} onClick={() => setView("lines")}>Lines</Button>
          <Button size="sm" variant={view === "make" ? "secondary" : "ghost"} onClick={() => setView("make")}>
            <Percent className="h-4 w-4 mr-1" />Make
          </Button>
          <Button size="sm" variant={view === "materials" ? "secondary" : "ghost"} onClick={() => setView("materials")}>
            <Layers className="h-4 w-4 mr-1" />Materials
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground font-medium">Abstract</span>
        {([
          ["Cost index", "_cost_index_pct", commercials.costIndexPct],
          ["Contingency", "_contingency_pct", commercials.contingencyPct],
          ["Overhead", "_overhead_pct", commercials.overheadPct],
          ["Cess", "_cess_pct", commercials.cessPct],
          ["GST", "_gst_pct", commercials.gstPct],
        ] as const).map(([label, key, val]) => (
          <label key={key} className="flex items-center gap-1">{label}
            <Input type="number" className="h-7 w-14" defaultValue={val}
              onBlur={(e) => { const v = Number(e.target.value); if (v !== val) saveCommercials({ [key]: v }); }} />
            <span className="text-muted-foreground">%</span>
          </label>
        ))}
        <span className="ml-auto text-muted-foreground">
          Grand total <b className="text-foreground tabular-nums">{inr(commercials.grandTotal)}</b>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground font-medium">Letterhead</span>
        <Input className="h-7 w-52" defaultValue={firmName ?? ""} placeholder="Your firm name (e.g. The Grid Architects)"
          onBlur={(e) => saveCommercials({ _firm_name: e.target.value.trim() })} />
        <Input className="h-7 w-64" defaultValue={firmTagline ?? ""} placeholder="Tagline (e.g. architects & interior designers)"
          onBlur={(e) => saveCommercials({ _firm_tagline: e.target.value.trim() })} />
        <span className="text-xs text-muted-foreground">Appears on the exported BOQ instead of Cunstruct</span>
      </div>

      {showRooms && boq.project_id && (
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Rooms</CardTitle>
              <p className="text-xs text-muted-foreground">
                Drives finishing quantities. {draftDims.floorAreaSqft.toLocaleString("en-IN")} sqft floor · {draftDims.wallAreaSqft.toLocaleString("en-IN")} sqft wall · {draftDims.bathrooms} bath
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={addRoom}><Plus className="h-4 w-4 mr-1" />Add</Button>
              <Button size="sm" onClick={saveRooms} disabled={savingRooms}>
                {savingRooms && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save rooms
              </Button>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {draftRooms.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3 text-center">No rooms yet — Add rooms so quantities are measured, not estimated.</p>
            ) : (
              <table className="w-full text-sm min-w-[560px]">
                <thead><tr className="text-xs text-muted-foreground text-left">
                  <th className="py-1 font-medium">Type</th><th className="font-medium">Label</th>
                  <th className="font-medium w-14">L (ft)</th><th className="font-medium w-14">W (ft)</th>
                  <th className="font-medium w-14">H (ft)</th><th className="font-medium w-12">Qty</th>
                  <th className="font-medium w-14">Elec.</th><th></th>
                </tr></thead>
                <tbody>
                  {draftRooms.map((r, i) => (
                    <tr key={r.id} className="border-t">
                      <td className="py-1 pr-2">
                        <select className="h-8 rounded border bg-background px-1 text-sm" value={r.room_type}
                          onChange={(e) => editRoom(i, { room_type: e.target.value })}>
                          {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="pr-2"><Input className="h-8" value={r.name ?? ""} placeholder="e.g. Master"
                        onChange={(e) => editRoom(i, { name: e.target.value })} /></td>
                      {(["length_ft", "width_ft", "height_ft", "count", "electrical_points"] as const).map((f) => (
                        <td key={f} className="pr-1"><Input className="h-8" type="number" value={r[f]}
                          onChange={(e) => editRoom(i, { [f]: Number(e.target.value) })} /></td>
                      ))}
                      <td><Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => delRoom(i)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

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
                {search.trim().length >= 2 ? "No matches" : "Type at least 2 characters to search the DSR"}
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

      {view === "make" ? (
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Make (margin)</CardTitle>
              <p className="text-xs text-muted-foreground">Enter your cost per unit; make = quote − cost. Lines below target are flagged.</p>
            </div>
            <label className="text-sm flex items-center gap-1.5 shrink-0">Target
              <Input type="number" className="h-7 w-16" value={targetMargin}
                onChange={(e) => setTargetMargin(Number(e.target.value))} /><span className="text-muted-foreground">%</span>
            </label>
          </CardHeader>
          <CardContent className="space-y-3">
            {bySubhead.map(({ no, name, rows }) => {
              const incl = rows.filter(({ line }) => line.included);
              const q = incl.reduce((s, { line }) => s + line.qty * (effRate(line) ?? 0), 0);
              const c = incl.reduce((s, { line }) => s + line.qty * (line.cost ?? 0), 0);
              const m = q - c, mp = q > 0 ? (m / q) * 100 : 0;
              return (
                <div key={name}>
                  <div className="flex items-center justify-between border-b pb-1 mb-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">{no}.00 {name}</span>
                    <span className={cn("text-xs tabular-nums", mp >= targetMargin ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-500")}>{inr(m)} · {mp.toFixed(1)}%</span>
                  </div>
                  {incl.map(({ line: l, no: itemNo }) => {
                    const rate = effRate(l) ?? 0;
                    const lq = l.qty * rate, lc = l.qty * (l.cost ?? 0), lm = lq - lc;
                    const mpct = lq > 0 ? (lm / lq) * 100 : 0;
                    const below = l.cost != null && mpct < targetMargin;
                    return (
                      <div key={l.id} className="grid grid-cols-[1fr_4.5rem_4.5rem_5rem_auto] items-center gap-2 py-1 border-b last:border-0 text-sm">
                        <span className="truncate text-[13px]"><span className="text-muted-foreground mr-1 font-mono text-[11px]">{itemNo}</span>{l.description}</span>
                        <Input type="number" className="h-8" placeholder="cost" defaultValue={l.cost ?? ""}
                          onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== l.cost) updateLine(l.id, { cost: v }); }} />
                        <span className="text-xs text-muted-foreground text-right tabular-nums">@{inr(rate)}</span>
                        <span className="text-right tabular-nums">{l.cost != null ? inr(lm) : "—"}</span>
                        <span className={cn("text-right tabular-nums text-xs w-12", below ? "text-amber-600 dark:text-amber-500 font-medium" : "text-muted-foreground")}>
                          {l.cost != null ? `${mpct.toFixed(0)}%` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div className="mt-2 pt-2 border-t flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Quote {inr(make.quote)} · Cost {inr(make.cost)}</span>
              <span className={cn("font-semibold tabular-nums", make.marginPct >= targetMargin ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-500")}>
                Make {inr(make.make)} · {make.marginPct.toFixed(1)}%
              </span>
            </div>
          </CardContent>
        </Card>
      ) : view === "materials" ? (
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
        bySubhead.map(({ no, name, rows, subtotal }) => (
          <Card key={name}>
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="text-base">
                <span className="text-muted-foreground font-normal mr-2 tabular-nums">{no}.00</span>{name}
              </CardTitle>
              <span className="text-sm font-medium tabular-nums">{inr(subtotal)}</span>
            </CardHeader>
            <CardContent className="space-y-0">
              {rows.map(({ line: l, no: itemNo }) => {
                const rate = effRate(l);
                return (
                  <div key={l.id} className={cn("grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_4.5rem_3rem_5rem_5.5rem_auto] items-start gap-x-3 gap-y-1 py-2 border-b last:border-0",
                    !l.included && "opacity-40")}>
                    <input type="checkbox" className="mt-1" checked={l.included}
                      onChange={(e) => updateLine(l.id, { included: e.target.checked })} />
                    <div className="min-w-0">
                      <div className="text-[11px] font-mono text-accent-foreground/70 mb-0.5">
                        <span className="text-muted-foreground mr-1">{itemNo}</span>{l.dsr_code ?? "NS · rate to be analysed"}
                      </div>
                      <div className="text-[13px] leading-snug text-foreground/90">{l.description}</div>
                    </div>
                    <Input type="number" className="h-8 hidden sm:block" defaultValue={l.qty}
                      onBlur={(e) => { const v = Number(e.target.value); if (v !== l.qty) updateLine(l.id, { qty: v }); }} />
                    <span className="text-xs text-muted-foreground hidden sm:block pt-2">{l.unit}</span>
                    <Input type="number" className="h-8 hidden sm:block" defaultValue={rate ?? ""} placeholder="rate"
                      title={l.custom_rate != null ? "Your rate (overrides DSR)" : "DSR reference rate — edit to set your rate"}
                      onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== rate) updateLine(l.id, { custom_rate: v }); }} />
                    <span className="text-sm tabular-nums text-right hidden sm:block pt-1.5">
                      {rate != null ? inr(l.qty * rate) : "—"}
                    </span>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => removeLine(l.id)}>
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
