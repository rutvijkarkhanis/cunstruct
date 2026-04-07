import { CartItem } from "@/context/CartContext";

export type DeliveryType = "light" | "medium" | "heavy";

export type DeliveryInfo = {
  type: DeliveryType;
  vehicle: string;
  fee: number;
  eta: string;
  freeAbove: number;
  isFree: boolean;
};

export function getDeliveryInfo(items: CartItem[], subtotal: number): DeliveryInfo {
  const hasHeavy = items.some((i) => i.product.category === "heavy-materials");

  let type: DeliveryType;
  if (hasHeavy) {
    type = "heavy";
  } else if (items.length > 10) {
    type = "medium";
  } else {
    type = "light";
  }

  const config: Record<DeliveryType, { vehicle: string; fee: number; eta: string; freeAbove: number }> = {
    light:  { vehicle: "Bike",     fee: 79,  eta: "60 mins",            freeAbove: 3000 },
    medium: { vehicle: "Loader",   fee: 199, eta: "60–90 mins",         freeAbove: 8000 },
    heavy:  { vehicle: "Tata Ace", fee: 499, eta: "2–4 hrs (Scheduled)", freeAbove: 20000 },
  };

  const c = config[type];
  const isFree = subtotal >= c.freeAbove;

  return {
    type,
    vehicle: c.vehicle,
    fee: isFree ? 0 : c.fee,
    eta: c.eta,
    freeAbove: c.freeAbove,
    isFree,
  };
}

export function getEstimatedDelivery(category: string | null): { eta: string; fee: number } {
  if (category === "heavy-materials") {
    return { eta: "2–4 hrs (Scheduled)", fee: 499 };
  }
  return { eta: "60 mins", fee: 79 };
}
