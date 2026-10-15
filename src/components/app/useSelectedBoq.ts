// Which BOQ the BOQ and Export steps act on: ?boq= when it belongs to this
// project, else the project's most recently analysed BOQ, else its newest —
// the same default the workspace's Review entry uses (useProjectBoqs.ts).
import { useSearchParams } from "react-router-dom";
import { useMostRecentlyAnalyzedBoqId, useProjectBoqs } from "@/hooks/useProjectBoqs";

export function useSelectedBoq(projectId: string) {
  const [params, setParams] = useSearchParams();
  const boqsQ = useProjectBoqs(projectId);
  const analyzedQ = useMostRecentlyAnalyzedBoqId(projectId);
  const boqs = boqsQ.data ?? [];
  const requested = params.get("boq");
  const selected = boqs.find((b) => b.id === requested) ?? boqs.find((b) => b.id === analyzedQ.data) ?? boqs[0] ?? null;
  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("boq", id);
    setParams(next, { replace: true });
  };
  return {
    boqs, selected, select,
    loading: boqsQ.isLoading || analyzedQ.isLoading,
    error: boqsQ.isError,
    /** ?boq= named a BOQ that is not in this project (stale or foreign link). */
    requestedMissing: !!requested && boqsQ.isSuccess && !boqs.some((b) => b.id === requested),
  };
}
