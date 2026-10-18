/**
 * Measurement sheet (plan v1.2, B3 — owner-only preview lane).
 *
 * Shows each BOQ line as No × L × B × D rows with deductions, drawing
 * references and rule citations, and the line total computed by
 * src/lib/measurement. Edits are local demo state only and are lost on reload.
 * Every rule citation is labelled unverified; nothing here asserts IS 1200
 * compliance.
 */
import { useId, useState, type KeyboardEvent } from "react";
import { StatusBadge } from "@/design/StatusBadge";
import { QuantityCell } from "@/design/QuantityCell";
import { formatQuantity, parseNumericInput } from "@/design/money";
import type { SemanticState } from "@/design/tokens";
import {
  REQUIRED_DIMENSIONS,
  UNIT_LABEL,
  citationLabel,
  evaluateLine,
  type Dimension,
  type LineResult,
  type MeasurementLine,
  type MeasurementRow,
} from "@/lib/measurement/measurement";
import "@/design/tokens.css";

const BADGE: Record<LineResult["status"], SemanticState> = {
  established: "MACHINE_UNVERIFIED",
  confirmed_zero: "MACHINE_UNVERIFIED",
  pending: "PENDING_QTY",
  invalid: "BLOCKING",
};

type Field = "no" | Dimension;

interface CellProps {
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
}

/** A numeric cell: Enter or leaving the field commits, Escape restores. An
 *  empty cell is "not entered" (the row becomes pending), never 0. */
