// "Upload drawings" — the drawing-first way into a new project. Choosing (or
// dropping) PDFs creates a draft project with a temporary name and uploads
// each drawing through the existing upload path (uploadProjectDrawing: the
// same documents, revisions and private storage as the Drawings screen).
// Nothing else is asked first. Each file shows its own state; a failed file
// can be retried, or more added to the same project, without starting again.
//
// The project exists as soon as it is created, so a refresh mid-upload loses
// only the files still in flight: the project stays in the list, and more
// drawings can be added from its Drawings screen.
//
// If the person allowed server processing, the drawings' fingerprints are
// computed afterwards (free: no AI). AI analysis is never started here.
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, FileText, Loader2, Upload } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { uploadProjectDrawing } from "@/hooks/useDocumentManagement";
import { appProjectsKey } from "@/lib/app/projectsQuery";
import { checkDrawingFiles, createDraftProject, draftProjectName } from "@/lib/app/draftProject";
import { computeDrawingFingerprints, type FingerprintStatus } from "@/lib/app/drawingFingerprints";
import { MAX_DRAWING_BYTES } from "@/lib/review/drawingStorage";
import { cn } from "@/lib/utils";

type FileState = "rejected" | "waiting" | "uploading" | "uploaded" | "failed";
interface Entry { key: string; file: File; state: FileState; error: string | null }

const STATE_LABEL: Record<FileState, string> = {
  rejected: "Not accepted", waiting: "Waiting", uploading: "Uploading…", uploaded: "Uploaded", failed: "Upload failed",
};
const MAX_MB = Math.round(MAX_DRAWING_BYTES / 1024 / 1024);
let seq = 0;

