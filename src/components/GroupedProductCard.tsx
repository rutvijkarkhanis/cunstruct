import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Product } from "@/lib/supabase";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";

export type ProductGroup = {
  groupName: string;
  products: Product[];
};

const GroupedProductCard = ({ group }: { group: ProductGroup }) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const { addToCart } = useCart();
  const selected = group.products[selectedIdx];
  const hasVariants = group.products.length > 1;

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addToCart(selected);
    toast.success(`${selected.name} added to cart`);
  };

  return (
    <Link
      to={`/product/${selected.id}`}
      className="group bg-card rounded-lg border overflow-hidden animate-slide-up flex flex-col"
    >
      {/* Image */}
      <div className="h-32 sm:h-36 lg:h-40 overflow-hidden bg-muted flex items-center justify-center p-3">
        <img
          src={selected.image_url}
          alt={group.groupName}
          loading="lazy"
          className="max-h-full max-w-full object-contain"
        />
      </div>

      <div className="p-3 flex flex-col flex-1">
        {/* Brand */}
        {selected.brand && (
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {selected.brand}
          </span>
        )}

        {/* Group title */}
        <h3 className="text-sm font-semibold text-foreground mt-0.5 line-clamp-2 leading-snug">
          {group.groupName}
        </h3>

        {/* Variant selector */}
        {hasVariants && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {group.products.map((p, i) => {
              // Extract a short label: use name minus group_name prefix, or full name
              const shortLabel =
                p.name.replace(group.groupName, "").trim() || p.name;
              return (
                <button
                  key={p.id}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedIdx(i);
                  }}
                  className={`px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
                    i === selectedIdx
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-foreground border-border hover:border-primary/40"
                  }`}
                >
                  {shortLabel.length > 20
                    ? `₹${p.selling_price}`
                    : shortLabel}
                </button>
              );
            })}
          </div>
        )}

        {/* Price + Add */}
        <div className="flex items-center justify-between mt-auto pt-2">
          <span className="text-base font-bold text-foreground">
            ₹{selected.selling_price}
          </span>
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

/** Group a flat product list by group_name */
export function groupProducts(products: Product[]): ProductGroup[] {
  const map = new Map<string, Product[]>();
  for (const p of products) {
    const key = p.group_name || p.name; // ungrouped products become their own group
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return Array.from(map.entries()).map(([groupName, products]) => ({
    groupName,
    products,
  }));
}
