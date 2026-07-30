import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase as catalogSupabase } from "@/lib/supabase";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2, Search, PackageSearch } from "lucide-react";
import { formatINR } from "@/lib/forecastEngine";

export interface PickedProduct {
  id: string;
  name: string;
  selling_price: number | null;
  unit: string | null;
}

/**
 * A searchable catalog picker. Ops uses it to bind a BOQ line to a real
 * product — fixing bad keyword matches and pulling the live price — so the
 * quote is built on confirmed SKUs, not guesses.
 */
export function ProductPicker({
  open, onOpenChange, initialQuery, onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialQuery?: string;
  onPick: (p: PickedProduct) => void;
}) {
  const [q, setQ] = useState(initialQuery ?? "");

  const { data: results, isFetching } = useQuery({
    queryKey: ["product-picker", q],
    enabled: open && q.trim().length >= 2,
    queryFn: async () => {
      const term = q.trim();
      const { data, error } = await catalogSupabase
        .from("products_master")
        .select("id, name, selling_price, unit, brand")
        .ilike("name", `%${term}%`)
        .eq("status", "published")
        .order("name")
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const pick = (p: any) => {
    onPick({ id: String(p.id), name: p.name, selling_price: p.selling_price ?? null, unit: p.unit ?? null });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Find a catalog product</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by product name…"
            className="pl-9"
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">
          {q.trim().length < 2 && (
            <p className="text-sm text-muted-foreground py-8 text-center">Type at least 2 characters to search.</p>
          )}
          {q.trim().length >= 2 && isFetching && (
            <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
          )}
          {q.trim().length >= 2 && !isFetching && (results?.length ?? 0) === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <PackageSearch className="w-5 h-5 mx-auto mb-1 opacity-60" />
              No published products match “{q.trim()}”.
            </div>
          )}
          <div className="divide-y">
            {results?.map((p: any) => (
              <button
                key={p.id}
                onClick={() => pick(p)}
                className="w-full text-left py-2.5 px-2 hover:bg-muted/60 rounded flex items-center justify-between gap-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{p.name}</span>
                  {p.brand && <span className="block text-xs text-muted-foreground truncate">{p.brand}</span>}
                </span>
                <span className="text-sm font-medium whitespace-nowrap">
                  {p.selling_price != null ? formatINR(Number(p.selling_price)) : "—"}
                  {p.unit ? <span className="text-xs text-muted-foreground">/{p.unit}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ProductPicker;
