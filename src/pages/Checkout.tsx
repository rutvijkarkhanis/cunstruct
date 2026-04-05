import { useState } from "react";
import { ArrowLeft, Clock, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import { Order } from "@/types/order";
import { getDeliveryInfo } from "@/lib/delivery";
import DeliveryBadge from "@/components/DeliveryBadge";

const Checkout = () => {
  const { items, totalPrice, clearCart } = useCart();
  const navigate = useNavigate();
  const [placed, setPlaced] = useState(false);
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "online">("cod");

  const delivery = getDeliveryInfo(items, totalPrice);
  const deliveryFee = delivery.fee;

  const handlePlace = (e: React.FormEvent) => {
    e.preventDefault();

    const order: Order = {
      id: crypto.randomUUID(),
      customerName: name,
      phone,
      address: `${address}, ${city}`,
      items: items.map(({ product, quantity }) => ({
        productId: product.id,
        productName: product.name,
        quantity,
        unitPrice: product.price,
        total: product.price * quantity,
      })),
      totalAmount: totalPrice + deliveryFee,
      paymentMethod,
      status: "pending",
      timestamp: new Date().toISOString(),
    };

    // Store order locally (can be sent to backend later)
    const existingOrders = JSON.parse(localStorage.getItem("orders") || "[]");
    localStorage.setItem("orders", JSON.stringify([...existingOrders, order]));

    console.log("Order placed:", order);
    setPlacedOrder(order);
    setPlaced(true);
    clearCart();
  };

  const handleWhatsApp = () => {
    if (!placedOrder) return;
    const productList = placedOrder.items
      .map((item) => `- ${item.productName} × ${item.quantity} = ₹${item.total}`)
      .join("\n");
    const message = `New Order:\n\nName: ${placedOrder.customerName}\nPhone: ${placedOrder.phone}\n\nProducts:\n${productList}\n\nTotal: ₹${placedOrder.totalAmount}\nPayment: ${placedOrder.paymentMethod === "cod" ? "COD" : "UPI"}\n\nAddress:\n${placedOrder.address}`;
    const url = `https://wa.me/919168833977?text=${encodeURIComponent(message)}`;
    window.location.href = url;
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
          <Button onClick={handleWhatsApp} className="mt-4 bg-[#25D366] hover:bg-[#1da851] text-white">
            Send Order on WhatsApp
          </Button>
          <Button onClick={() => navigate("/")} variant="outline" className="mt-2">
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
            <Input
              placeholder="Full Name"
              required
              className="bg-background"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              placeholder="Phone Number"
              type="tel"
              required
              className="bg-background"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Input
              placeholder="Address Line 1"
              required
              className="bg-background"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <Input
              placeholder="City, Pincode"
              required
              className="bg-background"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>

          <div className="bg-card rounded-lg border p-4 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Payment Method</h2>
            <RadioGroup
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as "cod" | "online")}
              className="space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="cod" id="cod" />
                <Label htmlFor="cod" className="text-sm text-foreground">
                  Cash on Delivery
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="online" id="online" />
                <Label htmlFor="online" className="text-sm text-foreground">
                  Online Payment
                </Label>
              </div>
            </RadioGroup>
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
              <span className="font-medium text-foreground">{deliveryFee === 0 ? "FREE" : `₹${deliveryFee}`}</span>
            </div>
            <div className="flex justify-between font-bold text-foreground">
              <span>Total</span>
              <span>₹{totalPrice + deliveryFee}</span>
            </div>
          </div>

          <DeliveryBadge delivery={delivery} />

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
