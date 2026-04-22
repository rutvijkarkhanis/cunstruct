import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import Header from "@/components/Header";
import GroupedProductCard, { groupProducts } from "@/components/GroupedProductCard";
import SortDropdown from "@/components/SortDropdown";
import { useSupabaseProducts } from "@/hooks/useSupabaseProducts";
import { sortGroups, SortOption } from "@/lib/sort";

const SearchResults = () => {
  const [params] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const [sort, setSort] = useState<SortOption>("price_asc");
  const { data: products, isLoading } = useSupabaseProducts();

  const groups = useMemo(() => {
    if (!products || !q) return [];
    const term = q.toLowerCase();
    const matches = products.filter((p) => {
      const hay = `${p.name ?? ""} ${p.group_name ?? ""} ${p.brand ?? ""} ${p.main_category ?? ""} ${p.subcategory ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
    return sortGroups(groupProducts(matches), sort);
  }, [products, q, sort]);

  return (
    <div className="min-h-screen bg-background">
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

        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted-foreground">{groups.length} products</p>
          <SortDropdown value={sort} onChange={setSort} />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <p className="text-center py-20 text-muted-foreground">No results found.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {groups.map((g) => (
              <GroupedProductCard key={g.groupName} group={g} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchResults;