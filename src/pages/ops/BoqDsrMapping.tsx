// DSR SPECIFICATION MAPPING + INDICATIVE COSTING for one BOQ.
//
// Mapping: per BOQ line, the reviewer searches the DSR reference, inspects full
// specifications, and records a decision (match / needs review / unmatched) or
// clears it. Decisions live in boq_line_dsr_mapping with a snapshot of the DSR
// item; the BOQ line itself is never edited here.
//
// Indicative estimate: measured quantity × the SNAPSHOTTED reference rate, only
// for lines the reviewer explicitly includes and only when the units match and
// rate/quantity exist. Shown under its own label and never fed into the BOQ's
// commercial totals, quotes or exports.

import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Search, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  compareUnits, referenceLabel, MAPPING_STATUS_LABEL,
  type DsrItemRef, type DsrMappingRow, type DsrMappingStatus, type MappingDecision,
} from "@/lib/dsrMapping";
import {
  buildIndicativeEstimate, canInclude, INDICATIVE_LABEL, INDICATIVE_STATUS_LABEL,
  type IndicativeRow, type IndicativeStatus,
} from "@/lib/indicativeCosting";
import {
  useDsrMapping, searchDsrItems, dsrCandidatesForCode, MAPPING_UNAVAILABLE_MESSAGE, type MappingLine,
} from "@/hooks/useDsrMapping";
import { useRateEvidence, EVIDENCE_UNAVAILABLE_MESSAGE } from "@/hooks/useRateEvidence";
import { useRateAdoption } from "@/hooks/useRateAdoption";
import RateEvidencePanel from "@/components/ops/RateEvidencePanel";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const rateText = (r: number | null) => (r == null ? "No rate in reference" : `${inr(r)}`);
const qtyText = (l: MappingLine) =>
  l.qty == null ? "—" : `${l.qty.toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${l.unit ?? ""}`.trim();

const STATUS_TONE: Record<DsrMappingStatus | "unmapped", string> = {
  mapped: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  needs_review: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  unmatched: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  unmapped: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: DsrMappingStatus | "unmapped" }) {
  return <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", STATUS_TONE[status])}>{MAPPING_STATUS_LABEL[status]}</span>;
}

/** Measured vs DSR unit, side by side whenever they differ or can't be checked. */
function UnitCompare({ boqUnit, dsrUnit }: { boqUnit: string | null; dsrUnit: string | null }) {
  const check = compareUnits(boqUnit, dsrUnit);
  if (check === "match") return <span className="text-xs text-muted-foreground">Unit: {dsrUnit}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400" role="note">
      <AlertTriangle className="h-3 w-3" />
      {check === "mismatch" ? "Unit mismatch" : "Unit missing"} — measured: {boqUnit || "none"} · DSR: {dsrUnit || "none"} (not converted)
    </span>
  );
}

