// MEASUREMENT ACCURACY LAB — admin-only evaluation panel inside the BOQ Review Workstation.
//
// Two reference modes:
//   • Blind founder reference (default): Stage A records the drawing's measurements with NO engine
//     output visible (BlindReferenceCapture). Only after the reference is locked does Stage B reveal
//     the engines. Corrections to a locked reference are explicit, auditable amendments.
//   • Historical benchmark: a reference file (e.g. the developer Gold Set) is loaded instead; labelled
//     as such, never as blind.
// Both engines (recovered 1de95f6, current 9ac1f71) run unchanged and are frozen; human verdicts and
// corrections are append-only and hash-chained; Track B (in-house + AI) is shown as unavailable.
// Storage is this browser only. Nothing here writes to the BOQ, pricing, exports, analysis runs or the
// review/apply path, and nothing here calls a server.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min?url";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PdfEvidenceViewer from "@/components/review/PdfEvidenceViewer";
import BlindReferenceCapture from "@/components/review/BlindReferenceCapture";
import type { ReferenceDimension } from "@/lib/measurement-quality/ledger";
import {
  appendVerdict, buildLabReport, ENGINES, freezeRun, latestVerdicts, runEngineOn, sha256Hex, verifyLog,
  type CorrectionEvent, type EngineId, type FrozenRun, type Verdict,
} from "@/lib/measurement-lab/core";
import { appendReferenceEvent, replay, toReferenceDimensions, type RefEvent, type RefEventBody, type ReferenceMeasurement } from "@/lib/measurement-lab/reference";
import { TRACK_B_STATUS } from "@/lib/measurement-lab/aiTrack";
import { browserStore, checkImport, exportLab, importLab, type LabExport } from "@/lib/measurement-lab/labStore";
import { evidenceFor } from "@/lib/measurement-lab/overlay";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
const ENGINE_IDS = Object.keys(ENGINES) as EngineId[];

interface Drawing { name: string; sha256: string; url: string; bytes: Uint8Array; numPages: number; pageSizes: Record<number, { width: number; height: number }> }
interface ReferenceFile { name: string; sha256: string; type: string; items: ReferenceDimension[] }

