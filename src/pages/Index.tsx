import { useMemo, useState, FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Clock, Loader2, Package, Eye, Search, ChevronRight, ArrowRight } from "lucide-react";
import Header from "@/components/Header";
import {
  useSupabaseProducts,
  useSupabaseCategories,
} from "@/hooks/useSupabaseProducts";
import { resolveKits, ResolvedKit } from "@/lib/kits";
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
  const navigate = useNavigate();
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>("price_asc");
  const [heroQuery, setHeroQuery] = useState("");

  const { data: products, isLoading } = useSupabaseProducts(selectedCat);
  const { data: allProducts } = useSupabaseProducts();
  const { data: categories } = useSupabaseCategories();

  const kits = useMemo(
    () => (allProducts ? resolveKits(allProducts) : []),
    [allProducts],
  );
  const visibleKits = kits.slice(0, 6);

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

  const handleHeroSearch = (e: FormEvent) => {
    e.preventDefault();
    if (!heroQuery.trim()) return;
    navigate(`/search?q=${encodeURIComponent(heroQuery.trim())}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero */}
      <div className="container pt-4 pb-2">
        <div className="bg-primary rounded-xl p-6 space-y-4">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-primary-foreground leading-tight">
              What do you want to <span className="text-accent">get done</span> today?
            </h1>
            <p className="text-sm text-primary-foreground/80">
              Pick a job or browse products.
            </p>
          </div>

          <form onSubmit={handleHeroSearch} className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={heroQuery}
              onChange={(e) => setHeroQuery(e.target.value)}
              placeholder="Search drills, switches, valves…"
              className="w-full h-11 pl-10 pr-24 rounded-full bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-4 rounded-full bg-accent text-accent-foreground text-xs font-semibold hover:bg-accent/90"
            >
              Search
            </button>
          </form>

          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-primary-foreground/80">
              Delivery in 60 mins
            </span>
          </div>
        </div>
      </div>

      {/* Kits grid (PRIMARY) */}
      <div className="container py-4">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-base font-bold text-foreground">Get the Job Done Kits</h2>
            <p className="text-[11px] text-muted-foreground">Pick a job, we'll pack everything you need.</p>
          </div>
          {kits.length > visibleKits.length && (
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
        ) : visibleKits.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground text-sm">No kits available.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleKits.map((k) => (
              <KitGridCard key={k.def.id} kit={k} />
            ))}
          </div>
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

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-foreground">
            {selectedCat ? `Popular in ${selectedCat}` : "Recommended Products"}
          </h2>
          <div className="flex items-center gap-2">
            <SortDropdown value={sort} onChange={setSort} />
            <Link
              to="/products"
              className="text-xs font-medium text-accent flex items-center gap-0.5"
            >
              View All <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <p className="text-center py-10 text-muted-foreground">No products found.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {groups.slice(0, 20).map((g) => (
              <GroupedProductCard key={g.groupName} group={g} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
