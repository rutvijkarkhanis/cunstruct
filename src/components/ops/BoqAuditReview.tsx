// BOQ Review — external audit findings inside the BOQ dashboard.
//
// Paste an audit JSON (produced outside Cunstruct), and this panel validates it,
// matches findings to BOQ lines, and lists them with a headline summary. It NEVER
// edits the BOQ: the user Accepts / Dismisses / Resolves / Keeps-Pending each
// finding. No AI, no network beyond persisting the pasted findings.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { ClipboardCheck, ChevronDown, ChevronUp, CheckCircle2, XCircle, RefreshCw, Clock, Plus, Wrench } from "lucide-react";
import { importAuditRun, setFindingState } from "@/lib/auditImport";
import { addFindingAsLine, applyMethodUnit, setLineQty, markLinePending } from "@/lib/applyFinding";
import { reviewSummary, type BoqLineRef, type FindingState } from "@/lib/auditFindings";
import type { AuditFinding, FindingType } from "@/lib/auditJson";

interface LineLike { id: string; section: string | null; description: string | null; unit: string | null; qty: number; external_key?: string | null; }

interface FindingRow {
  id: string;
  boq_line_id: string | null;
  finding_type: FindingType;
  action: string | null;
  scope: string | null; category: string | null; item: string | null; location: string | null;
  current_value: string | null; recommended_value: string | null;
  recommended_method: string | null; recommended_unit: string | null;
  reason: string | null; evidence: string | null;
  state: string;
}

const DB_TO_STATE: Record<string, FindingState> = {
  open: "OPEN", accepted: "ACCEPTED", dismissed: "DISMISSED", resolved: "RESOLVED", kept_pending: "KEPT_PENDING",
};

const TYPE_LABEL: Record<FindingType, string> = {
  MISSING_ITEM: "Missing item", MISSING_SCOPE: "Missing scope", QUANTITY_PENDING: "Quantity pending",
  QUANTITY_ERROR: "Quantity error", METHODOLOGY_ERROR: "Methodology", UNIT_ERROR: "Unit",
  DUPLICATE_ITEM: "Duplicate", MISSING_SPECIFICATION: "Spec missing", INSUFFICIENT_EVIDENCE: "No evidence",
  OTHER: "Other",
};

