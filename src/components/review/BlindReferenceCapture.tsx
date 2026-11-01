// STAGE A — blind human reference capture for the Measurement Lab.
//
// Shows the ORIGINAL drawing only. This component imports no engine, no engine run and no lab store
// (a test enforces it), so nothing it renders or prefills can come from engine output. The founder
// clicks points on the drawing (text location, start, end) and types the rest. Records are drafts until
// "Lock reference"; after locking they change only through amendments (handled in Stage B).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PdfEvidenceViewer from "@/components/review/PdfEvidenceViewer";
import { incompleteFields, type Derivability, type ReferenceMeasurement, type ReferenceState } from "@/lib/measurement-lab/reference";

type P = [number, number];
const blank = (n: number): ReferenceMeasurement => ({ ref_id: `REF-${String(n).padStart(3, "0")}`, page: 1, view: "", element: "", printed_text: "", value: null, unit: "mm", text_point: null, start: null, end: null, associated_element: "", derivability: "derivable", notes: "" });
const fmt = (p: P | null) => (p ? `(${p[0]}, ${p[1]})` : "—");

export default function BlindReferenceCapture(props: {
  fileUrl: string;
  fileName: string;
  pageSizes: Record<number, { width: number; height: number }>;
  numPages: number;
  state: ReferenceState;
  /** engine runs for this drawing already existed before this reference was started */
  engineRunsExisted: boolean;
  busy: boolean;
  onAdd: (r: ReferenceMeasurement) => void;
  onEdit: (r: ReferenceMeasurement) => void;
  onWithdraw: (refId: string, reason: string) => void;
  onLock: () => void;
}) {
  const { state } = props;
  const [draft, setDraft] = useState<ReferenceMeasurement>(() => blank(state.blind.length + 1));
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<"text_point" | "start" | "end" | null>(null);
  const missing = incompleteFields(draft);
  const set = (k: keyof ReferenceMeasurement, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const save = () => { if (editing) props.onEdit(draft); else props.onAdd(draft); setDraft(blank(state.blind.length + 2)); setEditing(false); };

  return (
    <div className="space-y-2" data-testid="blind-reference">
      <p className="text-xs text-muted-foreground">
        Stage A — record the drawing's measurements from the drawing itself. No engine output is shown or used here.
        Your reference is internal development evidence, not independent validation.
      </p>
      {props.engineRunsExisted && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1" role="alert">Engine results for this drawing were generated before this reference was started. A reference recorded now may not be blind; this is recorded with every entry.</p>}
      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="h-[520px] border rounded overflow-hidden">
          <PdfEvidenceViewer fileUrl={props.fileUrl} documentName={props.fileName} deferDestroyUntilLoaded
            source={{ page: draft.page, evidence: [], pageSize: props.pageSizes[draft.page] }}
            identifyModeActive={target !== null}
            onIdentifyPoint={({ page, point }) => { if (!target) return; setDraft((d) => ({ ...d, page, [target]: [Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10] as P })); setTarget(null); }} />
        </div>
        <div className="space-y-1 text-xs">
          <div className="font-medium">{editing ? `Edit ${draft.ref_id}` : `New reference ${draft.ref_id}`}</div>
          <label className="block">Page <Input type="number" min={1} max={props.numPages} value={draft.page} onChange={(e) => set("page", Number(e.target.value))} aria-label="Page" /></label>
          <label className="block">View / floor <Input value={draft.view} onChange={(e) => set("view", e.target.value)} aria-label="View" /></label>
          <label className="block">Architectural element <Input value={draft.element} onChange={(e) => set("element", e.target.value)} placeholder="e.g. south wall, ground floor" aria-label="Element" /></label>
          <label className="block">Printed dimension text <Input value={draft.printed_text} onChange={(e) => set("printed_text", e.target.value)} aria-label="Printed text" /></label>
          <div className="flex gap-2">
            <label className="block flex-1">Value <Input type="number" step="any" value={draft.value ?? ""} onChange={(e) => set("value", e.target.value === "" ? null : Number(e.target.value))} aria-label="Value" /></label>
            <label className="block w-28">Unit
              <Select value={draft.unit ?? "mm"} onValueChange={(v) => set("unit", v)}><SelectTrigger aria-label="Unit"><SelectValue /></SelectTrigger>
                <SelectContent>{["mm", "cm", "m", "in", "none-stated"].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select></label>
          </div>
          <div className="flex flex-wrap gap-1">
            {(["text_point", "start", "end"] as const).map((k) => (
              <Button key={k} type="button" size="sm" variant={target === k ? "default" : "outline"} onClick={() => setTarget(target === k ? null : k)}>
                {k === "text_point" ? "Click text" : k === "start" ? "Click start" : "Click end"}
              </Button>))}
          </div>
          <div className="font-mono">text {fmt(draft.text_point)} · start {fmt(draft.start)} · end {fmt(draft.end)}</div>
          {target && <div className="text-amber-800">Click the {target === "text_point" ? "printed text" : target} on the drawing.</div>}
          <label className="block">Associated element <Input value={draft.associated_element} onChange={(e) => set("associated_element", e.target.value)} placeholder="e.g. grid 6 -> grid 7" aria-label="Associated element" /></label>
          <label className="block">Derivability
            <Select value={draft.derivability} onValueChange={(v) => set("derivability", v as Derivability)}><SelectTrigger aria-label="Derivability"><SelectValue /></SelectTrigger>
              <SelectContent>{["derivable", "ambiguous", "not-derivable"].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select></label>
          <label className="block">Notes <Textarea rows={2} value={draft.notes} onChange={(e) => set("notes", e.target.value)} aria-label="Notes" /></label>
          {missing.length > 0 && <div className="text-muted-foreground">Needed before locking: {missing.join(", ")}</div>}
          <div className="flex gap-2"><Button size="sm" disabled={props.busy || !draft.printed_text.trim()} onClick={save}>{editing ? "Save changes" : "Add reference"}</Button>
            {editing && <Button size="sm" variant="ghost" onClick={() => { setDraft(blank(state.blind.length + 1)); setEditing(false); }}>Cancel</Button>}</div>
        </div>
      </div>
      <table className="w-full text-xs" aria-label="Reference measurements"><thead><tr className="text-left"><th>id</th><th>page</th><th>text</th><th>value</th><th>derivability</th><th>complete</th><th /></tr></thead><tbody>
        {state.blind.map((r) => { const m = incompleteFields(r); return (
          <tr key={r.ref_id} className="border-t"><td>{r.ref_id}</td><td>{r.page}</td><td>{r.printed_text}</td><td>{r.value ?? "—"} {r.unit ?? ""}</td><td>{r.derivability}</td><td>{m.length ? `missing ${m.length}` : "yes"}</td>
            <td className="whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => { setDraft(r); setEditing(true); }}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => { const why = window.prompt(`Why withdraw ${r.ref_id}?`); if (why) props.onWithdraw(r.ref_id, why); }}>Withdraw</Button></td></tr>); })}
      </tbody></table>
      <Button size="sm" disabled={props.busy || !state.blind.length || state.blind.some((r) => incompleteFields(r).length > 0)}
        onClick={() => { if (window.confirm(`Lock ${state.blind.length} reference measurement(s)? After locking, engine results are revealed and changes need an explicit amendment.`)) props.onLock(); }}>
        Lock reference and reveal engine results
      </Button>
    </div>
  );
}
