import { defineConfig, devices } from "@playwright/test";
import { E2E_FAKE_SUPABASE_URL } from "./e2e/support/mockBackend";

// Vanilla Playwright config (no external framework wrapper). E2E specs live in
// ./e2e; the dev server (port 8080, see vite.config) is started automatically.
//
// M8: the e2e suite runs the real app against a fully mocked network
// boundary (see e2e/support/mockBackend.ts — there is no reachable real
// Supabase backend in this environment). Two env vars the dev server needs
// at boot, both compile-time-inlined by Vite (import.meta.env.VITE_*):
//   - VITE_IS_APP_SUBDOMAIN=true — App.tsx otherwise serves the storefront
//     route tree on plain localhost, where /ops/* is just a cross-domain
//     redirect notice (see src/lib/subdomain.ts); the Ops/BoqReviewWorkstation
//     routes this suite exercises only render on the "app subdomain" tree.
//   - VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY — a FAKE, never-
//     reachable project URL (see mockBackend.ts), deliberately not the real
//     .env values: every request to it is intercepted, so the suite never
//     depends on real credentials being present or valid.

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use the environment's pre-installed Chromium rather than
        // triggering a download — see the repo's own container notes.
        launchOptions: process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: "/opt/pw-browsers/chromium" } : {},
      },
    },
  ],
  webServer: {
    // --host 127.0.0.1 overrides vite.config.ts's server.host: "::" for
    // this suite only — this sandbox's network stack has no IPv6 support
    // (binding "::" fails with EAFNOSUPPORT), unrelated to the app itself.
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://localhost:8080",
    // Always a fresh server for this suite: a pre-existing dev server on
    // :8080 (started without these env vars) would silently serve the
    // storefront route tree instead, and every e2e spec would fail at
    // navigation rather than at a clear, obviously-wrong assertion.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_IS_APP_SUBDOMAIN: "true",
      VITE_SUPABASE_URL: E2E_FAKE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: "e2e-fixture-anon-key",
    },
  },
});
