// Accuracy harness only (not part of the test suite). Real drawings stay outside Git.
import { defineConfig } from "vitest/config";
import path from "path";
export default defineConfig({
  test: { environment: "node", include: ["scripts/accuracy/*.test.ts"], testTimeout: 600000 },
  resolve: { alias: { "@": path.resolve(__dirname, "../../src") } },
});
