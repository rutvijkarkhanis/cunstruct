import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FileText, Check } from "lucide-react";
import { Link } from "react-router-dom";
import type { ProjectDocument, DocumentRevision, BoqDocumentLink } from "@/lib/projectDocs";

// Assign project documents to THIS BOQ. A document lives once at the project level
// and can be assigned to many BOQs; here we manage the links for one BOQ and record
// which revision this BOQ analysed. Does not touch BOQ lines/quantities/pricing.
export default function BoqDocumentsPanel({ boqId, projectId }: { boqId: string; projectId: string | null }) {
  const qc = useQueryClient();

  const { data: docs } = useQuery({
    queryKey: ["bp-documents", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("project_document")
        .select("id, project_id, name, doc_type, discipline, current_revision_id, status")
        .eq("project_id", projectId!).order("created_at");
      return (data ?? []) as ProjectDocument[];
    },
  });

  const ids = (docs ?? []).map((d) => d.id);
  const { data: revs } = useQuery({
    queryKey: ["bp-revisions", projectId, ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("document_revision")
        .select("id, document_id, label, created_at").in("document_id", ids).order("created_at");
      return (data ?? []) as DocumentRevision[];
    },
  });

  const { data: links } = useQuery({
    queryKey: ["bp-links", boqId],
    queryFn: async () => {
      const { data } = await supabase.from("boq_document")
        .select("id, boq_id, document_id, analyzed_revision_id, applicability_note").eq("boq_id", boqId);
      return (data ?? []) as BoqDocumentLink[];
    },
  });

  const linkFor = (docId: string) => (links ?? []).find((l) => l.document_id === docId);
  const revsFor = (docId: string) => (revs ?? []).filter((r) => r.document_id === docId);

  const toggle = async (doc: ProjectDocument) => {
    const existing = linkFor(doc.id);
    if (existing) {
      const { error } = await supabase.from("boq_document").delete().eq("id", existing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("boq_document")
        .insert({ boq_id: boqId, document_id: doc.id, analyzed_revision_id: doc.current_revision_id });
      if (error) return toast.error(error.message);
    }
    qc.invalidateQueries({ queryKey: ["bp-links", boqId] });
  };

  const setRevision = async (linkId: string, revisionId: string) => {
    const { error } = await supabase.from("boq_document").update({ analyzed_revision_id: revisionId }).eq("id", linkId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["bp-links", boqId] });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" />Assigned documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!docs?.length ? (
          <p className="text-sm text-muted-foreground">
            No project documents yet.{" "}
            {projectId && <Link to={`/ops/projects/${projectId}/documents`} className="text-primary hover:underline">Add documents</Link>}
          </p>
        ) : (
          (docs ?? []).map((d) => {
            const link = linkFor(d.id);
            const assigned = !!link;
            const rs = revsFor(d.id);
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-2 border-b py-2 last:border-0">
                <Button size="sm" variant={assigned ? "default" : "outline"} className="h-8" onClick={() => toggle(d)}>
                  {assigned ? <><Check className="h-3.5 w-3.5 mr-1" />Assigned</> : "Assign"}
                </Button>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{d.name}</div>
                  <div className="text-xs text-muted-foreground">{[d.doc_type, d.discipline].filter(Boolean).join(" · ")}</div>
                </div>
                {assigned && rs.length > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Revision</span>
                    <Select value={link?.analyzed_revision_id ?? ""} onValueChange={(v) => setRevision(link!.id, v)}>
                      <SelectTrigger className="h-8 w-28"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>{rs.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
