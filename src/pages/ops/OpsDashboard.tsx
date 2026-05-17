import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { Building2, Layers, Link2 } from "lucide-react";

export default function OpsDashboard() {
  const { data: stats } = useQuery({
    queryKey: ["ops-stats"],
    queryFn: async () => {
      const [projects, stages, mappings] = await Promise.all([
        supabase.from("projects").select("id", { count: "exact", head: true }),
        supabase.from("stage_master").select("id", { count: "exact", head: true }),
        supabase.from("stage_material_mapping").select("id", { count: "exact", head: true }),
      ]);
      return {
        projects: projects.count ?? 0,
        stages: stages.count ?? 0,
        mappings: mappings.count ?? 0,
      };
    },
  });

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Operations Overview</h1>
        <p className="text-sm text-muted-foreground">
          Predictive procurement engine — Phase 1 Foundation
        </p>
      </div>

      <Card className="p-4 bg-primary/5 border-primary/20">
        <div className="flex items-baseline gap-3">
          <div className="text-3xl font-bold text-primary">0%</div>
          <div>
            <div className="font-medium">Proactive Order Rate</div>
            <div className="text-xs text-muted-foreground">
              Orders initiated by Cunstruct before contractor request. Target: 30% by Week 8.
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard to="/ops/projects" icon={Building2} label="Active Projects" value={stats?.projects ?? 0} />
        <StatCard to="/ops/stages" icon={Layers} label="Construction Stages" value={stats?.stages ?? 0} />
        <StatCard to="/ops/mappings" icon={Link2} label="Stage Mappings" value={stats?.mappings ?? 0} />
      </div>

      <Card className="p-6">
        <h2 className="font-semibold mb-2">Phase 1 build status</h2>
        <ul className="text-sm space-y-1 text-muted-foreground">
          <li>✅ Project onboarding wizard</li>
          <li>✅ Stage master (16 stages seeded)</li>
          <li>✅ Stage → Material mapping editor</li>
          <li>⏳ Lead time intelligence — next iteration</li>
          <li>⏳ Forecast engine — next iteration</li>
          <li>⏳ Weekly WhatsApp briefing — next iteration</li>
          <li>⏳ Anomaly detection — next iteration</li>
        </ul>
      </Card>
    </div>
  );
}

function StatCard({
  to,
  icon: Icon,
  label,
  value,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <Link to={to}>
      <Card className="p-5 hover:border-primary transition-colors">
        <Icon className="w-5 h-5 text-primary mb-2" />
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </Card>
    </Link>
  );
}