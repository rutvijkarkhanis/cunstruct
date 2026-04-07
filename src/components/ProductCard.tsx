import { Link } from "react-router-dom";
import { Product } from "@/lib/supabase";
import { Plus } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";

const ProductCard = ({ product }: { product: Product }) => {
  const { addToCart } = useCart();

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addToCart(product);
    toast.success(`${product.name} added to cart`);
  };

  return (
    <Link
      to={`/product/${product.id}`}
      className="group bg-card rounded-lg border overflow-hidden animate-slide-up"
    >
      <div className="h-32 sm:h-36 lg:h-40 overflow-hidden bg-muted flex items-center justify-center p-3">
        <img
          src={product.image_url}
          alt={product.name}
          loading="lazy"
          width={512}
          height={512}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="p-3">
        {product.brand && (
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {product.brand}
          </span>
        )}
        <h3 className="text-sm font-semibold text-foreground mt-0.5 line-clamp-2 leading-snug">
          {product.name}
        </h3>
        <div className="flex items-center justify-between mt-2">
          <span className="text-base font-bold text-foreground">₹{product.selling_price}</span>
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

export default ProductCard;
