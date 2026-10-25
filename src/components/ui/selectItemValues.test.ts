// Radix Select throws while rendering a <SelectItem value=""> (it reserves ""
// for "no selection"), which takes the whole screen down through the error
// boundary — as it did in production on the Analyze step. No SelectItem in
// the app may be given a literal empty value; use a non-empty sentinel and
// translate it at the Select's edge (see CREATE_NEW_BOQ, "__root__").
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../..");
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p) : /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
});
const EMPTY_VALUE = /<(?:Select\.Item|SelectItem|SelectPrimitive\.Item)\b[^>]*\bvalue=(?:""|''|\{\s*(?:""|''|``)\s*\})/g;

describe("SelectItem values", () => {
  it("no SelectItem in src has a literal empty value", () => {
    const hits = files(SRC).flatMap((f) => {
      const text = fs.readFileSync(f, "utf8");
      return [...text.matchAll(EMPTY_VALUE)].map((m) => `${path.relative(SRC, f)}: ${m[0]}`);
    });
    expect(hits).toEqual([]);
  });

  it("the scan does catch the forms that crash", () => {
    for (const bad of ['<SelectItem value="">x</SelectItem>', "<SelectItem key={k} value={''}>x</SelectItem>", '<SelectItem value={""} disabled>x</SelectItem>']) {
      expect(bad.match(EMPTY_VALUE)).not.toBeNull();
    }
    expect('<SelectItem value="__root__">x</SelectItem>'.match(EMPTY_VALUE)).toBeNull();
  });
});
