import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Minus, Plus, ShoppingCart, Loader2 } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useSupabaseProducts } from "@/hooks/useSupabaseProducts";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { extractVariantLabel } from "@/lib/productGroupUtils";

const ProductDetail = () => {
  const { id } = useParams();
  const { addToCart } = useCart();
  const [qty, setQty] = useState(1);
  const { data: allProducts, isLoading } = useSupabaseProducts();

  // Find clicked product and its group siblings
  const { group, selectedIdx: initialIdx } = useMemo(() => {
    if (!allProducts || !id) return { group: [], selectedIdx: 0 };
    const clicked = allProducts.find((p) => p.id === id);
    if (!clicked) return { group: [], selectedIdx: 0 };
    const groupName = clicked.group_name || clicked.name;
    const siblings = allProducts.filter(
      (p) => (p.group_name || p.name) === groupName
    );
    const idx = siblings.findIndex((p) => p.id === id);
    return { group: siblings, selectedIdx: idx >= 0 ? idx : 0 };
  }, [allProducts, id]);

  const [selectedIdx, setSelectedIdx] = useState(initialIdx);
  useEffect(() => setSelectedIdx(initialIdx), [initialIdx]);

  const product = group[selectedIdx];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Product not found</p>
      </div>
    );
  }

  const groupName = product.group_name?.trim() || product.name;
  const brand = product.brand ?? "";
  const productName = groupName;
  const hasVariants = group.length > 1;

  const handleAdd = () => {
    addToCart(product, qty);
    toast.success(`${qty}x ${product.name} added to cart`);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container py-4">
        <Link to={-1 as any} className="inline-flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="max-w-lg mx-auto">
          {/* Image */}
          <div className="bg-card rounded-xl border p-4 sm:p-6">
            <div className="aspect-square max-h-64 sm:max-h-72 w-full flex items-center justify-center mx-auto">
              <img src={product.image_url} alt={product.name} className="max-h-full max-w-[80%] object-contain" />
            </div>
          </div>

          {/* Info */}
          <div className="mt-4 space-y-3">
            {brand && (
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {brand}
              </span>
            )}
            <h1 className="text-xl font-bold text-foreground">{productName}</h1>

            {/* Variant selector */}
            {hasVariants && (
              <div className="flex flex-wrap gap-2">
                {group.map((p, i) => {
                  const label = p.variant_name?.trim() || extractVariantLabel(p.name, productName);
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedIdx(i)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        i === selectedIdx
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary text-foreground border-border hover:border-primary/40"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Price + Qty + Add */}
            <div className="pt-3 border-t space-y-4">
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold text-foreground">₹{product.selling_price}</span>
                <div className="flex items-center gap-3 bg-secondary rounded-xl px-2 py-1">
                  <button onClick={() => setQty(Math.max(1, qty - 1))} className="p-1.5 active:scale-90 transition-transform">
                    <Minus className="h-4 w-4 text-foreground" />
                  </button>
                  <span className="text-sm font-semibold text-foreground w-6 text-center">{qty}</span>
                  <button onClick={() => setQty(qty + 1)} className="p-1.5 active:scale-90 transition-transform">
                    <Plus className="h-4 w-4 text-foreground" />
                  </button>
                </div>
              </div>

              <Button
                onClick={handleAdd}
                className="w-full max-w-sm mx-auto flex h-12 text-base font-semibold rounded-xl shadow-md hover:brightness-110 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                <ShoppingCart className="h-5 w-5 mr-2" />
                Add to Cart — ₹{product.selling_price * qty}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetail;
