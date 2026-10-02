// SHARE TOKEN — generation/hashing for public, unauthenticated project-share
// links (see src/pages/PublicWorkspaceShare.tsx and
// supabase/functions/workspace-share/). The raw token is a bearer secret:
// whoever holds it can view the shared project's workspace with no login.
// Only its SHA-256 hash is ever persisted (project_share_link.token_hash) —
// same discipline as a password-reset token, never an API key you can look
// up again later. generateShareToken() must never be called anywhere the
// result isn't shown to the creator immediately; hashShareToken() is what
// gets stored and what an incoming request is checked against.
//
// Relative + explicit extension (not the usual "@/..." alias) so this pure
// module can be imported unmodified from the workspace-share Supabase Edge
// Function (Deno) as well as the browser build — same convention as
// analysisPrompt.ts/identifyPrompt.ts. Web Crypto only (`crypto.getRandomValues`,
// `crypto.subtle.digest`) — both exist as globals in the browser and in Deno,
// so this file needs no environment-specific import either way.

const TOKEN_BYTES = 32; // 256 bits of entropy — comfortably unguessable

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh, unguessable bearer token for a new share link. Never persisted
 *  as-is — the caller must immediately display it (it can't be retrieved
 *  again later) and pass it through hashShareToken() before storing. */
export function generateShareToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** SHA-256 hex digest of a raw token — what's actually stored in
 *  project_share_link.token_hash and what an incoming request's token is
 *  compared against. Deterministic (same input always hashes the same way)
 *  and one-way (never reconstructs the raw token from the hash). */
export async function hashShareToken(rawToken: string): Promise<string> {
  const data = new TextEncoder().encode(rawToken);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
