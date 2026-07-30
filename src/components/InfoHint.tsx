import * as React from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A small "ⓘ" button that opens a popover with a plain-English explanation.
 * Used across the BOQ module to teach first-time users what each field means.
 *
 *   <InfoHint title="Wastage">Extra material ordered to cover offcuts…</InfoHint>
 */
export function InfoHint({
  title,
  children,
  className,
  side = "top",
  align = "start",
  width = "w-80",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  width?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={title ? `About ${title}` : "More information"}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex items-center justify-center text-muted-foreground/70 hover:text-foreground transition-colors align-middle",
            className,
          )}
        >
          <Info className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className={cn(width, "text-sm")}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <div className="font-semibold mb-1.5">{title}</div>}
        <div className="text-muted-foreground space-y-1.5 leading-relaxed [&_b]:text-foreground [&_code]:text-foreground [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_code]:text-[12px]">
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default InfoHint;