const download = (name: string, text: string, type: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const badge: Record<string, string> = { accepted: "bg-emerald-600", held: "bg-amber-600", rejected: "bg-red-600", correct: "bg-emerald-700", incorrect: "bg-red-700", unclear: "bg-slate-500" };
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

export default function MeasurementLabPanel() {
  const { user, roles } = useAuth();
  // defence in depth: the launcher already hides the lab from non-admins; the panel refuses too
  if (!user || !roles.includes("admin")) return <p className="text-sm text-muted-foreground" data-testid="measurement-lab-denied">The Measurement Lab is available to signed-in admins only.</p>;
  return <Lab reviewerId={user.id} reviewerLabel={user.email ?? user.id} />;
}

function Lab({ reviewerId, reviewerLabel }: { reviewerId: string; reviewerLabel: string }) {
  const qc = useQueryClient();
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [mode, setMode] = useState<"blind" | "file">("blind");
  const [refFile, setRefFile] = useState<ReferenceFile | null>(null);
  const [refScope, setRefScope] = useState<"blind" | "amended">("blind");
  const [pagesText, setPagesText] = useState("");
  const [engine, setEngine] = useState<EngineId>("engine-9ac1f71");
  const [filter, setFilter] = useState<"all" | "accepted" | "held" | "rejected" | "unverified">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [corrValue, setCorrValue] = useState("");
  const [amend, setAmend] = useState({ ref_id: "", field: "value", to: "", reason: "" });
  const [report, setReport] = useState<ReturnType<typeof buildLabReport> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const storeQ = useQuery({ queryKey: ["measurement-lab-store"], queryFn: browserStore, staleTime: Infinity });
  const store = storeQ.data?.store;
  const sha = drawing?.sha256;
  const runsQ = useQuery({ queryKey: ["measurement-lab-runs", sha], enabled: !!sha && !!store, queryFn: () => store!.getRuns(sha!) });
  const logQ = useQuery({ queryKey: ["measurement-lab-log", sha], enabled: !!sha && !!store, queryFn: () => store!.getLog(sha!) });
  const refLogQ = useQuery({ queryKey: ["measurement-lab-ref", sha], enabled: !!sha && !!store, queryFn: () => store!.getRefLog(sha!) });
  const log: readonly CorrectionEvent[] = useMemo(() => logQ.data ?? [], [logQ.data]);
  const refLog: readonly RefEvent[] = useMemo(() => refLogQ.data ?? [], [refLogQ.data]);
  const refState = useMemo(() => replay(refLog), [refLog]);
  const pages = useMemo(() => {
    if (!drawing) return [];
    const p = pagesText.trim() ? pagesText.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= drawing.numPages) : [];
    return p.length ? [...new Set(p)].sort((a, b) => a - b) : Array.from({ length: drawing.numPages }, (_, i) => i + 1);
  }, [drawing, pagesText]);
  // Stage B (engines visible) only once a blind reference is locked, or a reference file is loaded
  const stageB = mode === "blind" ? refState.locked : !!refFile;
  const runFor = (id: EngineId): FrozenRun | undefined => (runsQ.data ?? []).filter((r) => r.engine.id === id && r.input.pages.join(",") === pages.join(",")).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const run = stageB ? runFor(engine) : undefined;
  const verdicts = useMemo(() => (run ? latestVerdicts(log, run.run_id) : new Map<string, CorrectionEvent>()), [log, run]);
  const list = (run?.measurements ?? []).filter((m) => (filter === "all" ? true : filter === "unverified" ? !verdicts.has(m.id) : m.decision === filter));
  const current = run?.measurements.find((m) => m.id === selected) ?? null;
  const fail = (e: unknown) => setMsg((e as Error).message);
  const refresh = (k: string) => qc.invalidateQueries({ queryKey: [k, sha] });

  const openPdf = useMutation({
    mutationFn: async (f: File) => {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const sha256 = await sha256Hex(bytes);
      const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const pageSizes: Drawing["pageSizes"] = {};
      for (let n = 1; n <= doc.numPages; n++) { const v = (await doc.getPage(n)).getViewport({ scale: 1 }); pageSizes[n] = { width: v.width, height: v.height }; }
      const numPages = doc.numPages;
      await doc.destroy();
      return { name: f.name, sha256, url: URL.createObjectURL(f), bytes, numPages, pageSizes } as Drawing;
    },
    onSuccess: (d) => { setDrawing(d); setSelected(null); setReport(null); setMsg(null); },
    onError: (e) => setMsg(`Could not open the PDF: ${(e as Error).message}`),
  });
  const openReference = useMutation({
    mutationFn: async (f: File) => {
      const raw = new Uint8Array(await f.arrayBuffer());
      const j = JSON.parse(new TextDecoder().decode(raw));
      const items = (j.items ?? []).filter((i: { kind?: string }) => i.kind === "linear_dimension") as ReferenceDimension[];
      if (!items.length) throw new Error("no linear_dimension items in this file");
      return { name: f.name, sha256: await sha256Hex(raw), type: `${String(j.reference_type ?? "unknown provenance")} — historical benchmark, not a blind founder reference`, items };
    },
    onSuccess: (r) => { setRefFile(r); setMsg(null); },
    onError: (e) => setMsg(`Could not read the reference: ${(e as Error).message}`),
  });
  const refEvent = useMutation({
    mutationFn: async (body: RefEventBody) => {
      const existed = (runsQ.data ?? []).length > 0 && refLog.length === 0;
      const next = await appendReferenceEvent(refLog, body, { reviewer_id: reviewerId, reviewer_label: reviewerLabel, drawing_sha256: sha!, engine_runs_existed: existed });
      await store!.appendRefEvent(next[next.length - 1]);
    },
    onSuccess: () => { refresh("measurement-lab-ref"); setMsg(null); },
    onError: fail,
  });
  const runBoth = useMutation({
    mutationFn: async () => {
      const d = drawing!;
      const doc = await pdfjsLib.getDocument({ data: d.bytes.slice() }).promise;
      const out: string[] = [];
      try {
        for (const id of ENGINE_IDS) {
          const r = await freezeRun(id, { name: d.name, sha256: d.sha256, pages }, await runEngineOn(id, doc, pages));
          const prior = (await store!.getRuns(d.sha256)).find((x) => x.run_id === r.run_id);
          await store!.putRun(r);
          out.push(`${ENGINES[id].label}: ${r.measurements.length} measurements${prior ? " — identical to the frozen run already stored (reproduced)" : " — frozen"}`);
        }
      } finally { await doc.destroy(); }
      return out;
    },
    onSuccess: (m) => { refresh("measurement-lab-runs"); setMsg(m.join(" · ")); },
    onError: (e) => setMsg(`Engine run failed: ${(e as Error).message}`),
  });
  const mark = useMutation({
    mutationFn: async (verdict: Verdict) => {
      const v = corrValue.trim() === "" ? null : Number(corrValue);
      const next = await appendVerdict(log, { run_id: run!.run_id, measurement_id: current!.id, verdict, note, reviewer_id: reviewerId, reviewer_label: reviewerLabel, correction: verdict === "incorrect" && v !== null && Number.isFinite(v) ? { value: v } : null });
      await store!.appendEvent(next[next.length - 1]);
    },
    onSuccess: () => { setNote(""); setCorrValue(""); refresh("measurement-lab-log"); },
    onError: fail,
  });
  const reference = useMemo(() => {
    if (mode === "file") return refFile ? { ...refFile, items: refFile.items.filter((i) => i.sha256 === sha) } : undefined;
    if (!refState.locked || !sha) return undefined;
    const items = toReferenceDimensions(refState, sha, refScope);
    return { name: `founder reference (${refScope === "blind" ? "as locked" : "with amendments"})`, sha256: refLog.length ? refLog[refLog.length - 1].hash : "", type: `FOUNDER BLIND REFERENCE — internal development evidence, not independent${refState.engine_runs_existed ? "; engine output existed before it was started" : ""}`, items };
  }, [mode, refFile, refState, refScope, sha, refLog]);
  const makeReport = useMutation({
    mutationFn: async () => {
      const a = runFor("engine-1de95f6"), b = runFor("engine-9ac1f71");
      if (!a || !b) throw new Error("run both engines first");
      return buildLabReport({ drawing: { name: drawing!.name, sha256: drawing!.sha256, pages }, runs: [a, b], reference, log, logIntact: (await verifyLog(log)) === null });
    },
    onSuccess: setReport,
    onError: fail,
  });
  const doImport = useMutation({
    mutationFn: async (f: File) => {
      const x = JSON.parse(await f.text()) as LabExport;
      const problems = await checkImport(x);
      if (problems.length) throw new Error(`Import refused: ${problems.join("; ")}`);
      if (x.drawing_sha256 !== sha) throw new Error("Import refused: the file is for another drawing");
      return importLab(store!, x);
    },
    onSuccess: (r) => { ["measurement-lab-runs", "measurement-lab-log", "measurement-lab-ref"].forEach(refresh); setMsg(`Imported ${r.runs} runs, ${r.events} verdict events, ${r.refEvents} reference events (nothing overwritten).`); },
    onError: fail,
  });

  const history = current ? log.filter((e) => e.run_id === run?.run_id && e.measurement_id === current.id) : [];
  const s = storeQ.data;
  return (
    <div className="space-y-3 text-sm" data-testid="measurement-lab">
      <p className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900">
        Measurement Lab — experimental, admin only. Engines run unchanged and their outputs are frozen. References, verdicts and corrections are append-only.
        Nothing here changes the BOQ, pricing or the review/apply path. Signed in as {reviewerLabel}.
      </p>
      <p className="text-xs text-muted-foreground">
        Storage: {s ? (s.persistent ? `this browser${s.durable ? " (protected from automatic clearing)" : s.durable === false ? " (the browser may clear it under storage pressure — export regularly)" : ""}${s.usage ? ` · ${mb(s.usage.used)} of ${mb(s.usage.quota)}` : ""}` : "memory only (browser storage blocked) — export before leaving") : "…"}.
        It is not synced to other devices.
      </p>
      {msg && <p className="text-muted-foreground" role="status">{msg}</p>}

      <Card><CardContent className="pt-4 space-y-2">
        <div className="font-medium">1. Drawing</div>
        <label className="block">Drawing (PDF) <Input type="file" accept="application/pdf" aria-label="Drawing PDF" onChange={(e) => e.target.files?.[0] && openPdf.mutate(e.target.files[0])} /></label>
        {drawing && <div className="text-xs text-muted-foreground">{drawing.name} · {drawing.numPages} pages · sha256 <code>{drawing.sha256}</code></div>}
        <label className="block">Pages for the engines (blank = all) <Input value={pagesText} onChange={(e) => setPagesText(e.target.value)} placeholder="e.g. 1,3,4" aria-label="Pages" /></label>
        <div className="flex gap-2 items-center text-xs">Reference:
          <Select value={mode} onValueChange={(v) => { setMode(v as "blind" | "file"); setReport(null); }}>
            <SelectTrigger className="w-80" aria-label="Reference mode"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="blind">Blind founder reference (Stage A → B)</SelectItem><SelectItem value="file">Historical benchmark: reference file (not blind)</SelectItem></SelectContent>
          </Select>
        </div>
        {mode === "file" && <label className="block">Reference file (Gold Set JSON) <Input type="file" accept="application/json" aria-label="Reference JSON" onChange={(e) => e.target.files?.[0] && openReference.mutate(e.target.files[0])} /></label>}
        {mode === "file" && refFile && <div className="text-xs text-muted-foreground">{refFile.name} · {refFile.items.length} dimensions · {refFile.type} · sha256 <code>{refFile.sha256.slice(0, 16)}…</code></div>}
      </CardContent></Card>

      {drawing && mode === "blind" && !refState.locked && (
        <Card><CardContent className="pt-4">
          <div className="font-medium mb-1">2. Stage A — blind reference</div>
          <BlindReferenceCapture fileUrl={drawing.url} fileName={drawing.name} pageSizes={drawing.pageSizes} numPages={drawing.numPages} state={refState}
            engineRunsExisted={refState.engine_runs_existed || ((runsQ.data ?? []).length > 0 && refLog.length === 0)} busy={refEvent.isPending}
            onAdd={(r: ReferenceMeasurement) => refEvent.mutate({ type: "add", record: r })} onEdit={(r) => refEvent.mutate({ type: "edit", record: r })}
            onWithdraw={(id, reason) => refEvent.mutate({ type: "withdraw", ref_id: id, reason })} onLock={() => refEvent.mutate({ type: "lock", note: "locked before engine results were revealed" })} />
        </CardContent></Card>
      )}

      {drawing && stageB && (<>
        {mode === "blind" && (
          <Card><CardContent className="pt-4 space-y-2 text-xs">
            <div className="font-medium text-sm">Locked reference — {refState.current.length} measurements (locked {refState.locked_at?.slice(0, 16).replace("T", " ")})</div>
            <div className="flex gap-2 items-center">Score against:
              <Select value={refScope} onValueChange={(v) => setRefScope(v as "blind" | "amended")}><SelectTrigger className="w-64" aria-label="Reference version"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="blind">the reference as locked (blind)</SelectItem><SelectItem value="amended">the reference with amendments</SelectItem></SelectContent></Select>
            </div>
            <div className="grid gap-1 md:grid-cols-5">
              <Select value={amend.ref_id} onValueChange={(v) => setAmend({ ...amend, ref_id: v })}><SelectTrigger aria-label="Amend reference"><SelectValue placeholder="reference to amend" /></SelectTrigger>
                <SelectContent>{refState.current.map((r) => <SelectItem key={r.ref_id} value={r.ref_id}>{r.ref_id} · {r.printed_text}</SelectItem>)}</SelectContent></Select>
              <Select value={amend.field} onValueChange={(v) => setAmend({ ...amend, field: v })}><SelectTrigger aria-label="Amend field"><SelectValue /></SelectTrigger>
                <SelectContent>{["value", "derivability", "associated_element", "notes"].map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent></Select>
              <Input value={amend.to} onChange={(e) => setAmend({ ...amend, to: e.target.value })} placeholder="new value" aria-label="Amend to" />
              <Input value={amend.reason} onChange={(e) => setAmend({ ...amend, reason: e.target.value })} placeholder="reason (required)" aria-label="Amend reason" />
              <Button size="sm" variant="outline" disabled={!amend.ref_id || !amend.reason.trim() || refEvent.isPending}
                onClick={() => refEvent.mutate({ type: "amend", ref_id: amend.ref_id, changes: { [amend.field]: amend.field === "value" ? Number(amend.to) : amend.to } as Partial<ReferenceMeasurement>, reason: amend.reason }, { onSuccess: () => setAmend({ ref_id: "", field: "value", to: "", reason: "" }) })}>Record amendment</Button>
            </div>
            {refState.current.filter((r) => r.amended).map((r) => <div key={r.ref_id}>{r.ref_id}: {r.history.map((h) => `${h.at.slice(0, 16).replace("T", " ")} ${h.reviewer_label}: ${JSON.stringify(h.changes)} — ${h.reason}`).join("; ")} (original kept)</div>)}
          </CardContent></Card>
        )}

        <Card><CardContent className="pt-4 space-y-2">
          <div className="font-medium">{mode === "blind" ? "3" : "2"}. Stage B — engines (frozen)</div>
          <Button size="sm" disabled={!store || runBoth.isPending} onClick={() => runBoth.mutate()}>{runBoth.isPending ? "Running…" : "Run both engines"}</Button>
          <table className="w-full text-xs"><tbody>
            {ENGINE_IDS.map((id) => { const r = runFor(id); return (
              <tr key={id}><td className="pr-2">Track A · {ENGINES[id].label}</td><td>{r ? <>{r.measurements.length} · {r.counts.accepted} accepted / {r.counts.held} held / {r.counts.rejected} rejected · output <code>{r.output_sha256.slice(0, 12)}…</code></> : "not run"}</td></tr>); })}
            <tr><td className="pr-2">Track B · in-house + AI</td><td className="text-muted-foreground" data-testid="track-b-status">Unavailable — {TRACK_B_STATUS.reason}</td></tr>
          </tbody></table>
        </CardContent></Card>

        {run && (
          <Card><CardContent className="pt-4 space-y-2">
            <div className="font-medium">Verify each engine measurement</div>
            <div className="flex flex-wrap gap-2">
              <Select value={engine} onValueChange={(v) => { setEngine(v as EngineId); setSelected(null); }}>
                <SelectTrigger className="w-64" aria-label="Engine"><SelectValue /></SelectTrigger>
                <SelectContent>{ENGINE_IDS.map((id) => <SelectItem key={id} value={id}>{ENGINES[id].label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                <SelectTrigger className="w-40" aria-label="Filter"><SelectValue /></SelectTrigger>
                <SelectContent>{["all", "accepted", "held", "rejected", "unverified"].map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground self-center">{verdicts.size}/{run.measurements.length} verified</span>
            </div>
            <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
              <ol className="max-h-[480px] overflow-auto border rounded" aria-label="Measurements">
                {list.map((m) => { const v = verdicts.get(m.id); return (
                  <li key={m.id}><button type="button" onClick={() => setSelected(m.id)} className={`w-full text-left px-2 py-1 flex justify-between gap-2 ${selected === m.id ? "bg-primary/10" : ""}`}>
                    <span>{m.id} · “{m.text}”</span>
                    <span className="flex gap-1"><span className={`rounded px-1 text-white text-[10px] ${badge[m.decision]}`}>{m.decision}</span>{v && <span className={`rounded px-1 text-white text-[10px] ${badge[v.verdict]}`}>{v.verdict}</span>}</span>
                  </button></li>); })}
              </ol>
              <div className="space-y-2 min-w-0">
                {current ? (<>
                  <div className="h-[420px] border rounded overflow-hidden"><PdfEvidenceViewer fileUrl={drawing.url} source={evidenceFor(current, drawing.pageSizes[current.page])} documentName={drawing.name} /></div>
                  <div className="text-xs space-y-1">
                    <div><b>{current.id}</b> · page {current.page} · printed “{current.text}” → {current.value} {current.unit ?? "(no unit)"} · engine: <b>{current.decision}</b> ({current.status})</div>
                    {current.span && <div>endpoints ({current.span.start.join(", ")}) → ({current.span.end.join(", ")}) · {current.span.length} pt</div>}
                    {current.association && <div>association: {current.association.decision} {current.association.measures ?? ""} {current.association.ends.map((e) => (e.kind === "grid" ? `grid ${e.labels?.join("/")}` : e.kind)).join(" ↔ ")}</div>}
                    {current.reasons.length > 0 && <div className="text-muted-foreground">{current.reasons.join(" | ")}</div>}
                  </div>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (required for incorrect or unclear)" aria-label="Verdict note" rows={2} />
                  <Input value={corrValue} onChange={(e) => setCorrValue(e.target.value)} placeholder="Corrected value (optional, with Incorrect)" aria-label="Corrected value" />
                  <div className="flex gap-2">
                    {(["correct", "incorrect", "unclear"] as Verdict[]).map((v) => <Button key={v} size="sm" variant={v === "correct" ? "default" : "outline"} disabled={mark.isPending} onClick={() => mark.mutate(v)}>{v[0].toUpperCase() + v.slice(1)}</Button>)}
                  </div>
                  {history.length > 0 && <ul className="text-xs text-muted-foreground" aria-label="Verdict history">{history.map((e) => <li key={e.hash}>#{e.seq} {e.at.slice(0, 16).replace("T", " ")} · {e.reviewer_label} · <b>{e.verdict}</b>{e.correction?.value !== undefined ? ` → corrected value ${e.correction.value}` : ""}{e.note ? ` — ${e.note}` : ""}</li>)}</ul>}
                </>) : <p className="text-muted-foreground">Select a measurement to see the engine's dimension on the drawing.</p>}
              </div>
            </div>
          </CardContent></Card>
        )}

        <Card><CardContent className="pt-4 space-y-2">
          <div className="font-medium">Report</div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!runFor("engine-1de95f6") || !runFor("engine-9ac1f71") || makeReport.isPending} onClick={() => makeReport.mutate()}>Generate comparison report</Button>
            {report && <>
              <Button size="sm" variant="outline" onClick={() => download(`measurement-lab-report-${drawing.sha256.slice(0, 8)}.md`, report.markdown, "text/markdown")}>Download report (.md)</Button>
              <Button size="sm" variant="outline" onClick={() => download(`measurement-lab-report-${drawing.sha256.slice(0, 8)}.json`, JSON.stringify(report.json, null, 1), "application/json")}>Download report (.json)</Button>
            </>}
          </div>
          {report && <pre className="whitespace-pre-wrap text-xs border rounded p-2 max-h-[480px] overflow-auto" data-testid="lab-report">{report.markdown}</pre>}
        </CardContent></Card>
      </>)}

      {drawing && (
        <Card><CardContent className="pt-4 space-y-2 text-xs">
          <div className="font-medium text-sm">Backup</div>
          <div className="flex flex-wrap gap-2 items-center">
            <Button size="sm" variant="outline" onClick={() => download(`measurement-lab-${drawing.sha256.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportLab(drawing.sha256, runsQ.data ?? [], log, refLog), null, 1), "application/json")}>Export everything for this drawing</Button>
            <label>Import a backup <Input type="file" accept="application/json" aria-label="Import backup" onChange={(e) => e.target.files?.[0] && doImport.mutate(e.target.files[0])} /></label>
          </div>
          <div className="text-muted-foreground">An import is checked first (run hashes, both hash chains, same drawing) and never overwrites stored data.</div>
        </CardContent></Card>
      )}
    </div>
  );
}