export default function BoqAuditReview({ boqId, projectId, lines }: { boqId: string; projectId?: string | null; lines: LineLike[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [text, setText] = useState("");

  const { data: findings = [] } = useQuery({
    queryKey: ["boq-audit-findings", boqId],
    queryFn: async (): Promise<FindingRow[]> => {
      const { data, error } = await supabase
        .from("boq_audit_finding")
        .select("id, boq_line_id, finding_type, action, scope, category, item, location, current_value, recommended_value, recommended_method, recommended_unit, reason, evidence, state")
        .eq("boq_id", boqId)
        .order("created_at", { ascending: false })
        .order("sort");
      if (error) {
        // The audit tables come from a migration that may not be applied on every
        // deployment — degrade quietly rather than breaking the BOQ view.
        return [];
      }
      return (data ?? []) as FindingRow[];
    },
  });

  const lineRefs: BoqLineRef[] = useMemo(
    () => lines.map((l) => ({ id: l.id, section: l.section, description: l.description, unit: l.unit, externalKey: l.external_key ?? null })),
    [lines],
  );

  const coveredCount = useMemo(() => lines.filter((l) => l.qty > 0).length, [lines]);
  const summary = useMemo(() => {
    const asFindings: AuditFinding[] = findings.map((f) => ({ findingType: f.finding_type }));
    const states: Record<number, FindingState> = {};
    findings.forEach((f, i) => { states[i] = DB_TO_STATE[f.state] ?? "OPEN"; });
    return reviewSummary(asFindings, coveredCount, states);
  }, [findings, coveredCount]);

  const importMut = useMutation({
    mutationFn: () => importAuditRun({ boqId, projectId, rawText: text, lines: lineRefs }),
    onSuccess: (res) => {
      toast.success(
        res.status === "PASS"
          ? "Audit imported — no issues found."
          : `Imported ${res.findingCount} finding${res.findingCount === 1 ? "" : "s"} · ${res.matchedCount} matched to lines`,
      );
      res.warnings.slice(0, 3).forEach((w) => toast.warning(w));
      setText(""); setShowImport(false);
      qc.invalidateQueries({ queryKey: ["boq-audit-findings", boqId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to import audit JSON"),
  });

  const stateMut = useMutation({
    mutationFn: ({ id, state }: { id: string; state: FindingState }) => setFindingState(id, state),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boq-audit-findings", boqId] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update finding"),
  });

  // Explicit, user-driven BOQ mutations. Each runs ONLY on a button click; the
  // BOQ is never changed by importing an audit. After applying, the finding is
  // moved to its resolved/pending state and both views are refreshed.
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const applyMut = useMutation({
    mutationFn: async ({ run, state, id }: { run: () => Promise<unknown>; state: FindingState; id: string }) => {
      await run();
      await setFindingState(id, state);
    },
    onSuccess: () => {
      toast.success("Applied to the BOQ");
      qc.invalidateQueries({ queryKey: ["boq-audit-findings", boqId] });
      qc.invalidateQueries({ queryKey: ["boq-lines", boqId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to apply to the BOQ"),
  });

  const open_ = findings.filter((f) => DB_TO_STATE[f.state] === "OPEN" || DB_TO_STATE[f.state] === "ACCEPTED" || DB_TO_STATE[f.state] === "KEPT_PENDING");
  const hasFindings = findings.length > 0;

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <button className="flex items-center gap-2 font-semibold" onClick={() => setOpen((o) => !o)}>
            <ClipboardCheck className="w-4 h-4 text-primary" /> BOQ Review
            {hasFindings && <span className="text-xs font-normal text-muted-foreground">({open_.length} open)</span>}
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <Button size="sm" variant="outline" onClick={() => setShowImport((s) => !s)}>Import audit JSON</Button>
        </div>

        {open && (
          <>
            {/* Headline summary buckets */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mt-3 text-center">
              <Stat label="Covered" value={summary.covered} cls="text-green-700" />
              <Stat label="Missing" value={summary.missing} cls="text-red-600" />
              <Stat label="Pending" value={summary.pending} cls="text-amber-600" />
              <Stat label="Methodology" value={summary.methodologyIssues} cls="text-orange-600" />
              <Stat label="Spec" value={summary.specificationIssues} cls="text-purple-600" />
              <Stat label="Duplicate" value={summary.duplicateOrProblematic} cls="text-rose-600" />
              <Stat label="Other" value={summary.other} cls="text-muted-foreground" />
            </div>

            {showImport && (
              <div className="mt-3 space-y-2">
                <Textarea
                  rows={6}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder='Paste the audit JSON here — { "audit": { "status": "...", "findings": [...] } }'
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={!text.trim() || importMut.isPending} onClick={() => importMut.mutate()}>
                    {importMut.isPending ? "Importing…" : "Validate & import"}
                  </Button>
                  <span className="text-xs text-muted-foreground">Findings are advisory — the BOQ is never changed automatically.</span>
                </div>
              </div>
            )}

            {/* Findings list */}
            {hasFindings ? (
              <div className="mt-3 divide-y">
                {findings.map((f) => {
                  const st = DB_TO_STATE[f.state] ?? "OPEN";
                  const terminal = st === "DISMISSED" || st === "RESOLVED";
                  return (
                    <div key={f.id} className={`py-2.5 ${terminal ? "opacity-50" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted">{TYPE_LABEL[f.finding_type]}</span>
                            <span className="font-medium text-sm">{f.item || f.category || f.scope || "—"}</span>
                            {f.location && <span className="text-xs text-muted-foreground">· {f.location}</span>}
                            {st !== "OPEN" && <span className="text-[10px] text-muted-foreground">[{st.replace("_", " ").toLowerCase()}]</span>}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {[f.scope, f.category].filter(Boolean).join(" › ")}
                            {f.current_value && <> · now: <span className="text-foreground">{f.current_value}</span></>}
                            {(f.recommended_method || f.recommended_unit || f.recommended_value) && (
                              <> · suggest: <span className="text-foreground">{[f.recommended_value, f.recommended_method, f.recommended_unit].filter(Boolean).join(" / ")}</span></>
                            )}
                          </div>
                          {f.reason && <div className="text-xs text-muted-foreground mt-0.5">{f.reason}</div>}
                          {f.evidence && <div className="text-[11px] text-muted-foreground/80 mt-0.5">Evidence: {f.evidence}</div>}
                          {!f.boq_line_id && <div className="text-[11px] text-amber-700 mt-0.5">Not matched to a BOQ line</div>}

                          {/* Explicit apply actions — only ever mutate on click */}
                          {!terminal && (
                            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                              {!f.boq_line_id && f.item && (
                                <ActionBtn icon={Plus} label="Add to BOQ" onClick={() => applyMut.mutate({
                                  id: f.id, state: "RESOLVED",
                                  run: () => addFindingAsLine({ boqId, section: f.scope ?? f.category, description: f.item!, unit: f.recommended_unit, method: f.recommended_method, externalKey: f.external_key ?? null, sort: lines.length }),
                                })} />
                              )}
                              {f.boq_line_id && (f.recommended_method || f.recommended_unit) && (
                                <ActionBtn icon={Wrench} label="Apply method/unit" onClick={() => applyMut.mutate({
                                  id: f.id, state: "RESOLVED",
                                  run: () => applyMethodUnit(f.boq_line_id!, f.recommended_method, f.recommended_unit),
                                })} />
                              )}
                              {f.boq_line_id && (
                                <ActionBtn icon={Clock} label="Mark line pending" onClick={() => applyMut.mutate({
                                  id: f.id, state: "KEPT_PENDING",
                                  run: () => markLinePending(f.boq_line_id!),
                                })} />
                              )}
                              {f.boq_line_id && (
                                <span className="inline-flex items-center gap-1">
                                  <Input className="h-7 w-20" type="number" min={0} placeholder="qty"
                                    value={qtyDraft[f.id] ?? (f.recommended_value ?? "")}
                                    onChange={(e) => setQtyDraft((d) => ({ ...d, [f.id]: e.target.value }))} />
                                  <ActionBtn label="Set qty" onClick={() => {
                                    const v = Number(qtyDraft[f.id] ?? f.recommended_value);
                                    if (!Number.isFinite(v) || v < 0) return toast.error("Enter a valid quantity");
                                    applyMut.mutate({ id: f.id, state: "RESOLVED", run: () => setLineQty(f.boq_line_id!, v, f.recommended_method) });
                                  }} />
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <IconBtn title="Accept" active={st === "ACCEPTED"} onClick={() => stateMut.mutate({ id: f.id, state: "ACCEPTED" })}><CheckCircle2 className="w-4 h-4" /></IconBtn>
                          <IconBtn title="Keep pending" active={st === "KEPT_PENDING"} onClick={() => stateMut.mutate({ id: f.id, state: "KEPT_PENDING" })}><Clock className="w-4 h-4" /></IconBtn>
                          <IconBtn title="Resolve" active={st === "RESOLVED"} onClick={() => stateMut.mutate({ id: f.id, state: "RESOLVED" })}><RefreshCw className="w-4 h-4" /></IconBtn>
                          <IconBtn title="Dismiss" active={st === "DISMISSED"} onClick={() => stateMut.mutate({ id: f.id, state: "DISMISSED" })}><XCircle className="w-4 h-4" /></IconBtn>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-3">No audit findings yet. Export this BOQ, audit it externally, then paste the audit JSON here.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded border p-2">
      <div className={`text-lg font-bold ${cls}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function ActionBtn({ icon: Icon, label, onClick }: { icon?: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded border hover:bg-muted">
      {Icon && <Icon className="w-3 h-3" />}{label}
    </button>
  );
}

function IconBtn({ title, active, onClick, children }: { title: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} className={`p-1.5 rounded hover:bg-muted ${active ? "text-primary bg-muted" : "text-muted-foreground"}`}>
      {children}
    </button>
  );
}
