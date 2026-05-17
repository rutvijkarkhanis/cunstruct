import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Package, Eye, ChevronRight, ArrowRight, HardHat, X } from "lucide-react";
import Header from "@/components/Header";
import SearchBar from "@/components/SearchBar";
import KitsCarousel from "@/components/KitsCarousel";
import {
  useSupabaseProducts,
  useSupabaseCategories,
} from "@/hooks/useSupabaseProducts";
import { resolveKits, ResolvedKit } from "@/lib/kits";
import { resolveRecommendedGroups } from "@/lib/recommendedProducts";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";
import GroupedProductCard, { groupProducts } from "@/components/GroupedProductCard";
import SortDropdown from "@/components/SortDropdown";
import { sortGroups, SortOption } from "@/lib/sort";
const tagColor: Record<ResolvedKit["def"]["tag"], string> = {
  "Most Popular": "bg-accent/15 text-accent border-accent/30",
  "Contractor Pick": "bg-primary/10 text-primary border-primary/30",
  "Quick Fix": "bg-success/10 text-success border-success/30",
};

const KitGridCard = ({ kit }: { kit: ResolvedKit }) => {
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

/** Lookup table: main_category (lowercase) -> kit id */
const CATEGORY_TO_KIT: Record<string, string> = {
  electrical: "electrical",
  "plumbing & sanitary": "plumbing",
  plumbing: "plumbing",
  "fasteners & hardware": "fastening",
  fasteners: "fastening",
  "tools & accessories": "drilling-cutting",
  tools: "drilling-cutting",
  "adhesives & chemicals": "wall-repair",
  adhesives: "wall-repair",
  "fixtures & fittings": "wall-mounting",
  fixtures: "wall-mounting",
};

const Index = () => {
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>("price_asc");
  const [showBanner, setShowBanner] = useState(() => {
    try { return localStorage.getItem("hide-contractor-banner") !== "1"; } catch { return true; }
  });

  const { data: products, isLoading } = useSupabaseProducts(selectedCat);
  const { data: allProducts } = useSupabaseProducts();
  const { data: categories } = useSupabaseCategories();

  const dismissBanner = () => {
    setShowBanner(false);
    try { localStorage.setItem("hide-contractor-banner", "1"); } catch { /* noop */ }
  };

  const kits = useMemo(
    () => (allProducts ? resolveKits(allProducts) : []),
    [allProducts],
  );
  // Carousel shows full kit list (no slicing); CTA links to /kits page.

  const featuredKit: ResolvedKit | null = useMemo(() => {
    if (!selectedCat) return null;
    const kitId = CATEGORY_TO_KIT[selectedCat.toLowerCase()];
    if (!kitId) return null;
    return kits.find((k) => k.def.id === kitId) ?? null;
  }, [selectedCat, kits]);

  const groups = useMemo(
    () => (products ? sortGroups(groupProducts(products), sort) : []),
    [products, sort],
  );

  // Fixed cross-sell list — grouped by category, only used when no category is selected.
  const recommendedSections = useMemo(
    () => (allProducts ? resolveRecommendedGroups(allProducts) : []),
    [allProducts],
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Contractor banner */}
      {showBanner && (
        <div className="bg-primary text-primary-foreground text-sm">
          <div className="container flex items-center justify-between gap-4 py-2">
            <Link
              to="/auth"
              className="flex-1 text-center hover:underline"
            >
              Contractor? Track your project procurement →
            </Link>
            <button
              onClick={dismissBanner}
              className="shrink-0 p-1 rounded hover:bg-primary-foreground/10"
              aria-label="Dismiss banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <Header />

      {/* Hero */}
      <div className="container pt-4 pb-2">
        <div className="bg-primary rounded-xl p-6 space-y-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-primary-foreground leading-tight">
            Construction Materials in <span className="text-accent">30 Minutes</span>
          </h1>

          <SearchBar variant="hero" placeholder="Search drills, switches, valves…" />

          {/* Subtle location line — below the search bar */}
          <p className="text-xs text-primary-foreground/60">
            📍 Delivering across Gurgaon
          </p>
        </div>
      </div>

      {/* Kits carousel (PRIMARY) */}
      <div className="container py-4">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-base font-bold text-foreground">Get the Job Done Kits</h2>
            <p className="text-[11px] text-muted-foreground">Pick a job, we'll pack everything you need.</p>
          </div>
          {kits.length > 0 && (
            <Link
              to="/kits"
              className="text-xs font-medium text-accent flex items-center gap-0.5 shrink-0"
            >
              View All Kits <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        {!allProducts ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : kits.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground text-sm">No kits available.</p>
        ) : (
          <KitsCarousel kits={kits} renderCard={(k) => <KitGridCard kit={k} />} />
        )}
      </div>

      {/* Sticky category chips (SECONDARY) */}
      <div className="sticky top-14 z-30 bg-background/95 backdrop-blur-sm border-b">
        <div className="container py-2">
          <div className="flex gap-2 overflow-x-auto scrollbar-none">
            <button
              onClick={() => setSelectedCat(null)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                !selectedCat
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-foreground border-border hover:border-primary/40"
              }`}
            >
              All
            </button>
            {categories?.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCat(cat)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  selectedCat === cat
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-foreground border-border hover:border-primary/40"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Product listing */}
      <div className="container py-4 pb-10">
        {/* Featured kit for the selected category */}
        {featuredKit && (
          <Link
            to={`/kit/${featuredKit.def.id}`}
            className="flex items-center gap-3 bg-accent/10 border border-accent/30 rounded-lg p-3 mb-4 hover:bg-accent/15 transition-colors"
          >
            <span className="text-2xl shrink-0" aria-hidden>{featuredKit.def.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
                Recommended kit for {selectedCat}
              </p>
              <p className="text-sm font-bold text-foreground line-clamp-1">
                {featuredKit.def.name} · {featuredKit.products.length} items
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent shrink-0">
              View Kit <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        )}

        <div className="flex items-center justify-between mb-1">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">
              {selectedCat ? `Popular in ${selectedCat}` : "You Might Also Need"}
            </h2>
            {!selectedCat && (
              <p className="text-[11px] text-muted-foreground">
                Quick add — finish your job in one trip.
              </p>
            )}
          </div>
          {selectedCat && (
            <div className="flex items-center gap-2 shrink-0">
              <SortDropdown value={sort} onChange={setSort} />
            </div>
          )}
        </div>

        {selectedCat ? (
          isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : groups.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">No products found.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-3">
              {groups.slice(0, 20).map((g) => (
                <GroupedProductCard key={g.groupName} group={g} />
              ))}
            </div>
          )
        ) : !allProducts ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : recommendedSections.length === 0 ? (
          <p className="text-center py-10 text-muted-foreground">No products found.</p>
        ) : (
          <div className="space-y-6 mt-3">
            {recommendedSections.map((section, idx) => (
              <div key={section.title}>
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
                    {section.title}
                  </h3>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {section.products.map((p) => (
                    <GroupedProductCard
                      key={p.id}
                      group={{
                        groupName: p.group_name?.trim() || p.name,
                        products: [p],
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CTA: View All Products */}
        <div className="flex justify-center mt-6">
          <Link
            to="/products"
            className="inline-flex items-center gap-1 h-10 px-5 rounded-full border border-border bg-card text-foreground text-sm font-semibold hover:border-primary/40 hover:text-primary transition-colors"
          >
            View All Products <ChevronRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Brand section: positioning */}
        <section className="mt-12 bg-secondary/40 border rounded-2xl p-6 sm:p-8">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px] font-bold uppercase tracking-wide mb-3">
              <HardHat className="h-3.5 w-3.5" />
              Built for Construction Sites
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground leading-tight">
              Made for real on-site problems — not generic shopping.
            </h2>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground leading-relaxed">
              <p>
                Cunstruct is designed for urgent material shortages, missing tools, and last-minute
                requirements that hold up your work.
              </p>
              <p>
                Instead of calling multiple vendors or delaying the job, order instantly and get
                materials delivered in minutes.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Index;
