import { Link } from "react-router-dom";
import { Upload, Sparkles, ClipboardCheck, Calculator, FileDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The project landing's primary artifact: DRAWING → AI EXTRACTION → HUMAN
 * REVIEW → APPLY → BOQ → EXPORT, as five steps a first-time user can read in
 * one glance and act on immediately. Step 1 ("done") is the only step this
 * screen can back with real project-level data (a document exists); steps
 * 2-5 describe what happens next inside the BOQ/review flow rather than
 * claiming a status this screen cannot truthfully know per-BOQ — so no
 * invented "3/5 complete" progress bar, just an honest single checkpoint.
 */
export default function ProjectWorkflow({ hasDocuments }: { hasDocuments: boolean }) {
  const steps = [
    { icon: Upload, title: "Add a drawing", desc: "Upload the architectural or construction PDF.", to: "documents", done: hasDocuments },
    { icon: Sparkles, title: "Generate quantities", desc: "Cunstruct reads the drawing and proposes measurable BOQ quantities." },
    { icon: ClipboardCheck, title: "Review with confidence", desc: "Verify, edit, or flag each quantity before it enters the BOQ." },
    { icon: Calculator, title: "Build your BOQ", desc: "Apply the reviewed quantities into a real bill of quantities.", to: "boqs" },
    { icon: FileDown, title: "Export", desc: "Hand the finished BOQ to your team as PDF or Excel." },
  ];

  return (
    <div className="rounded-lg border bg-card p-4 md:p-5">
      <div className="flex items-baseline justify-between gap-2 mb-4">
        <h2 className="text-sm font-semibold text-foreground">How Cunstruct builds your BOQ</h2>
        {!hasDocuments && <span className="text-xs text-muted-foreground">Start with step 1</span>}
      </div>
      <ol className="grid gap-3 sm:grid-cols-5">
        {steps.map((s, i) => {
          const body = (
            <div
              className={cn(
                "h-full rounded-md border p-3 space-y-1.5 transition-colors",
                s.done ? "border-emerald-500/30 bg-emerald-500/5" : "border-border",
                s.to && "hover:border-primary/50",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                    s.done ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-primary/10 text-primary",
                  )}
                >
                  {s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <s.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-sm font-medium text-foreground">{s.title}</div>
              <p className="text-xs text-muted-foreground leading-snug">{s.desc}</p>
            </div>
          );
          return (
            <li key={s.title}>
              {s.to ? <Link to={s.to} className="block h-full">{body}</Link> : body}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
