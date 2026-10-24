// WORKBENCH PREVIEW — the BOQ's commercials (the abstract every export
// prints): the percentages and the letterhead the BOQ builder's "Advanced
// settings" edit, here with the same spec keys, defaults and guarded writer
// (lib/app/commercials, lib/boqSpecWrite). What is shown is always the
// persisted spec, re-read after every attempt — never the typed value. Each
// saved change is a step in the BOQ's undo history (components/app/undoHistory),
// undone only while the saved value is still what it set.
import { useId, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import type { Spec } from "@/lib/boqSpec";
import { writeBoqSpecKeys } from "@/lib/boqSpecWrite";
import { commercialsFor, includedDsrTotal, includedTotal } from "@/lib/boqLiveExport";
import { COMMERCIAL_FIELDS, commercialValue, describeSpecChange, parsePercent, undoSpecChange, type CommercialKey } from "@/lib/app/commercials";
import { popUndo, pushUndo, refuseNewest, useSessionUndoHistory } from "./undoHistory";
import { Button } from "@/components/ui/button";
import { Undo2 } from "lucide-react";
import type { AppBoqLine } from "@/lib/app/boqLines";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

function PercentField({ label, value, isDefault, onSave }: {
  label: string; value: number; isDefault: boolean; onSave: (v: number) => Promise<void>;
}) {
  const id = useId(), errId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = async () => {
    if (draft == null) return;
    const r = parsePercent(draft);
    if ("error" in r) { setError(r.error); return; }
    setError(null);
    if (r.value !== value || isDefault) await onSave(r.value);
    setDraft(null); // show the persisted value again
  };
  return (
    <div className="space-y-0.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">{label} (%){isDefault ? " — default" : ""}</label>
      <Input id={id} inputMode="decimal" className="h-8 w-24" aria-invalid={!!error} aria-describedby={error ? errId : undefined}
        value={draft ?? String(value)} onChange={(e) => { setDraft(e.target.value); setError(null); }}
        onBlur={() => void commit()} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void commit(); } if (e.key === "Escape") { setDraft(null); setError(null); } }} />
      {error && <p id={errId} role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}

export default function WorkbenchCommercials({ boqId, spec, lines, onSaved }: {
  boqId: string; spec: Spec; lines: AppBoqLine[];
  /** Re-read the persisted BOQ (called after every attempt). */
  onSaved: () => Promise<unknown>;
}) {
  const c = commercialsFor(includedTotal(lines), spec, includedDsrTotal(lines));
  const [history, setHistory] = useSessionUndoHistory(boqId);
  const [undoing, setUndoing] = useState(false);
  const save = async (key: string, value: unknown, what: string) => {
    try {
      // `before` is the value the guarded write found, not what this screen showed.
      let before: unknown;
      const r = await writeBoqSpecKeys(boqId, (current) => { before = current[key]; return { [key]: value }; });
      if (r.status === "saved") {
        toast.success(`${what} saved`);
        setHistory(pushUndo({ kind: "spec", lineId: `spec:${key}`, label: describeSpecChange(key, before, value), spec: { key, before, after: value } }));
      } else toast.error(`${what} not saved: the BOQ was changed elsewhere while saving. The current values are now shown.`);
    } catch (e) {
      toast.error(`${what} not saved — ${e instanceof Error ? e.message : "unknown error"}`);
    } finally { await onSaved(); }
  };
  const last = history.entries[history.entries.length - 1];
  const undoLast = async () => {
    if (!last || last.kind !== "spec" || undoing) return;
    setUndoing(true);
    const r = await undoSpecChange(boqId, last.spec.key, last.spec.before, last.spec.after);
    setUndoing(false);
    if (r === "done") { setHistory(popUndo); toast.success(`Undone. ${last.label}`); }
    else if (r === "conflict") { setHistory(refuseNewest); toast.error(`Undo not saved: ${last.label.split(":")[0]} was changed elsewhere since. The current value is kept.`); }
    else toast.error("Undo failed — the BOQ could not be saved. Nothing was changed.");
    await onSaved();
  };
  const firm = String(spec._firm_name ?? ""), tagline = String(spec._firm_tagline ?? "");
  const firmId = useId(), tagId = useId();
  const row = (label: string, amount: number) => (
    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{inr(amount)}</dd></div>
  );
  return (
    <section aria-labelledby="wb-commercials" className="rounded-md border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="wb-commercials" className="font-semibold mr-auto">Commercials</h3>
        {last?.kind === "spec" && (
          <Button size="sm" variant="outline" className="gap-1.5" disabled={undoing} onClick={() => void undoLast()} aria-label={`Undo: ${last.label}`}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />Undo
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        {COMMERCIAL_FIELDS.map((f) => {
          const v = commercialValue(spec, f.key as CommercialKey);
          return <PercentField key={`${f.key}:${v.value}:${v.isDefault}`} label={f.label} value={v.value} isDefault={v.isDefault}
            onSave={(n) => save(f.key, n, f.label)} />;
        })}
      </div>
      <dl aria-label="Abstract" className="text-sm max-w-md space-y-0.5">
        {row("Works (included lines)", c.works)}
        {c.costIndexAmt !== 0 && row(`Cost index ${c.costIndexPct}%`, c.costIndexAmt)}
        {row(`Contingency ${c.contingencyPct}%`, c.contingencyAmt)}
        {row(`Overhead & profit ${c.overheadPct}%`, c.overheadAmt)}
        {row(`Labour cess ${c.cessPct}%`, c.cessAmt)}
        {row(`GST ${c.gstPct}%`, c.gstAmt)}
        <div className="flex justify-between gap-4 border-t pt-1 font-semibold"><dt>Grand total</dt><dd className="tabular-nums" data-testid="grand-total">{inr(c.grandTotal)}</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">DSR 2023 rates already include GST, overheads and cess, so these are added on lines at your own rates only. Exports and frozen revisions use these values.</p>
      <div className="flex flex-wrap gap-3">
        <div className="space-y-0.5"><label htmlFor={firmId} className="text-xs text-muted-foreground">Firm name on exports</label>
          <Input key={`f:${firm}`} id={firmId} className="h-8 w-64" defaultValue={firm} placeholder="Shown instead of Cunstruct"
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== firm) void save("_firm_name", v, "Firm name"); }} /></div>
        <div className="space-y-0.5"><label htmlFor={tagId} className="text-xs text-muted-foreground">Tagline</label>
          <Input key={`t:${tagline}`} id={tagId} className="h-8 w-72" defaultValue={tagline}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== tagline) void save("_firm_tagline", v, "Tagline"); }} /></div>
      </div>
    </section>
  );
}
