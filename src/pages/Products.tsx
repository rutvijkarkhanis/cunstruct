import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Clock, Loader2 } from "lucide-react";
import Header from "@/components/Header";
import ProductCard from "@/components/ProductCard";
import { useSupabaseProducts } from "@/hooks/useSupabaseProducts";

const categories = [
  { id: "adhesives-chemicals", name: "Adhesives & Chemicals", icon: "🧴" },
  { id: "hardware-fasteners", name: "Hardware & Fasteners", icon: "🔩" },
  { id: "tools-accessories", name: "Tools & Accessories", icon: "🔧" },
  { id: "plumbing", name: "Plumbing", icon: "🚿" },
  { id: "heavy-materials", name: "Heavy Materials", icon: "🏗️" },
] as const;

const Products = () => {
  const [params, setParams] = useSearchParams();
  const category = params.get("category");
  const { data: products, isLoading, error } = useSupabaseProducts(category);

  const title = category
    ? categories.find((c) => c.id === category)?.name ?? "Products"
    : "All Products";

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container py-4">
        <div className="flex items-center gap-3 mb-4">
          <Link to="/" className="p-1">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </Link>
          <h1 className="text-xl font-bold text-foreground">{title}</h1>
        </div>

        {/* Category chips */}
        <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 scrollbar-none">
          <button
            onClick={() => setParams({})}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              !category ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border"
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setParams({ category: cat.id })}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                category === cat.id ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border"
              }`}
            >
              {cat.icon} {cat.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mb-4 bg-success/10 rounded-lg px-3 py-2">
          <Clock className="h-4 w-4 text-success" />
          <span className="text-sm font-medium text-success">Delivery in 60 mins</span>
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

        {products && products.length === 0 && !isLoading && (
          <p className="text-center py-20 text-muted-foreground">No products found.</p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {products?.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Products;
