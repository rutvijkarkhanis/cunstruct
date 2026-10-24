// The workbench preview gate must be off by default, never enabled by
// development mode, and must refuse the production project. The production
// refs it knows must match the repository's own production configuration.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { workbenchPreviewState, PRODUCTION_PROJECT_REFS } from "./workbenchPreview";

const ROOT = join(__dirname, "..", "..");
const FAKE = { VITE_SUPABASE_URL: "https://e2e-fixture.supabase.co", VITE_SUPABASE_PROJECT_ID: "e2e-fixture" };
const PROD = PRODUCTION_PROJECT_REFS[0];

describe("workbenchPreviewState", () => {
  it("is off when the flag is unset or not exactly 'true'", () => {
    expect(workbenchPreviewState({ ...FAKE })).toEqual({ enabled: false, reason: "flag-off" });
    for (const v of ["", "1", "TRUE", "yes", "false"]) {
      expect(workbenchPreviewState({ ...FAKE, VITE_CUNSTRUCT_WORKBENCH_PREVIEW: v }).enabled).toBe(false);
    }
  });

  it("is never turned on by development mode", () => {
    expect(workbenchPreviewState({ ...FAKE, DEV: true })).toEqual({ enabled: false, reason: "flag-off" });
  });

  it("is on only with the explicit flag against a non-production project", () => {
    expect(workbenchPreviewState({ ...FAKE, VITE_CUNSTRUCT_WORKBENCH_PREVIEW: "true" })).toEqual({ enabled: true, reason: "enabled" });
  });

  it("refuses when the Supabase URL is missing or unparseable", () => {
    const on = { VITE_CUNSTRUCT_WORKBENCH_PREVIEW: "true", VITE_SUPABASE_PROJECT_ID: "e2e-fixture" };
    for (const url of [undefined, "", "not a url", "e2e-fixture"]) {
      expect(workbenchPreviewState({ ...on, VITE_SUPABASE_URL: url })).toEqual({ enabled: false, reason: "unverifiable-project" });
    }
    // An unparseable value naming the production project is refused as production.
    expect(workbenchPreviewState({ ...on, VITE_SUPABASE_URL: PROD })).toEqual({ enabled: false, reason: "production-project" });
  });

  it("refuses any URL that is not exactly the declared project's canonical URL", () => {
    const on = { VITE_CUNSTRUCT_WORKBENCH_PREVIEW: "true", VITE_SUPABASE_PROJECT_ID: "e2e-fixture" };
    for (const url of ["https://e2e-fixture.supabase.co/", "https://E2E-FIXTURE.supabase.co", "https://other.supabase.co", "http://e2e-fixture.supabase.co", "http://127.0.0.1:54321"]) {
      expect(workbenchPreviewState({ ...on, VITE_SUPABASE_URL: url }), url).toEqual({ enabled: false, reason: "unverifiable-project" });
    }
    expect(workbenchPreviewState({ VITE_CUNSTRUCT_WORKBENCH_PREVIEW: "true", VITE_SUPABASE_URL: FAKE.VITE_SUPABASE_URL }).reason).toBe("unverifiable-project");
  });

  it("refuses the production project by id, by URL, or by both — however the URL is spelled", () => {
    const on = { VITE_CUNSTRUCT_WORKBENCH_PREVIEW: "true" };
    for (const url of [`https://${PROD}.supabase.co/`, `https://${PROD.toUpperCase()}.supabase.co`, `${PROD}.supabase.co`]) {
      expect(workbenchPreviewState({ ...on, VITE_SUPABASE_PROJECT_ID: "other", VITE_SUPABASE_URL: url }).reason, url).toBe("production-project");
    }
    expect(workbenchPreviewState({ ...on, VITE_SUPABASE_PROJECT_ID: PROD, VITE_SUPABASE_URL: FAKE.VITE_SUPABASE_URL }).reason).toBe("production-project");
    expect(workbenchPreviewState({ ...on, VITE_SUPABASE_PROJECT_ID: "other", VITE_SUPABASE_URL: `https://${PROD}.supabase.co` }).reason).toBe("production-project");
    expect(workbenchPreviewState({ ...on, VITE_SUPABASE_PROJECT_ID: PROD.toUpperCase(), VITE_SUPABASE_URL: `https://${PROD}.supabase.co/` }).reason).toBe("production-project");
  });
});

describe("repository configuration", () => {
  const value = (text: string, key: string) => text.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+)"?`, "m"))?.[1]?.trim();

  it("knows every production project ref the repository commits", () => {
    const toml = readFileSync(join(ROOT, "supabase", "config.toml"), "utf8");
    const env = readFileSync(join(ROOT, ".env"), "utf8");
    const committed = [value(toml, "project_id"), value(env, "VITE_SUPABASE_PROJECT_ID")].filter(Boolean) as string[];
    expect(committed.length).toBeGreaterThan(0);
    for (const ref of committed) expect(PRODUCTION_PROJECT_REFS).toContain(ref);
  });

  it("would refuse the committed .env configuration even with the flag on", () => {
    const env = readFileSync(join(ROOT, ".env"), "utf8");
    const state = workbenchPreviewState({
      VITE_CUNSTRUCT_WORKBENCH_PREVIEW: "true",
      VITE_SUPABASE_URL: value(env, "VITE_SUPABASE_URL"),
      VITE_SUPABASE_PROJECT_ID: value(env, "VITE_SUPABASE_PROJECT_ID"),
    });
    expect(state).toEqual({ enabled: false, reason: "production-project" });
  });

  it("the build-time constant compares against the same production id", () => {
    const src = readFileSync(join(ROOT, "src", "lib", "workbenchPreview.ts"), "utf8");
    const literal = src.match(/VITE_SUPABASE_PROJECT_ID !== "([^"]+)"/)?.[1];
    expect(literal).toBe(PROD);
    // …and the build-time canonical-URL rule is the runtime one.
    expect(src).toContain('import.meta.env.VITE_SUPABASE_URL === "https://" + import.meta.env.VITE_SUPABASE_PROJECT_ID + ".supabase.co"');
  });

  it("no committed env file turns the flag on", () => {
    for (const f of readdirSync(ROOT).filter((n) => n.startsWith(".env"))) {
      expect(readFileSync(join(ROOT, f), "utf8")).not.toMatch(/^\s*VITE_CUNSTRUCT_WORKBENCH_PREVIEW\s*=\s*"?true/m);
    }
  });
});
