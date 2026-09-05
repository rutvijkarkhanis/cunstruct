// DOCUMENT SELECTOR — let user choose drawing when analysis source cannot be matched.
//
// Shown when importing an analysis whose source.document doesn't match any
// stored drawing. Offers explicit selection for one drawing, or requires picking
// from multiple. Never silently falls back; user is always in control.

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export interface DocumentSelectorProps {
  searchedFor: string | null;
  availableDrawings: { documentId: string; name: string; originalFilename?: string | null }[];
  onSelect: (documentId: string) => void;
  onCancel: () => void;
}

export default function DocumentSelector({ searchedFor, availableDrawings, onSelect, onCancel }: DocumentSelectorProps) {
  if (availableDrawings.length === 0) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-4 space-y-3">
          <div className="flex gap-2">
            <AlertCircle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="space-y-2 text-sm">
              <div className="font-medium text-amber-900">Analysis drawing not found</div>
              <div className="text-amber-800">
                Analysis references: <span className="font-mono">{searchedFor ?? "(no document reference)"}</span>
              </div>
              <div className="text-amber-700">
                No drawings have been uploaded to this project yet. Upload a PDF in the Documents section first.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (availableDrawings.length === 1) {
    const doc = availableDrawings[0];
    return (
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4 space-y-3">
          <div className="flex gap-2">
            <AlertCircle className="w-5 h-5 text-blue-700 flex-shrink-0 mt-0.5" />
            <div className="space-y-2 text-sm">
              <div className="font-medium text-blue-900">Analysis drawing not found</div>
              <div className="text-blue-800">
                Analysis references: <span className="font-mono">{searchedFor ?? "(no document reference)"}</span>
              </div>
              <div className="text-blue-800">
                This project has one drawing. Use it for this analysis?
              </div>
              <div className="bg-blue-100 rounded px-2 py-1 text-blue-900 font-medium text-sm">
                {doc.name} {doc.originalFilename ? `(${doc.originalFilename})` : ""}
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
            <Button size="sm" onClick={() => onSelect(doc.documentId)}>Use this drawing</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardContent className="p-4 space-y-3">
        <div className="flex gap-2">
          <AlertCircle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="space-y-2 text-sm">
            <div className="font-medium text-amber-900">Analysis drawing not found</div>
            <div className="text-amber-800">
              Analysis references: <span className="font-mono">{searchedFor ?? "(no document reference)"}</span>
            </div>
            <div className="text-amber-800">
              Multiple drawings available. Select which one to use for this analysis:
            </div>
          </div>
        </div>
        <div className="space-y-2">
          {availableDrawings.map((doc) => (
            <Button
              key={doc.documentId}
              variant="outline"
              className="w-full justify-start text-left h-auto py-2"
              onClick={() => onSelect(doc.documentId)}
            >
              <div className="flex flex-col items-start">
                <div className="font-medium">{doc.name}</div>
                {doc.originalFilename && <div className="text-xs text-muted-foreground">{doc.originalFilename}</div>}
              </div>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
