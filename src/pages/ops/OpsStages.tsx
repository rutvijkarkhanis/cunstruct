import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";

export default function OpsStages() {
  const { data: stages } = useQuery({
    queryKey: ["stage_master"],
    queryFn: async () => {
      const { data } = await supabase.from("stage_master").select("*").order("sequence");
      return data ?? [];
    },
  });

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Stage Master</h1>
        <p className="text-sm text-muted-foreground">
          Standardized 16-stage construction hierarchy. Used by every project.
        </p>
      </div>

      <div className="space-y-2">
        {stages?.map((s) => (
          <Card key={s.id} className="p-4 flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground grid place-items-center font-semibold text-sm">
              {s.sequence}
            </div>
            <div className="flex-1">
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-muted-foreground">{s.description}</div>
            </div>
            <div className="text-xs text-muted-foreground">
              {s.typical_duration_days} days typical
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}