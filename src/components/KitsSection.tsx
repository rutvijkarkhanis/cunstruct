import { useMemo } from "react";
import { useSupabaseProducts } from "@/hooks/useSupabaseProducts";
import { resolveKits, ResolvedKit } from "@/lib/kits";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";
import { Package } from "lucide-react";

const tagColor: Record<ResolvedKit["def"]["tag"], string> = {
  "Most Popular": "bg-accent/15 text-accent border-accent/30",
  "Contractor Pick": "bg-primary/10 text-primary border-primary/30",
  "Quick Fix": "bg-success/10 text-success border-success/30",
};

const KitCard = ({ kit }: { kit: ResolvedKit }) => {
  const { addToCart } = useCart();
  const previews = kit.products.slice(0, 4);

  const handleAddAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    kit.products.forEach((p) => addToCart(p, 1));
    toast.success(`${kit.def.name} added to cart`);
  };

  return (
    <div className="shrink-0 w-72 bg-card border rounded-xl overflow-hidden flex flex-col">
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg" aria-hidden>{kit.def.emoji}</span>
          <h3 className="text-sm font-bold text-foreground line-clamp-1">{kit.def.name}</h3>
        </div>
        <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 ${tagColor[kit.def.tag]}`}>
          {kit.def.tag}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1 p-2 bg-muted/30">
        {previews.map((p) => (
          <div key={p.id} className="aspect-square bg-card rounded flex items-center justify-center p-1">
            <img src={p.image_url} alt={p.name} loading="lazy" className="max-h-full max-w-full object-contain" />
          </div>
        ))}
        {Array.from({ length: Math.max(0, 4 - previews.length) }).map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square bg-card rounded" />
        ))}
      </div>

      <div className="p-3 flex items-center justify-between gap-2 mt-auto">
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">{kit.products.length} items</p>
          <p className="text-base font-bold text-foreground">₹{kit.totalPrice.toLocaleString("en-IN")}</p>
        </div>
        <button
          onClick={handleAddAll}
          className="shrink-0 inline-flex items-center gap-1 h-8 px-3 rounded-full bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
        >
          <Package className="h-3.5 w-3.5" />
          Add Kit
        </button>
      </div>
    </div>
  );
};

const KitsSection = () => {
  const { data: products } = useSupabaseProducts();
  const kits = useMemo(() => (products ? resolveKits(products) : []), [products]);
  if (!kits.length) return null;

  return (
    <section className="container py-3">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-bold text-foreground">Get the Job Done Kits</h2>
          <p className="text-xs text-muted-foreground">Pick a job, we'll pack everything you need.</p>
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-none">
        {kits.map((k) => (
          <KitCard key={k.def.id} kit={k} />
        ))}
      </div>
    </section>
  );
};

export default KitsSection;