import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generateForDiscipline, disciplineByKey } from "@/lib/disciplines";
import { computeDimensions } from "@/lib/dimensions";
import { explodeMaterials, type Coefficient } from "@/lib/boqExplode";
import { computeCommercials, openDsrQuote, buildBoqCsv, downloadCsv, type QuoteSubHead, type CsvRow } from "@/lib/boqDsrDocument";
import { openIntakeForm } from "@/lib/boqIntakeForm";
import { sanityForCode, countFlagged } from "@/lib/boqSanity";
import { BASIS_META, findCatalogueMatch, isEquipment, parseDrawingSummary, type DrawingBasis, type DrawingItem, type DrawingSummary, type LineDrawingMeta, type QtyBasis } from "@/lib/boqDrawing";
import { BOQ_SPEC, type Spec, type SpecValue, type SpecField } from "@/lib/boqSpec";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Trash2, Wand2, Search, Layers, FileDown, Sheet, Ruler, ClipboardList, Percent, AlertTriangle, Eye, Presentation, ChevronDown, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface DsrItem { id: string; code: string; description: string | null; unit: string | null; rate: number | null; chapter: string | null; }
interface BoqLine {
  id: string; section: string | null; dsr_code: string | null; description: string | null;
  unit: string | null; qty: number; dsr_rate: number | null; custom_rate: number | null;
  cost: number | null;
  basis: string | null; basis_note: string | null;
  drawing: LineDrawingMeta | null;
  included: boolean; source: string; sort: number;
}

/** Drawing provenance appended to the item description in every output. */
const drawingSuffix = (l: { drawing: LineDrawingMeta | null }, opts?: { short?: boolean }): string => {
  const d = l.drawing;
  if (!d) return "";
  const parts = opts?.short
    ? [d.location, d.scope === "equipment" ? "by client" : null]
    : [d.location, d.basis, d.scope === "equipment" ? "Client equipment" : null];
  const kept = parts.filter(Boolean) as string[];
  return kept.length ? ` — ${kept.join(" · ")}` : "";
};
/** The rate in effect: the estimator's case-specific override, else the DSR reference. */
const effRate = (l: BoqLine) => l.custom_rate ?? l.dsr_rate;

interface RoomRow {
  id: string; name: string | null; room_type: string;
  length_ft: number; width_ft: number; height_ft: number; count: number; electrical_points: number;
}
const ROOM_TYPES = ["room", "bedroom", "living", "kitchen", "bathroom", "balcony", "utility", "pooja"];

// The assumptions worth confirming, triaged so the queue reads like a triage,
// not a questionnaire:
//   must    — moves the number most; always asked (keep ≤4)
//   default — pre-filled; shown as a summary line, expand only if wrong
//   defer   — client-owned; keep a provisional value, mark "client will decide"
type ConfirmTier = "must" | "default" | "defer";
const CONFIRM_TIERS: { key: string; tier: ConfirmTier }[] = [
  { key: "quality_tier", tier: "must" },
  { key: "structure", tier: "must" },
  { key: "compound_wall", tier: "must" },
  { key: "windows", tier: "default" },
  { key: "main_door", tier: "default" },
  { key: "cp_tier", tier: "default" },
  { key: "wp_terrace", tier: "default" },
  { key: "living_floor", tier: "defer" },
  { key: "false_ceiling", tier: "defer" },
];
const FIELD_BY_KEY: Record<string, SpecField> = {};
for (const s of BOQ_SPEC) for (const f of s.fields) FIELD_BY_KEY[f.key] = f;

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

// A single reversible change to the estimate — the unit of the session ledger.
// Kept in memory for the meeting (defensible audit persistence is a P1).
interface EstimateChange {
  id: string; seq: number;
  kind: "line" | "assumption" | "add" | "remove" | "commercial";
  label: string; detail?: string;
  totalBefore: number; totalAfter: number; delta: number;
  forward: () => Promise<void>;   // (re-)apply
  backward: () => Promise<void>;  // undo
  at: number;
}

// Scope-first estimate framing so the headline number can never be misread as
// the whole-project cost. A civil-only draft says so, on the same beat.
function scopeLine(discipline: string): string {
  if (discipline === "civil") return "Plumbing & electrical priced separately";
  return "Civil & other trades priced separately";
}
function floorsLabel(floors: number | null | undefined): string | null {
  if (!floors || floors < 1) return null;
  return floors === 1 ? "Ground floor" : `G+${floors - 1}`;
}
const TIER_LABEL: Record<string, string> = { economy: "Basic finish", standard: "Standard finish", premium: "Premium finish" };

