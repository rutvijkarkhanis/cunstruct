const hostname = typeof window !== "undefined" ? window.location.hostname : "";

/**
 * True on the track subdomain (track.*) or when VITE_IS_APP_SUBDOMAIN=true in
 * a local dev environment where both surfaces share the same localhost origin.
 */
export function isAppSubdomain(): boolean {
  if (import.meta.env.VITE_IS_APP_SUBDOMAIN === "true") return true;
  return hostname.startsWith("track.");
}

/** Base URL of the main storefront, e.g. https://cunstruct.com */
export function getMainUrl(): string {
  if (import.meta.env.VITE_MAIN_URL) return import.meta.env.VITE_MAIN_URL as string;
  if (import.meta.env.DEV) return "";
  return `https://${hostname.replace(/^track\./, "")}`;
}

/** Base URL of the track subdomain, e.g. https://track.cunstruct.com */
export function getAppUrl(): string {
  if (import.meta.env.VITE_APP_URL) return import.meta.env.VITE_APP_URL as string;
  if (import.meta.env.DEV) return "";
  return `https://track.${hostname.replace(/^track\./, "")}`;
}
