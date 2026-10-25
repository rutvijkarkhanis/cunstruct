// The project's name in the project header, with Rename: a project started
// from drawings has a temporary name, changed here whenever convenient.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renameProject } from "@/lib/app/draftProject";
import { appProjectsKey } from "@/lib/app/projectsQuery";
import { shellProjectKey } from "./projectShellContext";

export default function ProjectNameEditor({ projectId, name }: { projectId: string; name: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (draft.trim() === name) { setEditing(false); return; }
    setSaving(true);
    setError(null);
    try {
      await renameProject(projectId, draft);
      await Promise.all([
        qc.invalidateQueries({ queryKey: shellProjectKey(projectId) }),
        qc.invalidateQueries({ queryKey: appProjectsKey }),
      ]);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  };

  if (!editing) {
    return (
      <span className="inline-flex items-baseline gap-1.5 min-w-0">
        <h1 className="text-xl font-bold break-words min-w-0">{name}</h1>
        <Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-muted-foreground" onClick={() => { setDraft(name); setError(null); setEditing(true); }}>
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Rename
        </Button>
      </span>
    );
  }
  return (
    <form className="flex flex-wrap items-center gap-2 min-w-0" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h1 className="sr-only">{name}</h1>
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Project name" className="h-8 w-72 max-w-full" autoFocus />
      <Button type="submit" size="sm" disabled={saving || !draft.trim()}>Save</Button>
      <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
      {error && <p role="alert" className="basis-full text-sm text-destructive">{error}</p>}
    </form>
  );
}
