// Plan v1.2, I4: the owner-only engineering preview must run on deterministic
// fixtures and never touch production. These tests are a gate, written to keep
// holding as the preview grows (new tabs, new controls, new files under
// src/preview/):
//   1. render the page, open every tab and press every enabled control, with the
//      Supabase client and the network replaced by tripwires that fail on any use;
//   2. walk the page's import graph and fail if it reaches the Supabase client,
//      a data hook or the network;
//   3. the route stays off outside development unless the flag is set, and no
//      committed env file sets it.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const supabaseTouches = vi.hoisted(() => [] as string[]);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: new Proxy({}, {
    get(_t, prop) {
      supabaseTouches.push(String(prop));
      throw new Error(`EngineeringPreview touched the Supabase client (${String(prop)})`);
    },
  }),
}));

import EngineeringPreview from "./EngineeringPreview";

const networkTouches: string[] = [];
beforeEach(() => {
  supabaseTouches.length = 0;
  networkTouches.length = 0;
  vi.stubGlobal("fetch", vi.fn((input: unknown) => {
    networkTouches.push(`fetch ${String(input)}`);
    return Promise.reject(new Error("network is not allowed in the engineering preview"));
  }));
  vi.stubGlobal("XMLHttpRequest", vi.fn(() => {
    networkTouches.push("XMLHttpRequest");
    throw new Error("network is not allowed in the engineering preview");
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const renderAt = (element = <EngineeringPreview />) =>
  render(
    <MemoryRouter initialEntries={["/ops/engineering-preview"]}>
      <Routes>
        <Route path="/ops" element={<div>Ops home</div>} />
        <Route path="/ops/engineering-preview" element={element} />
      </Routes>
    </MemoryRouter>,
  );

describe("I4 — the engineering preview never reaches production", () => {
  it("every tab and every enabled control runs without touching Supabase or the network", () => {
    renderAt();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThanOrEqual(5);
    let pressed = 0;
    for (const name of tabs.map((t) => t.textContent ?? "")) {
      fireEvent.click(screen.getByRole("tab", { name }));
      // Press each enabled control once; re-query after every press, since a
      // press can re-render or remove controls. `hidden: true` includes
      // controls hidden from the accessibility tree (stricter, not looser) and
      // skips jsdom's per-element computed-style check, which made this test
      // exceed its timeout once the integrated-flow tab was added.
      const seen = new Set<string>();
      for (let guard = 0; guard < 200; guard++) {
        const panel = screen.queryByRole("tabpanel") ?? document.body;
        const next = within(panel as HTMLElement)
          .queryAllByRole("button", { hidden: true })
          .concat(within(panel as HTMLElement).queryAllByRole("checkbox", { hidden: true }))
          .find((b) => !(b as HTMLButtonElement).disabled && b.getAttribute("role") !== "tab" && !seen.has(controlKey(b)));
        if (!next) break;
        seen.add(controlKey(next));
        fireEvent.click(next);
        pressed++;
      }
    }
    expect(pressed).toBeGreaterThan(0);
    expect(supabaseTouches).toEqual([]);
    expect(networkTouches).toEqual([]);
  });
});

function controlKey(el: Element): string {
  const article = el.closest("article,tr,li,section");
  return `${el.getAttribute("aria-label") ?? el.textContent ?? ""}|${article?.textContent?.slice(0, 80) ?? ""}`;
}

// ── Static: the import graph never reaches the database, data hooks or network ──

const SRC = resolve(__dirname, "..", "..");
const ENTRY = resolve(__dirname, "EngineeringPreview.tsx");
const FORBIDDEN_TARGETS = [/[\\/]src[\\/]integrations[\\/]supabase[\\/]/, /[\\/]src[\\/]hooks[\\/]/];
const FORBIDDEN_TEXT = [/\bfetch\s*\(/, /XMLHttpRequest/, /\bfunctions\.invoke\b/, /@supabase\/supabase-js/];

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // a package; only the Supabase package is forbidden, checked as text
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function previewFiles(): string[] {
  const dir = join(SRC, "preview");
  const out: string[] = [ENTRY];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

describe("I4 — static isolation of the preview's code", () => {
  it("nothing the preview imports, directly or transitively, reaches Supabase, a data hook or the network", () => {
    const visited = new Set<string>();
    const problems: string[] = [];
    const queue = previewFiles();
    while (queue.length) {
      const file = queue.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      const rel = file.slice(SRC.length + 1);
      if (FORBIDDEN_TARGETS.some((re) => re.test(file))) {
        problems.push(`reaches ${rel}`);
        continue;
      }
      const text = readFileSync(file, "utf8");
      for (const re of FORBIDDEN_TEXT) if (re.test(text)) problems.push(`${rel} uses ${re.source}`);
      for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
        const target = resolveImport(file, m[1] ?? m[2]);
        if (target) queue.push(target);
      }
    }
    expect(visited.size).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});

// ── Flag: off outside development unless explicitly enabled ──────────────────

describe("I4 — feature flag", () => {
  it("outside development, with the flag unset, the route sends the user back to /ops", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_CUNSTRUCT_ENGINEERING_PREVIEW", "");
    renderAt();
    expect(screen.getByText("Ops home")).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("outside development, the flag set to \"true\" turns it on", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_CUNSTRUCT_ENGINEERING_PREVIEW", "true");
    renderAt();
    expect(screen.queryByText("Ops home")).toBeNull();
    expect(screen.getAllByRole("tab").length).toBeGreaterThanOrEqual(5);
  });

  it("no committed env file enables it", () => {
    const root = resolve(SRC, "..");
    for (const f of [".env", ".env.example", ".env.staging.example"]) {
      const p = join(root, f);
      if (!existsSync(p)) continue;
      const line = readFileSync(p, "utf8").split(/\r?\n/).find((l) => /^\s*VITE_CUNSTRUCT_ENGINEERING_PREVIEW\s*=/.test(l));
      expect(line?.split("=")[1]?.trim().replace(/^["']|["']$/g, "") ?? "", f).not.toBe("true");
    }
  });
});
