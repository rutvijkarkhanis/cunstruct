// Guards docs/ux/PHASE-0-INVENTORY.md (charter §8.1) against drift: every
// file, exported function and test it names must exist, every capability the
// charter lists must have a row, and a production status is one of the three
// allowed values, consistent with where its tables are migrated.
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const doc = read("docs/ux/PHASE-0-INVENTORY.md");

const STATUSES = ["works", "unavailable (migration not applied)", "unknown — owner check needed"];
const UNAVAILABLE = STATUSES[1];
/** Charter §8.1 item 3, in its order. A row's capability cell starts with one. */
const CAPABILITIES = [
  "Project", "Documents", "Folders", "Revisions", "Analysis", "Identify", "BOQ management",
  "Line-level BOQ editing", "Make", "Materials", "Client presentation", "DSR checks", "Sharing",
  "Commercial", "Exports",
];

/** Tables and database functions each migration folder creates. */
function created(dir: string): Set<string> {
  const names = new Set<string>();
  for (const f of readdirSync(resolve(root, dir)).filter((x) => x.endsWith(".sql"))) {
    for (const m of read(`${dir}/${f}`).matchAll(/create\s+(?:or\s+replace\s+)?(?:table|function)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)/gi)) {
      names.add(m[1].toLowerCase());
    }
  }
  return names;
}
const applied = created("supabase/migrations");
const deferred = created("supabase/deferred-migrations");

const ticks = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const isRepoPath = (t: string) => /^(src|docs|supabase|scripts)\//.test(t) && !/[*…\s]|:\D|:$/.test(t);

/** Why a `path`, `path#export` or `path:line` reference does not hold, or null. */
function brokenRef(ref: string): string | null {
  const [, path, sym, line] = ref.match(/^([^#:]+)(?:#(\w+))?(?::(\d+))?$/) ?? [];
  if (!path || !existsSync(resolve(root, path))) return `${ref}: no such file`;
  if (sym && !new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class|let)\\s+${sym}\\b`).test(read(path))) {
    return `${ref}: ${path} does not export ${sym}`;
  }
  if (line && read(path).split("\n").length < Number(line)) return `${ref}: ${path} is shorter than line ${line}`;
  return null;
}

interface Row { cells: string[]; line: string }
function matrixRows(text: string): Row[] {
  const body = text.split("<!-- matrix:start -->")[1]?.split("<!-- matrix:end -->")[0] ?? "";
  return body.split("\n")
    .filter((l) => /^\| \d+ \|/.test(l))
    .map((line) => ({ line, cells: line.split("|").slice(1, -1).map((c) => c.trim()) }));
}

/** Every problem with an inventory text; empty when it holds. */
function problems(text: string): string[] {
  const out: string[] = [];
  for (const t of ticks(text).filter(isRepoPath)) {
    const why = brokenRef(t);
    if (why) out.push(why);
  }
  const rows = matrixRows(text);
  if (rows.length === 0) out.push("no capability matrix rows");
  for (const { cells, line } of rows) {
    if (cells.length !== 7) { out.push(`row has ${cells.length} cells: ${line}`); continue; }
    const [n, capability, components, persistence, tests, status] = cells;
    const at = `row ${n} (${capability})`;
    if (!ticks(components).some((t) => /^src\/.+\.tsx?$/.test(t))) out.push(`${at}: names no owning component`);
    if (!ticks(persistence).some((t) => t.startsWith("src/"))) out.push(`${at}: names no persistence function`);
    const testRefs = ticks(tests);
    if (tests !== "none found" && (testRefs.length === 0 || testRefs.some((t) => !/\.test\.tsx?$/.test(t)))) {
      out.push(`${at}: tests must be test files, or "none found"`);
    }
    if (!STATUSES.includes(status)) out.push(`${at}: status "${status}" is not one of ${STATUSES.join(" / ")}`);
    const objects = ticks(persistence).filter((t) => /^[a-z_]+$/.test(t));
    for (const o of objects) {
      if (!applied.has(o) && !deferred.has(o)) out.push(`${at}: ${o} is created by no migration`);
    }
    const deferredOnly = objects.some((o) => deferred.has(o) && !applied.has(o));
    if (status === UNAVAILABLE && !deferredOnly) out.push(`${at}: unavailable, but names no deferred-migration object`);
    if (status !== UNAVAILABLE && deferredOnly) out.push(`${at}: names a deferred-migration object, but is not marked unavailable`);
  }
  for (const c of CAPABILITIES) {
    if (!rows.some((r) => r.cells[1]?.toLowerCase().startsWith(c.toLowerCase()))) out.push(`no row for charter capability "${c}"`);
  }
  return out;
}

describe("Phase 0 inventory (docs/ux/PHASE-0-INVENTORY.md)", () => {
  it("names only files, exports, tests and tables that exist, with a valid status on every row", () => {
    expect(problems(doc)).toEqual([]);
  });

  it("covers every capability in charter §8.1 item 3", () => {
    expect(matrixRows(doc).length).toBeGreaterThanOrEqual(CAPABILITIES.length);
  });

  it("marks the canonical shell, disposition and viewport sections as proposals", () => {
    for (const heading of ["## 2. Canonical shell", "## 4. Disposition table", "## 6. Supported viewports"]) {
      const section = doc.split(heading)[1]?.split("\n## ")[0] ?? "";
      expect(section, heading).toMatch(/Proposal for the owner\. Not a decision\./);
    }
  });

  describe("fails when the inventory drifts from the code", () => {
    const row = (components: string, persistence: string, tests: string, status: string) =>
      `<!-- matrix:start -->\n| 1 | Project | ${components} | ${persistence} | ${tests} | ${status} | x |\n<!-- matrix:end -->`;
    const ok = row("`src/App.tsx`", "`src/lib/app/projectsQuery.ts#loadAppProjects`; `projects`", "`src/lib/app/projects.test.ts`", STATUSES[2]);
    const others = (p: string[]) => p.filter((x) => !x.startsWith("no row for charter capability"));

    it("accepts a sound row", () => {
      expect(others(problems(ok))).toEqual([]);
    });
    it("a missing component file", () => {
      expect(others(problems(ok.replace("src/App.tsx", "src/Gone.tsx")))).toEqual(["src/Gone.tsx: no such file"]);
    });
    it("a function the file no longer exports", () => {
      expect(others(problems(ok.replace("#loadAppProjects", "#loadGone")))).toEqual([
        "src/lib/app/projectsQuery.ts#loadGone: src/lib/app/projectsQuery.ts does not export loadGone",
      ]);
    });
    it("a missing test file", () => {
      expect(others(problems(ok.replace("projects.test.ts", "gone.test.ts")))).toEqual(["src/lib/app/gone.test.ts: no such file"]);
    });
    it("a guessed status", () => {
      expect(others(problems(ok.replace(STATUSES[2], "probably works")))[0]).toMatch(/status "probably works" is not one of/);
    });
    it("a deferred table on a row not marked unavailable, and the reverse", () => {
      expect(others(problems(ok.replace("`projects`", "`boq_commercial_revision`")))).toEqual([
        "row 1 (Project): names a deferred-migration object, but is not marked unavailable",
      ]);
      expect(others(problems(ok.replace(STATUSES[2], UNAVAILABLE)))).toEqual([
        "row 1 (Project): unavailable, but names no deferred-migration object",
      ]);
    });
    it("a missing charter capability", () => {
      expect(problems(ok)).toContain('no row for charter capability "Exports"');
    });
  });
});
