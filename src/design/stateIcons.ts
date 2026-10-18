import { Ban, Check, CircleDashed, CircleMinus, Hourglass, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import type { StateIcon } from "./tokens";

/** Contract icon name → lucide-react glyph. */
export const STATE_ICONS: Record<StateIcon, LucideIcon> = {
  check: Check,
  "dotted-circle": CircleDashed,
  triangle: TriangleAlert,
  octagon: OctagonAlert,
  hourglass: Hourglass,
  "slash-circle": Ban,
  "minus-circle": CircleMinus,
};
