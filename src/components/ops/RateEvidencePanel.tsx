// Per-line rate evidence: DSR reference, indicative amount, vendor quotations
// and historical firm BOQ rates side by side, with the estimator's notes and a
// PREFERRED CANDIDATE for further review. Evidence, preferences and the
// adoption preview never write the BOQ; only an explicitly confirmed adoption
// (RateAdoptionPreview → useRateAdoption.adopt) changes the commercial rate.

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { DsrMappingRow } from "@/lib/dsrMapping";
import {
  buildRateComparison, EMPTY_QUOTATION_FORM, formFromQuotation, isPreferred, NO_PREFERENCE, parseQuotationForm,
  preferredFromEvidence, type EvidenceItem, type Inclusion, type QuotationForm, type QuotationWrite, type RateReview,
  type VendorQuotation,
} from "@/lib/rateEvidence";
import { findHistoricalRates, type ProjectDocumentRef } from "@/hooks/useRateEvidence";
import { ADOPTION_UNAVAILABLE_MESSAGE, type RateAdoptionRecord } from "@/hooks/useRateAdoption";
import { BASIS_LABEL, currentRateOf, type AdoptionSources, type CommercialLine } from "@/lib/rateAdoption";
import RateAdoptionPreview from "@/components/ops/RateAdoptionPreview";
import type { MappingLine } from "@/hooks/useDsrMapping";

const money = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
/** null = not available; 0 is a real zero. */
const rateCell = (rate: number | null, unit: string | null) =>
  rate == null ? <span className="text-muted-foreground">Not available</span> : <>{money(rate)}{unit ? <span className="text-muted-foreground"> / {unit}</span> : null}</>;

const KIND_LABEL: Record<EvidenceItem["kind"], string> = {
  dsr_reference: "DSR reference", indicative: "Indicative", vendor_quotation: "Vendor quotation", historical_boq: "Historical BOQ",
};

export interface RateEvidencePanelProps {
  boqId: string;
  line: MappingLine;
  mapping: DsrMappingRow | null;
  indicativeAmount: number | null;
  quotations: VendorQuotation[];
  review: RateReview | null;
  documents: ProjectDocumentRef[];
  storageAvailable: boolean;
  busy: boolean;
  today: string;
  saveQuotation: (lineId: string, value: QuotationWrite, existingId?: string) => Promise<boolean>;
  deleteQuotation: (id: string) => Promise<boolean>;
  saveReview: (lineId: string, patch: Partial<RateReview>, success?: string) => Promise<boolean>;
  /** Explicit rate adoption (Stage 5). Omitted = evidence only. */
  adoption?: {
    commercial: CommercialLine | null;
    records: RateAdoptionRecord[];
    available: boolean;
    busy: boolean;
    onAdopt: (line: CommercialLine, item: EvidenceItem, sources: AdoptionSources, acknowledged: string[]) => Promise<boolean>;
  };
}

