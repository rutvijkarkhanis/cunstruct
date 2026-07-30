// Shared editor + helpers for a qty_formula (the quantity basis that drives the
// BOQ). Used by both the Stage Mapping page and the BOQ template manager.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export type QtyBasis =
  | "per_floor_sqft" | "per_wall_sqft" | "per_point"
  | "per_room" | "per_bathroom" | "per_sqft" | "fixed";
export type QtyState = { basis: QtyBasis; amount: string; unitPrice: string; packSize: string };

export const BASIS_KEYS: QtyBasis[] = [
  "per_floor_sqft", "per_wall_sqft", "per_point", "per_room", "per_bathroom", "per_sqft", "fixed",
];
export const BASIS_META: Record<QtyBasis, { label: string; short: string; hint: string; placeholder: string }> = {
  per_floor_sqft: { label: "Per floor sq.ft", short: "/floor sq.ft", hint: "Units per sq.ft of floor/carpet area (tiles, flooring, adhesive).", placeholder: "e.g. 0.025" },
  per_wall_sqft: { label: "Per wall sq.ft", short: "/wall sq.ft", hint: "Units per sq.ft of wall area (paint, putty, plaster).", placeholder: "e.g. 0.02" },
  per_point: { label: "Per electrical point", short: "/point", hint: "Units per electrical point (wire, switches, conduit).", placeholder: "e.g. 15" },
  per_room: { label: "Per room", short: "/room", hint: "Units per room (doors, lights).", placeholder: "e.g. 1" },
  per_bathroom: { label: "Per bathroom", short: "/bathroom", hint: "Units per bathroom (sanitaryware).", placeholder: "e.g. 1" },
  per_sqft: { label: "Per built-up sq.ft", short: "/sq.ft", hint: "Units per sq.ft of built-up area (cement, steel, generic).", placeholder: "e.g. 0.4" },
  fixed: { label: "Fixed quantity", short: " fixed", hint: "A flat quantity regardless of project size.", placeholder: "e.g. 4" },
};

export const EMPTY_QTY: QtyState = { basis: "per_floor_sqft", amount: "", unitPrice: "", packSize: "" };

export function qtyFromFormula(f: any): QtyState {
  const found = BASIS_KEYS.find((k) => f?.[k] != null);
  return {
    basis: found ?? "per_floor_sqft",
    amount: found && f[found] != null ? String(f[found]) : "",
    unitPrice: f?.unit_price != null ? String(f.unit_price) : "",
    packSize: f?.pack_size != null ? String(f.pack_size) : "",
  };
}

export function qtyToFormula(q: QtyState): Record<string, number> | null {
  const out: Record<string, number> = {};
  const amt = parseFloat(q.amount);
  if (!isNaN(amt)) out[q.basis] = amt;
  const up = parseFloat(q.unitPrice);
  if (!isNaN(up)) out.unit_price = up;
  const ps = parseFloat(q.packSize);
  if (!isNaN(ps) && ps > 0) out.pack_size = ps;
  return Object.keys(out).length ? out : null;
}

export function formulaLabel(f: any): string {
  const found = BASIS_KEYS.find((k) => f?.[k] != null);
  if (!found) return "not set";
  return `${f[found]}${BASIS_META[found].short}`;
}

export function QtyBasisFields({ value, onChange }: { value: QtyState; onChange: (v: QtyState) => void }) {
  return (
    <div className="space-y-2">
      <Label>Quantity basis</Label>
      <div className="flex gap-2">
        <Select value={value.basis} onValueChange={(v) => onChange({ ...value, basis: v as QtyBasis })}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            {BASIS_KEYS.map((k) => <SelectItem key={k} value={k}>{BASIS_META[k].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          type="number" step="any" min="0"
          placeholder={BASIS_META[value.basis].placeholder}
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">{BASIS_META[value.basis].hint}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Pack size (optional)</Label>
          <Input
            type="number" step="any" min="0" placeholder="round up to multiples of"
            value={value.packSize}
            onChange={(e) => onChange({ ...value, packSize: e.target.value })}
          />
        </div>
        <div>
          <Label>Unit price override (optional)</Label>
          <Input
            type="number" step="any" min="0" placeholder="use live catalog price"
            value={value.unitPrice}
            onChange={(e) => onChange({ ...value, unitPrice: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
