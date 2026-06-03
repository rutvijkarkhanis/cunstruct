import { Product } from "@/lib/supabase";
import { ProductGroup } from "@/components/GroupedProductCard";

export type SortOption = "price_asc" | "price_desc" | "fast";

export const SORT_LABELS: Record<SortOption, string> = {
  price_asc: "Price: Low to High",
  price_desc: "Price: High to Low",
  fast: "Fast Delivery",
};

const groupMinPrice = (g: ProductGroup) =>
  Math.min(...g.products.map((p) => p.selling_price ?? Infinity));

const groupHasFast = (g: ProductGroup) =>
  g.products.some((p) => String(p.priority ?? "").toLowerCase() === "fast");

export function sortGroups(groups: ProductGroup[], sort: SortOption): ProductGroup[] {
  const arr = [...groups];
  arr.sort((a, b) => {
    const pa = groupMinPrice(a);
    const pb = groupMinPrice(b);
    const aMissing = !isFinite(pa);
    const bMissing = !isFinite(pb);
    if (aMissing && !bMissing) return 1;
    if (!aMissing && bMissing) return -1;

    if (sort === "price_desc") return pb - pa;
    if (sort === "fast") {
      const af = groupHasFast(a) ? 0 : 1;
      const bf = groupHasFast(b) ? 0 : 1;
      if (af !== bf) return af - bf;
      return pa - pb;
    }
    return pa - pb; // price_asc default
  });
  return arr;
}

export function deliveryTag(product: Product): { label: string; tone: "instant" | "same" | "request" } {
  const dt = (product.delivery_type ?? "").toLowerCase();
  const pr = String(product.priority ?? "").toLowerCase();
  if (dt === "heavy" || dt === "on_request") return { label: "On Request", tone: "request" };
  if (pr === "fast" || dt === "light") return { label: "Instant", tone: "instant" };
  return { label: "Same Day", tone: "same" };
}