export default function RateEvidencePanel(p: RateEvidencePanelProps) {
  const { line, mapping, review } = p;
  const disabled = p.busy || !p.storageAvailable;
  const [term, setTerm] = useState(line.description?.split(/\s+/).slice(0, 3).join(" ") ?? "");
  const [notes, setNotes] = useState(review?.notes ?? "");
  const [editing, setEditing] = useState<VendorQuotation | "new" | null>(null);
  const [adoptKey, setAdoptKey] = useState<string | null>(null);

  const { data: historical = [], isFetching: searching, error: searchError } = useQuery({
    queryKey: ["historical-rates", p.boqId, line.dsr_code, term.trim()],
    queryFn: () => findHistoricalRates(p.boqId, { code: line.dsr_code, term }),
  });

  const { items, referenceIssue } = buildRateComparison({
    line, mapping, indicativeAmount: p.indicativeAmount, quotations: p.quotations, historical, today: p.today,
  });
  const preferredItem = items.find((i) => isPreferred(i, review)) ?? null;
  const snapshotDrift = preferredItem && review && preferredItem.rate !== review.preferred_rate;
  const adoption = p.adoption;
  const commercial = adoption?.commercial ?? null;
  const adoptItem = items.find((i) => i.key === adoptKey) ?? null;
  const sourcesFor = (it: EvidenceItem): AdoptionSources => ({
    mapping,
    quotation: p.quotations.find((q) => q.id === it.ref.quotationId) ?? null,
    historical: historical.find((h) => h.id === it.ref.historicalLineId) ?? null,
  });
  const lastAdoption = adoption?.records.find((r) => r.boq_line_id === line.id) ?? null;
  const current = commercial ? currentRateOf(commercial) : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{line.description || "Untitled line"}</CardTitle>
        <p className="text-xs text-muted-foreground">
          Measured: {line.qty == null ? "—" : line.qty.toLocaleString("en-IN", { maximumFractionDigits: 2 })} {line.unit ?? ""}
          {mapping?.dsr_code ? ` · DSR ${mapping.dsr_code}` : " · not mapped to DSR"}
        </p>
        <p className="text-[11px] text-muted-foreground">
          Evidence, preferences and previews don't change the BOQ. Only an explicitly confirmed adoption sets the line's commercial rate; quantities are never changed.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {adoption && commercial && current && (
          <section className="rounded-md border p-3 space-y-1" data-testid="commercial-rate">
            <h3 className="text-sm font-semibold">Commercial rate (used in totals, quotes and exports)</h3>
            <p className="text-sm">
              {rateCell(current.rate, commercial.unit)} <span className="text-xs text-muted-foreground">· {BASIS_LABEL[current.basis]}</span>
              {current.rate != null && commercial.qty != null && commercial.qty > 0 && (
                <span className="text-xs text-muted-foreground"> · amount {money(Math.round(commercial.qty * current.rate))}</span>
              )}
            </p>
            {lastAdoption && (
              <p className="text-xs text-muted-foreground" data-testid="last-adoption">
                Last adopted {money(lastAdoption.adopted_rate)} from {lastAdoption.source_label} on {lastAdoption.confirmed_at.slice(0, 10)}
                {lastAdoption.previous_rate != null ? ` (was ${money(lastAdoption.previous_rate)})` : ""}
              </p>
            )}
          </section>
        )}
        {/* Preferred candidate */}
        <section className="rounded-md border p-3 space-y-1" data-testid="preferred-candidate">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Preferred candidate for review</h3>
            <Badge variant="outline">Not adopted — BOQ rates unchanged</Badge>
          </div>
          {review?.preferred_kind ? (
            <>
              <p className="text-sm">
                {review.preferred_source_label} — {rateCell(review.preferred_rate, review.preferred_unit)}
                {review.preferred_rate_date && <span className="text-muted-foreground"> · {review.preferred_rate_date}</span>}
              </p>
              {snapshotDrift && (
                <p className="text-xs text-amber-700 dark:text-amber-400 inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />The source now shows a different rate; the preference keeps the rate recorded when it was chosen.
                </p>
              )}
              {!preferredItem && review.preferred_kind !== "dsr_reference" && (
                <p className="text-xs text-muted-foreground">The source record is no longer listed; the recorded snapshot is kept.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {adoption && preferredItem && (
                  <Button size="sm" variant="outline" onClick={() => setAdoptKey(preferredItem.key)}>Review for adoption…</Button>
                )}
                <Button size="sm" variant="ghost" disabled={disabled}
                  onClick={() => p.saveReview(line.id, { ...NO_PREFERENCE }, "Preference cleared")}>Clear preference</Button>
              </div>
            </>
          ) : <p className="text-sm text-muted-foreground">None chosen. Nothing is selected automatically.</p>}
        </section>

        {/* Comparison */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Rate comparison</h3>
          {referenceIssue && <p className="text-xs text-muted-foreground">No % comparison against DSR: {referenceIssue}.</p>}
          {items.length === 0 ? <p className="text-sm text-muted-foreground">No rate evidence for this line yet.</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>vs DSR reference</TableHead>
                  <TableHead>Basis &amp; caveats</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => {
                  const preferred = isPreferred(it, review);
                  return (
                    <TableRow key={it.key} data-testid={`evidence-${it.key}`} className={cn(preferred && "bg-primary/5")}>
                      <TableCell className="max-w-[16rem] align-top">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{KIND_LABEL[it.kind]}</div>
                        <div className="text-sm">{it.source}</div>
                        {it.detail && <div className="text-[11px] text-muted-foreground line-clamp-2" title={it.detail}>{it.detail}</div>}
                      </TableCell>
                      <TableCell className="text-xs align-top whitespace-nowrap">{it.dateLabel}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums align-top whitespace-nowrap">
                        {rateCell(it.rate, it.unit)}
                        {it.unitCheck !== "match" && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-400">
                            {it.unitCheck === "mismatch" ? "Unit differs" : "Unit missing"}: {it.unit || "none"} vs measured {line.unit || "none"}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs align-top">
                        {it.pctVsReference != null
                          ? <span className="font-medium tabular-nums">{it.pctVsReference > 0 ? "+" : ""}{it.pctVsReference}%</span>
                          : <span className="text-muted-foreground">{it.notComparedReason ?? "—"}</span>}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground align-top max-w-[16rem]">
                        <ul className="space-y-0.5">{it.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col gap-1 items-start">
                          {preferred ? <Badge>Preferred</Badge> : it.kind !== "indicative" && (
                            <Button size="sm" variant="outline" disabled={disabled || !it.preferable}
                              onClick={() => p.saveReview(line.id, preferredFromEvidence(it), "Preferred candidate recorded")}>
                              Prefer for review
                            </Button>
                          )}
                          {adoption && commercial && it.kind !== "indicative" && (
                            <Button size="sm" variant="ghost" onClick={() => setAdoptKey(it.key)}>Adopt…</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>

        {adoption && commercial && adoptItem && (
          <RateAdoptionPreview key={adoptItem.key} line={commercial} item={adoptItem} sources={sourcesFor(adoptItem)} today={p.today}
            available={adoption.available} unavailableMessage={ADOPTION_UNAVAILABLE_MESSAGE} busy={adoption.busy}
            onCancel={() => setAdoptKey(null)}
            onConfirm={async (acked) => {
              const ok = await adoption.onAdopt(commercial, adoptItem, sourcesFor(adoptItem), acked);
              if (ok) setAdoptKey(null);
            }} />
        )}

        {/* Historical search */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Historical rates from the firm's BOQs</h3>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input aria-label="Search historical BOQ lines" className="pl-8" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Words from the item description" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Matched {line.dsr_code ? `by DSR code ${line.dsr_code} and ` : ""}by description, from other BOQs recorded in Cunstruct.
            {searching ? " Searching…" : ` ${historical.length} found.`} BOQ records don't hold execution status or awarded
            rates, so a historical rate is shown as the BOQ recorded it and is never treated as current.
          </p>
          {searchError && <p className="text-xs text-destructive">Historical search failed: {(searchError as Error).message}</p>}
        </section>

        {/* Estimator notes */}
        <section className="space-y-2">
          <label htmlFor="rate-notes" className="text-sm font-semibold">Estimator notes</label>
          <Textarea id="rate-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reasoning, follow-ups, vendor clarifications" />
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => p.saveReview(line.id, { notes: notes.trim() || null }, "Notes saved")}>Save notes</Button>
        </section>

        {/* Quotations */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Vendor quotations ({p.quotations.length})</h3>
            {editing == null && <Button size="sm" disabled={disabled} onClick={() => setEditing("new")}>Record quotation</Button>}
          </div>
          {editing != null && (
            <QuotationFormView key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? EMPTY_QUOTATION_FORM : formFromQuotation(editing)}
              documents={p.documents} busy={p.busy} measuredUnit={line.unit}
              onCancel={() => setEditing(null)}
              onSubmit={async (value) => {
                const ok = await p.saveQuotation(line.id, value, editing === "new" ? undefined : editing.id);
                if (ok) setEditing(null);
              }} />
          )}
          {p.quotations.map((q) => (
            <div key={q.id} className="rounded-md border p-2 text-xs flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{q.vendor_name}</span> · {q.status}
                {q.source_document_id && <> · document: {p.documents.find((d) => d.id === q.source_document_id)?.name ?? "linked document"}</>}
                {q.notes && <> · {q.notes}</>}
              </span>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setEditing(q)}>Edit</Button>
                <Button size="sm" variant="ghost" disabled={disabled} onClick={() => p.deleteQuotation(q.id)}>Delete</Button>
              </span>
            </div>
          ))}
        </section>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs"><span className="font-medium">{label}</span>{children}</label>;
}

const selectCls = "h-9 rounded-md border border-input bg-background px-2 text-sm";

function InclusionSelect({ label, value, onChange }: { label: string; value: Inclusion; onChange: (v: Inclusion) => void }) {
  return (
    <Field label={label}>
      <select aria-label={label} className={selectCls} value={value} onChange={(e) => onChange(e.target.value as Inclusion)}>
        <option value="not_stated">Not stated</option>
        <option value="included">Included</option>
        <option value="excluded">Excluded</option>
      </select>
    </Field>
  );
}

function QuotationFormView({ initial, documents, busy, measuredUnit, onSubmit, onCancel }: {
  initial: QuotationForm; documents: ProjectDocumentRef[]; busy: boolean; measuredUnit: string | null;
  onSubmit: (v: QuotationWrite) => void; onCancel: () => void;
}) {
  const [f, setF] = useState<QuotationForm>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const set = <K extends keyof QuotationForm>(k: K, v: QuotationForm[K]) => setF((s) => ({ ...s, [k]: v }));
  const txt = (k: keyof QuotationForm, label: string, extra?: Partial<InputHTMLAttributes<HTMLInputElement>>) => (
    <Field label={label}><Input aria-label={label} value={f[k] as string} onChange={(e) => set(k, e.target.value as never)} {...extra} /></Field>
  );

  return (
    <form className="rounded-md border p-3 space-y-3" aria-label="Quotation"
      onSubmit={(e) => {
        e.preventDefault();
        const r = parseQuotationForm(f);
        if (r.ok === false) { setErrors(r.errors); return; }
        setErrors([]);
        onSubmit(r.value);
      }}>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Status">
          <select aria-label="Status" className={selectCls} value={f.status} onChange={(e) => set("status", e.target.value as QuotationForm["status"])}>
            <option value="received">Received</option>
            <option value="incomplete">Incomplete</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </Field>
        {txt("vendor_name", "Vendor name")}
        {txt("vendor_contact", "Vendor contact")}
      </div>
      <Field label="Quoted description / specification">
        <Textarea aria-label="Quoted description / specification" rows={2} value={f.quoted_description} onChange={(e) => set("quoted_description", e.target.value)} />
      </Field>
      <div className="grid gap-2 sm:grid-cols-3">
        {txt("quoted_rate", "Quoted rate (₹)", { inputMode: "decimal", disabled: f.status === "unavailable" })}
        {txt("quoted_unit", `Quoted unit (BOQ: ${measuredUnit || "none"})`)}
        <Field label="Same scope/spec as the BOQ line?">
          <select aria-label="Same scope/spec as the BOQ line?" className={selectCls} value={f.spec_match} onChange={(e) => set("spec_match", e.target.value as QuotationForm["spec_match"])}>
            <option value="unclear">Not confirmed</option>
            <option value="matches">Matches</option>
            <option value="differs">Differs</option>
          </select>
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <InclusionSelect label="Tax" value={f.tax_treatment} onChange={(v) => set("tax_treatment", v)} />
        <InclusionSelect label="Freight" value={f.freight} onChange={(v) => set("freight", v)} />
        <InclusionSelect label="Installation" value={f.installation} onChange={(v) => set("installation", v)} />
        {txt("tax_pct", "Tax % (if stated)", { inputMode: "decimal" })}
        {txt("freight_amount", "Freight amount (if stated)", { inputMode: "decimal" })}
        {txt("installation_amount", "Installation amount (if stated)", { inputMode: "decimal" })}
      </div>
      {txt("other_charges", "Other stated charges")}
      <div className="grid gap-2 sm:grid-cols-3">
        {txt("quotation_date", "Quotation date", { type: "date" })}
        {txt("valid_until", "Valid until", { type: "date" })}
        {txt("quotation_ref", "Quotation reference")}
      </div>
      <Field label="Source document">
        <select aria-label="Source document" className={selectCls} value={f.source_document_id} onChange={(e) => set("source_document_id", e.target.value)}>
          <option value="">None linked</option>
          {documents.map((d) => <option key={d.id} value={d.id}>{d.name}{d.doc_type ? ` (${d.doc_type})` : ""}</option>)}
        </select>
        <span className="text-[11px] text-muted-foreground">Upload the quotation file in the project's Documents first, then link it here.</span>
      </Field>
      <div className="grid gap-2 sm:grid-cols-3">
        {txt("exclusions", "Exclusions")}
        {txt("conditions", "Commercial conditions")}
        {txt("notes", "Notes")}
      </div>
      {errors.length > 0 && (
        <ul className="text-xs text-destructive list-disc pl-4" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>Save quotation</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
