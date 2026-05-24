import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Search,
  X,
  Package,
  Wrench,
  Tag,
  Flame,
  Hammer,
  ArrowRight,
} from "lucide-react";
import { useSupabaseProducts } from "@/hooks/useSupabaseProducts";
import { groupProducts, ProductGroup } from "@/components/GroupedProductCard";
import { resolveKits, ResolvedKit } from "@/lib/kits";
import {
  JOB_DEFS,
  JobDef,
  DEFAULT_JOB_IDS,
  POPULAR_SEARCHES,
} from "@/lib/jobs";
import { logSearchEvent } from "@/lib/searchAnalytics";
import { cn } from "@/lib/utils";

function useDebounced<T>(value: T, ms = 120): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function highlight(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-accent/30 text-foreground rounded-sm px-0.5">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}

type Variant = "header" | "hero";

type Props = {
  variant?: Variant;
  placeholder?: string;
};

const SearchBar = ({ variant = "header", placeholder }: Props) => {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q, 120);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: products } = useSupabaseProducts();

  // Close on outside click (desktop). Mobile uses an X button.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Lock body scroll when mobile overlay is open
  useEffect(() => {
    if (open && typeof window !== "undefined" && window.innerWidth < 640) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  // ESC closes dropdown
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const allKits: ResolvedKit[] = useMemo(
    () => (products ? resolveKits(products) : []),
    [products],
  );

  const kitById = useMemo(() => {
    const m = new Map<string, ResolvedKit>();
    allKits.forEach((k) => m.set(k.def.id, k));
    return m;
  }, [allKits]);

  /* ----------------------- Result building (typed) ----------------------- */

  type JobHit = { job: JobDef; kit: ResolvedKit | null };

  const { jobs, productGroups, categories, totalHits } = useMemo(() => {
    const term = debounced.trim().toLowerCase();
    if (!products || !term) {
      return {
        jobs: [] as JobHit[],
        productGroups: [] as ProductGroup[],
        categories: [] as string[],
        totalHits: 0,
      };
    }

    // 1. Jobs: curated phrasings first, then fall back to kit names
    const matchedCuratedKitIds = new Set<string>();
    const curatedHits: JobHit[] = [];
    for (const job of JOB_DEFS) {
      const hay = `${job.label} ${job.keywords.join(" ")}`.toLowerCase();
      if (hay.includes(term)) {
        const kit = kitById.get(job.kitId) ?? null;
        curatedHits.push({ job, kit });
        matchedCuratedKitIds.add(job.kitId);
      }
    }

    // Fallback: surface kits whose own name/slot/products match but no curated job covered them
    const kitFallback: JobHit[] = [];
    for (const kit of allKits) {
      if (matchedCuratedKitIds.has(kit.def.id)) continue;
      const hay = `${kit.def.name} ${kit.def.slots.map((s) => s.label).join(" ")}`.toLowerCase();
      const matchesName = hay.includes(term);
      const matchesProduct = kit.products.some((p) =>
        `${p.name ?? ""} ${p.group_name ?? ""} ${p.subcategory ?? ""}`
          .toLowerCase()
          .includes(term),
      );
      if (matchesName || matchesProduct) {
        kitFallback.push({
          job: {
            id: `kit-${kit.def.id}`,
            label: kit.def.name,
            kitId: kit.def.id,
            keywords: [],
          },
          kit,
        });
      }
    }

    const jobs = [...curatedHits, ...kitFallback].slice(0, 4);

    // 2. Products
    const matches = products.filter((p) => {
      const hay = `${p.name ?? ""} ${p.group_name ?? ""} ${p.brand ?? ""} ${p.main_category ?? ""} ${p.subcategory ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
    matches.sort((a, b) => {
      const af = (a.priority ?? "").toLowerCase() === "fast" ? 0 : 1;
      const bf = (b.priority ?? "").toLowerCase() === "fast" ? 0 : 1;
      return af - bf;
    });
    const productGroups = groupProducts(matches).slice(0, 5);

    // 3. Categories (main_category + subcategory)
    const catSet = new Set<string>();
    for (const p of products) {
      if (p.main_category && p.main_category.toLowerCase().includes(term))
        catSet.add(p.main_category);
      if (p.subcategory && p.subcategory.toLowerCase().includes(term))
        catSet.add(p.subcategory);
    }
    const categories = Array.from(catSet).slice(0, 5);

    return {
      jobs,
      productGroups,
      categories,
      totalHits: jobs.length + productGroups.length + categories.length,
    };
  }, [products, debounced, allKits, kitById]);

  // Log zero-result events
  useEffect(() => {
    const term = debounced.trim();
    if (open && term && totalHits === 0 && products) {
      logSearchEvent({ query: term, event_type: "zero_result" });
    }
  }, [debounced, totalHits, open, products]);

  /* --------------------------- Default state --------------------------- */

  const defaultJobs = useMemo(() => {
    return DEFAULT_JOB_IDS.map((id) => JOB_DEFS.find((j) => j.id === id)).filter(
      (j): j is JobDef => Boolean(j),
    );
  }, []);

  /* ------------------------------ Handlers ------------------------------ */

  const close = () => setOpen(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    void logSearchEvent({ query: term, event_type: "search" });
    close();
    navigate(`/search?q=${encodeURIComponent(term)}`);
  };

  const handleJobClick = (job: JobDef) => {
    void logSearchEvent({
      query: q.trim() || job.label,
      event_type: "click",
      result_type: "kit",
      result_id: job.kitId,
    });
    close();
  };

  const handleProductClick = (productId: string) => {
    void logSearchEvent({
      query: q.trim(),
      event_type: "click",
      result_type: "product",
      result_id: productId,
    });
    close();
  };

  const handleCategoryClick = (cat: string) => {
    void logSearchEvent({
      query: q.trim(),
      event_type: "click",
      result_type: "category",
      result_id: cat,
    });
    close();
  };

  const runPopularSearch = (term: string) => {
    setQ(term);
    void logSearchEvent({ query: term, event_type: "search" });
    close();
    navigate(`/search?q=${encodeURIComponent(term)}`);
  };

  /* ------------------------------- Styles ------------------------------- */

  const isHero = variant === "hero";
  const wrapperCls = cn(
    "relative",
    isHero ? "w-full max-w-xl" : "flex-1 max-w-md",
  );
  const inputCls = cn(
    "w-full text-sm focus:outline-none focus:ring-2 focus:ring-ring transition",
    isHero
      ? "h-11 pl-10 pr-24 rounded-full bg-card text-foreground placeholder:text-muted-foreground"
      : "h-9 pl-8 pr-8 rounded-full border bg-background text-foreground",
  );
  const iconCls = cn(
    "absolute top-1/2 -translate-y-1/2 text-muted-foreground",
    isHero ? "left-3 h-4 w-4" : "left-2.5 h-4 w-4",
  );

  const showDefault = !debounced.trim();
  const showResults = !showDefault && totalHits > 0;
  const showEmpty = !showDefault && totalHits === 0;

  /* ------------------------------- Render ------------------------------- */

  return (
    <div ref={ref} className={wrapperCls}>
      <form onSubmit={submit} className="relative">
        <Search className={iconCls} />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? "Search drills, switches, valves…"}
          className={inputCls}
          aria-label="Search products, jobs and categories"
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              inputRef.current?.focus();
            }}
            className={cn(
              "absolute top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground",
              isHero ? "right-24" : "right-2",
            )}
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {isHero && (
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-4 rounded-full bg-accent text-accent-foreground text-xs font-semibold hover:bg-accent/90"
          >
            Search
          </button>
        )}
      </form>

      {open && (
        <>
          {/* Mobile backdrop */}
          <div
            className="sm:hidden fixed inset-0 top-14 bg-background/80 backdrop-blur-sm z-40"
            onClick={close}
            aria-hidden
          />

          <div
            className={cn(
              "z-50 bg-card border shadow-lg overflow-hidden",
              // Desktop: dropdown anchored under input
              "sm:absolute sm:left-0 sm:right-0 sm:top-full sm:mt-1 sm:rounded-lg",
              // Mobile: full-width overlay below header
              "fixed sm:static inset-x-0 top-14 sm:top-auto rounded-none sm:max-h-[70vh]",
              // Mobile fills available height
              "max-h-[calc(100vh-3.5rem)]",
            )}
          >
            <div className="overflow-y-auto max-h-[inherit]">
              {showDefault && (
                <DefaultPanel
                  jobs={defaultJobs}
                  popular={POPULAR_SEARCHES}
                  onJobClick={handleJobClick}
                  onPopularClick={runPopularSearch}
                />
              )}

              {showResults && (
                <ResultsPanel
                  query={debounced}
                  jobs={jobs}
                  productGroups={productGroups}
                  categories={categories}
                  onJobClick={handleJobClick}
                  onProductClick={handleProductClick}
                  onCategoryClick={handleCategoryClick}
                />
              )}

              {showEmpty && (
                <EmptyPanel
                  jobs={defaultJobs}
                  popular={POPULAR_SEARCHES}
                  onJobClick={handleJobClick}
                  onPopularClick={runPopularSearch}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

/* =========================== Sub-components =========================== */

const SectionHeader = ({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) => (
  <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {label}
    </span>
  </div>
);

const DefaultPanel = ({
  jobs,
  popular,
  onJobClick,
  onPopularClick,
}: {
  jobs: JobDef[];
  popular: string[];
  onJobClick: (job: JobDef) => void;
  onPopularClick: (term: string) => void;
}) => (
  <div className="pb-2">
    <SectionHeader icon={Flame} label="Popular searches" />
    <div className="flex flex-wrap gap-1.5 px-3 pb-1">
      {popular.map((term) => (
        <button
          key={term}
          type="button"
          onClick={() => onPopularClick(term)}
          className="px-2.5 py-1 rounded-full text-xs bg-muted text-foreground border border-border hover:border-primary/40 hover:bg-accent/10 transition-colors"
        >
          {term}
        </button>
      ))}
    </div>

    <SectionHeader icon={Hammer} label="Quick jobs" />
    <ul>
      {jobs.map((job) => (
        <li key={job.id}>
          <Link
            to={`/kit/${job.kitId}`}
            onClick={() => onJobClick(job)}
            className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors"
          >
            <div className="h-9 w-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
              <Wrench className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium text-foreground flex-1 line-clamp-1">
              {job.label}
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
  </div>
);

const ResultsPanel = ({
  query,
  jobs,
  productGroups,
  categories,
  onJobClick,
  onProductClick,
  onCategoryClick,
}: {
  query: string;
  jobs: { job: JobDef; kit: ResolvedKit | null }[];
  productGroups: ProductGroup[];
  categories: string[];
  onJobClick: (job: JobDef) => void;
  onProductClick: (productId: string) => void;
  onCategoryClick: (cat: string) => void;
}) => (
  <div className="pb-2">
    {jobs.length > 0 && (
      <>
        <SectionHeader icon={Wrench} label="Jobs" />
        <ul>
          {jobs.map(({ job, kit }) => (
            <li key={job.id}>
              <Link
                to={`/kit/${job.kitId}`}
                onClick={() => onJobClick(job)}
                className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors"
              >
                <div className="h-10 w-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
                  <Wrench className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground line-clamp-1">
                    {highlight(job.label, query)}
                  </p>
                  <p className="text-[11px] text-muted-foreground line-clamp-1">
                    {kit
                      ? `Open ${kit.def.name} · ${kit.products.length} items`
                      : `Open kit`}
                  </p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      </>
    )}

    {productGroups.length > 0 && (
      <>
        <SectionHeader icon={Package} label="Products" />
        <ul>
          {productGroups.map((g) => {
            const top = g.products[0];
            const min = Math.min(
              ...g.products.map((p) => p.selling_price ?? Infinity),
            );
            return (
              <li key={g.groupName}>
                <Link
                  to={`/product/${top.id}`}
                  onClick={() => onProductClick(top.id)}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  <img
                    src={top.image_url || "/placeholder.svg"}
                    alt=""
                    className="h-10 w-10 rounded object-contain bg-muted shrink-0"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground line-clamp-1">
                      {highlight(g.groupName, query)}
                    </p>
                    <p className="text-[11px] text-muted-foreground line-clamp-1">
                      {top.subcategory || top.main_category || ""}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-foreground shrink-0">
                    ₹{((isFinite(min) ? min : top.selling_price) ?? 0).toLocaleString("en-IN")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </>
    )}

    {categories.length > 0 && (
      <>
        <SectionHeader icon={Tag} label="Categories" />
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {categories.map((c) => (
            <Link
              key={c}
              to={`/products?category=${encodeURIComponent(c)}`}
              onClick={() => onCategoryClick(c)}
              className="px-2.5 py-1 rounded-full text-xs bg-muted text-foreground border border-border hover:border-primary/40 hover:bg-accent/10 transition-colors"
            >
              {highlight(c, query)}
            </Link>
          ))}
        </div>
      </>
    )}
  </div>
);

const EmptyPanel = ({
  jobs,
  popular,
  onJobClick,
  onPopularClick,
}: {
  jobs: JobDef[];
  popular: string[];
  onJobClick: (job: JobDef) => void;
  onPopularClick: (term: string) => void;
}) => (
  <div className="pb-2">
    <div className="px-3 pt-3 pb-1">
      <p className="text-sm font-semibold text-foreground">
        Not sure what to search?
      </p>
      <p className="text-[11px] text-muted-foreground">
        Try a popular term or pick a job below.
      </p>
    </div>
    <DefaultPanel
      jobs={jobs}
      popular={popular}
      onJobClick={onJobClick}
      onPopularClick={onPopularClick}
    />
    <div className="px-3 pb-3 pt-1 border-t mt-1">
      <a
        href="https://wa.me/919999999999"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
      >
        Can't find it? Ask us on WhatsApp <ArrowRight className="h-3 w-3" />
      </a>
    </div>
  </div>
);

export default SearchBar;
