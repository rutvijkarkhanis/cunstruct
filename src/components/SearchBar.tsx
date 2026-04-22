import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useSupabaseProducts } from "@/hooks/useSupabaseProducts";
import { groupProducts } from "@/components/GroupedProductCard";

function useDebounced<T>(value: T, ms = 300): T {
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

const SearchBar = () => {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q, 300);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const { data: products } = useSupabaseProducts();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const { groups, suggestedCats } = useMemo(() => {
    if (!products || !debounced.trim()) return { groups: [], suggestedCats: [] as string[] };
    const term = debounced.trim().toLowerCase();
    const matches = products.filter((p) => {
      const hay = `${p.name ?? ""} ${p.group_name ?? ""} ${p.brand ?? ""} ${p.main_category ?? ""} ${p.subcategory ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
    // Sort: priority=fast first
    matches.sort((a, b) => {
      const af = (a.priority ?? "").toLowerCase() === "fast" ? 0 : 1;
      const bf = (b.priority ?? "").toLowerCase() === "fast" ? 0 : 1;
      return af - bf;
    });
    const groups = groupProducts(matches).slice(0, 5);
    const cats = Array.from(
      new Set(products.map((p) => p.subcategory).filter(Boolean) as string[]),
    ).slice(0, 5);
    return { groups, suggestedCats: cats };
  }, [products, debounced]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div ref={ref} className="relative flex-1 max-w-md">
      <form onSubmit={submit} className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => q && setOpen(true)}
          placeholder="Search drills, switches, valves…"
          className="w-full h-9 pl-8 pr-8 rounded-full border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </form>

      {open && debounced.trim() && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-card border rounded-lg shadow-lg z-50 overflow-hidden">
          {groups.length === 0 ? (
            <div className="p-3 text-sm">
              <p className="text-muted-foreground mb-2">No results found</p>
              {suggestedCats.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {suggestedCats.map((c) => (
                    <Link
                      key={c}
                      to={`/products?category=${encodeURIComponent(c)}`}
                      onClick={() => setOpen(false)}
                      className="px-2 py-0.5 rounded-full text-[11px] bg-muted text-foreground border border-border hover:bg-accent/10"
                    >
                      {c}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <ul className="divide-y">
              {groups.map((g) => {
                const top = g.products[0];
                const min = Math.min(...g.products.map((p) => p.selling_price ?? Infinity));
                return (
                  <li key={g.groupName}>
                    <Link
                      to={`/product/${top.id}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 p-2 hover:bg-muted/50 transition-colors"
                    >
                      <img
                        src={top.image_url}
                        alt=""
                        className="h-10 w-10 rounded object-contain bg-muted shrink-0"
                        loading="lazy"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground line-clamp-1">
                          {highlight(g.groupName, debounced)}
                        </p>
                        <p className="text-[11px] text-muted-foreground line-clamp-1">
                          {top.subcategory || top.main_category || ""}
                        </p>
                      </div>
                      <span className="text-sm font-bold text-foreground shrink-0">
                        ₹{isFinite(min) ? min : top.selling_price}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchBar;