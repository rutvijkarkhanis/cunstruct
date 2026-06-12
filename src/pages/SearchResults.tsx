import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, Package } from "lucide-react";
import Header from "@/components/Header";
import SEO from "@/components/SEO";
import GroupedProductCard, { groupProducts } from "@/components/GroupedProductCard";
import SortDropdown from "@/components/SortDropdown";
import { useSupabaseProducts } from "@/hooks/useSupabaseProducts";
import { sortGroups, SortOption } from "@/lib/sort";
import { resolveKits } from "@/lib/kits";

const SearchResults = () => {
  const [params] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const [sort, setSort] = useState<SortOption>("price_asc");
  const { data: products, isLoading } = useSupabaseProducts();

  const { groups, kits } = useMemo(() => {
    if (!products || !q) return { groups: [], kits: [] as ReturnType<typeof resolveKits> };
    const term = q.toLowerCase();
    const matches = products.filter((p) => {
      const hay = `${p.name ?? ""} ${p.group_name ?? ""} ${p.brand ?? ""} ${p.main_category ?? ""} ${p.subcategory ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
    const allKits = resolveKits(products);
    const kits = allKits.filter((k) => {
      const hay = `${k.def.name} ${k.def.slots.map((s) => s.label).join(" ")}`.toLowerCase();
      if (hay.includes(term)) return true;
      return k.products.some((p) =>
        `${p.name ?? ""} ${p.group_name ?? ""} ${p.subcategory ?? ""}`.toLowerCase().includes(term),
      );
    });
    return { groups: sortGroups(groupProducts(matches), sort), kits };
  }, [products, q, sort]);

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={q ? `Search: ${q}` : "Search"}
        description={q ? `Search results for "${q}" on Cunstruct — construction materials delivered in 30 minutes.` : "Search Cunstruct for construction materials, kits, and more."}
      />
      <Header />
      <div className="container py-4">
        <div className="flex items-center gap-3 mb-4">
          <Link to="/" className="p-1">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </Link>
          <h1 className="text-xl font-bold text-foreground line-clamp-1">
            Results for "{q}"
          </h1>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 && kits.length === 0 ? (
          <p className="text-center py-20 text-muted-foreground">No results found.</p>
        ) : (
          <>
            {kits.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-bold text-foreground mb-2">Matching kits</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {kits.map((k) => (
                    <Link
                      key={k.def.id}
                      to={`/kit/${k.def.id}`}
                      className="bg-card border rounded-lg p-3 flex items-center gap-3 hover:border-primary/40 transition-colors"
                    >
                      <div className="h-12 w-12 rounded bg-accent/10 text-accent flex items-center justify-center shrink-0">
                        <Package className="h-6 w-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground line-clamp-1">{k.def.name}</p>
                        <p className="text-[11px] text-muted-foreground">{k.products.length} items</p>
                      </div>
                      <p className="text-sm font-bold text-foreground shrink-0">
                        ₹{k.totalPrice.toLocaleString("en-IN")}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {groups.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-foreground">{groups.length} products</h2>
                  <SortDropdown value={sort} onChange={setSort} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {groups.map((g) => (
                    <GroupedProductCard key={g.groupName} group={g} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SearchResults;