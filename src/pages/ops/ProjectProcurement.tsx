import { Card, CardContent } from "@/components/ui/card";
import { PackageSearch } from "lucide-react";

// Placeholder — procurement is a later phase. It will derive requirements from
// finalised BOQ lines and match suppliers/products.
export default function ProjectProcurement() {
  return (
    <Card>
      <CardContent className="p-10 text-center space-y-2">
        <PackageSearch className="h-8 w-8 mx-auto text-muted-foreground" />
        <div className="font-medium">Procurement</div>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Procurement will be generated from finalised BOQ lines — supplier matching, requirement
          lists and order tracking. This section is a placeholder for a later phase.
        </p>
      </CardContent>
    </Card>
  );
}
