// The project journey's BOQ table: labelled columns, search, filters, sort,
// inline editing of description/quantity/unit, and a source link per line.
// It owns no persistence — `onSave` does the write (see ProjectBoq.tsx) — and
// rates are read-only here: rate edits go through the BOQ builder's audited
// path, never a second one.
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Pencil, Search } from "lucide-react";
import {
  BOQ_COLUMNS, DEFAULT_SORT, NO_FILTERS, STATUS_LABEL, effectiveRate, filterLines, lineAmount, lineProvenance, lineStatus,
  parseEdit, qtyState, sectionOptions, sortLines, type BoqFilters, type BoqSort, type BoqTableLine, type EditableField,
  type LineStatus, type SortKey,
} from "@/lib/app/boqTable";
import { sectionLabel } from "@/lib/app/labels";
import { PROVENANCE_CAVEAT } from "@/lib/quantity";
import type { LineEvidence, LineEvidenceResult } from "@/lib/lineEvidence";
import LineEvidencePanel from "./LineEvidencePanel";
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
const FIELD_NAME: Record<EditableField, string> = { description: "Description", qty: "Quantity", unit: "Unit" };

/** One editable cell. Enter or leaving the field saves; Escape cancels and
 *  never saves — including the blur that follows the editor closing. */
function EditableCell({ line, field, display, align, onSave, disabled }: {
  line: BoqTableLine; field: EditableField; display: string; align?: "right";
  onSave: (line: BoqTableLine, patch: Partial<BoqTableLine>) => Promise<boolean>; disabled?: boolean;
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
    setDraft(field === "qty" ? String(line.qty) : (line[field] ?? ""));
    setEditing(true);
  };
  const close = () => { closed.current = true; restoreFocus.current = true; setEditing(false); };
  const cancel = () => close();
  const commit = async () => {
    if (closed.current || inFlight.current) return;
    const r = parseEdit(line, field, draft);
    if ("error" in r) { setError(r.error); return; }
    if (!Object.keys(r.patch).length) { close(); return; }
    inFlight.current = true;
    setSaving(true);
    const ok = await onSave(line, r.patch);
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
          inputMode={field === "qty" ? "decimal" : undefined}
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

export default function BoqTable({ lines, sourceOf, onSave, disabled, rateEditHref, initialStatus = "", initialQuery = "", evidenceOf, regionHref }: {
  lines: BoqTableLine[];
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
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);
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
            BOQ lines. Description, quantity and unit can be edited; rates are edited in the BOQ builder.
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
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr><td colSpan={BOQ_COLUMNS.length} className="px-3 py-8 text-center text-muted-foreground">
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
                    {rate != null ? inr(rate) : "—"}
                    {l.custom_rate != null && <span className="block text-xs text-muted-foreground">custom</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{amount != null ? inr(amount) : "—"}</td>
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
                </tr>
                {ev?.kind === "linked" && openEvidence === l.id && (
                  <tr className="bg-muted/30">
                    <td colSpan={BOQ_COLUMNS.length} className="px-3 py-3">
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
