// Estimator acceptance — the two backends the same journey runs against.
//
//   ACCEPTANCE_MODE unset or "mock" — the in-memory mock (e2e/support/
//     mockBackend.ts) on the local preview server (:8081). Proves what the
//     interface sends and reads back. NOT a backend acceptance run.
//   ACCEPTANCE_MODE=staging — a deployed Vercel Preview backed by the staging
//     Supabase project, with no mocks (playwright.acceptance.config.ts). Before
//     anything else it checks, from the deployment's own JavaScript, that the
//     app targets ACCEPTANCE_STAGING_REF and not production; it refuses to run
//     otherwise. Needs: ACCEPTANCE_BASE_URL, ACCEPTANCE_STAGING_REF,
//     ACCEPTANCE_STAFF_EMAIL, ACCEPTANCE_STAFF_PASSWORD, ACCEPTANCE_DRAWING_PDF
//     (a real PDF, uploaded as ZZ-STAGING-plan.pdf). Credentials are read from
//     the environment and never written to the report.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page, Route } from "@playwright/test";
import { expect } from "../../playwright-fixture";
import { installMockBackend, seedAuthSession, DOC_A_PDF_PATH, E2E_FAKE_SUPABASE_URL, WORKBENCH_PREVIEW_URL, type MockBackendHandle } from "../support/mockBackend";
import { buildPhase2Fixtures } from "../fixtures/phase2FixtureSet";

export type AcceptanceMode = "mock" | "staging";
export const MODE: AcceptanceMode = process.env.ACCEPTANCE_MODE === "staging" ? "staging" : "mock";
/** The drawing name the staging analysis sample refers to (docs/samples). */
export const DRAWING_NAME = "ZZ-STAGING-plan.pdf";

export interface Backend {
  mode: AcceptanceMode;
  /** Shown in the test title and the result file. */
  label: string;
  baseURL: string;
  /** Signs in as the staff estimator (mock: a seeded staff session). */
  signIn(page: Page): Promise<void>;
  /** Puts DRAWING_NAME into the project with its server-side fingerprint
   *  (document_revision.content_hash) computed, and returns that SHA-256 for
   *  the analysis's source_drawing — the only route by which an imported
   *  analysis can be applied (lib/review/importProvenance, revisionFreshness).
   *  Mock: simulated (upload and the server preflight are not mocked). */
  addDrawing(page: Page, projectId: string): Promise<string>;
  /** Mock only: the live tables, for read-back assertions. Null on staging. */
  mock: MockBackendHandle | null;
}

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Staging acceptance run: ${k} is not set.`);
  return v;
};

/** Types a secret without it entering a step title, report or trace (a
 *  Playwright fill() is logged with its value). React sees a normal input event. */
export async function setSecret(field: Locator, value: string) {
  await field.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

const sha256File = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

export async function backendFor(page: Page): Promise<Backend> {
  if (MODE === "staging") {
    const baseURL = need("ACCEPTANCE_BASE_URL");
    const ref = need("ACCEPTANCE_STAGING_REF");
    // The deployment's own JavaScript must name the staging project and no production one.
    let out = "";
    try {
      out = execFileSync("node", [fileURLToPath(new URL("../../scripts/check-deployed-target.mjs", import.meta.url)), baseURL], { encoding: "utf8" });
    } catch (e) {
      const x = e as { stdout?: string; stderr?: string; message?: string };
      throw new Error(`Refusing to run: the deployment is not verified as staging.\n${x.stdout || x.stderr || x.message || ""}`);
    }
    if (!out.includes(`https://${ref}.supabase.co`)) throw new Error(`Refusing to run: the deployment does not target ${ref}.\n${out}`);
    return {
      mode: "staging", label: `STAGING ${ref}`, baseURL, mock: null,
      async signIn(p) {
        await p.goto("/auth");
        await p.getByLabel("Email").fill(need("ACCEPTANCE_STAFF_EMAIL"));
        await setSecret(p.getByLabel("Password"), need("ACCEPTANCE_STAFF_PASSWORD"));
        await p.getByRole("button", { name: "Sign in" }).click();
        await expect(p).toHaveURL(/\/app\/projects/, { timeout: 30_000 }); // staff land on the estimation project list
      },
      async addDrawing(p, projectId) {
        // The real upload, through the Drawings section's own manager.
        const pdf = need("ACCEPTANCE_DRAWING_PDF");
        const named = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "acceptance-")), DRAWING_NAME);
        fs.copyFileSync(pdf, named);
        await p.goto(`/app/projects/${projectId}/workbench/drawings`);
        await p.getByRole("button", { name: "Upload or manage" }).click();
        await p.locator('input[type="file"][accept*="pdf"]').first().setInputFiles(named);
        await expect(p.getByText(DRAWING_NAME).first()).toBeVisible({ timeout: 60_000 });
        await p.keyboard.press("Escape");
        // The server computes the fingerprint (ai-analysis "preflight"; no AI is
        // run) when the project's Analyze view opens. Needs the ai-analysis
        // function deployed on staging.
        const preflight = p.waitForResponse((r) => r.url().includes("/functions/v1/ai-analysis") && (r.request().postData() ?? "").includes('"preflight"'), { timeout: 60_000 });
        await p.goto(`/ops/projects/${projectId}/workspace?mode=analyze`);
        const res = await preflight;
        const body = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
        if (!res.ok() || !body?.ok) throw new Error(`The drawing fingerprint was not computed (ai-analysis preflight: HTTP ${res.status()}${body?.error ? `, ${body.error}` : ""}). Deploy the ai-analysis function to staging.`);
        return sha256File(pdf);
      },
    };
  }

  // Mock: every non-local request is aborted; only the mock answers.
  const fixtures = buildPhase2Fixtures();
  await page.route("**/*", (route: Route) => {
    const host = new URL(route.request().url()).hostname;
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host) ? route.continue() : route.abort();
  });
  await seedAuthSession(page, E2E_FAKE_SUPABASE_URL);
  const mock = await installMockBackend(page, { fixtures: () => fixtures as unknown as Record<string, unknown>, applyWrites: true });
  return {
    mode: "mock", label: "MOCK — not a backend acceptance run", baseURL: WORKBENCH_PREVIEW_URL, mock,
    async signIn() { /* a staff session is seeded */ },
    async addDrawing(_p, projectId) {
      // SIMULATED: the rows an upload creates (storage upload is not mocked).
      // The signed URL serves a real fixture PDF, so the viewer renders it.
      // SIMULATED too: the fingerprint the server's preflight stores — the
      // SHA-256 of the very PDF the signed URL serves.
      const docId = `acc-doc-${projectId}`, revId = `acc-rev-${projectId}`;
      const sha = sha256File(DOC_A_PDF_PATH);
      mock.tables.project_document.push({ id: docId, project_id: projectId, name: DRAWING_NAME, current_revision_id: revId });
      mock.tables.document_revision.push({ id: revId, document_id: docId, file_path: `${projectId}/${docId}/rev-1.pdf`, original_filename: DRAWING_NAME, page_count: 3, page_titles: null, content_hash: sha });
      return sha;
    },
  };
}
