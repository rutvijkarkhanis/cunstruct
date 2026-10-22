// Check & finalise — the schedule check. Matches the BOQ's lines against the
// BOQ's own schedule (DSR <rate_year>), lists the lines whose match is not
// reliable and why, offers the schedule rate where code and unit check out,
// and lists work the schedule says is excluded from matched items (lib/dsr).
// A suggestion never adds a quantity or a rate: Accept adds a PENDING line;
// the rate is a separate, audited step.
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { buildDsrIndex, matchLine, type MatchResult } from "@/lib/dsr/match";
import { measurementNotes, scheduleLabel, matchableDescription, type DsrItem } from "@/lib/dsr/catalogue";
import { SCOPE_LIMITATIONS, scopeSuggestions, type ScopeSuggestion } from "@/lib/dsr/scope";
import {
  acceptScopeSuggestion, applyScheduleRate, decisionsFromSpec, loadDsrSchedule, saveScopeDecision,
  scheduleRateProblem, type ScopeDecision, type ScopeDecisionRecord,
} from "@/lib/dsr/scopeStore";
import { appBoqLinesKey, type AppBoqLine } from "@/lib/app/boqLines";
import { boqFilterPath } from "@/lib/app/journey";
import { useStepLink } from "./useStepLink";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const SOURCE = "DSR";
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const VERDICT: Record<MatchResult["verdict"], string> = { reliable: "Reliable match", possible: "Possible match — check", none: "No reliable match" };
const DECISION: Record<ScopeDecision, string> = { accepted: "Accepted", rejected: "Rejected", deferred: "Deferred" };
/** The variant part of a schedule description ("… : — Columns, piers …"). */
const variant = (d: string | null) => {
  const parts = matchableDescription(d).split(/\s[—–]\s|:\s*[—–]/);
  return (parts[parts.length - 1] ?? "").trim();
};

