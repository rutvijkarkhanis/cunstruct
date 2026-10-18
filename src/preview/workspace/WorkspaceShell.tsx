// ENGINEERING PREVIEW — workspace shell (plan v1.2, I2 and I3).
//
// One frame: a synthetic drawing canvas, an Excel-like BOQ grid and a
// one-line sign-off ledger. Grid: arrows, Tab/Shift+Tab, Enter/Shift+Enter,
// F2 (edit), typing to start an edit, Delete (clear to pending/no rate),
// Escape (cancel) and paste-a-range. Canvas and grid are linked both ways.
// Every edit is local component state, labelled demo; nothing is saved and
// there is no Supabase client here. All data is SYNTHETIC.
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { MoneyCell } from "@/design/MoneyCell";
import { QuantityCell } from "@/design/QuantityCell";
import { StatusBadge } from "@/design/StatusBadge";
import { formatINR } from "@/design/money";
import { QUANTITY_STATE_LABEL } from "@/lib/quantity";
import "@/design/tokens.css";
import {
  COLUMNS,
  DRAWING_VIEWBOX,
  INITIAL_WORKSPACE_LINES,
  REGIONS,
  applyCellText,
  columnId,
  isEditable,
  ledgerSummary,
  lineAmount,
  lineQuantityState,
  linesForRegion,
  moveCell,
  pasteRange,
  regionLink,
  type Cell,
  type EditableColumn,
  type MoveKey,
  type WorkspaceLine,
} from "./model";

type Message = { kind: "info" | "error"; text: string } | null;

const cellKey = (c: Cell) => `${c.row}:${c.col}`;

function StatePill({ line }: { line: WorkspaceLine }) {
  const state = lineQuantityState(line);
  if (state === "pending") return <StatusBadge state="PENDING_QTY" />;
  if (state === "unavailable") return <StatusBadge state="UNAVAILABLE" />;
  // Established and confirmed zero are not review verdicts: a neutral pill with text.
  return (
    <span className="ds-status" data-state="machine-unverified">
      <span aria-hidden="true">{state === "confirmed_zero" ? "0" : "#"}</span>
      <span>{QUANTITY_STATE_LABEL[state]}</span>
    </span>
  );
}

function RegionCell({ line }: { line: WorkspaceLine }) {
  const link = regionLink(line);
  const region = REGIONS.find((r) => r.id === line.regionId);
  if (link === "none") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <StatusBadge state="UNAVAILABLE" />
        <span className="text-xs">No drawing region</span>
      </span>
    );
  }
  if (link === "unverified") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <StatusBadge state="NEEDS_REVIEW" />
        <span className="text-xs">Region unverified · {region!.id}</span>
      </span>
    );
  }
  return <span className="text-xs">Linked region (illustrative) · {region!.id}</span>;
}

