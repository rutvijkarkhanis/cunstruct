import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2, Search, FileText } from "lucide-react";
import { formatINR } from "@/lib/forecastEngine";

export interface PickedDsr {
  code: string;
  description: string;
  unit: string | null;
  rate: number | null;
  chapter: string | null;
  subhead: string | null;
}

/**
 * Searchable CPWD DSR item picker. Ops binds a BOQ line to an official DSR
 * item — pulling its code, standard description, unit and government rate — so
 * every line carries a defensible reference. Searches by code (e.g. "5.22.6")
 * or by any words in the description ("rcc slab", "brick 1:6").
 */
export function DsrPicker({
  open, onOpenChange, initialQuery, onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialQuery?: string;
  onPick: (d: PickedDsr) => void;
}) {
  const [q, setQ] = useState(initialQuery ?? "");
  const term = q.trim();

  const { data: results, isFetching } = useQuery({
    queryKey: ["dsr-picker", term],
    enabled: open && term.length >= 2,
    queryFn: async () => {
      let query = supabase
        .from("dsr_item")
        .select("code, description, unit, rate, chapter, subhead")
        .eq("billable", true)
        .limit(40);
      // "5.22" -> code prefix search; words -> description search (AND of terms)
      if (/^[0-9.]+$/.test(term)) {
        query = query.ilike("code", `${term}%`);
      } else {
        for (const w of term.split(/\s+/).filter(Boolean)) {
          query = query.ilike("description", `%${w}%`);
        }
      }
      const { data, error } = await query;
      if (error) throw error;
      // shorter descriptions first — usually the canonical item
      return (data ?? []).sort((a: any, b: any) => (a.description?.length ?? 0) - (b.description?.length ?? 0));
    },
  });

  const pick = (d: any) => {
    onPick({
      code: d.code, description: d.description, unit: d.unit ?? null,
      rate: d.rate != null ? Number(d.rate) : null, chapter: d.chapter ?? null, subhead: d.subhead ?? null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Find a DSR item</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search by code (5.22.6) or words (rcc slab, brick 1:6)…" className="pl-9"
          />
        </div>
        <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1">
          {term.length < 2 && <p className="text-sm text-muted-foreground py-8 text-center">Type a code or a few words to search 2,758 DSR items.</p>}
          {term.length >= 2 && isFetching && <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          {term.length >= 2 && !isFetching && (results?.length ?? 0) === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground"><FileText className="w-5 h-5 mx-auto mb-1 opacity-60" />No DSR item matches “{term}”.</div>
          )}
          <div className="divide-y">
            {results?.map((d: any) => (
              <button key={d.code} onClick={() => pick(d)} className="w-full text-left py-2.5 px-2 hover:bg-muted/60 rounded flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded text-foreground shrink-0">{d.code}</code>
                    <span className="text-[11px] text-muted-foreground">{d.subhead}</span>
                  </span>
                  <span className="block text-sm mt-1 leading-snug">{d.description}</span>
                </span>
                <span className="text-sm font-medium whitespace-nowrap text-right">
                  {d.rate != null ? formatINR(Number(d.rate)) : "—"}
                  {d.unit ? <span className="block text-xs text-muted-foreground font-normal">/{d.unit}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default DsrPicker;
