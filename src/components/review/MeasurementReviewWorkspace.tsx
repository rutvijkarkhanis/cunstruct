// MEASUREMENT LAB — review workspace: measurement list, the drawing (the main surface) and a contextual
// inspector. Rendered only inside the admin-only, lazy-loaded MeasurementLabPanel.
//
// It reads a frozen engine run and the append-only verdict log and never changes either: a verdict is
// handed to `onVerdict`, which appends to the log. Opening or selecting a measurement never marks it
// reviewed. Nothing here touches the BOQ, pricing, exports or the review/apply path.
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PdfEvidenceViewer from "@/components/review/PdfEvidenceViewer";
import { latestVerdicts, type CorrectionEvent, type FrozenRun, type Verdict } from "@/lib/measurement-lab/core";
import { changesForRun, describeMeasurement, type ChangeReceipt, type EvidenceState, type ReviewStatus } from "@/lib/measurement-lab/record";
import { applyFilter, FILTER_LABELS, FILTERS, isTypingTarget, nextUnresolved, progressOf, shortcutFor, SHORTCUTS, statusOf, step, type Filter } from "@/lib/measurement-lab/reviewState";
import { labMarkers, measurementIdOf } from "@/lib/measurement-lab/overlay";

type ViewerMarkers = NonNullable<ComponentProps<typeof PdfEvidenceViewer>["markers"]>;

export interface WorkspaceUi { filter: Filter; selected: string | null; inspector_open: boolean; focus: boolean; shortcuts: boolean }
interface Props {
  run: FrozenRun;
  log: readonly CorrectionEvent[];
  drawing: { name: string; url: string; pageSizes: Record<number, { width: number; height: number }> };
  ui: WorkspaceUi;
  onUi: (patch: Partial<WorkspaceUi>) => void;
  /** appends one verdict to the log; rejects with a message when the log refuses it */
  onVerdict: (v: { measurement_id: string; verdict: Verdict; note: string; corrected_value: number | null }) => Promise<void>;
  busy?: boolean;
  /** the engine picker, owned by the panel */
  engineControl?: ReactNode;
}

const STATUS_STYLE: Record<ReviewStatus, string> = { "not-reviewed": "border border-slate-300 text-slate-600", correct: "bg-emerald-700 text-white", incorrect: "bg-red-700 text-white", unclear: "bg-slate-500 text-white" };
const DECISION_STYLE: Record<string, string> = { accepted: "bg-emerald-600 text-white", held: "bg-amber-600 text-white", rejected: "bg-red-600 text-white" };
const STATE_STYLE: Record<EvidenceState, string> = { available: "text-emerald-700", derived: "text-sky-700", missing: "text-slate-500", unresolved: "text-amber-700" };
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");
const statusText = (s: ReviewStatus) => (s === "not-reviewed" ? "not reviewed" : s);

function Receipt({ r, onOpen }: { r: ChangeReceipt; onOpen?: () => void }) {
  return (
    <li className="py-1 border-b last:border-0">
      <div className="flex justify-between gap-2">
        {onOpen ? <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={onOpen}>{r.measurement_id}</button> : <span className="font-medium">#{r.seq}</span>}
        <span className="text-muted-foreground">{when(r.at)} · {r.reviewer_label}</span>
      </div>
      <div>{statusText(r.previous_status)} → <b>{r.verdict}</b>{r.changed_value ? <> · value {r.value_before} → <b>{r.value_after}</b> {r.unit ?? ""}</> : <> · value unchanged ({r.value_after} {r.unit ?? ""})</>}</div>
      {r.note && <div className="text-muted-foreground">Reason: {r.note}</div>}
    </li>
  );
}

export default function MeasurementReviewWorkspace({ run, log, drawing, ui, onUi, onVerdict, busy, engineControl }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [note, setNote] = useState("");
  const [corrected, setCorrected] = useState("");
  const [pending, setPending] = useState<"incorrect" | "unclear" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [refit, setRefit] = useState(0);

  const verdicts = useMemo(() => latestVerdicts(log, run.run_id), [log, run.run_id]);
  const list = useMemo(() => applyFilter(run.measurements, verdicts, ui.filter), [run.measurements, verdicts, ui.filter]);
  const progress = useMemo(() => progressOf(run.measurements, verdicts), [run.measurements, verdicts]);
  const current = run.measurements.find((m) => m.id === ui.selected) ?? null;
  const record = useMemo(() => (current ? describeMeasurement(current, run, log) : null), [current, run, log]);
  const changes = useMemo(() => changesForRun(run, log), [run, log]);
  // focus on: highlight + zoom to the selected measurement; focus off: whole sheet, nothing emphasised.
  // `refit` gives F a fresh marker set, which makes the viewer re-fit even when the selection is unchanged.
  const markers = useMemo(() => labMarkers(run.measurements, ui.focus ? ui.selected : null, drawing.pageSizes) as unknown as ViewerMarkers,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.measurements, ui.focus, ui.selected, drawing.pageSizes, refit]);

  // a half-typed reason belongs to the measurement it was typed for
  useEffect(() => { setNote(""); setCorrected(""); setPending(null); }, [ui.selected]);
  useEffect(() => { listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [ui.selected, ui.filter]);

  const select = (id: string | null) => { onUi({ selected: id }); setMessage(null); };
  const record_ = async (verdict: Verdict, reason = note) => {
    if (!current) { setMessage("Select a measurement first."); return; }
    if (verdict !== "correct" && !reason.trim()) {
      // Focus the reason field synchronously, inside this key event: a timer could run after the
      // reviewer's next keystrokes under load, and those characters would be lost.
      if (!reasonRef.current) flushSync(() => onUi({ inspector_open: true }));
      reasonRef.current?.focus();
      setPending(verdict);
      setMessage(`Type why it is ${verdict}, then press Ctrl+Enter (or the ${verdict === "incorrect" ? "Incorrect" : "Unclear"} button). Nothing has been recorded.`);
      return;
    }
    const v = corrected.trim() === "" ? null : Number(corrected);
    if (v !== null && !Number.isFinite(v)) { setMessage("The corrected value must be a number. Nothing has been recorded."); return; }
    if (v !== null && verdict !== "incorrect") { setMessage("A corrected value belongs to an Incorrect verdict. Nothing has been recorded."); return; }
    try {
      await onVerdict({ measurement_id: current.id, verdict, note: reason, corrected_value: v });
      setNote(""); setCorrected(""); setPending(null);
      setMessage(`${current.id}: recorded ${verdict}${v !== null ? ` (corrected value ${v})` : ""}.`);
      rootRef.current?.focus();
    } catch (e) { setMessage(`Not recorded: ${(e as Error).message}`); }
  };

  // Keyboard: active only inside the lab, never while typing, and never past a required reason.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (!ui.shortcuts || isTypingTarget(e.target)) return;
      const a = shortcutFor(e);
      if (!a) return;
      e.preventDefault();
      switch (a) {
        case "accept": void record_("correct", ""); break;
        case "incorrect": void record_("incorrect"); break;
        case "unclear": void record_("unclear"); break;
        case "next-unresolved": { const n = nextUnresolved(list, verdicts, ui.selected, run.measurements); if (n) select(n); else setMessage("No unresolved measurement left in this list."); break; }
        case "previous": { const p = step(list, ui.selected, -1, run.measurements); if (p) select(p); break; }
        case "focus": onUi({ focus: true }); setRefit((k) => k + 1); break;
        case "toggle-inspector": onUi({ inspector_open: !ui.inspector_open }); break;
        case "help": setShowHelp((s) => !s); break;
        case "clear": if (ui.selected) select(null); else if (showHelp) setShowHelp(false); break;
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  });

  const pct = progress.total ? Math.round((progress.reviewed / progress.total) * 100) : 0;
  return (
    <div ref={rootRef} tabIndex={-1} className="space-y-2 outline-none" data-testid="review-workspace" data-lab-esc={ui.shortcuts && ui.selected ? "clear" : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        {engineControl}
        <Select value={ui.filter} onValueChange={(v) => onUi({ filter: v as Filter })}>
          <SelectTrigger className="w-48 h-8 text-xs" aria-label="Filter"><SelectValue /></SelectTrigger>
          <SelectContent>{FILTERS.map((f) => <SelectItem key={f} value={f}>{FILTER_LABELS[f]}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { const n = nextUnresolved(list, verdicts, ui.selected, run.measurements); if (n) select(n); else setMessage("No unresolved measurement left in this list."); }}>Next unresolved <kbd className="ml-1 text-[10px] opacity-60">N</kbd></Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" aria-pressed={ui.focus} onClick={() => { onUi({ focus: !ui.focus }); setRefit((k) => k + 1); }}>{ui.focus ? "Whole sheet" : "Zoom to selection"} <kbd className="ml-1 text-[10px] opacity-60">F</kbd></Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" aria-pressed={ui.inspector_open} onClick={() => onUi({ inspector_open: !ui.inspector_open })}>{ui.inspector_open ? "Hide inspector" : "Show inspector"} <kbd className="ml-1 text-[10px] opacity-60">I</kbd></Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" aria-pressed={showChanges} onClick={() => setShowChanges((s) => !s)}>What changed? ({changes.length})</Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" aria-pressed={showHelp} onClick={() => setShowHelp((s) => !s)}>Shortcuts <kbd className="ml-1 text-[10px] opacity-60">?</kbd></Button>
        <label className="flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={ui.shortcuts} onChange={(e) => onUi({ shortcuts: e.target.checked })} aria-label="Keyboard shortcuts on" />keys</label>
      </div>

      <div className="space-y-1" aria-label="Review progress">
        <div className="flex flex-wrap gap-x-3 text-xs">
          <span><b>{progress.reviewed}</b> of {progress.total} reviewed ({pct}%)</span>
          <span className="text-muted-foreground">not reviewed {progress.notReviewed}</span>
          <span className="text-emerald-700">correct {progress.correct}</span>
          <span className="text-red-700">incorrect {progress.incorrect}</span>
          <span className="text-slate-600">unclear {progress.unclear}</span>
          <span className="font-medium">still to resolve {progress.unresolved}</span>
        </div>
        <div className="flex h-1.5 w-full overflow-hidden rounded bg-slate-200" role="img" aria-label={`${progress.reviewed} of ${progress.total} reviewed`}>
          <div className="bg-emerald-700" style={{ width: `${(progress.correct / (progress.total || 1)) * 100}%` }} />
          <div className="bg-red-700" style={{ width: `${(progress.incorrect / (progress.total || 1)) * 100}%` }} />
          <div className="bg-slate-500" style={{ width: `${(progress.unclear / (progress.total || 1)) * 100}%` }} />
        </div>
      </div>

      {message && <p className="text-xs" role="status">{message}</p>}
      {showHelp && (
        <div className="rounded border p-2 text-xs" aria-label="Keyboard shortcuts">
          <div className="mb-1 font-medium">Keyboard shortcuts {ui.shortcuts ? "" : "(off — tick “keys” to turn them on)"}</div>
          <table><tbody>{SHORTCUTS.map((s) => <tr key={s.keys}><td className="pr-3"><kbd className="rounded border px-1">{s.keys}</kbd></td><td>{s.label}</td></tr>)}</tbody></table>
          <div className="mt-1 text-muted-foreground">Shortcuts never fire while you type in a field, and never record Incorrect or Unclear without a reason. Keys pressed in the Lab never reach the workstation behind it.</div>
        </div>
      )}
      {showChanges && (
        <div className="rounded border p-2 text-xs max-h-48 overflow-auto" aria-label="What changed">
          <div className="mb-1 font-medium">What changed? — every verdict on this run, newest first (append-only; the engine's frozen output is never changed)</div>
          {changes.length ? <ul>{changes.map((r) => <Receipt key={r.event_hash} r={r} onOpen={() => select(r.measurement_id)} />)}</ul> : <p className="text-muted-foreground">No verdicts yet.</p>}
        </div>
      )}

      <div className={`grid gap-2 ${ui.inspector_open ? "lg:grid-cols-[220px_1fr_300px]" : "lg:grid-cols-[220px_1fr]"}`}>
        <ol ref={listRef} className="max-h-[520px] overflow-auto rounded border text-xs" aria-label="Measurements">
          {list.map((m) => { const s = statusOf(verdicts, m.id); const sel = m.id === ui.selected; return (
            <li key={m.id}>
              <button type="button" aria-current={sel ? "true" : undefined} onClick={() => select(m.id)}
                className={`flex w-full items-center justify-between gap-1 px-2 py-1 text-left ${sel ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}>
                <span className="truncate">{m.id} · “{m.text}”</span>
                <span className="flex shrink-0 gap-1">
                  <span className={`rounded px-1 text-[10px] ${DECISION_STYLE[m.decision]}`}>{m.decision}</span>
                  <span className={`rounded px-1 text-[10px] ${STATUS_STYLE[s]}`}>{statusText(s)}</span>
                </span>
              </button>
            </li>); })}
          {!list.length && <li className="p-2 text-muted-foreground">No measurement matches this filter.</li>}
        </ol>

        <div className="min-w-0 space-y-1">
          {current && record && !record.location_linkable && <p className="text-xs text-amber-800" role="note">Precise location linking is unavailable for {current.id}: the frozen run has no position for it. It is on page {current.page}.</p>}
          <div className="h-[520px] overflow-hidden rounded border">
            <PdfEvidenceViewer fileUrl={drawing.url} source={undefined} documentName={drawing.name} markers={markers} deferDestroyUntilLoaded
              onSelectMarker={(id) => select(measurementIdOf(id))} markerContextLabel={current ? `${current.id} · page ${current.page}` : "Click a measurement on the drawing or in the list"} />
          </div>
        </div>

        {ui.inspector_open && (
          <aside className="max-h-[520px] space-y-2 overflow-auto rounded border p-2 text-xs" aria-label="Measurement inspector">
            <div className="flex items-center justify-between"><span className="font-medium text-sm">Inspector</span>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onUi({ inspector_open: false })}>Hide</Button></div>
            {!record || !current ? <p className="text-muted-foreground">Select a measurement in the list or on the drawing.</p> : (<>
              <section aria-label="Measurement">
                <div className="text-sm"><b>{record.id}</b> · {record.engine_value} {record.unit ?? "(no unit)"}</div>
                <dl className="grid grid-cols-[110px_1fr] gap-x-2">
                  <dt className="text-muted-foreground">Type</dt><dd>linear dimension</dd>
                  <dt className="text-muted-foreground">Page</dt><dd>{record.source.page}</dd>
                  <dt className="text-muted-foreground">Engine result</dt><dd><span className={`rounded px-1 ${DECISION_STYLE[record.extraction.decision]}`}>{record.extraction.decision}</span> ({record.extraction.status})</dd>
                  <dt className="text-muted-foreground">Your verdict</dt><dd><span className={`rounded px-1 ${STATUS_STYLE[record.verification.status]}`}>{statusText(record.verification.status)}</span></dd>
                  <dt className="text-muted-foreground">Current value</dt><dd>{record.current_value} {record.unit ?? ""} <span className="text-muted-foreground">({record.provenance.replace("-", " ")})</span></dd>
                </dl>
              </section>
              <section aria-label="Record a verdict" className="space-y-1">
                <Textarea ref={reasonRef} value={note} rows={2} aria-label="Verdict note" placeholder="Why (required for Incorrect or Unclear)"
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && pending) { e.preventDefault(); void record_(pending, e.currentTarget.value); } }} />
                <Input value={corrected} onChange={(e) => setCorrected(e.target.value)} aria-label="Corrected value" placeholder="Corrected value (only with Incorrect)" className="h-8 text-xs" />
                <div className="flex gap-1">
                  <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void record_("correct")}>Correct <kbd className="ml-1 opacity-60">A</kbd></Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void record_("incorrect")}>Incorrect <kbd className="ml-1 opacity-60">R</kbd></Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void record_("unclear")}>Unclear <kbd className="ml-1 opacity-60">U</kbd></Button>
                </div>
                <div className="text-muted-foreground">A verdict is appended to the tamper-evident log. It never changes the engine's frozen output or the BOQ.</div>
              </section>
              <section aria-label="Source evidence">
                <div className="font-medium">Source evidence</div>
                <ul>{record.evidence.map((f) => (
                  <li key={f.key} className="grid grid-cols-[110px_1fr] gap-x-2">
                    <span className="text-muted-foreground">{f.label}</span>
                    <span><span className={STATE_STYLE[f.state]}>{f.state}</span>{f.value ? ` · ${f.value}` : ""}{f.note ? <span className="text-muted-foreground"> — {f.note}</span> : null}</span>
                  </li>))}</ul>
              </section>
              <section aria-label="Verification">
                <div className="font-medium">Verification</div>
                <div>{record.engine.label} · output <code>{record.engine.output_sha256.slice(0, 12)}…</code> (frozen)</div>
                {record.verification.latest?.note && <div>Latest reason: {record.verification.latest.note}</div>}
                {record.verification.receipts.length ? <ul aria-label="Verdict history">{record.verification.receipts.map((r) => <Receipt key={r.event_hash} r={r} />)}</ul> : <div className="text-muted-foreground">No verdicts yet — selecting a measurement does not mark it reviewed.</div>}
              </section>
            </>)}
          </aside>
        )}
      </div>
    </div>
  );
}