// Count the headline number up on change — the frame lands with it, never a
// naked figure. Respects reduced-motion.
function useCountUp(value: number, ms = 450): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduced || value === fromRef.current) { setDisplay(value); fromRef.current = value; return; }
    const from = fromRef.current;
    let raf = 0;
    const tick = (t: number) => {
      if (startRef.current == null) startRef.current = t;
      const p = Math.min(1, (t - startRef.current) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else { fromRef.current = value; startRef.current = null; }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return display;
}

const shortDesc = (l: { dsr_code: string | null; description: string | null }) =>
  (l.description ?? l.dsr_code ?? "Line").slice(0, 30);

// Level-2 "Why?" — the plain-language basis behind a line's quantity.
function tierBasis(spec: Spec): string {
  const struct = spec.structure === "load_bearing" ? "load-bearing" : "RCC-frame";
  const tier = (TIER_LABEL[String(spec.quality_tier ?? "standard")] ?? "standard finish").toLowerCase();
  return `Standard ${struct} assumption at ${tier}. The quantity scales with built-up area — change the quality tier or the quantity to adjust.`;
}

export default function OpsBoqBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [showBrowser, setShowBrowser] = useState(false);
  const [view, setView] = useState<"lines" | "make" | "materials">("lines");
  const [targetMargin, setTargetMargin] = useState(15);
  // Present mode: strip every operator-only element so the screen can be turned
  // to the contractor. Entering is a deliberate act ("Show to client" or the "p"
  // key); leaving needs an explicit Exit / Esc so a stray key can never flip
  // internal figures back in front of the client mid-conversation.
  const [present, setPresent] = useState(false);
  const enterPresent = () => { setView("lines"); setPresent(true); };
  const exitPresent = () => setPresent(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = !!(e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable]");
      if (e.metaKey || e.ctrlKey || inField) return;
      if (e.key === "p") { setView("lines"); setPresent(true); }   // p enters client view only
      else if (e.key === "Escape") setPresent(false);              // explicit exit
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Change ledger (in-memory, per meeting) — every assumption/rate/quantity move
  // is recorded with its rupee delta, so the final number is defensible and any
  // step is reversible. Entries [0,cursor) are applied; [cursor,) is the redo stack.
  const [changes, setChanges] = useState<EstimateChange[]>([]);
  const [cursor, setCursor] = useState(0);
  const [firstTotal, setFirstTotal] = useState<number | null>(null);
  const [showLedger, setShowLedger] = useState(true);
  const [showDefaults, setShowDefaults] = useState(false);
  const seqRef = useRef(0);

  const fetchLinesNow = async (): Promise<BoqLine[]> => {
    const { data } = await supabase.from("boq_line")
      .select("id, section, dsr_code, description, unit, qty, dsr_rate, custom_rate, cost, basis, basis_note, drawing, included, source, sort")
      .eq("boq_id", id).order("sort");
    return (data ?? []) as BoqLine[];
  };
  const fetchSpecNow = async (): Promise<Spec> => {
    const { data } = await supabase.from("boq").select("spec").eq("id", id).single();
    return (data?.spec ?? {}) as Spec;
  };
  const grandOf = (ls: BoqLine[], sp: Spec) => {
    const works = ls.filter((l) => l.included).reduce((s, l) => s + l.qty * (effRate(l) ?? 0), 0);
    const pct = (k: string, d: number) => Number(sp[k] ?? d);
    return computeCommercials(works, {
      costIndexPct: pct("_cost_index_pct", 0), contingencyPct: pct("_contingency_pct", 3),
      overheadPct: pct("_overhead_pct", 15), cessPct: pct("_cess_pct", 1), gstPct: pct("_gst_pct", 18),
    }).grandTotal;
  };
  const setSpecKeys = async (patch: Spec): Promise<Spec> => {
    const newSpec = { ...(await fetchSpecNow()), ...patch };
    await supabase.from("boq").update({ spec: newSpec }).eq("id", id);
    qc.setQueryData(["boq", id], (old: typeof boq | undefined) => (old ? { ...old, spec: newSpec } : old));
    return newSpec;
  };
  // Wrap any mutation so it lands in the ledger with an honest before/after delta.
  const commit = async (meta: { kind: EstimateChange["kind"]; label: string; detail?: string; forward: () => Promise<void>; backward: () => Promise<void> }) => {
    const before = grandOf(await fetchLinesNow(), await fetchSpecNow());
    await meta.forward();
    const after = grandOf(await fetchLinesNow(), await fetchSpecNow());
    const change: EstimateChange = {
      id: crypto.randomUUID(), seq: ++seqRef.current, kind: meta.kind, label: meta.label, detail: meta.detail,
      totalBefore: before, totalAfter: after, delta: after - before, forward: meta.forward, backward: meta.backward, at: Date.now(),
    };
    setChanges((prev) => [...prev.slice(0, cursor), change]);
    setCursor((c) => c + 1);
    setFirstTotal((t) => (t == null ? before : t));
    if (Math.abs(change.delta) >= 1) {
      const up = change.delta > 0;
      toast(`${meta.label}${meta.detail ? " · " + meta.detail : ""}`, { description: `${up ? "+" : "−"}${inr(Math.abs(change.delta))}` });
    }
  };
  const undo = async () => { if (cursor === 0 || busy) return; await changes[cursor - 1].backward(); setCursor(cursor - 1); };
  const redo = async () => { if (cursor >= changes.length || busy) return; await changes[cursor].forward(); setCursor(cursor + 1); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if ((e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable]")) return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });  // rebind each render so undo/redo see fresh cursor/changes

  const { data: boq } = useQuery({
    queryKey: ["boq", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("boq")
        .select("id, name, status, project_id, spec, discipline, contractor_id").eq("id", id).single();
      if (error) throw error;
      return data as { id: string; name: string; status: string; project_id: string | null; spec: Spec; discipline: string; contractor_id: string | null };
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

  const { data: contractor } = useQuery({
    queryKey: ["boq-contractor", boq?.contractor_id],
    enabled: !!boq?.contractor_id,
    queryFn: async () => {
      const { data } = await supabase.from("contractor_profile").select("id, name").eq("id", boq!.contractor_id!).single();
      return data as { id: string; name: string } | null;
    },
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
        .select("id, section, dsr_code, description, unit, qty, dsr_rate, custom_rate, cost, basis, basis_note, drawing, included, source, sort")
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

  const coeffsByCode = useMemo(() => {
    const m = new Map<string, Coefficient[]>();
    for (const c of coeffs) { const a = m.get(c.item_code) ?? []; a.push(c); m.set(c.item_code, a); }
    return m;
  }, [coeffs]);

  const schedule = useMemo(() => explodeMaterials(
    lines.map((l) => ({ dsr_code: l.dsr_code, qty: l.qty, included: l.included })),
    coeffsByCode,
  ), [lines, coeffsByCode]);

  const [expanded, setExpanded] = useState<string | null>(null);
  // Progressive "Why?" — every line opens at Level 1 (a plain sentence) and the
  // operator taps deeper only if asked. Resets whenever a different line opens.
  const [whyLevel, setWhyLevel] = useState(1);
  useEffect(() => { setWhyLevel(1); }, [expanded]);

  const runGenerate = async (useSpec: Spec, opts?: { silent?: boolean }) => {
    if (!boq) return;
    setBusy(true);
    try {
      const generated = generateForDiscipline(boq.discipline ?? "civil", useSpec, {
        area_sqft: project?.area_sqft ?? (Number(useSpec._area_sqft) || null),
        floors: project?.floors ?? (Number(useSpec._floors) || null),
      }, hasRooms ? dims : undefined);
      // Fetch the live DSR rows for exactly the codes we need (not a capped
      // load-all), so every generated line resolves its description/unit/rate.
      const codes = [...new Set(generated.map((g) => g.code).filter(Boolean))] as string[];
      const { data: dsrRows, error: dsrErr } = await supabase.from("dsr_item")
        .select("code, description, unit, rate, chapter").in("code", codes);
      if (dsrErr) throw dsrErr;
      const byDsrCode = new Map<string, { code: string; description: string | null; unit: string | null; rate: number | null; chapter: string | null }>();
      for (const r of dsrRows ?? []) byDsrCode.set(r.code, r);
      // Regenerating changes QUANTITIES (what the spec drives) but must preserve
      // the operator's own overrides — their rate, their cost, and any line they
      // de-selected. Snapshot those (keyed by code + sub-head) before we delete,
      // and re-apply them to the freshly generated rows. Without this, every
      // "Confirm" silently wiped the estimator's rates.
      const ovKey = (code: string | null, section: string | null, desc: string | null) => `${code ?? ""}|${section ?? ""}|${desc ?? ""}`;
      const { data: prevAuto } = await supabase.from("boq_line")
        .select("dsr_code, section, description, custom_rate, cost, included").eq("boq_id", id).eq("source", "auto");
      const overrides = new Map<string, { custom_rate: number | null; cost: number | null; included: boolean }>();
      for (const p of (prevAuto ?? []) as { dsr_code: string | null; section: string | null; description: string | null; custom_rate: number | null; cost: number | null; included: boolean }[]) {
        overrides.set(ovKey(p.dsr_code, p.section, p.description), { custom_rate: p.custom_rate, cost: p.cost, included: p.included });
      }
      // Regenerate auto lines; keep anything the user added by hand.
      await supabase.from("boq_line").delete().eq("boq_id", id).eq("source", "auto");
      const rows = generated.map((g, i) => {
        const dsr = byDsrCode.get(g.code);   // exact code lookup
        // section holds the DSR sub-head (type of work); the construction
        // stage is derived from the code at render/export time.
        const section = dsr?.chapter ?? g.section;
        const desc = dsr?.description ?? g.label;
        const ov = overrides.get(ovKey(g.code, section, desc));
        return {
          boq_id: id, section, dsr_code: g.code,
          description: desc,
          unit: dsr?.unit ?? g.unit, qty: g.qty, dsr_rate: dsr?.rate ?? null,
          custom_rate: ov?.custom_rate ?? null,
          cost: ov?.cost ?? null,
          basis: g.basis ?? null, basis_note: g.note ?? null,
          drawing: g.drawing ?? null,
          included: ov?.included ?? g.included ?? true,   // client equipment defaults out; operator can include
          source: "auto", sort: i,
        };
      });
      const { error } = await supabase.from("boq_line").insert(rows);
      if (error) throw error;
      if (!opts?.silent) toast.success(`Estimate ready — ${rows.length} items`);
      refetchLines();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  };
  const generate = () => runGenerate(boq?.spec ?? {});

  // Confirm queue: change one assumption and re-draft from it (the contractor
  // reacts to a guess instead of filling a form). Recorded in the ledger with the
  // net rupee impact, and reversible.
  const confirmChange = async (key: string, value: SpecValue) => {
    if (!boq) return;
    const prev = (boq.spec ?? {})[key];
    const f = FIELD_BY_KEY[key];
    const optLabel = (v: SpecValue) =>
      f?.type === "toggle" ? (v ? "Yes" : "No") : (f?.options?.find((o) => o.value === v)?.label ?? String(v ?? "—"));
    await commit({
      kind: "assumption", label: f?.label ?? key, detail: `${optLabel(prev)} → ${optLabel(value)}`,
      forward: async () => { const ns = await setSpecKeys({ [key]: value }); await runGenerate(ns, { silent: true }); },
      backward: async () => { const ns = await setSpecKeys({ [key]: prev }); await runGenerate(ns, { silent: true }); },
    });
  };

  // Defer a client-owned decision: keep the provisional value (so the total still
  // holds) but mark it "client will decide". Stored as spec._deferred (an array in
  // the jsonb — no schema change). No regenerate: the value hasn't changed.
  const deferredKeys = (((boq?.spec as Record<string, unknown> | undefined)?._deferred as string[] | undefined) ?? []);
  const toggleDefer = async (key: string) => {
    if (!boq) return;
    const cur = deferredKeys;
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    const newSpec = { ...(boq.spec ?? {}), _deferred: next } as unknown as Spec;
    await supabase.from("boq").update({ spec: newSpec }).eq("id", id);
    qc.setQueryData(["boq", id], (old: typeof boq | undefined) => (old ? { ...old, spec: newSpec } : old));
  };

  // Drawing summary: the operator's measured/counted quantities from the drawings.
  // Saved on spec._drawing; regeneration lets it override the generic heuristics.
  const drawingItems = (((boq?.spec as Record<string, unknown> | undefined)?._drawing as DrawingSummary | undefined)?.items ?? []);
  const [showDrawing, setShowDrawing] = useState(false);
  const drawingRef = useRef<HTMLDivElement>(null);
  // The card renders below a tall stack of cards, so scroll it into view when it
  // opens — otherwise the button looks like it does nothing.
  useEffect(() => {
    if (showDrawing) drawingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showDrawing]);
  const [drawDraft, setDrawDraft] = useState<DrawingItem[] | null>(null);
  const drawRows = drawDraft ?? drawingItems;
  const editDraw = (i: number, patch: Partial<DrawingItem>) =>
    setDrawDraft((d) => (d ?? drawingItems).map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addDraw = () => setDrawDraft((d) => [...(d ?? drawingItems), { match: "", qty: 0, unit: "nos", basis: "Counted", note: "" }]);
  const delDraw = (i: number) => setDrawDraft((d) => (d ?? drawingItems).filter((_, idx) => idx !== i));
  const [pasteText, setPasteText] = useState("");
  const parsePaste = () => {
    const parsed = parseDrawingSummary(pasteText);
    if (!parsed.length) { toast.error("Couldn't find any quantities in that text"); return; }
    setDrawDraft((d) => [...(d ?? drawingItems).filter((r) => r.match.trim()), ...parsed]);
    setPasteText("");
    toast.success(`Parsed ${parsed.length} item${parsed.length === 1 ? "" : "s"} — review the match & quantity, then Apply`);
  };
  const saveDrawing = async () => {
    if (!boq) return;
    const prev = ((boq.spec as Record<string, unknown>)?._drawing ?? null) as unknown;
    const clean = drawRows.filter((r) => r.match.trim() && Number(r.qty) > 0)
      .map((r) => ({ match: r.match.trim(), qty: Number(r.qty), unit: r.unit?.trim() || undefined, basis: r.basis ?? "Counted", equipment: r.equipment, note: r.note?.trim() || undefined }));
    await commit({
      kind: "assumption", label: "Drawing measurements", detail: `${clean.length} applied`,
      forward: async () => { const ns = await setSpecKeys({ _drawing: { items: clean } } as unknown as Spec); await runGenerate(ns, { silent: true }); },
      backward: async () => { const ns = await setSpecKeys({ _drawing: prev } as unknown as Spec); await runGenerate(ns, { silent: true }); },
    });
    setDrawDraft(null);
    toast.success("Drawing measurements applied");
  };

  // Output before input: a brand-new BOQ generates its draft on arrival, so you
  // land on a full BOQ to react to — never an empty screen.
  const autoGen = useRef(false);
  useEffect(() => {
    if (autoGen.current) return;
    if (!boq || linesLoading || busy || lines.length > 0) return;
    autoGen.current = true;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boq, linesLoading, lines.length, busy]);

  const addFromCatalog = async (it: DsrItem) => {
    let newId: string | null = null;
    await commit({
      kind: "add", label: `Added ${it.code ?? shortDesc({ dsr_code: it.code, description: it.description })}`,
      forward: async () => {
        const { data, error } = await supabase.from("boq_line").insert({
          boq_id: id, section: it.chapter ?? "Other", dsr_code: it.code,
          description: it.description, unit: it.unit, qty: 1, dsr_rate: it.rate, source: "manual", sort: 999,
        }).select("id").single();
        if (error) { toast.error(error.message); return; }
        newId = (data as { id: string }).id;
        refetchLines();
      },
      backward: async () => { if (newId) { await supabase.from("boq_line").delete().eq("id", newId); refetchLines(); } },
    });
  };

  const applyLinePatch = async (lineId: string, patch: Partial<BoqLine>) => {
    const { error } = await supabase.from("boq_line").update(patch).eq("id", lineId);
    if (error) toast.error(error.message); else refetchLines();
  };
  const updateLine = async (lineId: string, patch: Partial<BoqLine>) => {
    const line = lines.find((l) => l.id === lineId);
    if (!line) { await applyLinePatch(lineId, patch); return; }
    const prev: Partial<BoqLine> = {};
    (Object.keys(patch) as (keyof BoqLine)[]).forEach((k) => { (prev as Record<string, unknown>)[k] = line[k]; });
    let detail: string | undefined;
    if ("custom_rate" in patch) { const r = effRate(line); detail = `rate ${r != null ? inr(r) : "—"} → ${patch.custom_rate != null ? inr(patch.custom_rate) : "—"}`; }
    else if ("qty" in patch) detail = `${line.qty} → ${patch.qty} ${line.unit ?? ""}`.trim();
    else if ("cost" in patch) detail = `cost ${patch.cost != null ? inr(patch.cost) : "—"}`;
    else if ("included" in patch) detail = patch.included ? "included" : "removed from total";
    await commit({
      kind: "line", label: shortDesc(line), detail,
      forward: async () => { await applyLinePatch(lineId, patch); },
      backward: async () => { await applyLinePatch(lineId, prev); },
    });
  };
  const removeLine = async (lineId: string) => {
    const line = lines.find((l) => l.id === lineId);
    if (!line) { await supabase.from("boq_line").delete().eq("id", lineId); refetchLines(); return; }
    await commit({
      kind: "remove", label: `Removed ${line.dsr_code ?? shortDesc(line)}`,
      forward: async () => { await supabase.from("boq_line").delete().eq("id", lineId); refetchLines(); },
      backward: async () => {
        await supabase.from("boq_line").insert({
          id: line.id, boq_id: id, section: line.section, dsr_code: line.dsr_code, description: line.description,
          unit: line.unit, qty: line.qty, dsr_rate: line.dsr_rate, custom_rate: line.custom_rate,
          cost: line.cost, included: line.included, source: line.source, sort: line.sort,
        });
        refetchLines();
      },
    });
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

  // Built-up area drives the sanity bands (project first, else the spec anchor).
  const builtUp = project?.area_sqft ?? (Number((boq?.spec as Spec)?._area_sqft) || 0);
  const flaggedCount = useMemo(() => countFlagged(lines, builtUp), [lines, builtUp]);

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
  const displayGrand = useCountUp(commercials.grandTotal);
  const netDelta = firstTotal != null ? commercials.grandTotal - firstTotal : 0;

  const saveCommercials = async (patch: Record<string, number | string>) => {
    if (!boq) return;
    const keys = Object.keys(patch);
    const isPct = keys.some((k) => k.endsWith("_pct"));
    // Letterhead / tagline: no rupee impact — save quietly, don't clutter the ledger.
    if (!isPct) { await setSpecKeys(patch as Spec); qc.invalidateQueries({ queryKey: ["boq", id] }); return; }
    const prev: Record<string, SpecValue> = {};
    keys.forEach((k) => { prev[k] = (boq.spec ?? {})[k]; });
    const LABELS: Record<string, string> = { _cost_index_pct: "Cost index", _contingency_pct: "Contingency", _overhead_pct: "Overhead", _cess_pct: "Cess", _gst_pct: "GST" };
    await commit({
      kind: "commercial", label: LABELS[keys[0]] ?? "Commercials", detail: `${prev[keys[0]] ?? 0}% → ${patch[keys[0]]}%`,
      forward: async () => { await setSpecKeys(patch as Spec); qc.invalidateQueries({ queryKey: ["boq", id] }); },
      backward: async () => { await setSpecKeys(prev as Spec); qc.invalidateQueries({ queryKey: ["boq", id] }); },
    });
  };

  // Contractor memory: save this BOQ's choices as the contractor's usual (explicit,
  // never silent — the operator decides when a preference is worth remembering).
  const saveDefaults = async () => {
    if (!boq?.contractor_id) return;
    const { error } = await supabase.from("contractor_profile")
      .update({ spec: boq.spec, updated_at: new Date().toISOString() }).eq("id", boq.contractor_id);
    if (error) toast.error(error.message);
    else toast.success(`Saved ${contractor?.name ?? "contractor"}'s usual choices`);
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
        return { no, code: line.dsr_code, spec: (line.description ?? "") + drawingSuffix(line), qty: line.qty, unit: line.unit ?? "", rate, amount: rate != null ? line.qty * rate : null };
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
        spec: (line.description ?? "") + drawingSuffix(line), unit: line.unit ?? "", qty: line.qty, rate: effRate(line),
      })));
    if (!rows.length) return toast.error("Nothing to export yet");
    downloadCsv(`${boq!.name.replace(/[^\w]+/g, "_")}_BOQ.csv`, buildBoqCsv(rows, { boqName: boq!.name, project: project?.name, generatedOn: gen() }));
  };

  if (!boq) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className={cn("max-w-5xl mx-auto p-4 md:p-6 space-y-4", present && "pt-16")}>
      {present && (
        <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-2 bg-accent text-accent-foreground px-4 py-2 text-sm font-medium shadow-md">
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-current animate-pulse" />CLIENT VIEW — internal figures hidden
          </span>
          <Button size="sm" variant="secondary" onClick={exitPresent}>Exit client view</Button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">{boq.name}</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <Badge>{disciplineByKey(boq.discipline).name}</Badge>
            {contractor && <Badge variant="secondary">{contractor.name}</Badge>}
            {project?.name ?? "Standalone"} · {lines.length} lines · <Badge variant="outline">{boq.status}</Badge>
          </p>
          {!present && (
            <p className="text-xs mt-0.5 flex items-center gap-2 flex-wrap">
              {hasRooms
                ? <span className="text-emerald-600 dark:text-emerald-400">Quantities from {rooms.length} rooms · {dims.floorAreaSqft.toLocaleString("en-IN")} sqft measured</span>
                : <span className="text-amber-600 dark:text-amber-500">Quantities estimated from built-up area — add rooms for accuracy</span>}
              {flaggedCount > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
                  <AlertTriangle className="h-3 w-3" />{flaggedCount} to review
                </span>
              )}
              {lines.some((l) => l.basis === "DRAWING_INPUT") && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  {lines.filter((l) => l.basis === "DRAWING_INPUT").length} from drawing
                </span>
              )}
            </p>
          )}
        </div>
        <Button variant={present ? "default" : "outline"} size="sm" onClick={() => (present ? exitPresent() : enterPresent())}
          title="Show a clean, client-facing view (or press P; Esc to exit)">
          {present ? <><Eye className="h-4 w-4 mr-2" />Exit client view</> : <><Presentation className="h-4 w-4 mr-2" />Show to client</>}
        </Button>
        {/* Scope-first estimate: the headline number can never read as the whole
            project cost — its discipline and exclusions sit right on it. */}
        <div className="text-right min-w-[11rem]">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {disciplineByKey(boq.discipline).name} works estimate
          </div>
          <div className="text-2xl md:text-3xl font-semibold tabular-nums leading-tight">{inr(displayGrand)}</div>
          {(() => {
            const fl = floorsLabel(project?.floors ?? (Number((boq.spec as Spec)?._floors) || null));
            const tier = TIER_LABEL[String((boq.spec as Spec)?.quality_tier ?? "standard")] ?? null;
            const bits = [builtUp ? `${builtUp.toLocaleString("en-IN")} sqft` : null, fl, tier].filter(Boolean);
            return bits.length ? <div className="text-[11px] text-muted-foreground">{bits.join(" · ")}</div> : null;
          })()}
          <div className="text-[11px] text-amber-600 dark:text-amber-500">{scopeLine(boq.discipline)}</div>
          {!present && changes.length > 0 && firstTotal != null && Math.abs(netDelta) >= 1 && (
            <div className={cn("text-[11px] font-medium", netDelta > 0 ? "text-amber-600 dark:text-amber-500" : "text-emerald-600 dark:text-emerald-400")}>
              {netDelta > 0 ? "+" : "−"}{inr(Math.abs(netDelta))} since starting
            </div>
          )}
          {!present && make.hasCost && (
            <div className={cn("text-[11px] font-medium", make.marginPct >= targetMargin ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-500")}>
              make {inr(make.make)} · {make.marginPct.toFixed(1)}%
            </div>
          )}
        </div>
      </div>

      {present && deferredKeys.length > 0 && (
        <p className="text-xs text-muted-foreground border-l-2 border-accent pl-2">
          Client to confirm: {deferredKeys.map((k) => FIELD_BY_KEY[k]?.label).filter(Boolean).join(", ")} — provisional rates shown.
        </p>
      )}

      {!present && (<>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={generate} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
          {lines.some((l) => l.source === "auto") ? "Rebuild estimate" : "Prepare estimate"}
        </Button>
        <Button variant="outline" onClick={() => setShowBrowser((s) => !s)}>
          <Plus className="h-4 w-4 mr-2" />Add item
        </Button>
        {boq.project_id && (
          <Button variant={hasRooms ? "outline" : "default"} onClick={() => setShowRooms((s) => !s)}>
            <Ruler className="h-4 w-4 mr-2" />Rooms{rooms.length ? ` (${rooms.length})` : ""}
          </Button>
        )}
        <Button variant={showDrawing || drawingItems.length ? "default" : "outline"} onClick={() => setShowDrawing((s) => !s)}
          title="Enter measured quantities read off the drawings — they override the estimates">
          <Ruler className="h-4 w-4 mr-2" />{showDrawing ? "Hide drawing" : "Drawing"}{!showDrawing && drawingItems.length ? ` (${drawingItems.length})` : ""}
        </Button>
        <Button variant="outline" onClick={() => printIntake(false)} title="Printable project details form — pre-filled where known, blank lines to complete by hand">
          <ClipboardList className="h-4 w-4 mr-2" />Intake form
        </Button>
        {boq.contractor_id && (
          <Button variant="outline" onClick={saveDefaults} title="Remember these choices for next time">
            <UserCheck className="h-4 w-4 mr-2" />Save {contractor?.name ?? "contractor"}'s usual
          </Button>
        )}
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

      {changes.length > 0 && (
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between gap-2">
            <button className="text-left min-w-0" onClick={() => setShowLedger((s) => !s)}>
              <CardTitle className="text-base flex items-center gap-2">
                <ChevronDown className={cn("h-4 w-4 transition-transform", !showLedger && "-rotate-90")} />
                Changes this session
              </CardTitle>
              <p className="text-xs text-muted-foreground ml-6">
                {cursor} change{cursor === 1 ? "" : "s"}
                {firstTotal != null && Math.abs(netDelta) >= 1 ? ` · net ${netDelta > 0 ? "+" : "−"}${inr(Math.abs(netDelta))}` : ""}
              </p>
            </button>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={undo} disabled={cursor === 0 || busy}>Undo</Button>
              <Button size="sm" variant="outline" onClick={redo} disabled={cursor >= changes.length || busy}>Redo</Button>
            </div>
          </CardHeader>
          {showLedger && (
            <CardContent className="space-y-0.5">
              {changes.map((c, i) => {
                const undone = i >= cursor;
                return (
                  <div key={c.id} className={cn("grid grid-cols-[1.5rem_1fr_auto] items-baseline gap-2 text-sm py-0.5", undone && "opacity-40")}>
                    <span className="text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                    <span className="min-w-0">
                      <span className="font-medium">{c.label}</span>
                      {c.detail ? <span className="text-muted-foreground"> · {c.detail}</span> : null}
                    </span>
                    <span className={cn("tabular-nums text-right", c.delta > 0 ? "text-amber-600 dark:text-amber-500" : c.delta < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                      {c.delta === 0 ? "—" : `${c.delta > 0 ? "+" : "−"}${inr(Math.abs(c.delta))}`}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          )}
        </Card>
      )}

      {boq.discipline === "civil" && lines.length > 0 && (() => {
        // A control for one assumption — the same Select/Switch reused across tiers.
        const control = (k: string) => {
          const f = FIELD_BY_KEY[k];
          if (!f) return null;
          const v = (boq.spec as Spec)?.[k];
          return f.type === "toggle" ? (
            <Switch checked={!!v} onCheckedChange={(c) => confirmChange(k, c)} />
          ) : (
            <Select value={(v as string) ?? undefined} onValueChange={(val) => confirmChange(k, val)}>
              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {f.options!.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          );
        };
        const optLabel = (k: string) => {
          const f = FIELD_BY_KEY[k]; const v = (boq.spec as Spec)?.[k];
          if (!f) return "";
          return f.type === "toggle" ? (v ? "Yes" : "No") : (f.options?.find((o) => o.value === v)?.label ?? "—");
        };
        const inTier = (t: ConfirmTier) => CONFIRM_TIERS.filter((c) => c.tier === t && FIELD_BY_KEY[c.key]);
        const musts = inTier("must"), defaults = inTier("default"), defers = inTier("defer");
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Confirm with the contractor</CardTitle>
              <p className="text-xs text-muted-foreground">The few things that move the number — the rest we assumed.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* MUST — always visible, prominent */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {musts.map(({ key: k }) => (
                  <div key={k} className="flex items-center justify-between gap-2 rounded-md border border-accent/60 bg-accent/5 px-3 py-1.5">
                    <span className="text-sm font-medium">{FIELD_BY_KEY[k].label}</span>
                    {control(k)}
                  </div>
                ))}
              </div>

              {/* DEFAULT — collapsed to a summary line; expand only if wrong */}
              {defaults.length > 0 && (
                <div className="rounded-md border">
                  <button className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left"
                    onClick={() => setShowDefaults((s) => !s)}>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">We assumed — tap to change</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                      <span className="truncate">{defaults.map(({ key: k }) => optLabel(k)).join(" · ")}</span>
                      <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", showDefaults && "rotate-180")} />
                    </span>
                  </button>
                  {showDefaults && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-3 pb-2">
                      {defaults.map(({ key: k }) => (
                        <div key={k} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
                          <span className="text-sm">{FIELD_BY_KEY[k].label}</span>
                          {control(k)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* DEFER — client-owned; provisional value still totals */}
              {defers.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Client will decide later</div>
                  {defers.map(({ key: k }) => {
                    const isDef = deferredKeys.includes(k);
                    return (
                      <div key={k} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm">{FIELD_BY_KEY[k].label}</span>
                          {isDef && <Badge variant="outline" className="text-[10px]">provisional: {optLabel(k)}</Badge>}
                        </div>
                        <div className="flex items-center gap-2">
                          {!isDef && control(k)}
                          <Button size="sm" variant={isDef ? "secondary" : "ghost"} className="h-8"
                            onClick={() => toggleDefer(k)}
                            title={isDef ? "Decide now instead" : "Mark as client's decision — keeps a provisional rate"}>
                            {isDef ? "Client deciding" : "Client will decide"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

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
      </>)}

      {!present && showDrawing && (
        <Card ref={drawingRef} className="ring-2 ring-accent/40 scroll-mt-4">
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Drawing measurements</CardTitle>
              <p className="text-xs text-muted-foreground">
                Quantities you measured or counted on the drawings. Each overrides the estimate for the matching
                item and is marked drawing-sourced. Anything left out stays an estimate.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={addDraw}><Plus className="h-4 w-4 mr-1" />Add</Button>
              <Button size="sm" onClick={saveDrawing} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Apply
              </Button>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <div className="mb-3 space-y-1.5">
              <textarea
                className="w-full min-h-[92px] rounded-md border bg-background px-3 py-2 text-sm"
                placeholder={"Paste a drawing summary (e.g. from ChatGPT)…\n\nLiving room: 8 × 6A sockets, 2 × 16A sockets, 1 × TV point\n4M switchboards: 6 nos\nConduit: 185 m"}
                value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={parsePaste} disabled={!pasteText.trim()}>Parse into rows</Button>
                <span className="text-[11px] text-muted-foreground">
                  Turns the summary into editable rows below — same item summed across rooms. Review, then Apply.
                </span>
              </div>
            </div>
            <datalist id="boq-line-match">
              {lines.map((l) => (
                <option key={l.id} value={l.dsr_code ?? l.description ?? ""}>
                  {l.dsr_code ? `${l.dsr_code} — ` : ""}{l.description}
                </option>
              ))}
            </datalist>
            {drawRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3 text-center">
                No measurements yet — Add a row, name the requirement (a DSR code, or words like "16A socket"), enter the quantity.
              </p>
            ) : (
              <table className="w-full text-sm min-w-[820px]">
                <thead><tr className="text-xs text-muted-foreground text-left">
                  <th className="py-1 font-medium">Requirement (DSR code or words)</th>
                  <th className="font-medium w-16">Qty</th>
                  <th className="font-medium w-16">Unit</th>
                  <th className="font-medium w-28">Basis</th>
                  <th className="font-medium">Location / Note</th>
                  <th className="font-medium w-28">Type</th>
                  <th className="font-medium w-40">Catalogue</th><th></th>
                </tr></thead>
                <tbody>
                  {drawRows.map((r, i) => {
                    const valid = r.match.trim() && Number(r.qty) > 0;
                    const equip = valid && (r.equipment ?? isEquipment(r.match));
                    const cat = valid && !equip
                      ? findCatalogueMatch(r.match, lines.map((l) => ({ code: l.dsr_code, label: l.description ?? "" })))
                      : null;
                    return (
                    <tr key={i} className="border-t">
                      <td className="py-1 pr-2">
                        <Input list="boq-line-match" className="h-8" value={r.match} placeholder='e.g. 16A socket · TV point · 5.22.6'
                          onChange={(e) => editDraw(i, { match: e.target.value })} />
                      </td>
                      <td className="pr-1"><Input className="h-8" type="number" value={r.qty || ""}
                        onChange={(e) => editDraw(i, { qty: Number(e.target.value) })} /></td>
                      <td className="pr-1"><Input className="h-8" value={r.unit ?? ""} placeholder="nos"
                        onChange={(e) => editDraw(i, { unit: e.target.value })} /></td>
                      <td className="pr-2">
                        <select className="h-8 rounded border bg-background px-1 text-sm" value={r.basis ?? "Counted"}
                          onChange={(e) => editDraw(i, { basis: e.target.value as DrawingBasis })}>
                          {(["Counted", "Measured", "Derived", "Assumed"] as const).map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </td>
                      <td className="pr-2"><Input className="h-8" value={r.note ?? ""} placeholder="e.g. Living / TV area"
                        onChange={(e) => editDraw(i, { note: e.target.value })} /></td>
                      <td className="pr-2">
                        <select className="h-8 rounded border bg-background px-1 text-sm" value={equip ? "equipment" : "works"}
                          title="Works = contractor scope (priced) · Equipment = client-provided (not priced by default)"
                          onChange={(e) => editDraw(i, { equipment: e.target.value === "equipment" })}>
                          <option value="works">Works</option>
                          <option value="equipment">Equipment</option>
                        </select>
                      </td>
                      <td className="pr-2 text-xs">
                        {!valid ? <span className="text-muted-foreground">—</span>
                          : equip ? <span className="text-amber-600 dark:text-amber-500" title="Client equipment — added as a line but not priced in works by default">client equipment</span>
                          : cat ? <span className="text-emerald-600 dark:text-emerald-400" title={cat.code ? `${cat.code} — ${cat.label}` : cat.label}>→ links to a catalogue item</span>
                          : <span className="text-amber-600 dark:text-amber-500">＋ new item (no match)</span>}
                      </td>
                      <td><Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => delDraw(i)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" /></Button></td>
                    </tr>
                  );})}
                </tbody>
              </table>
            )}
            <p className="text-[11px] text-muted-foreground mt-2">
              Paste plain or as a list — locations are kept and the same item is summed across rooms. Every requirement becomes a
              BOQ line: <span className="text-emerald-600 dark:text-emerald-400">links to a catalogue item</span> → priced from the DSR;
              <span className="text-amber-600 dark:text-amber-500"> new item (no match)</span> → a valid line you price yourself;
              <span className="text-amber-600 dark:text-amber-500"> client equipment</span> (the TV itself, a projector) → added but not priced in works.
              Basis is Counted / Measured / Derived / Assumed. Room-by-room dimensions go in <b>Rooms</b>.
            </p>
          </CardContent>
        </Card>
      )}

      {!present && showRooms && boq.project_id && (
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

      {!present && showBrowser && (
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

      {!present && view === "make" ? (
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
      ) : !present && view === "materials" ? (
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
          No items yet — Prepare estimate, or add an item.
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
                if (present && !l.included) return null;
                const rate = effRate(l);
                const qtyTxt = l.qty.toLocaleString("en-IN", { maximumFractionDigits: 2 });
                const flag = sanityForCode(l.dsr_code, l.qty, builtUp);
                const flagged = !present && (flag.level === "low" || flag.level === "high");
                // Present: a clean, contractor-facing row — item · qty · unit · rate · amount.
                if (present) {
                  return (
                    <div key={l.id} className="grid grid-cols-[1fr_4.5rem_3rem_5.5rem_6rem] items-start gap-x-3 py-1.5 border-b last:border-0">
                      <div className="min-w-0">
                        <span className="text-[11px] font-mono text-muted-foreground mr-1">{itemNo}</span>
                        <span className="text-[13px] leading-snug text-foreground/90">{l.description}<span className="text-muted-foreground">{drawingSuffix(l, { short: true })}</span></span>
                      </div>
                      <span className="text-sm tabular-nums text-right">{qtyTxt}</span>
                      <span className="text-xs text-muted-foreground">{l.unit}</span>
                      <span className="text-sm tabular-nums text-right">{rate != null ? inr(rate) : "—"}</span>
                      <span className="text-sm tabular-nums text-right font-medium">{rate != null ? inr(l.qty * rate) : "—"}</span>
                    </div>
                  );
                }
                const isExp = expanded === l.id;
                const breakdown = l.dsr_code ? (coeffsByCode.get(l.dsr_code) ?? []) : [];
                return (
                  <div key={l.id} className={cn("border-b last:border-0", !l.included && "opacity-40")}>
                    <div className="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_4.5rem_3rem_5rem_5.5rem_auto] items-start gap-x-3 gap-y-1 py-2">
                      <input type="checkbox" className="mt-1" checked={l.included}
                        onChange={(e) => updateLine(l.id, { included: e.target.checked })} />
                      <div className="min-w-0 cursor-pointer" onClick={() => setExpanded(isExp ? null : l.id)} title="Show how this line is derived">
                        <div className="text-[11px] font-mono text-accent-foreground/70 mb-0.5 flex items-center gap-1">
                          <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", isExp && "rotate-180")} />
                          <span className="text-muted-foreground">{itemNo}</span>{l.dsr_code ?? "Priced separately"}
                          {l.basis === "DRAWING_INPUT" && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-sans" title={l.basis_note ?? "From the drawing"}>drawing</span>
                          )}
                          {flagged && (
                            <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-500 font-sans" title={flag.message ?? ""}>
                              <AlertTriangle className="h-3 w-3" />{flag.level}
                            </span>
                          )}
                        </div>
                        <div className="text-[13px] leading-snug text-foreground/90">{l.description}<span className="text-muted-foreground">{drawingSuffix(l)}</span></div>
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
                    {isExp && (() => {
                      const r = effRate(l);
                      const amount = r != null ? inr(l.qty * r) : "—";
                      const coef = builtUp > 0 ? l.qty / builtUp : null;
                      const maxWhy = l.dsr_code && breakdown.length > 0 ? 4 : 3;
                      const nextLabel = whyLevel === 1 ? "How is this figured?" : whyLevel === 2 ? "Show the source" : "Full breakdown";
                      return (
                        <div className="ml-6 mb-2 rounded-md bg-muted/40 border p-3 text-xs space-y-2">
                          {/* Level 1 — one plain sentence, no jargon */}
                          <div className="text-[13px] text-foreground">
                            {coef != null && r != null ? (
                              <>{coef.toFixed(coef < 1 ? 3 : 2)} {l.unit}/sqft × {builtUp.toLocaleString("en-IN")} sqft × {inr(r)} = <b>{amount}</b></>
                            ) : (
                              <>{l.qty.toLocaleString("en-IN", { maximumFractionDigits: 2 })} {l.unit} × {r != null ? inr(r) : "—"} = <b>{amount}</b></>
                            )}
                            {l.custom_rate != null && <span className="text-emerald-600 dark:text-emerald-400"> (your rate)</span>}
                          </div>
                          {flag.message && <div className="text-amber-600 dark:text-amber-500">{flag.message}</div>}

                          {/* Level 2 — basis */}
                          {whyLevel >= 2 && (
                            <div className="text-muted-foreground border-t pt-2">{tierBasis(boq.spec as Spec)}</div>
                          )}

                          {/* Level 3 — provenance: quantity basis and rate source kept distinct */}
                          {whyLevel >= 3 && (
                            <div className="border-t pt-2 space-y-1">
                              {(() => {
                                const bm = l.basis ? BASIS_META[l.basis as QtyBasis] : null;
                                const showCode = l.dsr_code && l.basis !== "HEURISTIC";
                                return (
                                  <div>
                                    <span className="text-muted-foreground">Quantity basis: </span>
                                    {bm ? bm.label : (l.dsr_code ? "DSR / AOR methodology" : "Estimated (non-schedule item)")}
                                    {showCode && <span className="font-mono"> — {l.dsr_code}</span>}
                                  </div>
                                );
                              })()}
                              {l.drawing && (
                                <div className="text-muted-foreground">
                                  Source: Drawing summary · {[l.drawing.basis, l.drawing.location, l.drawing.scope === "equipment" ? "Client equipment (excluded)" : "Works"].filter(Boolean).join(" · ")}
                                </div>
                              )}
                              {!l.drawing && l.basis_note && <div className="text-muted-foreground">{l.basis_note}</div>}
                              <div>
                                <span className="text-muted-foreground">Rate: </span>
                                {!l.dsr_code ? (
                                  l.custom_rate != null
                                    ? <>Your rate <b>{inr(l.custom_rate)}</b> · <span className="text-amber-600 dark:text-amber-500">no catalogue match</span></>
                                    : <span className="text-amber-600 dark:text-amber-500">No catalogue match — set your rate</span>
                                ) : l.custom_rate != null ? (
                                  <>Your rate <b>{inr(l.custom_rate)}</b>{l.dsr_rate != null && <span className="text-muted-foreground"> · DSR reference {inr(l.dsr_rate)}</span>}</>
                                ) : (
                                  <>DSR reference rate <b>{l.dsr_rate != null ? inr(l.dsr_rate) : "—"}</b></>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Level 4 — full material + labour analysis */}
                          {whyLevel >= 4 && breakdown.length > 0 && (
                            <div className="border-t pt-2">
                              <div className="text-muted-foreground mb-1">Consumes (per AOR × {l.qty.toLocaleString("en-IN", { maximumFractionDigits: 2 })} {l.unit}):</div>
                              <div className="grid grid-cols-[1fr_5rem_3rem] gap-x-3 gap-y-0.5">
                                {breakdown.map((c, ci) => (
                                  <div key={ci} className="contents">
                                    <span className="truncate">{c.resource}</span>
                                    <span className="text-right tabular-nums">{(c.qty * l.qty).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                                    <span className="text-muted-foreground">{c.unit}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="pt-1">
                            {whyLevel < maxWhy ? (
                              <button className="text-accent-foreground/80 underline underline-offset-2"
                                onClick={(e) => { e.stopPropagation(); setWhyLevel((w) => Math.min(maxWhy, w + 1)); }}>
                                {nextLabel}
                              </button>
                            ) : (
                              <button className="text-muted-foreground underline underline-offset-2"
                                onClick={(e) => { e.stopPropagation(); setWhyLevel(1); }}>Collapse</button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
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
