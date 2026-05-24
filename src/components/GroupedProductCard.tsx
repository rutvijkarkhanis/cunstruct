import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Product } from "@/lib/supabase";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";
import { extractVariantLabel } from "@/lib/productGroupUtils";

const FALLBACK_IMG = "/placeholder.svg";

export type ProductGroup = {
  groupName: string;
  products: Product[];
};

const GroupedProductCard = ({ group }: { group: ProductGroup }) => {
  const selectedIdx = 0;
  const navigate = useNavigate();
  const { addToCart } = useCart();
  const selected = group.products[selectedIdx];
  const hasVariants = group.products.length > 1;
  const brand = selected.brand ?? "";
  const productName = group.groupName ?? selected.name ?? "Product";
  const MAX_VISIBLE_VARIANTS = 2;
  const visibleVariants = group.products.slice(0, MAX_VISIBLE_VARIANTS);
  const hiddenCount = group.products.length - visibleVariants.length;
  const minPrice = Math.min(...group.products.map((p) => p.selling_price ?? Infinity));
  const startingPrice = isFinite(minPrice) ? minPrice : (selected.selling_price ?? 0);

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasVariants) {
      navigate(`/product/${selected.id}`);
      return;
    }
    addToCart(selected);
    toast.success(`${selected.name ?? "Item"} added to cart`);
  };

  return (
    <Link
      to={`/product/${selected.id}`}
      className="group bg-card rounded-lg border overflow-hidden animate-slide-up flex flex-col"
    >
      {/* Image */}
      <div className="h-32 sm:h-36 lg:h-40 overflow-hidden bg-muted flex items-center justify-center p-3">
        <img
          src={selected.image_url || FALLBACK_IMG}
          alt={productName}
          loading="lazy"
          className="max-h-full max-w-full object-contain"
        />
      </div>

      <div className="p-3 flex flex-col flex-1">
        {/* Brand */}
        {brand && (
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {brand}
          </span>
        )}

        {/* Product name */}
        <h3 className="text-sm font-semibold text-foreground mt-0.5 line-clamp-2 leading-snug">
          {productName}
        </h3>

        {/* Variant preview (max 2, +N more) */}
        {hasVariants && (
          <>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {visibleVariants.map((p) => {
                const label = p.variant_name?.trim() || extractVariantLabel(p.name ?? "", productName);
                return (
                  <span
                    key={p.id}
                    className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-muted text-muted-foreground border border-border line-clamp-1"
                  >
                    {label}
                  </span>
                );
              })}
              {hiddenCount > 0 && (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-accent/10 text-accent border border-accent/20">
                  +{hiddenCount} more
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Available in {group.products.length} variants
            </p>
          </>
        )}

        {/* Price + Add */}
        <div className="flex items-center justify-between mt-auto pt-2">
          <div className="flex flex-col">
            {hasVariants && (
              <span className="text-[10px] text-muted-foreground leading-none">Starting at</span>
            )}
            <span className="text-base font-bold text-foreground">₹{(startingPrice ?? 0).toLocaleString("en-IN")}</span>
          </div>
          <button
            onClick={handleAdd}
            className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
    </Link>
  );
};

export default GroupedProductCard;

/** Group a flat product list by group_name (falls back to name when null). */
export function groupProducts(products: Product[]): ProductGroup[] {
  const map = new Map<string, Product[]>();
  for (const p of products) {
    const key = (p.group_name?.trim() || p.name || p.id || "Untitled");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return Array.from(map.entries()).map(([groupName, products]) => ({
    groupName,
    products,
  }));
}