export default function DsrCheckSection({ projectId, boqId, lines, spec, rateYear, boqQueryKey }: {
  projectId: string; boqId: string; lines: AppBoqLine[]; spec: unknown; rateYear: string | null; boqQueryKey: readonly unknown[];
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const schedule = { source: SOURCE, year: rateYear };
  const label = scheduleLabel(SOURCE, rateYear);
  const catQ = useQuery({ queryKey: ["dsr-schedule", SOURCE, rateYear], queryFn: () => loadDsrSchedule(SOURCE, rateYear), staleTime: Infinity });
  const index = useMemo(() => (catQ.data ? buildDsrIndex(catQ.data, SOURCE, rateYear) : null), [catQ.data, rateYear]);
  const included = useMemo(() => lines.filter((l) => l.included !== false), [lines]);
  const matches = useMemo(() => new Map(index ? included.map((l) => [l.id, matchLine(l, index)] as const) : []), [index, included]);
  const suggestions = useMemo(() => (index ? scopeSuggestions(lines, matches, index) : []), [index, lines, matches]);
  const decisions = decisionsFromSpec(spec);
  const byCode = useMemo(() => new Map((catQ.data ?? []).map((i) => [i.code, i])), [catQ.data]);
  const [busy, setBusy] = useState<string | null>(null);
  // One action at a time, also between two clicks that land before the
  // disabled buttons re-render (a double click).
  const inFlight = useRef(false);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: boqQueryKey }), qc.invalidateQueries({ queryKey: appBoqLinesKey(boqId) })]);
  const run = async (key: string, fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(`Not saved — ${(e as Error).message}`); } finally { inFlight.current = false; setBusy(null); await refresh(); }
  };
  const historyNote = (r: { historyRecorded: boolean; unchanged?: true }) => {
    if (r.unchanged) toast.info("Already saved — nothing changed.");
    else if (!r.historyRecorded) toast.warning("Decision saved. Change history is not set up on this database, so it is not in the BOQ's history.", { id: "dsr-history-unavailable" });
  };

  if (catQ.isLoading) return <Shell label={label}><div role="status" aria-label="Loading the schedule"><Skeleton className="h-5 w-64" /></div></Shell>;
  if (catQ.isError) return <Shell label={label}><p role="alert" className="text-sm">Could not load {label}, so the schedule check is unavailable. Nothing else on this page is affected.</p></Shell>;
  if (!index || index.items.length === 0) {
    return <Shell label={label}><p className="text-sm">{label} is not loaded on this database, so lines cannot be checked against it. No match or rate is assumed.</p></Shell>;
  }

  const counts = { reliable: 0, possible: 0, none: 0 };
  for (const m of matches.values()) counts[m.verdict]++;
  const toCheck = included.filter((l) => matches.get(l.id)?.verdict !== "reliable");
  const rateReady = included.filter((l) => {
    const m = matches.get(l.id);
    return m?.basis === "code" && m.verdict === "reliable" && l.dsr_rate == null && !scheduleRateProblem(l, byCode.get(l.dsr_code ?? ""), schedule);
  });

  return (
    <Shell label={label}>
      <p className="text-sm text-muted-foreground">
        Each included line compared with {label} ({index.items.length.toLocaleString("en-IN")} items) on description, unit and specification.
        Matches are suggestions; nothing changes until you act.
      </p>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div><dt className="inline text-muted-foreground">Reliable match: </dt><dd className="inline">{counts.reliable}</dd></div>
        <div><dt className="inline text-muted-foreground">Possible match: </dt><dd className="inline">{counts.possible}</dd></div>
        <div><dt className="inline text-muted-foreground">No reliable match: </dt><dd className="inline">{counts.none}</dd></div>
      </dl>

      {rateReady.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-sm font-medium">Schedule rate available (Pricing)</h4>
          <ul className="space-y-1 text-sm">
            {rateReady.map((l) => {
              const item = byCode.get(l.dsr_code!)!;
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-2">
                  <span className="mr-auto">{l.description} — {label} {item.code}, {inr(item.rate!)} per {item.unit}</span>
                  <Button size="sm" variant="outline" disabled={busy !== null} aria-label={`Use the ${label} rate for ${l.description}`}
                    onClick={() => run(`rate:${l.id}`, async () => {
                      const r = await applyScheduleRate({ boqId, line: l, item, schedule, changedBy: user?.id ?? null });
                      if (r.status === "applied") toast.success(r.manualRateStillApplies ? "Schedule rate recorded. This line's manual rate still applies." : "Schedule rate applied.");
                      else if (r.status === "conflict") toast.error("Not saved: this line's rate was changed elsewhere. The current values are now shown.");
                      else if (r.status === "audit_unavailable") toast.error("Not saved: rate changes need change history, which is not set up on this database.");
                      else if (r.status === "invalid") toast.error(`Not saved: ${r.reason}`);
                      else toast.error(r.reverted ? `Not saved: its history record couldn't be saved (${r.message}).` : `Rate saved, but its history record couldn't be saved (${r.message}) and undoing it failed. Check this line.`);
                    })}>Use schedule rate</Button>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">Offered only where the line's code is in {label} and its unit matches the item's. A quantity still pending stays pending.</p>
        </div>
      )}

      {toCheck.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Lines to check against the schedule ({toCheck.length})</summary>
          <ul className="mt-2 space-y-3">
            {toCheck.map((l) => {
              const m = matches.get(l.id)!;
              return (
                <li key={l.id} aria-label={`Schedule match for ${l.description}`}>
                  <p><span className="font-medium">{l.description || "(no description)"}</span> — {VERDICT[m.verdict]}{m.ambiguous ? " (ambiguous)" : ""}</p>
                  <ul className="list-disc pl-5 text-muted-foreground">{m.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  {m.verdict !== "none" && m.candidates.length > 0 && (
                    <p className="text-xs">Closest items: {m.candidates.map((c) => `${c.item.code} (${c.item.unit ?? "no unit"})`).join(", ")}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Possibly missing work ({suggestions.length})</h4>
        {suggestions.length === 0 && <p className="text-sm text-muted-foreground">Nothing the schedule says is excluded from the matched items is missing from this BOQ.</p>}
        {suggestions.map((s) => (
          <Suggestion key={s.key} s={s} rec={decisions[s.key] ?? null} busy={busy} projectId={projectId} boqId={boqId}
            onDecide={(decision, note) => run(`dec:${s.key}`, async () => {
              const r = await saveScopeDecision({ boqId, key: s.key, decision, expected: decisions[s.key] ?? null, note, schedule: label, changedBy: user?.id ?? null });
              if (r.status === "conflict") toast.error("Not saved: this suggestion was decided elsewhere. The current decision is now shown.");
              else historyNote(r);
            })}
            onAccept={(codes, note) => run(`dec:${s.key}`, async () => {
              const section = lines.find((l) => l.id === s.triggers[0]?.lineId)?.section ?? null;
              const r = await acceptScopeSuggestion({ boqId, suggestion: s, codes, expected: decisions[s.key] ?? null, note, schedule, section, changedBy: user?.id ?? null });
              if (r.status === "invalid") toast.error(r.reason);
              else if (r.status === "conflict") toast.error("Not saved: this suggestion was decided elsewhere. The current decision is now shown.");
              else {
                toast.success(`${r.created} pending line${r.created === 1 ? "" : "s"} added. Measure the quantity on the drawings, then match the rate.`);
                if (r.decision.status === "conflict") toast.warning("The lines were added, but the decision changed elsewhere and was not overwritten.");
                else historyNote(r.decision);
              }
            })} />
        ))}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">What this check does not do</summary>
          <ul className="list-disc pl-5">{SCOPE_LIMITATIONS.map((t) => <li key={t}>{t}</li>)}</ul>
        </details>
      </div>
    </Shell>
  );
}

/** "Next" for a suggestion whose added lines outlive its decision. */
const linesRemainNext = (d: ScopeDecision | null) =>
  d === "rejected" ? "Rejected, but lines added earlier remain: remove them in the BOQ, or accept again to keep them."
    : d === "deferred" ? "Deferred; lines added earlier remain in the BOQ with their quantity pending."
      : "No decision recorded; lines added earlier remain in the BOQ with their quantity pending. Accept to record them, or remove them in the BOQ.";

function Shell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby="chk-dsr" className="rounded-md border bg-card p-4 space-y-3">
      <h3 id="chk-dsr" className="font-semibold">Schedule check — {label}</h3>
      {children}
    </section>
  );
}

function Suggestion({ s, rec, busy, projectId, boqId, onDecide, onAccept }: {
  s: ScopeSuggestion; rec: ScopeDecisionRecord | null; busy: string | null; projectId: string; boqId: string;
  onDecide: (d: ScopeDecision | null, note?: string) => void; onAccept: (codes: string[], note?: string) => void;
}) {
  const step = useStepLink();
  const [picking, setPicking] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const disabled = busy !== null;
  const accepted = s.acceptedLineIds.length > 0;
  return (
    <article aria-label={`Suggestion: ${s.title}`} className="rounded-md border p-3 space-y-1.5 text-sm">
      <p className="font-medium">{s.title}{rec && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">{DECISION[rec.decision]}{rec.note ? ` — ${rec.note}` : ""}</span>}</p>
      <p>{s.what}</p>
      <p><span className="text-muted-foreground">Why: </span>{s.why}</p>
      <p><span className="text-muted-foreground">Missing: </span>{s.missingEvidence}</p>
      {s.possibleDuplicates.length > 0 && (
        <div>
          <span className="text-muted-foreground">May already be covered by: </span>
          {s.possibleDuplicates.map((d, i) => (
            <span key={d.lineId}>{i > 0 && ", "}<Link className="underline" to={step(boqFilterPath(projectId, boqId, { q: d.description }))}>{d.description}</Link></span>
          ))}
        </div>
      )}
      <p><span className="text-muted-foreground">Next: </span>{accepted && rec?.decision !== "accepted" ? linesRemainNext(rec?.decision ?? null) : s.nextDecision}</p>
      {accepted && (
        <p>{s.acceptedLineIds.length} pending line{s.acceptedLineIds.length === 1 ? "" : "s"} added. <Link className="underline" to={step(boqFilterPath(projectId, boqId, { status: "pending" }))}>Show pending lines</Link></p>
      )}
      {accepted && rec?.decision !== "accepted" && (
        <p role="note" className="text-xs">{rec ? `${DECISION[rec.decision]} after accepting` : "Decision undone"}: the line{s.acceptedLineIds.length === 1 ? "" : "s"} already added {s.acceptedLineIds.length === 1 ? "is" : "are"} still in the BOQ. Nothing is deleted here — remove {s.acceptedLineIds.length === 1 ? "it" : "them"} in the BOQ if not needed.</p>
      )}

      <input aria-label={`Note on ${s.title} (optional)`} placeholder="Note (optional)" className="w-full rounded border bg-background px-2 py-1 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
      {picking ? (
        <fieldset className="space-y-1 rounded-md border p-2">
          <legend className="px-1 text-xs text-muted-foreground">Choose the schedule item(s) this BOQ needs — each becomes a line with its quantity pending</legend>
          <ul className="max-h-56 space-y-1 overflow-auto">
            {s.options.map((o: DsrItem) => {
              const notes = measurementNotes(o.description);
              return (
                <li key={o.code}>
                  <label className="flex gap-2">
                    <input type="checkbox" checked={codes.includes(o.code)} onChange={(e) => setCodes((c) => (e.target.checked ? [...c, o.code] : c.filter((x) => x !== o.code)))} />
                    <span>{o.code} — {variant(o.description) || matchableDescription(o.description).slice(0, 80)} ({o.unit ?? "no unit"})
                      {notes.length > 0 && <span className="block text-xs text-muted-foreground">Schedule's measurement wording (guidance, not a quantity): “{notes.join("; ")}”</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex gap-2">
            <Button size="sm" disabled={disabled || codes.length === 0} onClick={() => { onAccept(codes, note); setPicking(false); }}>Add {codes.length || ""} pending line{codes.length === 1 ? "" : "s"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>Cancel</Button>
          </div>
        </fieldset>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => setPicking(true)}>{accepted ? "Add another item" : "Accept…"}</Button>
          {rec?.decision !== "rejected" && <Button size="sm" variant="outline" disabled={disabled} onClick={() => onDecide("rejected", note)}>Reject</Button>}
          {rec?.decision !== "deferred" && <Button size="sm" variant="outline" disabled={disabled} onClick={() => onDecide("deferred", note)}>Defer</Button>}
          {rec && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onDecide(null)} aria-label={`Undo the decision on ${s.title}`}>Undo decision</Button>}
        </div>
      )}
    </article>
  );
}
