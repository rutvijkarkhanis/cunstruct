import { Link } from "react-router-dom";
import { Product } from "@/data/products";
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
      <div className="aspect-square overflow-hidden bg-muted">
        <img
          src={product.image}
          alt={product.name}
          loading="lazy"
          width={320}
          height={320}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
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
          <div>
            <span className="text-base font-bold text-foreground">₹{product.price}</span>
            <span className="text-xs text-muted-foreground ml-1">/{product.unit}</span>
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

export default ProductCard;
