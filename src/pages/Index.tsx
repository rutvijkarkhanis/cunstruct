import { useState } from "react";
import { Link } from "react-router-dom";
import { Clock, ChevronRight, Loader2 } from "lucide-react";
import Header from "@/components/Header";
import GroupedProductCard, { groupProducts } from "@/components/GroupedProductCard";
import { useSupabaseProducts, useSupabaseCategories } from "@/hooks/useSupabaseProducts";

const Index = () => {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const { data: products, isLoading } = useSupabaseProducts(selectedCategory);
  const { data: categories } = useSupabaseCategories();
  const groups = products ? groupProducts(products) : [];

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero banner */}
      <div className="container pt-4 pb-2">
        <div className="bg-primary rounded-xl p-5 space-y-2">
          <h1 className="text-xl font-bold text-primary-foreground leading-tight">
            Construction Materials
            <br />
            <span className="text-accent">Delivered Fast.</span>
          </h1>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-primary-foreground/80">
              Delivery in 60 mins
            </span>
          </div>
        </div>
      </div>

      {/* Category chips */}
      <div className="container py-3">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              !selectedCategory ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border"
            }`}
          >
            All
          </button>
          {categories?.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                selectedCategory === cat ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Products */}
      <div className="container py-2 pb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-foreground">
            {selectedCategory ?? "All Products"}
          </h2>
          <Link to="/products" className="text-xs font-medium text-accent flex items-center gap-0.5">
            View All <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <p className="text-center py-10 text-muted-foreground">No products found.</p>
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

export default Index;
