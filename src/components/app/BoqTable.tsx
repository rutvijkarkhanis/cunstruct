// The project journey's BOQ table: labelled columns, search, filters, sort,
// inline editing of description/quantity/unit, and a source link per line.
// It owns no persistence — `onSave` does the write (see ProjectBoq.tsx). Rates
// are read-only unless the page passes `onRateSave` (the workbench preview),
// whose write is the same audited path the BOQ builder uses
// (lib/manualRateEdit) — never a second one. With `showHistory`, each line
// can open its recorded change history (LineHistoryPanel, read-only).
import { Fragment, lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Pencil, Search } from "lucide-react";
import {
  BOQ_COLUMNS, DEFAULT_SORT, NO_FILTERS, STATUS_LABEL, effectiveRate, filterLines, lineAmount, lineProvenance, lineStatus,
  parseEdit, parseRateEdit, qtyState, rateSource, sectionOptions, sortLines, type BoqFilters, type BoqSort, type BoqTableLine, type EditableField,
  type LineStatus, type SortKey,
} from "@/lib/app/boqTable";
import { sectionLabel } from "@/lib/app/labels";
import { PROVENANCE_CAVEAT } from "@/lib/quantity";
import type { LineEvidence, LineEvidenceResult } from "@/lib/lineEvidence";
import LineEvidencePanel from "./LineEvidencePanel";
import { WORKBENCH_PREVIEW_ENABLED } from "@/lib/workbenchPreview";

// Workbench-only: imported only in builds with the preview.
const LineHistoryPanel = WORKBENCH_PREVIEW_ENABLED ? lazy(() => import("./LineHistoryPanel")) : null;
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LineSource { name: string | null; page: string | null; href: string | null }

const num = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });

/** The quantity cell states which case applies — never a bare 0 for a pending
 *  line, never "pending" for a confirmed zero. */
function qtyDisplay(l: BoqTableLine): string {
  switch (qtyState(l)) {
    case "established": return num(l.qty);
    case "confirmed_zero": return "0 (confirmed)";
    case "unavailable": return "Not available";
    case "pending": return l.qty > 0 ? `${num(l.qty)} (unconfirmed)` : "Pending";
  }
}
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

const STATUS_CLASS: Record<LineStatus, string> = {
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  unpriced: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  complete: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  excluded: "bg-muted text-foreground",
};

const SORTABLE: Partial<Record<(typeof BOQ_COLUMNS)[number]["key"], SortKey>> = {
  section: "section", description: "description", qty: "qty", rate: "rate", amount: "amount", status: "status",
};
type CellField = EditableField | "rate";
const FIELD_NAME: Record<CellField, string> = { description: "Description", qty: "Quantity", unit: "Unit", rate: "Rate" };
type RateSave = (line: BoqTableLine, rate: number | null) => Promise<boolean>;

/** One editable cell. Enter or leaving the field saves; Escape cancels and
 *  never saves — including the blur that follows the editor closing. */
function EditableCell({ line, field, display, align, onSave, onRateSave, disabled, placeholder }: {
  line: BoqTableLine; field: CellField; display: string; align?: "right";
  onSave: (line: BoqTableLine, patch: Partial<BoqTableLine>) => Promise<boolean>; disabled?: boolean;
  /** Required for field "rate". */ onRateSave?: RateSave; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Set once the editor closes (saved, unchanged or cancelled): any blur that
  // follows — e.g. from the input unmounting — must not save again.
  const closed = useRef(false);
  // A ref, not state: disabling the input mid-save blurs it, and that blur
  // handler would still see the stale `saving === false`.
  const inFlight = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(false);
  const errorId = useId();
  const what = `${FIELD_NAME[field]} for ${line.description || line.dsr_code || "line"}`;

  useEffect(() => {
    if (!editing && restoreFocus.current) { restoreFocus.current = false; buttonRef.current?.focus(); }
  }, [editing]);
  // A failed save re-enables the input (disabled while saving): give it focus
  // back. Only then — a validation error on blur must not pull focus back.
  const refocusAfterFailure = useRef(false);
  useEffect(() => {
    if (editing && !saving && refocusAfterFailure.current) { refocusAfterFailure.current = false; inputRef.current?.focus(); }
  }, [editing, saving]);

  const start = () => {
    closed.current = false;
    setError(null);
    // A rate field shows the line's own rate; empty means "use the DSR rate".
    setDraft(field === "qty" ? String(line.qty) : field === "rate" ? (line.custom_rate == null ? "" : String(line.custom_rate)) : (line[field] ?? ""));
    setEditing(true);
  };
  const close = () => { closed.current = true; restoreFocus.current = true; setEditing(false); };
  const cancel = () => close();
  const commit = async () => {
    if (closed.current || inFlight.current) return;
    let save: () => Promise<boolean>;
    if (field === "rate") {
      const r = parseRateEdit(line, draft);
      if ("error" in r) { setError(r.error); return; }
      if (r.unchanged) { close(); return; }
      save = () => onRateSave!(line, r.rate);
    } else {
      const r = parseEdit(line, field, draft);
      if ("error" in r) { setError(r.error); return; }
      if (!Object.keys(r.patch).length) { close(); return; }
      save = () => onSave(line, r.patch);
    }
    inFlight.current = true;
    setSaving(true);
    const ok = await save();
    inFlight.current = false;
    if (ok) { setSaving(false); close(); return; }
    refocusAfterFailure.current = true;
    setSaving(false);
    setError("Could not save. Try again, or press Escape to cancel.");
  };

  if (editing) {
    return (
      <div className="min-w-[6rem]">
        <Input
          ref={inputRef}
          autoFocus
          aria-label={what}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          value={draft}
          inputMode={field === "qty" || field === "rate" ? "decimal" : undefined}
          placeholder={placeholder}
          disabled={saving}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
            else if (e.key === "Enter") { e.preventDefault(); void commit(); }
          }}
          onBlur={() => { void commit(); }}
          className={cn("h-8 text-sm", align === "right" && "text-right")}
        />
        {error && <p id={errorId} role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">{error}</p>}
      </div>
    );
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={start}
      disabled={disabled}
      aria-label={`Edit ${what}, currently ${display}`}
      className={cn(
        "group inline-flex items-center gap-1 rounded px-1 -mx-1 py-0.5 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
        align === "right" && "justify-end w-full text-right",
      )}
    >
      <span className="break-words">{display}</span>
      <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
    </button>
  );
}

const RATE_SOURCE_LABEL = { own: "own rate", dsr: "DSR rate", none: "no rate" } as const;

export default function BoqTable({ lines, sourceOf, onSave, disabled, rateEditHref, initialStatus = "", initialQuery = "", evidenceOf, regionHref, onRateSave: rateSaveProp, showHistory: showHistoryProp, onRemove: removeProp }: {
  lines: BoqTableLine[];
  /** Row actions (workbench): exclude/include through `onSave`, and remove (the caller confirms and writes). */
  onRemove?: (l: BoqTableLine) => void;
  /** Rates editable in the table (audited write, see the header). Absent: read-only, edited in the builder. */
  onRateSave?: RateSave;
  /** Each line can open its recorded change history. */
  showHistory?: boolean;
  sourceOf: (l: BoqTableLine) => LineSource | null;
  onSave: (line: BoqTableLine, patch: Partial<BoqTableLine>) => Promise<boolean>;
  disabled?: boolean;
  rateEditHref: string;
  /** Status filter to open with (e.g. from a "pending quantities" link). */
  initialStatus?: LineStatus | "";
  /** Search to open with (e.g. "Basis not recorded" from a check). */
  initialQuery?: string;
  /** The review evidence a line is linked to by its stable key (lib/lineEvidence). */
  evidenceOf?: (l: BoqTableLine) => LineEvidenceResult | null;
  regionHref?: (e: LineEvidence) => string | null;
}) {
  // The workbench's extras exist only in builds with the preview (the constant folds away elsewhere).
  const onRateSave = WORKBENCH_PREVIEW_ENABLED ? rateSaveProp : undefined;
  const showHistory = WORKBENCH_PREVIEW_ENABLED && !!showHistoryProp;
  const onRemove = WORKBENCH_PREVIEW_ENABLED ? removeProp : undefined;
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  // Lines whose include/exclude is being saved: a second click before the
  // save lands would be guarded on the old value and refused as "changed elsewhere".
  const [toggling, setToggling] = useState<ReadonlySet<string>>(new Set());
  const toggleIncluded = async (l: BoqTableLine) => {
    if (toggling.has(l.id)) return;
    setToggling((s) => new Set(s).add(l.id));
    try { await onSave(l, { included: !l.included }); }
    finally { setToggling((s) => { const n = new Set(s); n.delete(l.id); return n; }); }
  };
  const [filters, setFilters] = useState<BoqFilters>({ ...NO_FILTERS, status: initialStatus, q: initialQuery });
  const [sort, setSort] = useState<BoqSort>(DEFAULT_SORT);
  const searchId = useId(), sectionId = useId(), statusId = useId();
  const sections = useMemo(() => sectionOptions(lines), [lines]);
  const rows = useMemo(
    () => sortLines(filterLines(lines, filters, (l) => sourceOf(l)?.name ?? null), sort),
    [lines, filters, sort, sourceOf],
  );
  const filtered = filters.q.trim() !== "" || filters.section !== "" || filters.status !== "";

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : DEFAULT_SORT));

  return (
    <div className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-full sm:w-64">
          <label htmlFor={searchId} className="sr-only">Search BOQ lines</label>
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input id={searchId} type="search" placeholder="Search lines" value={filters.q} className="pl-8"
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-0.5">
          <label htmlFor={sectionId} className="text-xs text-muted-foreground">Section</label>
          <select id={sectionId} value={filters.section} onChange={(e) => setFilters((f) => ({ ...f, section: e.target.value }))}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="">All sections</option>
            {sections.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <label htmlFor={statusId} className="text-xs text-muted-foreground">Status</label>
          <select id={statusId} value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as LineStatus | "" }))}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABEL) as LineStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        {filtered && <Button variant="ghost" size="sm" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>}
        <p className="text-sm text-muted-foreground ml-auto" aria-live="polite">
          {filtered ? `Showing ${rows.length} of ${lines.length} lines` : `${lines.length} line${lines.length === 1 ? "" : "s"}`}
        </p>
      </div>

      {/* Focusable, named scroll region so the table can be scrolled
          sideways by keyboard at phone width; `relative` keeps the
          visually-hidden caption inside it. */}
      <div role="region" aria-label="BOQ lines" tabIndex={0}
        className="relative overflow-x-auto rounded-md border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {onRateSave ? "BOQ lines. Description, quantity, unit and rate can be edited." : "BOQ lines. Description, quantity and unit can be edited; rates are edited in the BOQ builder."}
          </caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              {BOQ_COLUMNS.map((c) => {
                const key = SORTABLE[c.key];
                const active = key && sort.key === key;
                const numeric = c.key === "qty" || c.key === "rate" || c.key === "amount";
                return (
                  <th key={c.key} scope="col"
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("px-3 py-2 font-medium text-foreground whitespace-nowrap", numeric && "text-right")}>
                    {key ? (
                      <button type="button" onClick={() => toggleSort(key)}
                        className="inline-flex items-center gap-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                        {c.label}
                        {active ? (sort.dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />)
                          : <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
                      </button>
                    ) : c.label}
                    {c.key === "rate" && (
                      <Link to={rateEditHref} className="block text-xs font-normal text-muted-foreground underline">Edit in builder</Link>
                    )}
                  </th>
                );
              })}
              {onRemove && <th scope="col" className="px-3 py-2 font-medium text-foreground whitespace-nowrap"><span className="sr-only">Line actions</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr><td colSpan={BOQ_COLUMNS.length + (onRemove ? 1 : 0)} className="px-3 py-8 text-center text-muted-foreground">
                {lines.length === 0 ? "This BOQ has no lines yet." : "No lines match these filters."}
              </td></tr>
            ) : rows.map((l) => {
              const st = lineStatus(l);
              const rate = effectiveRate(l);
              const amount = lineAmount(l);
              const src = sourceOf(l);
              const prov = lineProvenance(l);
              const ev = evidenceOf?.(l) ?? null;
              return (
                <Fragment key={l.id}>
                <tr className={cn(st === "excluded" && "text-muted-foreground")}>
                  <td className="px-3 py-2 whitespace-nowrap">{sectionLabel(l.section)}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{l.dsr_code ?? "—"}</td>
                  <td className="px-3 py-2 min-w-[14rem]">
                    <EditableCell line={l} field="description" display={l.description || "—"} onSave={onSave} disabled={disabled} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    <EditableCell line={l} field="qty" align="right" onSave={onSave} disabled={disabled}
                      display={qtyDisplay(l)} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <EditableCell line={l} field="unit" display={l.unit || "—"} onSave={onSave} disabled={disabled} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {onRateSave ? (
                      <>
                        <EditableCell line={l} field="rate" align="right" onSave={onSave} onRateSave={onRateSave} disabled={disabled}
                          display={rate != null ? inr(rate) : "—"}
                          placeholder={l.dsr_rate != null ? `DSR ${inr(l.dsr_rate)}` : "No DSR rate"} />
                        <span className={cn("block text-xs", rateSource(l) === "none" ? "text-orange-800 dark:text-orange-300" : "text-muted-foreground")}>{RATE_SOURCE_LABEL[rateSource(l)]}</span>
                      </>
                    ) : (
                      <>
                        {rate != null ? inr(rate) : "—"}
                        {l.custom_rate != null && <span className="block text-xs text-muted-foreground">custom</span>}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {amount != null ? inr(amount) : "—"}
                    {onRateSave && amount == null && st !== "excluded" && (
                      <span className="block text-xs text-muted-foreground">{st === "pending" ? "quantity pending" : "needs a rate"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={cn("inline-block rounded px-1.5 py-0.5 text-xs font-medium", STATUS_CLASS[st])}>{STATUS_LABEL[st]}</span>
                  </td>
                  <td className="px-3 py-2 min-w-[9rem]" title={[prov.note, PROVENANCE_CAVEAT].filter(Boolean).join(" — ")}>
                    <span className={cn(prov.origin === "unknown" || prov.origin === "assumption" ? "text-muted-foreground" : "")}>{prov.label}</span>
                    {prov.note && <span className="block text-xs text-muted-foreground break-words">{prov.note}</span>}
                    {ev?.kind === "linked" && (
                      <button type="button" className="block text-xs underline" aria-expanded={openEvidence === l.id}
                        aria-label={`${openEvidence === l.id ? "Hide" : "Show"} evidence for ${l.description || "line"}`}
                        onClick={() => setOpenEvidence((o) => (o === l.id ? null : l.id))}>
                        {openEvidence === l.id ? "Hide evidence" : "Evidence"}
                      </button>
                    )}
                    {ev?.kind === "ambiguous" && <span className="block text-xs text-muted-foreground">Several review items share this mark — evidence not linked.</span>}
                    {showHistory && (
                      <button type="button" className="block text-xs underline" aria-expanded={openHistory === l.id}
                        aria-label={`${openHistory === l.id ? "Hide" : "Show"} change history for ${l.description || "line"}`}
                        onClick={() => setOpenHistory((o) => (o === l.id ? null : l.id))}>
                        {openHistory === l.id ? "Hide history" : "History"}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 min-w-[9rem]">
                    {!src ? (
                      <span className="text-muted-foreground">—<span className="sr-only">No source</span></span>
                    ) : src.href ? (
                      <Link to={src.href} className="inline-flex items-center gap-1 underline break-words"
                        aria-label={`Open source drawing ${src.name}${src.page ? `, page ${src.page}` : ""}`}>
                        <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {src.name}{src.page ? ` · p.${src.page}` : ""}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{src.name}</span>
                    )}
                  </td>
                  {onRemove && (
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={disabled || toggling.has(l.id)}
                        aria-label={`${l.included ? "Exclude" : "Include"} ${l.description || "line"} ${l.included ? "from" : "in"} the total`}
                        onClick={() => void toggleIncluded(l)}>
                        {l.included ? "Exclude" : "Include"}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-red-700 dark:text-red-300" disabled={disabled}
                        aria-label={`Remove line ${l.description || "line"}`} onClick={() => onRemove(l)}>
                        Remove
                      </Button>
                    </td>
                  )}
                </tr>
                {showHistory && openHistory === l.id && (
                  <tr className="bg-muted/30">
                    <td colSpan={BOQ_COLUMNS.length + (onRemove ? 1 : 0)} className="px-3 py-3">
                      {LineHistoryPanel && <Suspense fallback={null}><LineHistoryPanel lineId={l.id} label={l.description || l.dsr_code || "line"} /></Suspense>}
                    </td>
                  </tr>
                )}
                {ev?.kind === "linked" && openEvidence === l.id && (
                  <tr className="bg-muted/30">
                    <td colSpan={BOQ_COLUMNS.length + (onRemove ? 1 : 0)} className="px-3 py-3">
                      <LineEvidencePanel e={ev} regionHref={regionHref?.(ev) ?? null} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