export default function UploadDrawingsCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [project, setProject] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [allowProcessing, setAllowProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fp, setFp] = useState<{ state: "idle" | "running" | "done" | "failed"; result?: FingerprintStatus; error?: string }>({ state: "idle" });

  const setEntry = (key: string, patch: Partial<Entry>) =>
    setEntries((es) => es.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  const fingerprint = async (projectId: string) => {
    setFp({ state: "running" });
    try { setFp({ state: "done", result: await computeDrawingFingerprints(projectId) }); }
    catch (e) { setFp({ state: "failed", error: e instanceof Error ? e.message : String(e) }); }
  };

  const uploadAll = async (projectId: string, list: Entry[]) => {
    let any = false;
    for (const e of list) {
      setEntry(e.key, { state: "uploading", error: null });
      try {
        await uploadProjectDrawing(projectId, e.file, null);
        setEntry(e.key, { state: "uploaded" });
        any = true;
      } catch (err) {
        setEntry(e.key, { state: "failed", error: err instanceof Error ? err.message : "Upload failed" });
      }
    }
    await qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
    return any;
  };

  const start = async (files: File[]) => {
    if (!user || busy || !files.length) return;
    const checked = checkDrawingFiles(files).map((c): Entry => ({
      key: `f${++seq}`, file: c.file, state: c.ok ? "waiting" : "rejected", error: c.error,
    }));
    setEntries((es) => [...es, ...checked]);
    const accepted = checked.filter((e) => e.state === "waiting");
    if (!accepted.length) return;
    setBusy(true);
    try {
      let target = project;
      if (!target) {
        setCreating(true);
        setCreateError(null);
        try {
          target = await createDraftProject({ name: draftProjectName(accepted.map((e) => e.file)), userId: user.id, allowServerProcessing: allowProcessing });
          setProject(target);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setCreateError(`The project could not be created, so nothing was uploaded: ${msg}`);
          setEntries((es) => es.map((e) => (accepted.some((a) => a.key === e.key) ? { ...e, state: "failed", error: "Not uploaded: the project was not created." } : e)));
          return;
        } finally { setCreating(false); }
        // The new project joins the list straight away, next to the existing ones.
        await qc.invalidateQueries({ queryKey: appProjectsKey });
      }
      const uploaded = await uploadAll(target.id, accepted);
      if (uploaded && allowProcessing) await fingerprint(target.id);
    } finally { setBusy(false); }
  };

  const retry = async (key: string) => {
    const e = entries.find((x) => x.key === key);
    if (!e || !project || busy) return;
    setBusy(true);
    try {
      const uploaded = await uploadAll(project.id, [e]);
      if (uploaded && allowProcessing) await fingerprint(project.id);
    } finally { setBusy(false); }
  };

  const reset = () => { setEntries([]); setProject(null); setCreateError(null); setFp({ state: "idle" }); };
  const uploadedCount = entries.filter((e) => e.state === "uploaded").length;

  return (
    <section aria-labelledby="upload-drawings" className="rounded-md border bg-card p-4 space-y-3">
      <div>
        <h2 id="upload-drawings" className="font-semibold">{project ? `Drawings for ${project.name}` : "Start from your drawings"}</h2>
        <p className="text-sm text-muted-foreground">
          {project
            ? "Add more drawings to this project, or open it to view them."
            : "Upload the project's drawings to start. A project is created with a temporary name; its name and details can be added later."}
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void start(Array.from(e.dataTransfer.files)); }}
        className={cn("rounded-md border-2 border-dashed p-5 flex flex-col items-center gap-2 text-center", dragOver && "border-primary bg-secondary/40")}
      >
        <Button onClick={() => input.current?.click()} disabled={busy || !user} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
          {project ? "Add more drawings" : "Upload drawings"}
        </Button>
        <p className="text-xs text-muted-foreground">Choose files or drop them here. PDF only, up to {MAX_MB} MB each; several at once.</p>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple className="sr-only" aria-label="Choose drawing files"
          data-testid="upload-drawings-input"
          onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; void start(fs); }} />
      </div>

      {!project && (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={allowProcessing} onCheckedChange={(v) => setAllowProcessing(v === true)} className="mt-0.5" aria-label="Allow server processing of these drawings" />
          <span>
            Allow server processing of these drawings. Cunstruct then computes each drawing's fingerprint (free, no AI), which
            linking quantities to a drawing revision needs. AI analysis still runs only when you choose <span className="font-medium">Analyze drawings</span>.
          </span>
        </label>
      )}

      {creating && <p role="status" className="text-sm text-muted-foreground">Creating the project…</p>}
      {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}

      {entries.length > 0 && (
        <ul aria-label="Drawing uploads" className="divide-y rounded-md border text-sm">
          {entries.map((e) => (
            <li key={e.key} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 break-all">{e.file.name}</span>
              <span className={cn("shrink-0 inline-flex items-center gap-1", (e.state === "failed" || e.state === "rejected") && "text-destructive")}>
                {e.state === "uploaded" && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                {(e.state === "failed" || e.state === "rejected") && <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                {STATE_LABEL[e.state]}
              </span>
              {e.state === "failed" && project && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void retry(e.key)} aria-label={`Retry ${e.file.name}`}>Retry</Button>
              )}
              {e.error && <p className="basis-full text-xs text-destructive">{e.error}</p>}
            </li>
          ))}
        </ul>
      )}

      {fp.state === "running" && <p role="status" className="text-sm text-muted-foreground">Computing drawing fingerprints (no AI)…</p>}
      {fp.state === "done" && fp.result && (
        <p role="status" className="text-sm">
          Fingerprinted {fp.result.fingerprinted} of {uploadedCount} uploaded drawing{uploadedCount === 1 ? "" : "s"}.
          {fp.result.fingerprinted < uploadedCount && " The rest can be fingerprinted from the project's Drawings screen."}
        </p>
      )}
      {fp.state === "failed" && (
        <div role="alert" className="text-sm text-destructive flex flex-wrap items-center gap-2">
          <span>{fp.error}</span>
          {project && <Button size="sm" variant="outline" disabled={busy} onClick={() => void fingerprint(project.id)}>Retry fingerprints</Button>}
        </div>
      )}

      {project && (
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild disabled={busy}>
            <Link to={`/app/projects/${project.id}/drawings`}>Open {project.name}</Link>
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={reset}>Start another project</Button>
          {uploadedCount === 0 && !busy && <span className="text-sm text-muted-foreground">No drawing has been uploaded yet; the project is kept and drawings can be added later.</span>}
        </div>
      )}
    </section>
  );
}
