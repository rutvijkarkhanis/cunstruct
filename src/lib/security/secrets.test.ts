import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

// Guard against secrets leaking into the client bundle. The browser may only ever
// see the Supabase PUBLISHABLE key; provider/service-role secrets must live
// server-side (Deno edge functions / platform env), never in `src` or `.env`.

const SRC = join(__dirname, "../..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|jsx)$/.test(e) && !/\.test\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const contents = files.map((f) => ({ f, text: readFileSync(f, "utf8") }));

describe("client bundle contains no server secrets", () => {
  it("no source file USES a service-role key (env access, edge-only var, or createClient)", () => {
    // Target real exposure vectors, not mere mentions of the token (security guard
    // modules legitimately list "service_role" as a denylist string).
    const usage = [
      /import\.meta\.env\.[A-Za-z_]*SERVICE_ROLE/i,     // reading a service-role env in client
      /\bSUPABASE_SERVICE_ROLE_KEY\b/,                  // the edge-only var name in client code
      /createClient\([^)]*service[_-]?role/i,           // building a service-role client
    ];
    const bad = contents.filter(({ text }) => usage.some((re) => re.test(text)));
    expect(bad.map((b) => b.f)).toEqual([]);
  });

  it("no client env var is named like a secret (VITE_ vars ship to the browser)", () => {
    // Any import.meta.env.VITE_*SECRET* / *SERVICE* / *PRIVATE* / *API_KEY* would be exposed.
    const bad = contents.filter(({ text }) =>
      /import\.meta\.env\.VITE_[A-Z_]*(SECRET|SERVICE|PRIVATE|API_KEY|ACCESS_TOKEN)/.test(text),
    );
    expect(bad.map((b) => b.f)).toEqual([]);
  });

  it("no hardcoded provider/openai-style keys are present", () => {
    const bad = contents.filter(({ text }) => /sk-[a-zA-Z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}/.test(text));
    expect(bad.map((b) => b.f)).toEqual([]);
  });
});

describe("supabase client uses only the publishable key", () => {
  it("client.ts references the publishable key and never a service role", () => {
    const client = readFileSync(join(SRC, "integrations/supabase/client.ts"), "utf8");
    expect(client).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(/service_role/i.test(client)).toBe(false);
  });
});

describe("tracked .env holds only client-safe (VITE_) keys", () => {
  it("the committed .env exposes no server secret", () => {
    const envPath = join(SRC, "../.env");
    if (!existsSync(envPath)) return; // no tracked .env — nothing to check
    const env = readFileSync(envPath, "utf8");
    const assignments = env.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    for (const line of assignments) {
      const key = line.split("=")[0];
      // Every assignment must be a public VITE_ var; nothing server-side.
      expect(key.startsWith("VITE_")).toBe(true);
      expect(/SERVICE|SECRET|PRIVATE|SERVICE_ROLE/i.test(key)).toBe(false);
    }
  });
});
