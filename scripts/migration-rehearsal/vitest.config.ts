// Config for the LOCAL migration rehearsal only (not the app's test suite).
// PGlite is installed in this folder (npm --prefix scripts/migration-rehearsal install),
// so the app's own dependencies and lockfiles are untouched.
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/migration-rehearsal/*.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../../src") } },
});
