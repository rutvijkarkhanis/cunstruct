// SHARE LINKS DIALOG — staff-only management of a project's public share
// links. Normal authenticated supabase client via useShareLinks; the
// unauthenticated public read path this enables lives entirely in the
// workspace-share Edge Function, never here.
//
// The raw token is shown exactly once, immediately after creation — only its
// hash is persisted (project_share_link.token_hash), so it genuinely cannot
// be shown again afterward. Same UX discipline as a GitHub PAT/API-key
// creation flow: copy it now, or revoke and make a new one.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Share2, Copy, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useShareLinks } from "@/hooks/useShareLinks";
import { formatDateShort } from "@/lib/forecastEngine";

/** Today's date as a plain YYYY-MM-DD string, in the browser's own local
 *  time zone — the same shape a native `<input type="date">` produces/
 *  consumes, so a same-day comparison never trips on a UTC/local mismatch. */
function todayDateString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** An expiry date input ("" = no expiry) becomes end-of-that-day in the
 *  browser's own local time zone — a link set to "expire today" stays
 *  usable through the rest of today, never expiring the instant it's
 *  created. Returns null for "" (indefinite) and for anything that doesn't
 *  parse to a real date. */
function expiryDateToIso(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface ShareLinksDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function shareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`;
}

export default function ShareLinksDialog({ projectId, open, onOpenChange }: ShareLinksDialogProps) {
  const { links, createLink, revokeLink } = useShareLinks(projectId);
  const [name, setName] = useState("");
  const [showPricing, setShowPricing] = useState(true);
  // "" = no expiry (indefinite) — the existing default behavior, unchanged
  // unless a staff member explicitly picks a date.
  const [expiryDate, setExpiryDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreatedUrl, setJustCreatedUrl] = useState<string | null>(null);

  const onCreate = async () => {
    if (!name.trim()) { toast.error("Give this link a name"); return; }
    if (expiryDate) {
      if (Number.isNaN(new Date(expiryDate).getTime())) { toast.error("That expiry date isn't valid"); return; }
      if (expiryDate < todayDateString()) { toast.error("Expiry date can't be in the past"); return; }
    }
    setCreating(true);
    const rawToken = await createLink({ name: name.trim(), showPricing, expiresAt: expiryDateToIso(expiryDate) });
    setCreating(false);
    if (rawToken) {
      setJustCreatedUrl(shareUrl(rawToken));
      setName("");
      setExpiryDate("");
    }
  };

  const onRevoke = async (linkId: string) => {
    await revokeLink(linkId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Share2 className="w-4 h-4" /> Share this project</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {justCreatedUrl && (
            <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-2.5 space-y-1.5">
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                Copy this link now — we don't store it and can't show it again. Losing it means revoking and creating a new one.
              </p>
              <div className="flex items-center gap-1.5">
                <Input readOnly value={justCreatedUrl} className="text-xs h-8" onFocus={(e) => e.target.select()} />
                <Button
                  size="icon" variant="outline" className="h-8 w-8 shrink-0"
                  onClick={() => { navigator.clipboard.writeText(justCreatedUrl); toast.success("Copied"); }}
                  aria-label="Copy link"
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2 border rounded p-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Link name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Client review – Oct 2026" className="h-8 text-sm" />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Show BOQ pricing (rates, totals)</Label>
              <Switch checked={showPricing} onCheckedChange={setShowPricing} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Expires (optional — leave blank for no expiry)</Label>
              <Input
                type="date" value={expiryDate} min={todayDateString()}
                onChange={(e) => setExpiryDate(e.target.value)} className="h-8 text-sm"
              />
            </div>
            <Button size="sm" className="gap-1.5 w-full" onClick={onCreate} disabled={creating}>
              <Plus className="w-3.5 h-3.5" /> {creating ? "Creating…" : "Create link"}
            </Button>
          </div>

          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Existing links</div>
            {links === undefined ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : links.length === 0 ? (
              <p className="text-xs text-muted-foreground">No share links yet.</p>
            ) : (
              <div className="space-y-1.5">
                {links.map((l) => {
                  const revoked = !!l.revoked_at;
                  const expired = !!l.expires_at && new Date(l.expires_at).getTime() <= Date.now();
                  const inactive = revoked || expired;
                  return (
                    <div key={l.id} className="flex items-center justify-between gap-2 text-xs border-b pb-1.5 last:border-0">
                      <div className="min-w-0">
                        <div className={inactive ? "truncate text-muted-foreground line-through" : "truncate"}>{l.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {revoked
                            ? "Revoked"
                            : expired
                              ? `Expired ${formatDateShort(l.expires_at)}`
                              : `${l.show_pricing ? "Pricing visible" : "No pricing"}${l.expires_at ? ` · Expires ${formatDateShort(l.expires_at)}` : " · No expiry"}`}
                        </div>
                      </div>
                      {!inactive && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => onRevoke(l.id)} aria-label="Revoke" title="Revoke">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
