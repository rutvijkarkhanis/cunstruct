// Guards the team rules against regressions in the documents themselves
// (docs/agent-orchestration/, AGENTS.md, CLAUDE.md, the PR and issue
// templates). Text checks only: no network, no GitHub state.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf-8");
const DOCS = ["PLAN", "PROTOCOL"] as const;
const doc = Object.fromEntries(DOCS.map((d) => [d, read(`docs/agent-orchestration/${d}.md`)])) as Record<(typeof DOCS)[number], string>;
const agents = read("AGENTS.md");
const claude = read("CLAUDE.md");
const prTemplate = read(".github/pull_request_template.md");
const forms = [".github/ISSUE_TEMPLATE/agent-task.yml", ".github/ISSUE_TEMPLATE/needs-rutvij.yml"].map((p) => [p, read(p)] as const);
const everything = [...Object.values(doc), agents, claude, prTemplate, ...forms.map(([, y]) => y)].join("\n");

/** Deliverables PLAN.md asks agents to create; they do not exist yet. */
const FUTURE_PATHS = new Set(["docs/ux/PHASE-0-INVENTORY.md", "src/test/uxInventory.test.ts", "docs/UX-UI-REVAMP-CHARTER.md", "docs/bugs/VERCEL-PREVIEW-BUILD-REFUSED.md"]);

/** Section numbers ("3", "6.1") declared by a document's headings. */
const sections = (text: string) => new Set([...text.matchAll(/^#{2,3} (\d+(?:\.\d+)?)\.? /gm)].map((m) => m[1]));
const section = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to));

describe("agent team documents", () => {
  it("removed documents are not referenced", () => {
    expect(everything).not.toMatch(/\b(PILOT|DASHBOARD)\.md\b/);
  });

  it("every § reference resolves to a PROTOCOL section (references to the UX charter excepted)", () => {
    const declared = sections(doc.PROTOCOL);
    const named: [string, string][] = [["PROTOCOL.md", doc.PROTOCOL], ["PLAN.md", doc.PLAN], ["AGENTS.md", agents], ["CLAUDE.md", claude], ["pull_request_template.md", prTemplate], ...forms];
    const missing: string[] = [];
    for (const [name, text] of named) {
      for (const line of text.split("\n")) {
        for (const m of line.matchAll(/§(\d+(?:\.\d+)?)/g)) {
          if (/charter/i.test(line.slice(Math.max(0, m.index! - 40), m.index))) continue;
          if (!declared.has(m[1])) missing.push(`${name}: §${m[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every repository path the documents cite exists, apart from named future deliverables", () => {
    const missing = [...everything.matchAll(/`((?:docs|\.github|scripts|src|supabase)\/[^`*<\s]+)`/g)]
      .map((m) => m[1].replace(/[.,;:)]+$/, ""))
      .filter((p) => !FUTURE_PATHS.has(p) && !existsSync(path.join(root, p)));
    expect(missing).toEqual([]);
  });

  it("an unsigned or agent-written comment is never authorization, and identity is never claimed as proof", () => {
    expect(doc.PROTOCOL).toMatch(/unsigned comment is unattributed input/);
    expect(doc.PROTOCOL).toMatch(/### 2\.1 Rutvij's decisions: the only form of authorization/);
    expect(doc.PROTOCOL).toMatch(/An agent never writes a `DECISION` line or the signature `— Rutvij`/);
    expect(doc.PROTOCOL).toMatch(/Neither GitHub nor this format can prove who typed a comment/);
    expect(doc.PROTOCOL).toMatch(/A review is evidence, not approval/);
    expect(doc.PROTOCOL).toMatch(/relayed from chat — not authorization/);
    for (const text of [agents, claude]) expect(text).toMatch(/DECISION <ID>: … — Rutvij/);
  });

  it("§8 lists the protected actions and only Rutvij's DECISION comment authorizes them", () => {
    const s8 = section(doc.PROTOCOL, "## 8.", "## 9.");
    expect(s8).toMatch(/`DECISION <ID>: … — Rutvij` comment/);
    expect(s8).toMatch(/relayed chat answers and unsigned comments never count/);
    for (const action of [/merging to `main`/, /Supabase function deploy/, /migrations/, /paid API calls/, /publishing a local-only branch or bundle/, /force-push/, /new GitHub workflow/, /labelled `on-hold`/]) {
      expect(s8).toMatch(action);
    }
  });

  it("no hosted-check failure is accepted by rule; merging needs local build evidence and Rutvij's review", () => {
    for (const banned of [/only acceptable red check/i, /accepts the known/i, /known pre-existing failure\*\*:/i, /fails on every PR, by design/i]) {
      expect(everything).not.toMatch(banned);
    }
    const s61 = section(doc.PROTOCOL, "### 6.1", "## 7.");
    expect(s61).toMatch(/`npm run build` exiting 0 locally/);
    expect(s61).toMatch(/A local build is \*\*not\*\* proof that a hosted deployment will succeed/);
    expect(s61).toMatch(/No failing check is accepted by rule/);
    expect(s61).toMatch(/Rutvij reviews each failure himself/);
    expect(prTemplate).toMatch(/log not available to the agent/);
  });

  it("agents never review their own work, merge or close tasks; review scales with risk", () => {
    const s6 = section(doc.PROTOCOL, "## 6.", "### 6.1");
    expect(s6).toMatch(/\*\*Agents never review their own work, never merge and never close a task issue\.\*\*/);
    for (const level of ["**High**", "**Normal**", "**Low**"]) expect(s6).toContain(level);
    expect(s6).toMatch(/supabase\/functions/);
  });

  it("handoff does not depend on another session running", () => {
    expect(doc.PROTOCOL).toMatch(/No agent runs continuously, and no agent can wake another/);
    expect(doc.PROTOCOL).toMatch(/\*\*always before your session ends\*\*/);
    for (const field of ["Branch / commit:", "Verified:", "Failing:", "Next:", "Blocked by:"]) expect(doc.PROTOCOL).toContain(field);
  });

  it("each workstream has one owner, the two leads own disjoint areas, and #217 stays on hold", () => {
    const table = section(doc.PLAN, "## 1.", "**Why these two.**");
    const rows = table.split("\n").filter((l) => /^\| \*\*(W\d|Bounded)/.test(l));
    expect(rows.map((r) => r.split("|")[2].trim())).toEqual(["Learnator", "Ruthvich", "Codex"]);
    const owned = (r: string) => [...r.split("|")[3].matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\*+$/, ""));
    const [w1, w2] = rows.map(owned);
    expect(w1.filter((a) => w2.some((b) => a.startsWith(b) || b.startsWith(a)))).toEqual([]);
    expect(doc.PLAN).toMatch(/#217 \(BOQ provenance\) stays `on-hold`/);
    expect(doc.PROTOCOL).toMatch(/starting anything labelled `on-hold`/);
  });

  it("issue forms are well formed and reference only labels the protocol defines", () => {
    const labels = new Set(["needs-rutvij", "on-hold", "status:blocked"]);
    for (const [, y] of forms) {
      for (const key of ["name:", "description:", "body:"]) expect(y).toMatch(new RegExp(`^${key}`, "m"));
      const formLabels = [...(y.match(/^labels: \[(.*)\]$/m)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      expect(formLabels.filter((l) => !labels.has(l))).toEqual([]);
      const ids = [...y.matchAll(/^\s+id: (\S+)/gm)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
