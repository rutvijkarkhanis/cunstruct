import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Minus, Plus, Trash2 } from "lucide-react";
import Header from "@/components/Header";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import DeliveryBadge from "@/components/DeliveryBadge";
import { getDeliveryInfo } from "@/lib/delivery";

const Cart = () => {
  const { items, updateQuantity, removeFromCart, totalPrice } = useCart();
  const navigate = useNavigate();
  const delivery = getDeliveryInfo(items, totalPrice);
  const grandTotal = totalPrice + delivery.fee;

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-16 text-center">
          <p className="text-lg text-muted-foreground mb-4">Your cart is empty</p>
          <Link to="/" className="text-sm font-medium text-accent underline">
            Browse products
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      <Header />
      <div className="container py-4">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(-1)} className="p-1">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-xl font-bold text-foreground">Cart ({items.length})</h1>
        </div>

        <div className="space-y-3">
          {items.map(({ product, quantity }) => (
            <div key={product.id} className="bg-card rounded-lg border p-3 flex gap-3">
              <img
                src={product.image_url}
                alt={product.name}
                className="w-20 h-20 rounded-md object-cover"
                loading="lazy"
                width={80}
                height={80}
              />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-foreground line-clamp-1">{product.name}</h3>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm font-bold text-foreground">₹{product.selling_price * quantity}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateQuantity(product.id, quantity - 1)} className="h-7 w-7 rounded-md bg-secondary flex items-center justify-center">
                      <Minus className="h-3 w-3 text-foreground" />
                    </button>
                    <span className="text-sm font-semibold w-5 text-center text-foreground">{quantity}</span>
                    <button onClick={() => updateQuantity(product.id, quantity + 1)} className="h-7 w-7 rounded-md bg-secondary flex items-center justify-center">
                      <Plus className="h-3 w-3 text-foreground" />
                    </button>
                    <button onClick={() => removeFromCart(product.id)} className="h-7 w-7 rounded-md flex items-center justify-center ml-1">
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <DeliveryBadge delivery={delivery} />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-card border-t p-4 safe-area-bottom">
        <div className="container flex items-center justify-between">
          <div>
            <span className="text-sm text-muted-foreground">Total (incl. delivery)</span>
            <p className="text-xl font-bold text-foreground">₹{grandTotal}</p>
          </div>
          <Button
            onClick={() => navigate("/checkout")}
            className="bg-accent text-accent-foreground h-12 px-8 text-base font-semibold hover:bg-accent/90"
          >
            Checkout
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Cart;
