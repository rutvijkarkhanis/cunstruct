import { Link, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { ArrowLeft, Clock, Loader2 } from "lucide-react";
import Header from "@/components/Header";
import GroupedProductCard, { groupProducts } from "@/components/GroupedProductCard";
import SortDropdown from "@/components/SortDropdown";
import { sortGroups, SortOption } from "@/lib/sort";
import {
  useSupabaseProducts,
  useSupabaseCategories,
  useSupabaseSubcategories,
} from "@/hooks/useSupabaseProducts";
import SEO from "@/components/SEO";

const Products = () => {
  const [params, setParams] = useSearchParams();
  const mainCategory = params.get("category");
  const subcategory = params.get("sub");
  const activeFilter = subcategory ?? mainCategory;
  const [sort, setSort] = useState<SortOption>("price_asc");
  const { data: products, isLoading, error } = useSupabaseProducts(activeFilter);
  const { data: categories } = useSupabaseCategories();
  const { data: subcategories } = useSupabaseSubcategories(mainCategory);

  const title = subcategory ?? mainCategory ?? "All Products";
  const seoDescription = subcategory
    ? `Buy ${subcategory} online — construction materials and hardware delivered in 30 minutes across Delhi & Gurgaon.`
    : mainCategory
    ? `Shop ${mainCategory} online — cement, steel, tiles and more delivered in 30 minutes across Delhi & Gurgaon.`
    : "Buy building materials and hardware online — cement, steel, tiles, plumbing, electrical and more, delivered in 30 minutes across Delhi & Gurgaon.";

  const groups = products ? sortGroups(groupProducts(products), sort) : [];

  const setMain = (cat: string | null) => {
    if (cat) setParams({ category: cat });
    else setParams({});
  };
  const setSub = (sub: string | null) => {
    if (!mainCategory) return;
    if (sub) setParams({ category: mainCategory, sub });
    else setParams({ category: mainCategory });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={title}
        description={seoDescription}
        canonicalPath={mainCategory ? `/products?category=${encodeURIComponent(mainCategory)}${subcategory ? `&sub=${encodeURIComponent(subcategory)}` : ""}` : "/products"}
      />
      <Header />
      <div className="container py-4">
        <div className="flex items-center gap-3 mb-4">
          <Link to="/" className="p-1">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </Link>
          <h1 className="text-xl font-bold text-foreground">{title}</h1>
        </div>

        {/* Main category chips */}
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-none">
          <button
            onClick={() => setMain(null)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              !mainCategory ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border"
            }`}
          >
            All
          </button>
          {categories?.map((cat) => (
            <button
              key={cat}
              onClick={() => setMain(cat)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                mainCategory === cat ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Subcategory chips */}
        {mainCategory && subcategories && subcategories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 scrollbar-none">
            <button
              onClick={() => setSub(null)}
              className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                !subcategory ? "bg-accent text-accent-foreground border-accent" : "bg-muted text-muted-foreground border-border"
              }`}
            >
              All {mainCategory}
            </button>
            {subcategories.map((sub) => (
              <button
                key={sub}
                onClick={() => setSub(sub)}
                className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  subcategory === sub ? "bg-accent text-accent-foreground border-accent" : "bg-muted text-muted-foreground border-border"
                }`}
              >
                {sub}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mb-4 bg-success/10 rounded-lg px-3 py-2">
          <Clock className="h-4 w-4 text-success" />
          <span className="text-sm font-medium text-success">Delivery in 30 minutes</span>
        </div>

        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted-foreground">{groups.length} products</p>
          <SortDropdown value={sort} onChange={setSort} />
        </div>

        {isLoading && (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="text-center py-20 text-destructive">
            <p className="font-medium">Failed to load products</p>
          </div>
        )}

        {!isLoading && groups.length === 0 && !error && (
          <p className="text-center py-20 text-muted-foreground">No products found.</p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {groups.map((group) => (
            <GroupedProductCard key={group.groupName} group={group} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Products;