function Specification({ text }: { text: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return <p className="text-xs italic text-muted-foreground">No specification text in the reference</p>;
  const long = text.length > 160;
  return (
    <div className="text-xs text-foreground/80">
      <p className={cn("whitespace-pre-line", !open && long && "line-clamp-2")}>{text}</p>
      {long && (
        <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide full specification" : "Show full specification"}
        </button>
      )}
    </div>
  );
}

function CandidateCard({ item, line, disabled, onSelect, onFlag }: {
  item: DsrItemRef; line: MappingLine; disabled: boolean; onSelect: () => void; onFlag: () => void;
}) {
  const ref = referenceLabel(item.source, item.rate_year);
  return (
    <div className="rounded-md border p-3 space-y-1.5" data-testid="dsr-candidate">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono font-medium">{item.code}</span>
        {ref && <Badge variant="outline">{ref}</Badge>}
        <span className="text-muted-foreground">{rateText(item.rate)}{item.rate != null && item.unit ? ` / ${item.unit}` : ""}</span>
      </div>
      {item.subhead && <p className="text-[11px] text-muted-foreground">{item.subhead}</p>}
      <Specification text={item.description} />
      <UnitCompare boqUnit={line.unit} dsrUnit={item.unit} />
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" disabled={disabled} onClick={onSelect}>Select match</Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={onFlag}>Flag for review</Button>
      </div>
    </div>
  );
}

function SnapshotView({ mapping, line }: { mapping: DsrMappingRow; line: MappingLine }) {
  if (mapping.status === "unmatched") {
    return <p className="text-sm text-muted-foreground">Marked as a custom item with no DSR equivalent.</p>;
  }
  if (!mapping.dsr_code) {
    return <p className="text-sm text-muted-foreground">Flagged as ambiguous — no candidate recorded.</p>;
  }
  const ref = referenceLabel(mapping.dsr_source, mapping.dsr_rate_year);
  return (
    <div className="space-y-1.5" data-testid="mapping-snapshot">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono font-medium">{mapping.dsr_code}</span>
        {ref && <Badge variant="outline">{ref}</Badge>}
        <span className="text-muted-foreground">{rateText(mapping.dsr_rate)}{mapping.dsr_rate != null && mapping.dsr_unit ? ` / ${mapping.dsr_unit}` : ""}</span>
      </div>
      <Specification text={mapping.dsr_description} />
      <UnitCompare boqUnit={line.unit} dsrUnit={mapping.dsr_unit} />
      <p className="text-[11px] text-muted-foreground">Reference captured when this decision was made; later changes to the DSR table don't alter it.</p>
    </div>
  );
}

function LinePanel({ line, mapping, busy, storageAvailable, onDecide, onClear }: {
  line: MappingLine; mapping: DsrMappingRow | null; busy: boolean; storageAvailable: boolean;
  onDecide: (d: MappingDecision, note: string) => void; onClear: () => void;
}) {
  const [note, setNote] = useState(mapping?.reviewer_note ?? "");
  const [term, setTerm] = useState(line.description?.split(/\s+/).slice(0, 3).join(" ") ?? "");
  const disabled = busy || !storageAvailable;

  const { data: codeCandidates = [], isLoading: codeLoading } = useQuery({
    queryKey: ["dsr-candidates-code", line.dsr_code],
    enabled: !!line.dsr_code,
    queryFn: () => dsrCandidatesForCode(line.dsr_code!),
  });
  const { data: results = [], isFetching: searching, error: searchError } = useQuery({
    queryKey: ["dsr-mapping-search", term.trim()],
    enabled: term.trim().length >= 2,
    queryFn: () => searchDsrItems(term),
  });
  const searchOnly = results.filter((r) => !codeCandidates.some((c) => c.id === r.id));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{line.description || "Untitled line"}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {line.section ? `${line.section} · ` : ""}Measured: {qtyText(line)}{line.dsr_code ? ` · BOQ code ${line.dsr_code}` : ""}
          {!line.included && " · excluded from BOQ"}
        </p>
        <p className="text-[11px] text-muted-foreground">The BOQ line's quantity, unit, description and rates are not changed by mapping.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Current decision</h3>
            <StatusBadge status={mapping?.status ?? "unmapped"} />
          </div>
          {mapping ? <SnapshotView mapping={mapping} line={line} /> : <p className="text-sm text-muted-foreground">No decision yet.</p>}
          {mapping?.reviewer_note && <p className="text-xs"><span className="font-medium">Note:</span> {mapping.reviewer_note}</p>}
        </section>

        <section className="space-y-2">
          <label htmlFor="mapping-note" className="text-sm font-semibold">Reviewer note (optional)</label>
          <Textarea id="mapping-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this match, or what needs checking" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => onDecide({ kind: "unmatched" }, note)}>Mark unmatched (custom item)</Button>
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => onDecide({ kind: "needs_review" }, note)}>Flag as ambiguous</Button>
            {mapping && <Button size="sm" variant="ghost" disabled={disabled} onClick={onClear}>Clear decision</Button>}
          </div>
        </section>

        {line.dsr_code && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Candidates with code {line.dsr_code}</h3>
            {codeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : codeCandidates.length === 0
              ? <p className="text-xs text-muted-foreground">No DSR reference item has this code.</p>
              : codeCandidates.map((c) => (
                <CandidateCard key={c.id} item={c} line={line} disabled={disabled}
                  onSelect={() => onDecide({ kind: "select", item: c }, note)}
                  onFlag={() => onDecide({ kind: "needs_review", item: c }, note)} />
              ))}
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Search the DSR reference</h3>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input aria-label="Search DSR items" className="pl-8" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Code or specification text" />
          </div>
          {searchError ? <p className="text-xs text-destructive">Search failed: {(searchError as Error).message}</p>
            : searching ? <Loader2 className="h-4 w-4 animate-spin" />
            : term.trim().length >= 2 && searchOnly.length === 0
              ? <p className="text-xs text-muted-foreground">No other matching items.</p>
              : searchOnly.map((c) => (
                <CandidateCard key={c.id} item={c} line={line} disabled={disabled}
                  onSelect={() => onDecide({ kind: "select", item: c }, note)}
                  onFlag={() => onDecide({ kind: "needs_review", item: c }, note)} />
              ))}
        </section>
      </CardContent>
    </Card>
  );
}

const BLOCKED_TONE: Partial<Record<IndicativeStatus, string>> = {
  priced: "text-emerald-700 dark:text-emerald-400",
  eligible: "text-foreground",
  excluded: "text-muted-foreground",
};

function EstimateTable({ rows, storageAvailable, busyLineId, onToggle }: {
  rows: IndicativeRow[]; storageAvailable: boolean; busyLineId: string | null;
  onToggle: (row: IndicativeRow, include: boolean) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">Include</TableHead>
          <TableHead>BOQ line</TableHead>
          <TableHead>Measured</TableHead>
          <TableHead>DSR reference</TableHead>
          <TableHead className="text-right">Ref. rate</TableHead>
          <TableHead className="text-right">Indicative amount</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const { line, mapping } = row;
          const included = !!mapping?.include_in_estimate;
          // A blocked line that was included earlier can still be switched off.
          const toggleable = storageAvailable && (canInclude(row) || included);
          const ref = mapping ? referenceLabel(mapping.dsr_source, mapping.dsr_rate_year) : null;
          return (
            <TableRow key={line.id} data-testid={`estimate-row-${line.id}`}>
              <TableCell>
                <input type="checkbox" aria-label={`Include ${line.description ?? "line"} in indicative estimate`}
                  checked={included} disabled={!toggleable || busyLineId === line.id}
                  onChange={(e) => onToggle(row, e.target.checked)} />
              </TableCell>
              <TableCell className="max-w-[16rem]">
                <div className="text-sm">{line.description || "Untitled line"}</div>
                {line.section && <div className="text-[11px] text-muted-foreground">{line.section}</div>}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm tabular-nums">{line.qty == null ? "—" : line.qty.toLocaleString("en-IN", { maximumFractionDigits: 2 })} {line.unit ?? ""}</TableCell>
              <TableCell className="max-w-[18rem]">
                {mapping?.dsr_code ? (
                  <div className="space-y-0.5">
                    <div className="text-sm"><span className="font-mono">{mapping.dsr_code}</span>{ref && <span className="text-muted-foreground"> · {ref}</span>}</div>
                    {mapping.dsr_description && <div className="text-[11px] text-muted-foreground line-clamp-2" title={mapping.dsr_description}>{mapping.dsr_description}</div>}
                    {row.unitCheck && row.unitCheck !== "match" && <UnitCompare boqUnit={line.unit} dsrUnit={mapping.dsr_unit} />}
                  </div>
                ) : <span className="text-xs text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">
                {mapping?.dsr_rate != null ? `${inr(mapping.dsr_rate)}${mapping.dsr_unit ? ` / ${mapping.dsr_unit}` : ""}` : "—"}
              </TableCell>
              <TableCell className="text-right text-sm font-medium tabular-nums">{row.amount != null ? inr(row.amount) : "—"}</TableCell>
              <TableCell className={cn("text-xs whitespace-nowrap", BLOCKED_TONE[row.status] ?? "text-amber-700 dark:text-amber-400")}>
                {INDICATIVE_STATUS_LABEL[row.status]}{included && row.status !== "priced" ? " (included, not priced)" : ""}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function LineList({ lines, selectedId, onSelect, badge, meta }: {
  lines: MappingLine[]; selectedId: string | null; onSelect: (id: string) => void;
  badge: (l: MappingLine) => ReactNode; meta: (l: MappingLine) => string;
}) {
  return (
    <ul className="space-y-1" aria-label="BOQ lines">
      {lines.map((l) => (
        <li key={l.id}>
          <button type="button" onClick={() => onSelect(l.id)}
            className={cn("w-full rounded-md border px-3 py-2 text-left hover:bg-muted/50", selectedId === l.id && "border-primary bg-muted/50", !l.included && "opacity-60")}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm">{l.description || "Untitled line"}</span>
              {badge(l)}
            </div>
            <div className="text-[11px] text-muted-foreground">{qtyText(l)}{meta(l)}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function BoqDsrMapping() {
  const navigate = useNavigate();
  const { id: routeId, boqId: routeBoqId } = useParams<{ id?: string; boqId?: string }>();
  const boqId = routeBoqId ?? routeId;
  const { boqName, lines, linesLoading, mappings, mappingsLoading, storageAvailable, busyLineId, decide, clear, setIncluded } = useDsrMapping(boqId);
  const evidence = useRateEvidence(boqId);
  const adoption = useRateAdoption(boqId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const byLine = useMemo(() => new Map(mappings.map((m) => [m.boq_line_id, m])), [mappings]);
  const estimate = useMemo(() => buildIndicativeEstimate(lines, mappings), [lines, mappings]);
  const selected = lines.find((l) => l.id === selectedId) ?? null;
  const c = estimate.counts;

  const quotationsFor = (lineId: string) => evidence.quotations.filter((q) => q.boq_line_id === lineId);
  const reviewFor = (lineId: string) => evidence.reviews.find((r) => r.boq_line_id === lineId) ?? null;

  if (linesLoading || mappingsLoading || evidence.loading) {
    return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("..", { relative: "path" })}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back to BOQ
        </Button>
        <div>
          <h1 className="text-xl font-semibold">DSR mapping, indicative cost &amp; rate evidence</h1>
          {boqName && <p className="text-xs text-muted-foreground">{boqName}</p>}
        </div>
      </div>

      {!storageAvailable && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Mapping can't be saved here yet</AlertTitle>
          <AlertDescription>{MAPPING_UNAVAILABLE_MESSAGE}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="mapping">
        <TabsList>
          <TabsTrigger value="mapping">DSR mapping</TabsTrigger>
          <TabsTrigger value="estimate">Indicative estimate</TabsTrigger>
          <TabsTrigger value="rates">Rate comparison</TabsTrigger>
        </TabsList>

        <TabsContent value="mapping" className="space-y-3">
          {lines.length === 0 ? <p className="text-sm text-muted-foreground">This BOQ has no lines to map.</p> : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <LineList lines={lines} selectedId={selectedId} onSelect={setSelectedId}
                badge={(l) => <StatusBadge status={byLine.get(l.id)?.status ?? "unmapped"} />}
                meta={(l) => {
                  const m = byLine.get(l.id);
                  const mismatch = m?.dsr_unit && compareUnits(l.unit, m.dsr_unit) === "mismatch";
                  return `${m?.dsr_code ? ` · ${m.dsr_code}` : ""}${mismatch ? " · unit mismatch" : ""}`;
                }} />
              {selected
                ? <LinePanel key={`${selected.id}:${byLine.get(selected.id)?.reviewed_at ?? ""}`} line={selected} mapping={byLine.get(selected.id) ?? null}
                    busy={busyLineId === selected.id} storageAvailable={storageAvailable}
                    onDecide={(d, note) => decide(selected.id, d, note)} onClear={() => clear(selected.id)} />
                : <p className="text-sm text-muted-foreground">Select a BOQ line to map it to a DSR reference item.</p>}
            </div>
          )}
        </TabsContent>

        <TabsContent value="estimate" className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle className="text-base font-semibold">{INDICATIVE_LABEL}</AlertTitle>
            <AlertDescription>
              Measured quantities × DSR reference rates captured at mapping time — a historical benchmark only.
              It is not used in this BOQ's commercial totals, quotes or exports, and it changes no rates on the BOQ.
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Indicative total of included lines</div>
              <div className="text-3xl font-semibold tabular-nums" data-testid="indicative-total">{inr(estimate.total)}</div>
              <div className={cn("text-xs", estimate.partial ? "text-amber-700 dark:text-amber-400 font-medium" : "text-muted-foreground")} data-testid="indicative-coverage">
                {estimate.partial
                  ? `Partial — ${c.priced} of ${c.inScope} in-scope lines priced; ${c.unpriced} not costed`
                  : `All ${c.inScope} in-scope lines priced`}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Stat label="Priced" value={c.priced} />
            <Stat label="Unpriced" value={c.unpriced} />
            <Stat label="Unmapped" value={c.unmapped} />
            <Stat label="Needs review" value={c.needsReview} />
            <Stat label="Unit mismatch" value={c.unitMismatch} />
          </div>
          <p className="text-xs text-muted-foreground">
            Also: {c.eligible} eligible but not included · {c.unmatched} unmatched (custom) · {c.missingRate} without a reference rate ·{" "}
            {c.unitUnknown} with a missing unit · {c.missingQuantity} quantity pending · {c.excluded} excluded from the BOQ
          </p>

          <EstimateTable rows={estimate.rows} storageAvailable={storageAvailable} busyLineId={busyLineId}
            onToggle={(row, include) => row.mapping && setIncluded(row.mapping, include)} />
        </TabsContent>

        <TabsContent value="rates" className="space-y-3">
          {!evidence.storageAvailable && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Rate evidence can't be saved here yet</AlertTitle>
              <AlertDescription>{EVIDENCE_UNAVAILABLE_MESSAGE}</AlertDescription>
            </Alert>
          )}
          <p className="text-xs text-muted-foreground">
            Pricing evidence for review — vendor quotations and the firm's historical BOQ rates beside the DSR reference.
            A preferred candidate is a recommendation, not an adopted rate. A line's commercial rate changes only when a reviewer
            opens "Adopt…", checks the preview and confirms it.
          </p>
          {lines.length === 0 ? <p className="text-sm text-muted-foreground">This BOQ has no lines.</p> : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <LineList lines={lines} selectedId={selectedId} onSelect={setSelectedId}
                badge={(l) => {
                  const r = reviewFor(l.id);
                  return r?.preferred_kind ? <Badge variant="outline">Preferred set</Badge> : null;
                }}
                meta={(l) => {
                  const n = quotationsFor(l.id).length;
                  return n ? ` · ${n} quotation${n === 1 ? "" : "s"}` : "";
                }} />
              {selected && boqId
                ? <RateEvidencePanel key={selected.id} boqId={boqId} line={selected} mapping={byLine.get(selected.id) ?? null}
                    indicativeAmount={estimate.rows.find((r) => r.line.id === selected.id)?.amount ?? null}
                    quotations={quotationsFor(selected.id)} review={reviewFor(selected.id)} documents={evidence.documents}
                    storageAvailable={evidence.storageAvailable} busy={evidence.busy} today={today}
                    saveQuotation={evidence.saveQuotation} deleteQuotation={evidence.deleteQuotation} saveReview={evidence.saveReview}
                    adoption={{
                      commercial: adoption.commercialLines.find((c) => c.id === selected.id) ?? null,
                      records: adoption.records, available: adoption.adoptionAvailable, busy: adoption.busy, onAdopt: adoption.adopt,
                    }} />
                : <p className="text-sm text-muted-foreground">Select a BOQ line to review its rate evidence.</p>}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
