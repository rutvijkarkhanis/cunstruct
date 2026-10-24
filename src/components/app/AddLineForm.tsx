// Adding a BOQ line in the workbench: description, unit, quantity (optional —
// empty adds it as pending, never an invented number) and section, typed in
// or taken from a DSR 2023 item (the existing DsrPicker). The row rules are
// lib/app/newLine; the write is the caller's (lib/lineEdit addLineRecorded).
import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { DsrPicker, type PickedDsr } from "@/components/ops/DsrPicker";
import { buildNewLine } from "@/lib/app/newLine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function AddLineForm({ boqId, sections, nextSort, onAdd }: {
  boqId: string; sections: string[]; nextSort: number;
  /** Writes the row; true when the line now exists. */
  onAdd: (row: Record<string, unknown>, label: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [dsr, setDsr] = useState<PickedDsr | null>(null);
  const [f, setF] = useState({ description: "", unit: "", qty: "", section: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { d: useId(), u: useId(), q: useId(), s: useId(), list: useId(), err: useId() };
  const reset = () => { setF({ description: "", unit: "", qty: "", section: "" }); setDsr(null); setError(null); };

  if (!open) {
    return <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" />Add line</Button>;
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = buildNewLine({ boqId, ...f, sort: nextSort, dsr: dsr ? { code: dsr.code, rate: dsr.rate, chapter: dsr.chapter } : null });
    if ("error" in r) { setError(r.error); return; }
    setSaving(true);
    const ok = await onAdd(r.row, `Added “${f.description.trim().slice(0, 40)}”`);
    setSaving(false);
    if (ok) { reset(); setOpen(false); }
  };
  return (
    <form aria-label="Add a line" onSubmit={submit} className="rounded-md border bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold mr-auto">Add a line</h3>
        <Button type="button" size="sm" variant="outline" onClick={() => setPicking(true)}>Pick from DSR 2023…</Button>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Close add a line" onClick={() => { reset(); setOpen(false); }}><X className="h-4 w-4" /></Button>
      </div>
      {dsr && (
        <p className="text-xs text-muted-foreground">
          DSR {dsr.code}{dsr.rate != null ? ` · reference rate ₹${inr(dsr.rate)}${dsr.unit ? ` per ${dsr.unit}` : ""}` : " · no reference rate"}{" "}
          <button type="button" className="underline" onClick={() => setDsr(null)}>Not from DSR</button>
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1.5fr]">
        <div className="space-y-0.5"><label htmlFor={ids.d} className="text-xs text-muted-foreground">Description</label>
          <Input id={ids.d} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div className="space-y-0.5"><label htmlFor={ids.u} className="text-xs text-muted-foreground">Unit</label>
          <Input id={ids.u} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
        <div className="space-y-0.5"><label htmlFor={ids.q} className="text-xs text-muted-foreground">Quantity</label>
          <Input id={ids.q} inputMode="decimal" placeholder="Pending" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></div>
        <div className="space-y-0.5"><label htmlFor={ids.s} className="text-xs text-muted-foreground">Section</label>
          <Input id={ids.s} list={ids.list} placeholder={dsr?.chapter ?? "Other"} value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} />
          <datalist id={ids.list}>{sections.map((s) => <option key={s} value={s} />)}</datalist></div>
      </div>
      <p className="text-xs text-muted-foreground">Leave the quantity empty if it is not measured yet: the line is added as pending, not as a number. Set an own rate on the line afterwards.</p>
      {error && <p id={ids.err} role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
      <Button type="submit" size="sm" disabled={saving}>{saving ? "Adding…" : "Add to BOQ"}</Button>
      <DsrPicker open={picking} onOpenChange={setPicking} onPick={(it) => {
        setDsr(it);
        // A DSR-coded line carries that item's standard description and unit (as the builder binds them).
        setF((x) => ({ ...x, description: it.description, unit: it.unit ?? x.unit }));
        setPicking(false);
      }} />
    </form>
  );
}
