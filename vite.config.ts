import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { assertStaging, buildUsesStaging, PREVIEW_PRODUCTION_OPT_OUT } from "./scripts/staging-guard.mjs";

// `--mode staging` (npm run dev:staging / build:staging) must never reach
// production. Vite would otherwise fall back to the committed `.env`
// (production) for any value the staging file lacks, so instead staging mode
// refuses to start unless scripts/staging-guard.mjs verifies a separate staging
// project, and then pins the app's Supabase values to it explicitly.
// A Vercel Preview build is held to the same rule (buildUsesStaging): it is
// built against the verified staging project or not at all.
function stagingSupabaseDefines(mode: string) {
  let target;
  try {
    ({ target } = assertStaging(__dirname, { app: true })); // throws → Vite refuses to start/build
  } catch (e) {
    if (mode === "staging") throw e;
    throw new Error(`Vercel Preview build refused: previews are built against a verified staging project, never the production .env.\n${(e as Error).message}\nSet the STAGING_SUPABASE_* variables for the Preview environment, or set ${PREVIEW_PRODUCTION_OPT_OUT}=true there to build previews against production deliberately.`);
  }
  return {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(target.supabaseUrl),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(target.publishableKey),
    "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(target.projectRef),
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: buildUsesStaging(mode) ? stagingSupabaseDefines(mode) : {},
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React core — loaded on every page, cache it separately
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router-dom/") ||
            id.includes("node_modules/react-router/")
          ) {
            return "vendor-react";
          }

          // Radix UI primitives — large collection, separate chunk
          if (id.includes("node_modules/@radix-ui/")) {
            return "vendor-radix";
          }

          // Supabase SDK
          if (id.includes("node_modules/@supabase/")) {
            return "vendor-supabase";
          }

          // TanStack Query
          if (
            id.includes("node_modules/@tanstack/") ||
            id.includes("node_modules/@tanstack/query-core")
          ) {
            return "vendor-query";
          }

          // Framer Motion — used only on some pages, load separately
          if (id.includes("node_modules/framer-motion/")) {
            return "vendor-motion";
          }

          // Recharts — only used in ops dashboard
          if (id.includes("node_modules/recharts/")) {
            return "vendor-charts";
          }

          // date-fns — only used in a few places
          if (id.includes("node_modules/date-fns/")) {
            return "vendor-dates";
          }
        },
      },
    },
  },
}));
