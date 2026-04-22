import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Eye, Loader2, Package } from "lucide-react";
import Header from "@/components/Header";
import { useSupabaseProducts } from "@/hooks/useSupabaseProducts";
import { resolveKits, ResolvedKit } from "@/lib/kits";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";

const tagColor: Record<ResolvedKit["def"]["tag"], string> = {
  "Most Popular": "bg-accent/15 text-accent border-accent/30",
  "Contractor Pick": "bg-primary/10 text-primary border-primary/30",
  "Quick Fix": "bg-success/10 text-success border-success/30",
};

const KitCard = ({ kit }: { kit: ResolvedKit }) => {
  const { addToCart } = useCart();
  const previews = kit.products.slice(0, 5);

  const handleAddAll = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    kit.products.forEach((p) => addToCart(p, 1));
    toast.success(`${kit.def.name} added to cart`);
  };

  return (
    <Link
      to={`/kit/${kit.def.id}`}
      className="group bg-card border rounded-xl overflow-hidden flex flex-col hover:border-primary/40 hover:shadow-md transition-all"
    >
      <div className="p-4 border-b flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-2xl" aria-hidden>{kit.def.emoji}</span>
          <h3 className="text-sm font-bold text-foreground line-clamp-2">{kit.def.name}</h3>
        </div>
        <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 ${tagColor[kit.def.tag]}`}>
          {kit.def.tag}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-1 p-2 bg-muted/30">
        {previews.map((p) => (
          <div key={p.id} className="aspect-square bg-card rounded flex items-center justify-center p-1">
            <img src={p.image_url} alt={p.name} loading="lazy" className="max-h-full max-w-full object-contain" />
          </div>
        ))}
        {Array.from({ length: Math.max(0, 5 - previews.length) }).map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square bg-card rounded" />
        ))}
      </div>

      <div className="p-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">{kit.products.length} items</p>
          <p className="text-base font-bold text-foreground">from ₹{kit.totalPrice.toLocaleString("en-IN")}</p>
        </div>
      </div>

      <div className="p-3 pt-0 grid grid-cols-2 gap-2">
        <span className="inline-flex items-center justify-center gap-1 h-9 px-3 rounded-full bg-primary text-primary-foreground text-xs font-semibold group-hover:bg-primary/90">
          <Eye className="h-3.5 w-3.5" />
          View Kit
        </span>
        <button
          onClick={handleAddAll}
          className="inline-flex items-center justify-center gap-1 h-9 px-3 rounded-full border border-primary/40 text-primary text-xs font-semibold hover:bg-primary/5"
        >
          <Package className="h-3.5 w-3.5" />
          Add Full Kit
        </button>
      </div>
    </Link>
  );
};

const Kits = () => {
  const { data: products, isLoading } = useSupabaseProducts();
  const kits = useMemo(() => (products ? resolveKits(products) : []), [products]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container py-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>
        <h1 className="text-xl font-bold text-foreground">All Kits</h1>
        <p className="text-xs text-muted-foreground mb-4">
          Curated collections for every job — pick one and you're done.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : kits.length === 0 ? (
          <p className="text-center py-10 text-muted-foreground">No kits available.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {kits.map((k) => (
              <KitCard key={k.def.id} kit={k} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Kits;