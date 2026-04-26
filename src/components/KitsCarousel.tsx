import { useRef, useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ResolvedKit } from "@/lib/kits";

type Props = {
  kits: ResolvedKit[];
  renderCard: (kit: ResolvedKit) => React.ReactNode;
};

/**
 * Horizontal scroll carousel for kits.
 * - Fixed card width (no shrinking), partial next card visible
 * - Desktop: arrow buttons; Mobile: native swipe
 */
const KitsCarousel = ({ kits, renderCard }: Props) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [updateArrows, kits.length]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // ~1 card width + gap (card 304 + gap 16)
    const step = 320 * dir;
    el.scrollBy({ left: step, behavior: "smooth" });
  };

  return (
    <div className="relative">
      {/* Arrows (desktop only) */}
      <button
        type="button"
        aria-label="Scroll left"
        onClick={() => scrollBy(-1)}
        disabled={!canLeft}
        className={`hidden md:flex absolute -left-3 top-1/2 -translate-y-1/2 z-10 h-9 w-9 items-center justify-center rounded-full bg-card border shadow-md transition-opacity ${
          canLeft ? "opacity-100 hover:bg-muted" : "opacity-0 pointer-events-none"
        }`}
      >
        <ChevronLeft className="h-4 w-4 text-foreground" />
      </button>
      <button
        type="button"
        aria-label="Scroll right"
        onClick={() => scrollBy(1)}
        disabled={!canRight}
        className={`hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 h-9 w-9 items-center justify-center rounded-full bg-card border shadow-md transition-opacity ${
          canRight ? "opacity-100 hover:bg-muted" : "opacity-0 pointer-events-none"
        }`}
      >
        <ChevronRight className="h-4 w-4 text-foreground" />
      </button>

      <div
        ref={scrollerRef}
        className="flex gap-4 overflow-x-auto scrollbar-none scroll-smooth snap-x snap-mandatory pb-2 pr-8"
        style={{ scrollPaddingLeft: "0.25rem" }}
      >
        {kits.map((k) => (
          <div
            key={k.def.id}
            className="snap-start shrink-0 w-[76vw] sm:w-[340px] md:w-[304px]"
          >
            {renderCard(k)}
          </div>
        ))}
      </div>
    </div>
  );
};

export default KitsCarousel;