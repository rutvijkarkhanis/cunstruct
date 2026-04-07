import { ArrowLeft, Clock, Plus, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import Header from "@/components/Header";
import { useSupabaseProducts } from "@/hooks/useSupabaseProducts";

const SupabaseProducts = () => {
  const { data: products, isLoading, error } = useSupabaseProducts();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container py-4">
        <div className="flex items-center gap-3 mb-4">
          <Link to="/" className="p-1">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </Link>
          <h1 className="text-xl font-bold text-foreground">All Products</h1>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="text-center py-20 text-destructive">
            <p className="font-medium">Failed to load products</p>
            <p className="text-sm text-muted-foreground mt-1">{(error as Error).message}</p>
          </div>
        )}

        {products && products.length === 0 && (
          <p className="text-center py-20 text-muted-foreground">No products found.</p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {products?.map((product) => (
            <div
              key={product.id}
              className="bg-card rounded-lg border overflow-hidden animate-slide-up"
            >
              <div className="h-32 sm:h-36 lg:h-40 overflow-hidden bg-muted flex items-center justify-center p-3">
                <img
                  src={product.image_url}
                  alt={product.name}
                  loading="lazy"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="p-3 space-y-1.5">
                <h3 className="text-sm font-semibold text-foreground line-clamp-2 leading-snug">
                  {product.name}
                </h3>
                <div className="flex items-center gap-1.5 text-xs text-success">
                  <Clock className="h-3 w-3" />
                  <span>{product.delivery_time}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-base font-bold text-foreground">
                    ₹{product.selling_price}
                  </span>
                  <button className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SupabaseProducts;
