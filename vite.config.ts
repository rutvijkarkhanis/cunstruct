import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
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
