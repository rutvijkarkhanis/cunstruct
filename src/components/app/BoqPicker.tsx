import { useId } from "react";
import type { ProjectBoqSummary } from "@/hooks/useProjectBoqs";

/** Native select: fully keyboard/screen-reader accessible and usable at phone width. */
export default function BoqPicker({ boqs, value, onChange }: { boqs: ProjectBoqSummary[]; value: string; onChange: (id: string) => void }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 min-w-0">
      <label htmlFor={id} className="text-sm text-muted-foreground shrink-0">BOQ</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {boqs.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </div>
  );
}
