import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Star, Clock, Minus, Plus, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { products } from "@/data/products";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";

const ProductDetail = () => {
  const { id } = useParams();
  const { addToCart } = useCart();
  const [qty, setQty] = useState(1);

  const product = products.find((p) => p.id === id);

  if (!product) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Product not found</p>
      </div>
    );
  }

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

        <div className="bg-card rounded-lg border overflow-hidden">
          <div className="bg-muted flex items-center justify-center p-6">
            <div className="w-full max-w-xs sm:max-w-sm md:max-w-md mx-auto h-56 sm:h-64 md:h-72 flex items-center justify-center">
              <img src={product.image} alt={product.name} className="max-h-full max-w-full object-contain" width={640} height={640} />
            </div>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 bg-success/10 rounded-md px-2.5 py-1.5 w-fit">
              <Clock className="h-3.5 w-3.5 text-success" />
              <span className="text-xs font-medium text-success">Delivery in 60 mins</span>
            </div>

            {product.brand && (
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {product.brand}
              </span>
            )}
            <h1 className="text-xl font-bold text-foreground">{product.name}</h1>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Star className="h-4 w-4 fill-accent text-accent" />
                <span className="text-sm font-medium text-foreground">{product.rating}</span>
              </div>
              <span className="text-sm text-muted-foreground">•</span>
              <span className="text-sm text-muted-foreground">{product.weight}kg</span>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">{product.description}</p>

            <div className="pt-2 border-t">
              <div className="flex items-end justify-between">
                <div>
                  <span className="text-2xl font-bold text-foreground">₹{product.price}</span>
                  <span className="text-sm text-muted-foreground ml-1">/{product.unit}</span>
                </div>
                <div className="flex items-center gap-3 bg-secondary rounded-lg px-1">
                  <button onClick={() => setQty(Math.max(1, qty - 1))} className="p-1.5">
                    <Minus className="h-4 w-4 text-foreground" />
                  </button>
                  <span className="text-sm font-semibold text-foreground w-6 text-center">{qty}</span>
                  <button onClick={() => setQty(qty + 1)} className="p-1.5">
                    <Plus className="h-4 w-4 text-foreground" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button onClick={handleAdd} className="flex-1 bg-primary text-primary-foreground h-12 text-base font-semibold">
                <ShoppingCart className="h-5 w-5 mr-2" />
                Add to Cart — ₹{product.price * qty}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetail;