function NumberCell({ label, value, onCommit }: CellProps) {
  const id = useId();
  const shown = value == null ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    setEditing(false);
    if (draft.trim() === "") {
      setInvalid(false);
      if (value != null) onCommit(null);
      return;
    }
    const n = parseNumericInput(draft);
    if (n == null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (n !== value) onCommit(n);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    else if (e.key === "Escape") {
      setInvalid(false);
      setEditing(false);
      setDraft(shown);
    }
  };
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-err` : undefined}
        placeholder="—"
        className="ds-control ds-num ds-target h-8 w-20 px-2"
        value={editing || invalid ? draft : shown}
        onFocus={() => { setEditing(true); setDraft(shown); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {invalid && (
        <span id={`${id}-err`} role="alert" className="text-xs ds-cell" data-state="blocking">
          Enter a number
        </span>
      )}
    </span>
  );
}

function LineTable({ line, onChange }: { line: MeasurementLine; onChange: (rowId: string, field: Field, value: number | null) => void }) {
  const result = evaluateLine(line);
  const unit = UNIT_LABEL[line.unit];
  const required = REQUIRED_DIMENSIONS[line.unit];
  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");
  const dimHeader = (d: Dimension) => (required.includes(d) ? d : `${d} (not used)`);

  return (
    <section aria-labelledby={`${line.id}-title`} className="space-y-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${line.id}-title`} className="font-semibold">
          {line.id} · {line.item} <span className="text-sm font-normal text-muted-foreground">({unit})</span>
        </h3>
        <StatusBadge state={BADGE[result.status]} />
      </div>
      <div className="overflow-x-auto ds-focus" tabIndex={0} role="region" aria-label={`${line.id} measurement rows`}>
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">Row</th>
              <th className="px-2 py-2 font-medium">Description</th>
              <th className="px-2 py-2 text-right font-medium">No</th>
              {(["L", "B", "D"] as Dimension[]).map((d) => (
                <th key={d} className="px-2 py-2 text-right font-medium">{dimHeader(d)}</th>
              ))}
              <th className="px-2 py-2 text-right font-medium">Quantity ({unit})</th>
              <th className="px-2 py-2 font-medium">Drawing ref</th>
              <th className="px-2 py-2 font-medium">Rule</th>
            </tr>
          </thead>
          <tbody>
            {line.rows.map((row: MeasurementRow, i) => {
              const r = result.rows[i];
              return (
                <tr key={row.id} className={`border-t ${row.deduction ? "italic" : ""}`} data-deduction={row.deduction || undefined}>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{row.id}</td>
                  <td className="px-2 py-2">
                    {row.deduction && <span className="mr-1 font-semibold not-italic">Deduct:</span>}
                    {row.description}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <NumberCell label={`${row.description}: No`} value={row.no} onCommit={(v) => onChange(row.id, "no", v)} />
                  </td>
                  {(["L", "B", "D"] as Dimension[]).map((d) => {
                    const dim = row[d];
                    const used = required.includes(d);
                    if (!used && (dim == null || dim.value == null)) {
                      return <td key={d} className="px-2 py-2 text-right text-muted-foreground" aria-label={`${d} not used`}>·</td>;
                    }
                    return (
                      <td key={d} className="px-2 py-2 text-right">
                        <span className="inline-flex items-start gap-1">
                          <NumberCell label={`${row.description}: ${d} (${dim?.unit ?? "m"})`} value={dim?.value ?? null} onCommit={(v) => onChange(row.id, d, v)} />
                          <span className="pt-2 text-xs text-muted-foreground">{dim?.unit ?? "m"}</span>
                        </span>
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-right">
                    {r.status === "ok" ? (
                      <span className="ds-num">{row.deduction ? "−" : ""}{formatQuantity(r.quantity, 2)}</span>
                    ) : (
                      <QuantityCell
                        value={null}
                        state={r.status === "pending" ? "PENDING_QTY" : "BLOCKING"}
                        missingLabel={r.status === "pending" ? "Quantity pending" : "Row has an error"}
                      />
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs">{row.drawingRef ? `p.${row.drawingRef.page} · ${row.drawingRef.regionId}` : <span className="ds-cell" data-state="needs-review">No drawing reference</span>}</td>
                  <td className="px-2 py-2 text-xs">{citationLabel(row.rule)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <td className="px-2 py-2" colSpan={6}>
                {result.status === "established" || result.status === "confirmed_zero"
                  ? `Total: gross ${formatQuantity(result.gross, 2)} − deductions ${formatQuantity(result.deductions, 2)}`
                  : result.status === "pending"
                    ? "Total pending: a row is not fully measured"
                    : "Total withheld: fix the errors below"}
              </td>
              <td className="px-2 py-2 text-right">
                <QuantityCell
                  value={result.total}
                  unit={unit}
                  state={result.status === "pending" ? "PENDING_QTY" : result.status === "invalid" ? "BLOCKING" : undefined}
                  missingLabel={result.status === "pending" ? "Quantity pending" : "Total withheld"}
                />
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      {errors.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label={`${line.id} errors`}>
          {errors.map((e, k) => (
            <li key={k} className="ds-cell" data-state="blocking">Error{e.rowId ? ` (${e.rowId})` : ""}: {e.message}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground" aria-label={`${line.id} notes`}>
          {warnings.map((w, k) => (
            <li key={k}>Note{w.rowId ? ` (${w.rowId})` : ""}: {w.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MeasurementSheet({ initialLines }: { initialLines: MeasurementLine[] }) {
  const [lines, setLines] = useState(initialLines);
  const update = (lineId: string, rowId: string, field: Field, value: number | null) =>
    setLines((ls) => ls.map((l) => l.id !== lineId ? l : {
      ...l,
      rows: l.rows.map((r) => {
        if (r.id !== rowId) return r;
        if (field === "no") return { ...r, no: value };
        return { ...r, [field]: { value, unit: r[field]?.unit ?? "m" } };
      }),
    }));

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <strong>Sample measurements, not a real project.</strong> Rule citations are placeholders: every one is shown as{" "}
        <em>not verified against the standard</em>, because the IS 1200 texts have not been checked. Edits stay in this
        page and are lost on reload. An empty cell means "not measured" and makes the line pending, never zero.
      </p>
      {lines.map((l) => (
        <LineTable key={l.id} line={l} onChange={(rowId, field, value) => update(l.id, rowId, field, value)} />
      ))}
    </div>
  );
}

export default MeasurementSheet;
