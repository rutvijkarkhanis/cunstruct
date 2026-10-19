import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { routeInventory } from "./routeInventory";

const root = resolve(__dirname, "../..");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
const doc = readFileSync(resolve(root, "docs/B12-ROUTE-INVENTORY.md"), "utf8");

const TREE = ["storefront", "app"];

/** "tree | path | element" rows from the inventory table. */
function documented(): string[] {
  return doc
    .split("\n")
    .map((l) => l.match(/^\| (storefront|app) \| `([^`]+)` \| ([^|]+) \| ([^|]+) \|$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => `${m[1]} | ${m[2]} | ${m[3].trim()}`);
}

describe("B12 route inventory", () => {
  const routes = routeInventory(app);

  it("finds every <Route> in App.tsx", () => {
    const code = app.replace(/\{\/\*[\s\S]*?\*\/\}/g, ""); // JSX comments mention <Route> too
    expect(routes).toHaveLength((code.match(/<Route\s/g) ?? []).length);
  });

  it("matches docs/B12-ROUTE-INVENTORY.md exactly (update the doc with any route change)", () => {
    expect(documented()).toEqual(routes.map((r) => `${TREE[r.tree]} | ${r.path} | ${r.element}`));
  });

  it("gives every documented route a disposition", () => {
    for (const l of doc.split("\n").filter((x) => /^\| (storefront|app) \|/.test(x))) {
      expect(l.split("|")[4].trim().length, l).toBeGreaterThan(0);
    }
  });

  it("joins nested paths and labels index routes and redirects", () => {
    const src = `<Routes><Route path="/a" element={<A />}><Route index element={<Navigate to="b" replace />} /><Route path="b" element={<B />} /></Route></Routes>`;
    expect(routeInventory(src)).toEqual([
      { tree: 0, path: "/a", element: "A" },
      { tree: 0, path: "/a (index)", element: "Navigate → b" },
      { tree: 0, path: "/a/b", element: "B" },
    ]);
  });
});
