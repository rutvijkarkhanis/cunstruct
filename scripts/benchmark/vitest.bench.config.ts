// Config for the Set A scoring driver only (not the test suite).
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["scripts/benchmark/*.test.ts"],
    testTimeout: 120000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../../src") } },
});
