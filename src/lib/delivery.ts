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

const HEAVY_CATEGORY = "heavy-materials";

export function getDeliveryInfo(items: CartItem[], subtotal: number): DeliveryInfo {
  const totalWeight = items.reduce((sum, i) => sum + i.product.weight * i.quantity, 0);
  const hasHeavy = items.some((i) => i.product.category === HEAVY_CATEGORY);

  let type: DeliveryType;
  if (hasHeavy || totalWeight > 200) {
    type = "heavy";
  } else if (totalWeight > 50) {
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

/** Estimate delivery for a single product (1 qty) */
export function getEstimatedDelivery(category: string, weight: number): { eta: string; fee: number } {
  if (category === HEAVY_CATEGORY || weight > 200) {
    return { eta: "2–4 hrs (Scheduled)", fee: 499 };
  }
  if (weight > 50) {
    return { eta: "60–90 mins", fee: 199 };
  }
  return { eta: "60 mins", fee: 79 };
}
