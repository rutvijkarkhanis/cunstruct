import { useState } from "react";
import { ArrowLeft, Clock, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";

const Checkout = () => {
  const { items, totalPrice, clearCart } = useCart();
  const navigate = useNavigate();
  const [placed, setPlaced] = useState(false);

  const deliveryFee = totalPrice > 2000 ? 0 : 49;

  const handlePlace = (e: React.FormEvent) => {
    e.preventDefault();
    setPlaced(true);
    clearCart();
  };

  if (placed) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="container py-16 text-center space-y-4"
        >
          <CheckCircle2 className="h-16 w-16 text-success mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">Order Placed!</h1>
          <div className="flex items-center justify-center gap-2 text-success">
            <Clock className="h-4 w-4" />
            <span className="text-sm font-medium">Estimated delivery in 60 mins</span>
          </div>
          <Button onClick={() => navigate("/")} variant="outline" className="mt-4">
            Continue Shopping
          </Button>
        </motion.div>
      </div>
    );
  }

  if (items.length === 0) {
    navigate("/cart");
    return null;
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <Header />
      <div className="container py-4">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(-1)} className="p-1">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-xl font-bold text-foreground">Checkout</h1>
        </div>

        <form onSubmit={handlePlace} className="space-y-4">
          <div className="bg-card rounded-lg border p-4 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Delivery Address</h2>
            <Input placeholder="Full Name" required className="bg-background" />
            <Input placeholder="Phone Number" type="tel" required className="bg-background" />
            <Input placeholder="Address Line 1" required className="bg-background" />
            <Input placeholder="City, Pincode" required className="bg-background" />
          </div>

          <div className="bg-card rounded-lg border p-4 space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Order Summary</h2>
            {items.map(({ product, quantity }) => (
              <div key={product.id} className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {product.name} × {quantity}
                </span>
                <span className="font-medium text-foreground">₹{product.price * quantity}</span>
              </div>
            ))}
            <div className="border-t pt-2 mt-2 flex justify-between text-sm">
              <span className="text-muted-foreground">Delivery</span>
              <span className="font-medium text-foreground">
                {deliveryFee === 0 ? "FREE" : `₹${deliveryFee}`}
              </span>
            </div>
            <div className="flex justify-between font-bold text-foreground">
              <span>Total</span>
              <span>₹{totalPrice + deliveryFee}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-success/10 rounded-lg px-3 py-2">
            <Clock className="h-4 w-4 text-success" />
            <span className="text-sm font-medium text-success">Delivery in 60 mins</span>
          </div>

          <div className="fixed bottom-0 left-0 right-0 bg-card border-t p-4">
            <div className="container">
              <Button
                type="submit"
                className="w-full bg-accent text-accent-foreground h-12 text-base font-semibold hover:bg-accent/90"
              >
                Place Order — ₹{totalPrice + deliveryFee}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Checkout;
