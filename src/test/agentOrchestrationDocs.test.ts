// Guards the agent-orchestration rules against regressions in the documents
// themselves (docs/agent-orchestration/, AGENTS.md, CLAUDE.md, the PR
// template). Text checks only: no network, no GitHub state.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf-8");
const DOCS = ["PLAN", "PROTOCOL", "PILOT", "DASHBOARD"] as const;
const doc = Object.fromEntries(DOCS.map((d) => [d, read(`docs/agent-orchestration/${d}.md`)])) as Record<(typeof DOCS)[number], string>;
const agents = read("AGENTS.md");
const claude = read("CLAUDE.md");
const prTemplate = read(".github/pull_request_template.md");
const everything = [...Object.values(doc), agents, claude, prTemplate].join("\n");

/** Section numbers ("3", "2.1") declared by a document's headings. */
const sections = (text: string) => new Set([...text.matchAll(/^#{2,3} (\d+(?:\.\d+)?)\.? /gm)].map((m) => m[1]));

describe("agent orchestration documents", () => {
  it("every cross-reference to a section resolves", () => {
    const declared = Object.fromEntries(DOCS.map((d) => [d, sections(doc[d])]));
    const missing: string[] = [];
    const files: [string, string, string | null][] = [
      ...DOCS.map((d) => [`${d}.md`, doc[d], d] as [string, string, string]),
      ["AGENTS.md", agents, null], ["CLAUDE.md", claude, null], ["pull_request_template.md", prTemplate, null],
    ];
    for (const [name, text, self] of files) {
      for (const m of text.matchAll(/\b(PLAN|PROTOCOL|PILOT|DASHBOARD)(?:\.md)?`? §(\d+(?:\.\d+)?)/g)) {
        if (!declared[m[1] as (typeof DOCS)[number]].has(m[2])) missing.push(`${name}: ${m[1]} §${m[2]}`);
      }
      if (self) {
        // A bare "§N" refers to the last document named earlier on the same
        // line ("PROTOCOL §4, §9"), or else to the document it is in.
        for (const line of text.split("\n")) {
          for (const m of line.matchAll(/(?<![A-Z.`\w])§(\d+(?:\.\d+)?)/g)) {
            const before = line.slice(0, m.index!);
            if (/(PLAN|PROTOCOL|PILOT|DASHBOARD)(\.md)?`? $/.test(before)) continue;
            const named = [...before.matchAll(/\b(PLAN|PROTOCOL|PILOT|DASHBOARD)(?:\.md)?`? §/g)].pop()?.[1];
            const target = (named ?? self) as (typeof DOCS)[number];
            if (!declared[target].has(m[1])) missing.push(`${name}: ${target} §${m[1]}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every repository path the documents cite exists", () => {
    const missing = [...everything.matchAll(/`((?:docs|\.github|scripts|src|supabase)\/[^`*<\s]+)`/g)]
      .map((m) => m[1].replace(/[.,;:)]+$/, ""))
      .filter((p) => !p.includes("/pilot/") && !existsSync(path.join(root, p)));
    expect(missing).toEqual([]);
  });

  it("an unsigned or agent-written comment is never authorization", () => {
    expect(everything).not.toMatch(/unsigned comment counts as Rutvij/i);
    expect(doc.PROTOCOL).toMatch(/unsigned comment is unattributed input/);
    expect(doc.PROTOCOL).toMatch(/### 2\.1 Rutvij's decisions: the only form of authorization/);
    expect(doc.PROTOCOL).toMatch(/An agent never writes a `DECISION` line or the signature `— Rutvij`/);
    expect(doc.PROTOCOL).toMatch(/neither GitHub nor this format can prove who typed a comment/);
    for (const text of [agents, claude]) expect(text).toMatch(/DECISION <ID>: … — Rutvij/);
  });

  it("§15 approvals and escalation answers require Rutvij's DECISION comment; chat relays never authorize", () => {
    const s15 = doc.PROTOCOL.slice(doc.PROTOCOL.indexOf("## 15."), doc.PROTOCOL.indexOf("## 16."));
    expect(s15).toMatch(/`DECISION <ID>: … — Rutvij` comment/);
    expect(s15).toMatch(/relayed chat answers and unsigned comments never count/);
    expect(doc.PROTOCOL).toMatch(/relayed from chat — not authorization/);
  });

  it("no hosted-check failure is accepted by rule; merging needs build evidence and Rutvij's review", () => {
    for (const banned of [/only acceptable red check/i, /accepts the known/i, /known pre-existing failure\*\*:/i, /fails on every PR, by design/i]) {
      expect(everything).not.toMatch(banned);
    }
    const s9 = doc.PROTOCOL.slice(doc.PROTOCOL.indexOf("## 9."), doc.PROTOCOL.indexOf("## 10."));
    expect(s9).toMatch(/`npm run build` exiting 0 locally/);
    expect(s9).toMatch(/A local build is \*\*not\*\* proof that a hosted deployment will succeed/);
    expect(s9).toMatch(/No failing check is accepted by rule/);
    expect(s9).toMatch(/Rutvij reviews each failure himself/);
    expect(prTemplate).toMatch(/log not available to the agent/);
  });

  it("agents can neither verify, close nor merge their own work", () => {
    expect(doc.PROTOCOL).toMatch(/\*\*Only the reviewer may add `verified`\.\*\*/);
    expect(doc.PROTOCOL).toMatch(/\*\*Agents never close a task issue and never merge\.\*\*/);
    expect(doc.PILOT).toMatch(/`verified` is added by the author/);
  });

  it("the BOQ provenance item stays on hold and no document assumes agents wake each other", () => {
    expect(doc.PLAN).toMatch(/\*\*ON HOLD — DO NOT START\.\*\*/);
    expect(doc.PROTOCOL).toMatch(/starting anything labelled `on-hold`/);
    expect(doc.PROTOCOL).toMatch(/No agent runs continuously, and no agent can wake another/);
  });

  it("issue forms declare the required top-level keys and only existing labels", () => {
    const labels = new Set([...doc.DASHBOARD.matchAll(/`((?:status|agent|priority|workstream|type):[a-z0-9-]+|needs-rutvij|verified|on-hold|stale)`/g)].map((m) => m[1]));
    for (const p of [".github/ISSUE_TEMPLATE/agent-task.yml", ".github/ISSUE_TEMPLATE/needs-rutvij.yml"]) {
      const y = read(p);
      for (const key of ["name:", "description:", "body:"]) expect(y).toMatch(new RegExp(`^${key}`, "m"));
      const formLabels = [...(y.match(/^labels: \[(.*)\]$/m)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      expect(formLabels.filter((l) => !labels.has(l))).toEqual([]);
      const ids = [...y.matchAll(/^\s+id: (\S+)/gm)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
