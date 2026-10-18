// Shared pieces of the owner-only engineering preview (plan v1.2 §5B).
// Mock data only: nothing here reads or writes a database.
import type { ReactNode } from "react";

export type { PreviewLine, QuantityState, ReviewState } from "./labels";

export function SurfacePanel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{children}</p>;
}
