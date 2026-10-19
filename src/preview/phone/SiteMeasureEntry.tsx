// B10 (c): site measurement entry at phone width. No × L × B × D rows evaluated
// by src/lib/measurement (pending stays pending, never 0). Photos are held as
// in-memory object URLs only — never uploaded or persisted — and revoked when
// removed or when the view unmounts.
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { NumericNudge } from "@/design/DragAlternative";
import { formatQuantity } from "@/design/money";
import { evaluateLine, UNIT_LABEL, type MeasurementRow } from "@/lib/measurement/measurement";
import { t, type Locale } from "./messages";
import type { QueuedActionKind } from "./offlineQueue";
import { PREVIEW_MEASURE_LINE } from "./fixtures";

const emptyRow = (n: number): MeasurementRow => ({
  id: `R${n}`, description: "", no: null,
  L: { value: null, unit: "m" }, B: { value: null, unit: "m" }, D: { value: null, unit: "m" },
  deduction: false, drawingRef: null, rule: null,
});

interface Photo { url: string; name: string }

const createUrl = (f: File): string | null => {
  try {
    return typeof URL.createObjectURL === "function" ? URL.createObjectURL(f) : null;
  } catch {
    return null;
  }
};
const revokeUrl = (url: string) => {
  try {
    if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
  } catch {
    /* nothing to release */
  }
};

export function SiteMeasureEntry({
  locale, onQueue,
}: {
  locale: Locale;
  onQueue: (kind: QueuedActionKind, payload: Record<string, string | number | null>) => void;
}) {
  const line = PREVIEW_MEASURE_LINE;
  const [rows, setRows] = useState<MeasurementRow[]>([emptyRow(1)]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach((p) => revokeUrl(p.url)), []);

  const result = evaluateLine({ id: line.id, item: line.item, unit: line.unit, rows });

  const setDim = (i: number, key: "no" | "L" | "B" | "D", v: number) =>
    setRows((rs) => rs.map((r, j) => (j !== i ? r : key === "no" ? { ...r, no: v } : { ...r, [key]: { value: v, unit: "m" } })));

  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const added = files.flatMap((f) => {
      const url = createUrl(f);
      return url ? [{ url, name: f.name }] : [];
    });
    setPhotos((p) => [...p, ...added]);
    e.target.value = "";
  };

  const total =
    result.status === "established" || result.status === "confirmed_zero"
      ? `${formatQuantity(result.total)} ${UNIT_LABEL[line.unit]}`
      : t(locale, result.status === "invalid" ? "totalInvalid" : "totalPending");

  return (
    <section className="space-y-3" aria-labelledby="measure-title">
      <h3 id="measure-title" className="text-base font-semibold">{t(locale, "measureTitle")}</h3>
      <p className="text-sm">{t(locale, "measureLine", { line: line.item })}</p>
      {rows.map((r, i) => (
        <fieldset key={r.id} className="space-y-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{t(locale, "row", { n: i + 1 })}</legend>
          {(["no", "L", "B", "D"] as const).map((k) => {
            const label = t(locale, k === "no" ? "fieldNo" : k === "L" ? "fieldL" : k === "B" ? "fieldB" : "fieldD");
            const value = k === "no" ? r.no : r[k]?.value ?? null;
            return (
              <div key={k} className="flex items-center justify-between gap-2">
                <span className="w-6 text-sm font-medium">{label}</span>
                <NumericNudge
                  label={`${t(locale, "row", { n: i + 1 })} ${label}`}
                  value={value}
                  min={0}
                  step={k === "no" ? 1 : 0.05}
                  decimals={k === "no" ? 0 : 3}
                  unit={k === "no" ? undefined : "m"}
                  onChange={(v) => setDim(i, k, v)}
                />
              </div>
            );
          })}
          {rows.length > 1 && (
            <button
              type="button"
              className="min-h-11 text-sm underline"
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
            >
              {t(locale, "removeRow", { n: i + 1 })}
            </button>
          )}
        </fieldset>
      ))}
      <button type="button" className="min-h-11 w-full rounded-md border text-sm font-medium" onClick={() => setRows((rs) => [...rs, emptyRow(rs.length + 1)])}>
        {t(locale, "addRow")}
      </button>
      <div className="flex items-center justify-between rounded-md bg-muted/50 p-2 text-sm">
        <span>{t(locale, "lineTotal")}</span>
        <span className="font-semibold tabular-nums" data-testid="measure-total">{total}</span>
      </div>

      <div className="space-y-2">
        <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-md border text-sm font-medium">
          {t(locale, "attachPhoto")}
          <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={onFiles} />
        </label>
        <p className="text-xs text-muted-foreground">{t(locale, "photoNote")}</p>
        {photos.length > 0 && (
          <ul className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <li key={p.url} className="space-y-1">
                <img src={p.url} alt={p.name} className="h-20 w-full rounded object-cover" />
                <button
                  type="button"
                  className="min-h-8 text-xs underline"
                  onClick={() => {
                    revokeUrl(p.url);
                    setPhotos((ps) => ps.filter((x) => x.url !== p.url));
                  }}
                >
                  {t(locale, "removePhoto", { n: i + 1 })}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        className="min-h-11 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground"
        onClick={() =>
          onQueue("measurement_save", {
            lineId: line.id,
            rows: rows.length,
            status: result.status,
            total: result.total,
            // Only the count: photo data stays in memory and is never queued.
            photos: photos.length,
          })
        }
      >
        {t(locale, "saveMeasurement")}
      </button>
    </section>
  );
}