export default function WorkspaceShell() {
  const [lines, setLines] = useState<WorkspaceLine[]>(INITIAL_WORKSPACE_LINES);
  const [active, setActive] = useState<Cell>({ row: 0, col: 0 });
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ draft: string; error: string | null } | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const focusGridCell = useRef(false);

  // Move DOM focus with the active cell, but only when the grid owns focus.
  useEffect(() => {
    if (!focusGridCell.current || editing) return;
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${cellKey(active)}"]`)?.focus();
  }, [active, editing]);

  const activeLine = lines[active.row];
  const highlightedRegion = selectedRegion ?? activeLine?.regionId ?? null;
  const selectedLineIds = new Set(selectedRegion ? linesForRegion(selectedRegion, lines) : activeLine ? [activeLine.id] : []);

  const go = (next: Cell | null) => {
    if (!next) return false;
    focusGridCell.current = true;
    setSelectedRegion(null);
    setActive(next);
    return true;
  };

  const startEdit = (initial?: string) => {
    if (!isEditable(active.col)) {
      setMessage({ kind: "error", text: `"${COLUMNS[active.col].label}" cannot be edited.` });
      return;
    }
    const line = lines[active.row];
    const current = columnId(active.col) === "qty" ? line.qty : line.rate;
    setMessage(null);
    setEditing({ draft: initial ?? (current == null ? "" : String(current)), error: null });
  };

  const commit = (after: MoveKey | null) => {
    if (!editing) return;
    const col = columnId(active.col) as EditableColumn;
    const res = applyCellText(lines[active.row], col, editing.draft);
    if ("error" in res) {
      setEditing({ ...editing, error: res.error });
      return;
    }
    setLines((ls) => ls.map((l, i) => (i === active.row ? res.line : l)));
    setEditing(null);
    setMessage({ kind: "info", text: `${res.line.id} ${col === "qty" ? "quantity" : "rate"} updated (demo, not saved).` });
    focusGridCell.current = true;
    if (after) {
      const next = moveCell(active, after, lines.length);
      if (next) setActive(next);
    }
  };

  const onGridKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (editing) return; // the input handles its own keys
    const k = e.key;
    let handled = true;
    if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") go(moveCell(active, k, lines.length));
    else if (k === "Enter") go(moveCell(active, e.shiftKey ? "ShiftEnter" : "Enter", lines.length));
    else if (k === "Tab") handled = go(moveCell(active, e.shiftKey ? "ShiftTab" : "Tab", lines.length));
    else if (k === "F2") startEdit();
    else if ((k === "Delete" || k === "Backspace") && isEditable(active.col)) {
      const col = columnId(active.col) as EditableColumn;
      const res = applyCellText(lines[active.row], col, "");
      if ("line" in res) {
        setLines((ls) => ls.map((l, i) => (i === active.row ? res.line : l)));
        setMessage({ kind: "info", text: col === "qty" ? `${res.line.id} quantity cleared: now pending, not 0 (demo).` : `${res.line.id} rate cleared (demo).` });
      }
    } else if (k.length === 1 && /[0-9.-]/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey && isEditable(active.col)) startEdit(k);
    else handled = false;
    if (handled) e.preventDefault();
  };

  const onEditKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(e.shiftKey ? "ShiftEnter" : "Enter");
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit(e.shiftKey ? "ShiftTab" : "Tab");
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null);
      focusGridCell.current = true;
      setMessage({ kind: "info", text: "Edit cancelled; the value is unchanged." });
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    if (editing) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const res = pasteRange(lines, active, text);
    if ("errors" in res) {
      setMessage({ kind: "error", text: `Paste rejected, nothing changed. ${res.errors.join(" ")}` });
      return;
    }
    setLines(res.lines);
    setMessage({ kind: "info", text: `Pasted ${res.rows} × ${res.cols} cell${res.rows * res.cols === 1 ? "" : "s"} (demo, not saved).` });
  };

  const selectRegion = (id: string) => {
    const ids = linesForRegion(id, lines);
    setSelectedRegion(id);
    const first = lines.findIndex((l) => l.regionId === id);
    if (first >= 0) setActive({ row: first, col: 0 });
    const region = REGIONS.find((r) => r.id === id)!;
    setMessage({
      kind: "info",
      text: `${region.label}: ${ids.length} linked line${ids.length === 1 ? "" : "s"} (${ids.join(", ") || "none"})${region.status === "uncertain" ? " — link unverified" : ""}.`,
    });
  };

  return (
    <div className="space-y-4" data-testid="workspace-shell">
      <div className="grid min-w-0 gap-4 xl:grid-cols-[1fr_1.5fr]">
        <section className="min-w-0 rounded-xl border bg-card p-4" aria-labelledby="ws-canvas-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 id="ws-canvas-title" className="text-sm font-semibold">Drawing canvas</h3>
              <div className="text-xs text-muted-foreground">Synthetic plan DRAWING-DEMO-01 · not a project drawing</div>
            </div>
            <span className="rounded border px-2 py-1 text-xs text-muted-foreground">Scale unconfirmed</span>
          </div>
          <div className="ds-drawing rounded-md border p-2">
            <svg
              viewBox={`0 0 ${DRAWING_VIEWBOX.width} ${DRAWING_VIEWBOX.height}`}
              className="h-auto w-full"
              role="group"
              aria-label="Synthetic drawing with linked regions"
            >
              <rect x="20" y="20" width="360" height="220" fill="none" stroke="currentColor" strokeWidth="3" />
              <line x1="180" y1="20" x2="180" y2="240" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" />
              <line x1="20" y1="120" x2="380" y2="120" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" />
              {REGIONS.map((r) => {
                const on = highlightedRegion === r.id;
                const uncertain = r.status === "uncertain";
                return (
                  <g
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selectedRegion === r.id}
                    aria-label={`${r.label}${uncertain ? ", link unverified" : ""}${on ? ", highlighted" : ""}`}
                    data-region={r.id}
                    data-highlighted={on || undefined}
                    className="ds-focus cursor-pointer outline-none"
                    onClick={() => selectRegion(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectRegion(r.id);
                      }
                    }}
                  >
                    <rect
                      x={r.x}
                      y={r.y}
                      width={r.w}
                      height={r.h}
                      fill={on ? (uncertain ? "#fde68a" : "#bae6fd") : "transparent"}
                      stroke={uncertain ? "#b45309" : "#0369a1"}
                      strokeWidth={on ? 4 : 2}
                      strokeDasharray={uncertain ? "6 4" : undefined}
                    />
                    <text x={r.x + 4} y={r.y + 14} fontSize="11" fill="currentColor">
                      {r.id}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Solid outline: linked region (illustrative). Dashed outline: link unverified. Lines with no region are listed in the grid as “No drawing region”. Nothing is measured from this drawing.
          </p>
        </section>

        <section className="min-w-0 rounded-xl border bg-card" aria-labelledby="ws-grid-title">
          <div className="border-b p-4">
            <h3 id="ws-grid-title" className="font-semibold">BOQ grid</h3>
            <p className="text-xs text-muted-foreground">
              Arrows move · Tab / Shift+Tab across · Enter / Shift+Enter down / up · F2 or type to edit · Delete clears · Escape cancels · paste a range from a spreadsheet. Edits are demo only.
            </p>
          </div>
          <div className="overflow-x-auto" role="region" aria-label="BOQ grid, scrolls sideways" tabIndex={-1}>
            <table
              ref={gridRef}
              role="grid"
              aria-label="Demo BOQ grid"
              aria-rowcount={lines.length + 1}
              className="w-full min-w-[720px] text-left text-sm"
              onKeyDown={onGridKeyDown}
              onPaste={onPaste}
            >
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr role="row">
                  {COLUMNS.map((c) => (
                    <th key={c.id} role="columnheader" className="px-3 py-2 font-medium">
                      {c.label}
                      {c.editable && <span className="sr-only"> (editable)</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, row) => {
                  const lineSelected = selectedLineIds.has(line.id);
                  const amount = lineAmount(line);
                  const pending = lineQuantityState(line) === "pending";
                  return (
                    <tr key={line.id} role="row" aria-selected={lineSelected} data-line={line.id} className={`border-t align-top ${lineSelected ? "bg-sky-50/70" : ""}`}>
                      {COLUMNS.map((c, col) => {
                        const isActive = active.row === row && active.col === col;
                        const isEditing = isActive && editing != null;
                        const edited = c.editable && line.edited.includes(c.id as EditableColumn);
                        return (
                          <td
                            key={c.id}
                            role="gridcell"
                            data-cell={`${row}:${col}`}
                            tabIndex={isActive && !isEditing ? 0 : -1}
                            aria-selected={isActive}
                            aria-readonly={!c.editable || undefined}
                            onClick={() => {
                              focusGridCell.current = true;
                              setSelectedRegion(null);
                              setActive({ row, col });
                            }}
                            onDoubleClick={() => c.editable && startEdit()}
                            className={`ds-focus min-h-[24px] px-3 py-2 ${isActive ? "ring-2 ring-inset ring-sky-600" : ""} ${c.id === "item" ? "max-w-64" : "whitespace-nowrap"}`}
                          >
                            {isEditing ? (
                              <span className="flex flex-col gap-1">
                                <input
                                  autoFocus
                                  className="ds-control ds-num ds-target h-8 w-28 px-2"
                                  aria-label={`${c.id === "qty" ? "Quantity" : "Rate"} for ${line.id}${c.id === "qty" ? ` (${line.unit})` : " (₹)"}`}
                                  aria-invalid={editing.error ? true : undefined}
                                  aria-describedby={editing.error ? "ws-edit-error" : undefined}
                                  value={editing.draft}
                                  onChange={(e) => setEditing({ draft: e.target.value, error: null })}
                                  onKeyDown={onEditKeyDown}
                                />
                                {editing.error && (
                                  <span id="ws-edit-error" role="alert" className="text-xs ds-cell" data-state="blocking">
                                    {editing.error}
                                  </span>
                                )}
                              </span>
                            ) : c.id === "item" ? (
                              <>
                                <div className="font-medium">{line.description}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{line.id}</div>
                              </>
                            ) : c.id === "qty" ? (
                              <QuantityCell value={line.qty} unit={line.unit} state={pending ? "PENDING_QTY" : undefined} />
                            ) : c.id === "rate" ? (
                              line.rate == null ? <MoneyCell value={null} missingLabel="No rate" /> : <MoneyCell value={line.rate} />
                            ) : c.id === "amount" ? (
                              <MoneyCell value={amount} missingLabel={pending ? "No amount: quantity pending" : "No amount: no rate"} />
                            ) : c.id === "state" ? (
                              <StatePill line={line} />
                            ) : (
                              <RegionCell line={line} />
                            )}
                            {edited && !isEditing && <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">edited · demo</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p
            aria-live="polite"
            role={message?.kind === "error" ? "alert" : "status"}
            className={`min-h-[1.5rem] border-t px-4 py-2 text-xs ${message?.kind === "error" ? "ds-cell" : "text-muted-foreground"}`}
            data-state={message?.kind === "error" ? "blocking" : undefined}
          >
            {message?.text ?? ""}
          </p>
        </section>
      </div>

      <div className="rounded-lg border bg-card px-4 py-2 text-sm" data-testid="signoff-ledger">
        <span className="font-semibold">Sign-off ledger:</span> {ledgerSummary(lines)} · Priced subtotal (illustrative){" "}
        {formatINR(lines.reduce((s, l) => s + (lineAmount(l) ?? 0), 0))}
      </div>
    </div>
  );
}
