// One BOQ line's recorded changes (lib/app/lineHistory): what changed, from
// what to what, when, and whether it was a manual edit or applied from the
// drawing review. Read-only. Says so when history is not set up on this
// database, and when it could not be read — never an empty list instead.
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { describeChange, lineHistoryKey, loadLineHistory } from "@/lib/app/lineHistory";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function LineHistoryPanel({ lineId, label }: { lineId: string; label: string }) {
  const q = useQuery({ queryKey: lineHistoryKey(lineId), queryFn: () => loadLineHistory(lineId) });
  return (
    <section aria-label={`Change history for ${label}`} className="space-y-1.5 text-sm">
      <h4 className="font-medium">Change history</h4>
      {q.isLoading ? (
        <Skeleton className="h-10 w-full max-w-md" />
      ) : q.isError ? (
        <div role="alert" className="space-y-1">
          <p>Could not load this line's history.</p>
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Retry</Button>
        </div>
      ) : !q.data!.available ? (
        <p className="text-muted-foreground">Change history is not set up on this database, so changes to this line are not recorded.</p>
      ) : q.data!.rows.length === 0 ? (
        <p className="text-muted-foreground">No recorded changes. The line is as it was created or imported.</p>
      ) : (
        <ol className="space-y-1">
          {q.data!.rows.map((r) => {
            const d = describeChange(r);
            return (
              <li key={r.id} className="flex flex-wrap gap-x-3">
                <span className="tabular-nums text-muted-foreground">{when(r.changed_at)}</span>
                <span>{d.what}</span>
                <span className="text-muted-foreground">{d.why}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
