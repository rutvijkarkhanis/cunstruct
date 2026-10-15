// Read-only view of ONE saved commercial revision: its header, recorded
// limitations and every saved line with rate provenance — rendered only from
// the revision's own rows. A clearly separate "Since this revision" column
// compares each saved line with the current working BOQ, so the user can see
// what has moved without the revision itself ever being re-derived or changed.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, FileText, Loader2, Sheet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { loadRevisionLines } from "@/hooks/useBoqRevisions";
import { boqStatusLabel } from "@/lib/boqStatus";
import {
  diffRevisionAgainstWorking, limitationText, PROVENANCE_LABEL,
  type RevisionLine, type StoredRevision,
} from "@/lib/boqRevision";

const inr = (n: number | null) => (n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));

export default function RevisionViewer({ rev, issuedByLabel, workingLines, onExport, onClose }: {
  rev: StoredRevision;
  issuedByLabel: string;
  /** The working BOQ as snapshot-shaped lines, for comparison only. */
  workingLines: RevisionLine[];
  onExport: (kind: "pdf" | "pdf_blank" | "csv") => void;
  onClose: () => void;
}) {
  const { data: lines = [], isLoading, error } = useQuery({
    queryKey: ["boq-revision-lines", rev.id],
    queryFn: () => loadRevisionLines(rev.id),
    staleTime: Infinity, // a revision never changes
  });
  const diff = useMemo(() => diffRevisionAgainstWorking(lines, workingLines), [lines, workingLines]);
  const moved = diff.changed + diff.removed + diff.added.length;

  return (
    <section role="region" aria-label={`Revision ${rev.label}`} className="rounded-md border-2 border-primary/40 p-3 space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">{rev.boq_name} — {rev.label} <span className="font-normal text-muted-foreground">(frozen, read-only)</span></h3>
          <p className="text-xs text-muted-foreground">
            Frozen {rev.issued_at.slice(0, 10)} by {issuedByLabel} · BOQ status then: {rev.boq_status_at_issue ? boqStatusLabel(rev.boq_status_at_issue) : "not recorded"}
            {rev.project_name ? ` · ${rev.project_name}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">Freezing records who issued it and when — not that it was sent, awarded or executed.</p>
        </div>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose} aria-label="Close revision"><X className="h-4 w-4" /></Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <div><div className="text-[11px] text-muted-foreground">Works total</div>{inr(rev.works_total)}</div>
        <div><div className="text-[11px] text-muted-foreground">Grand total</div><span data-testid="revision-grand-total">{inr(rev.grand_total)}</span></div>
        <div><div className="text-[11px] text-muted-foreground">Priced lines</div>{rev.priced_line_count} of {rev.line_count}</div>
        <div><div className="text-[11px] text-muted-foreground">Rate year</div>{rev.rate_year ?? "not recorded"}</div>
      </div>

      {rev.limitations.length > 0 && (
        <div className="text-xs">
          <span className="font-medium">Limitations recorded at freeze (acknowledged):</span>
          <ul className="list-disc pl-5" aria-label="Recorded limitations">{rev.limitations.map((l) => <li key={l.code}>{limitationText(l)}</li>)}</ul>
        </div>
      )}
      {rev.issue_note && <p className="text-xs"><span className="font-medium">Issue note:</span> {rev.issue_note}</p>}

      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" onClick={() => onExport("pdf")}><FileText className="h-3.5 w-3.5 mr-1" />PDF</Button>
        <Button size="sm" variant="outline" onClick={() => onExport("pdf_blank")}><FileDown className="h-3.5 w-3.5 mr-1" />PDF / Spec &amp; Qty</Button>
        <Button size="sm" variant="outline" onClick={() => onExport("csv")}><Sheet className="h-3.5 w-3.5 mr-1" />CSV</Button>
      </div>

      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : error ? (
        <p className="text-xs text-destructive">Couldn't load this revision's lines: {(error as Error).message}</p>
      ) : (
        <>
          <p className="text-xs" data-testid="revision-drift">
            {moved === 0
              ? "The working BOQ still matches this revision line for line."
              : `Since this revision, the working BOQ has ${diff.changed} changed, ${diff.removed} removed and ${diff.added.length} added line(s). The revision below is unchanged.`}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Rate basis</TableHead>
                <TableHead>Since this revision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => {
                const d = diff.lines.get(l.position);
                return (
                  <TableRow key={l.position} data-testid={`revision-line-${l.item_no}`} className={cn(!l.included && "opacity-60")}>
                    <TableCell className="text-xs whitespace-nowrap align-top">{l.item_no}</TableCell>
                    <TableCell className="text-xs align-top max-w-[18rem]">
                      <div>{l.description || "Untitled line"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {[l.subhead_name, l.dsr_code, l.source_document_name && `${l.source_document_name}${l.source_page ? ` p.${l.source_page}` : ""}`].filter(Boolean).join(" · ")}
                      </div>
                      {l.limitations.length > 0 && <div className="text-[11px] text-amber-700 dark:text-amber-400">{l.limitations.join(" · ")}</div>}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums align-top whitespace-nowrap">{l.qty ?? "—"} {l.unit ?? ""}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums align-top">{inr(l.rate)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums align-top">{inr(l.amount)}</TableCell>
                    <TableCell className="text-xs align-top">
                      <Badge variant="outline">{PROVENANCE_LABEL[l.rate_provenance]}</Badge>
                      {l.adoption_source_label && (
                        <div className="text-[11px] text-muted-foreground">{l.adoption_source_label}{l.adoption_source_date ? ` · ${l.adoption_source_date}` : ""}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-[11px] align-top">
                      {!d || d.status === "unchanged" ? <span className="text-muted-foreground">Unchanged</span>
                        : d.status === "removed" ? <span className="text-amber-700 dark:text-amber-400">Removed from working BOQ</span>
                        : <ul className="text-amber-700 dark:text-amber-400">{d.changes.map((c) => <li key={c.field}>{c.field}: {c.from} → {c.to}</li>)}</ul>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {diff.added.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Added to the working BOQ since: {diff.added.map((a) => a.description || "Untitled line").join(", ")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
