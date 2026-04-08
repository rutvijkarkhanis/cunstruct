import { useState } from "react";
import { ArrowLeft, Clock, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { Order } from "@/types/order";
import DeliveryBadge from "@/components/DeliveryBadge";
import { getDeliveryInfo } from "@/lib/delivery";

const Checkout = () => {
  const { items, totalPrice, clearCart } = useCart();
  const navigate = useNavigate();
  const delivery = getDeliveryInfo(items, totalPrice);
  const grandTotal = totalPrice + delivery.fee;
  const [placed, setPlaced] = useState(false);
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [pincode, setPincode] = useState("");

  const handlePlace = (e: React.FormEvent) => {
    e.preventDefault();

    const order: Order = {
      id: crypto.randomUUID(),
      customerName: name,
      phone,
      address: `${address}, Gurgaon - ${pincode}`,
      items: items.map(({ product, quantity }) => ({
        productId: product.id,
        productName: product.name,
        quantity,
        unitPrice: product.selling_price,
        total: product.selling_price * quantity,
      })),
      totalAmount: grandTotal,
      paymentMethod: "cod",
      status: "pending",
      timestamp: new Date().toISOString(),
    };

    const existingOrders = JSON.parse(localStorage.getItem("orders") || "[]");
    localStorage.setItem("orders", JSON.stringify([...existingOrders, order]));

    // Submit to Google Form silently
    const orderNotes = order.items
      .map((item) => `${item.productName} × ${item.quantity} = ₹${item.total}`)
      .join("\n");
    const notes = `${orderNotes}\n\nSubtotal: ₹${totalPrice}\nDelivery: ${delivery.isFree ? "FREE" : `₹${delivery.fee}`} (${delivery.vehicle})\nETA: ${delivery.eta}\nTotal: ₹${grandTotal}`;

    const formData = new URLSearchParams();
    formData.append("entry.1089409281", name);
    formData.append("entry.1031025677", phone);
    formData.append("entry.1743770567", `${address}, Gurgaon - ${pincode}`);
    formData.append("entry.1901693875", notes);

    fetch(
      "https://docs.google.com/forms/d/e/1FAIpQLScdkVHwL26cUbQUc4jFalXe3KqEro_Ey8mZnG0pAy1oxt1ExQ/formResponse",
      { method: "POST", body: formData, mode: "no-cors" }
    ).catch(() => {});

    setPlacedOrder(order);
    setPlaced(true);
    clearCart();
  };

  const handleWhatsApp = () => {
    if (!placedOrder) return;
    const productList = placedOrder.items
      .map((item) => `- ${item.productName} × ${item.quantity} = ₹${item.total}`)
      .join("\n");
    const message = `New Order:\n\nName: ${placedOrder.customerName}\nPhone: ${placedOrder.phone}\n\nProducts:\n${productList}\n\nTotal: ₹${placedOrder.totalAmount}\nPayment: COD\n\nAddress:\n${placedOrder.address}`;
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
          <Button onClick={handleWhatsApp} className="mt-6 bg-[#25D366] hover:bg-[#1da851] text-white">
            Get Order Status on WhatsApp
          </Button>
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
            <Input
              placeholder="Full Name"
              required
              className="bg-background"
              value={name}
              onChange={(e) => {
                const val = e.target.value.replace(/[^a-zA-Z\s]/g, "");
                setName(val);
              }}
              pattern="[a-zA-Z\s]+"
              title="Name should contain only letters"
            />
            <Input
              placeholder="Phone Number"
              type="tel"
              required
              className="bg-background"
              value={phone}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9]/g, "");
                if (val.length <= 10) setPhone(val);
              }}
              pattern="[0-9]{10}"
              title="Enter a valid 10-digit phone number"
              maxLength={10}
              inputMode="numeric"
            />
            <Input
              placeholder="Address Line (House No, Street, Locality)"
              required
              className="bg-background"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <div className="flex gap-3">
              <Input
                value="Gurgaon"
                disabled
                className="bg-muted text-muted-foreground flex-1"
              />
              <Input
                placeholder="Pincode"
                required
                className="bg-background w-32"
                value={pincode}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, "");
                  if (val.length <= 6) setPincode(val);
                }}
                pattern="[0-9]{6}"
                title="Enter a valid 6-digit pincode"
                maxLength={6}
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="bg-card rounded-lg border p-4 space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Order Summary</h2>
            {items.map(({ product, quantity }) => (
              <div key={product.id} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{product.name} × {quantity}</span>
                <span className="font-medium text-foreground">₹{product.selling_price * quantity}</span>
              </div>
            ))}
            <div className="border-t pt-2 mt-2 space-y-1">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span>₹{totalPrice}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Delivery ({delivery.vehicle})</span>
                <span>{delivery.isFree ? <span className="text-success font-medium">FREE</span> : `₹${delivery.fee}`}</span>
              </div>
              <div className="flex justify-between font-bold text-foreground pt-1 border-t">
                <span>Total</span>
                <span>₹{grandTotal}</span>
              </div>
            </div>
          </div>

          <div className="mb-2">
            <DeliveryBadge delivery={delivery} compact />
          </div>

          <div className="fixed bottom-0 left-0 right-0 bg-card border-t p-4">
            <div className="container">
              <Button type="submit" className="w-full bg-accent text-accent-foreground h-12 text-base font-semibold hover:bg-accent/90">
                Place Order — ₹{grandTotal}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Checkout;
