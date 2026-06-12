import { useMemo, useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Minus, Plus, Package } from "lucide-react";
import Header from "@/components/Header";
import SEO, { SITE_URL } from "@/components/SEO";
import { useSupabaseProducts } from "@/hooks/useSupabaseProducts";
import { resolveKits } from "@/lib/kits";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";

const KitDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: products, isLoading } = useSupabaseProducts();
  const { addToCart } = useCart();

  const kit = useMemo(() => {
    if (!products) return null;
    return resolveKits(products).find((k) => k.def.id === id) ?? null;
  }, [products, id]);

  // selection map: productId -> qty (0 = removed)
  const [qty, setQty] = useState<Record<string, number>>({});

  useEffect(() => {
    if (kit) {
      const init: Record<string, number> = {};
      kit.products.forEach((p) => (init[p.id] = 1));
      setQty(init);
    }
  }, [kit]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!kit) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-10 text-center">
          <p className="text-muted-foreground mb-4">Kit not found.</p>
          <Link to="/" className="text-accent text-sm font-medium">Back to home</Link>
        </div>
      </div>
    );
  }

  const total = kit.products.reduce(
    (s, p) => s + (qty[p.id] ?? 0) * (p.selling_price ?? 0),
    0,
  );
  const selectedCount = kit.products.filter((p) => (qty[p.id] ?? 0) > 0).length;

  const handleAddSelected = () => {
    const selected = kit.products.filter((p) => (qty[p.id] ?? 0) > 0);
    if (!selected.length) {
      toast.error("No items selected");
      return;
    }
    selected.forEach((p) => addToCart(p, qty[p.id]));
    toast.success(`${selected.length} items added to cart`);
    navigate("/cart");
  };

  const handleAddFull = () => {
    kit.products.forEach((p) => addToCart(p, 1));
    toast.success(`${kit.def.name} added to cart`);
    navigate("/cart");
  };

  const kitJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: kit.def.name,
    description: `Pre-assembled kit with ${kit.products.length} construction items.`,
    url: `${SITE_URL}/kit/${kit.def.id}`,
    numberOfItems: kit.products.length,
    itemListElement: kit.products.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: p.name,
      url: `${SITE_URL}/product/${p.id}`,
    })),
  };

  return (
    <div className="min-h-screen bg-background pb-32">
      <SEO
        title={kit.def.name}
        description={`${kit.def.name} kit — ${kit.products.length} construction items ready to order. Delivered in 30 minutes.`}
        canonicalPath={`/kit/${kit.def.id}`}
        jsonLd={kitJsonLd}
      />
      <Header />

      <div className="container py-4">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        {/* Kit header */}
        <div className="bg-card border rounded-xl p-5 mb-4">
          <div className="flex items-start gap-3">
            <span className="text-3xl" aria-hidden>{kit.def.emoji}</span>
            <div className="min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-accent/15 text-accent border-accent/30">
                {kit.def.tag}
              </span>
              <h1 className="text-xl font-bold text-foreground mt-2">{kit.def.name}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Everything you need to complete {kit.def.name.toLowerCase().replace(/\s*kit$/i, "")}.
              </p>
            </div>
          </div>
        </div>

        {/* Items list */}
        <h2 className="text-sm font-bold text-foreground mb-2">
          Items in this kit ({kit.products.length})
        </h2>
        <ul className="space-y-2">
          {kit.products.map((p) => {
            const itemQty = qty[p.id] ?? 0;
            const removed = itemQty === 0;
            return (
              <li
                key={p.id}
                className={`bg-card border rounded-lg p-3 flex items-center gap-3 transition-opacity ${
                  removed ? "opacity-50" : ""
                }`}
              >
                <Link
                  to={`/product/${p.id}`}
                  className="h-16 w-16 shrink-0 bg-muted rounded flex items-center justify-center p-1"
                >
                  <img
                    src={p.image_url}
                    alt={p.name}
                    loading="lazy"
                    className="max-h-full max-w-full object-contain"
                  />
                </Link>
                <div className="flex-1 min-w-0">
                  <Link to={`/product/${p.id}`} className="block">
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {p.brand || p.subcategory || ""}
                    </p>
                    <p className="text-sm font-semibold text-foreground line-clamp-2">
                      {p.group_name || p.name}
                    </p>
                    {p.variant_name && (
                      <p className="text-[11px] text-muted-foreground line-clamp-1">
                        {p.variant_name}
                      </p>
                    )}
                  </Link>
                  <p className="text-sm font-bold text-foreground mt-1">
                    ₹{(p.selling_price ?? 0).toLocaleString("en-IN")}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {removed ? (
                    <button
                      onClick={() => setQty((q) => ({ ...q, [p.id]: 1 }))}
                      className="text-[11px] font-semibold text-accent border border-accent/40 rounded-full px-2.5 py-1 hover:bg-accent/10"
                    >
                      Add back
                    </button>
                  ) : (
                    <>
                      <div className="flex items-center gap-1 border rounded-full">
                        <button
                          onClick={() =>
                            setQty((q) => ({ ...q, [p.id]: Math.max(0, (q[p.id] ?? 1) - 1) }))
                          }
                          className="h-7 w-7 inline-flex items-center justify-center text-foreground"
                          aria-label="Decrease"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="text-xs font-semibold w-5 text-center">{itemQty}</span>
                        <button
                          onClick={() => setQty((q) => ({ ...q, [p.id]: (q[p.id] ?? 0) + 1 }))}
                          className="h-7 w-7 inline-flex items-center justify-center text-foreground"
                          aria-label="Increase"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <button
                        onClick={() => setQty((q) => ({ ...q, [p.id]: 0 }))}
                        className="text-[10px] text-muted-foreground hover:text-destructive"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-card border-t shadow-lg z-40">
        <div className="container py-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground">{selectedCount} items selected</p>
            <p className="text-lg font-bold text-foreground">
              ₹{total.toLocaleString("en-IN")}
            </p>
          </div>
          <button
            onClick={handleAddFull}
            className="hidden sm:inline-flex items-center gap-1 h-10 px-4 rounded-full border border-primary/40 text-primary text-sm font-semibold hover:bg-primary/5"
          >
            <Package className="h-4 w-4" />
            Add Full Kit
          </button>
          <button
            onClick={handleAddSelected}
            disabled={selectedCount === 0}
            className="inline-flex items-center gap-1 h-10 px-5 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
          >
            Add Selected to Cart
          </button>
        </div>
      </div>
    </div>
  );
};

export default KitDetail;