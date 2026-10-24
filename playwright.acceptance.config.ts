import { defineConfig, devices } from "@playwright/test";

// STAGING acceptance run only (e2e/acceptance): the deployed Vercel Preview,
// backed by the staging Supabase project, with no mocks and no local server.
// The mock run of the same journey is part of the normal suite
// (playwright.config.ts). Before anything is touched, e2e/acceptance/
// adapters.ts checks from the deployment's own JavaScript that it targets
// ACCEPTANCE_STAGING_REF and not production.
//
//   ACCEPTANCE_MODE=staging ACCEPTANCE_BASE_URL=https://<preview-host> \
//   ACCEPTANCE_STAGING_REF=<ref> ACCEPTANCE_STAFF_EMAIL=… ACCEPTANCE_STAFF_PASSWORD=… \
//   ACCEPTANCE_DRAWING_PDF=/path/to/plan.pdf \
//   npx playwright test -c playwright.acceptance.config.ts
if (process.env.ACCEPTANCE_MODE !== "staging" || !process.env.ACCEPTANCE_BASE_URL) {
  throw new Error("playwright.acceptance.config.ts runs only against staging: set ACCEPTANCE_MODE=staging and ACCEPTANCE_BASE_URL (see e2e/acceptance/adapters.ts). The mock run is part of `npx playwright test`.");
}

export default defineConfig({
  testDir: "./e2e/acceptance",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report-acceptance", open: "never" }], ["json", { outputFile: "test-results/acceptance-staging.json" }]],
  use: {
    baseURL: process.env.ACCEPTANCE_BASE_URL,
    // No traces: they record typed values and request headers. Screenshots and the reports are enough evidence.
    trace: "off",
    screenshot: "on",
    // A protected preview: the bypass value is sent as a header, never logged.
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {},
  },
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"], launchOptions: process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: "/opt/pw-browsers/chromium" } : {} },
  }],
});
