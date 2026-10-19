// Route inventory for plan item B12 ("Remove the old surfaces"; acceptance:
// route inventory diff). Reads the <Routes> trees in src/App.tsx statically
// and returns every route with its full path and the element it renders, so
// docs/B12-ROUTE-INVENTORY.md can be checked against the code and any route
// added or removed shows up as a diff. Read-only: nothing here changes routing.
import ts from "typescript";

export interface RouteEntry {
  /** 0 = storefront tree, 1 = app-subdomain tree (order of <Routes> in App.tsx). */
  tree: number;
  /** Full path; nested paths are joined to their parent, index routes end in "(index)". */
  path: string;
  /** Rendered component, or "Navigate → <to>" for a redirect. */
  element: string;
}

function attr(el: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return el.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
  );
}

function tagOf(node: ts.Node): string | undefined {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return undefined;
}

function openingOf(node: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

function describeElement(el: ts.JsxOpeningLikeElement): string {
  const init = attr(el, "element")?.initializer;
  if (!init || !ts.isJsxExpression(init) || !init.expression) return "(none)";
  const expr = init.expression;
  const inner = ts.isJsxElement(expr) ? expr.openingElement : ts.isJsxSelfClosingElement(expr) ? expr : undefined;
  if (!inner) return "(inline)";
  const tag = inner.tagName.getText();
  if (/^[a-z]/.test(tag)) return `inline <${tag}>`;
  if (tag === "Navigate") {
    const to = attr(inner, "to")?.initializer;
    return `Navigate → ${to && ts.isStringLiteral(to) ? to.text : "?"}`;
  }
  return tag;
}

function join(parent: string, child: string): string {
  if (child.startsWith("/")) return child;
  if (parent === "" || parent === "/") return `/${child}`;
  return `${parent}/${child}`;
}

export function routeInventory(source: string): RouteEntry[] {
  const sf = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: RouteEntry[] = [];
  let tree = -1;

  const walkRoutes = (children: ts.NodeArray<ts.JsxChild>, parent: string) => {
    for (const c of children) {
      if (tagOf(c) !== "Route") continue;
      const node = c as ts.JsxElement | ts.JsxSelfClosingElement;
      const el = openingOf(node);
      const isIndex = !!attr(el, "index");
      const p = attr(el, "path")?.initializer;
      const own = p && ts.isStringLiteral(p) ? p.text : "";
      const path = isIndex ? `${parent === "" ? "/" : parent} (index)` : join(parent, own);
      out.push({ tree, path, element: describeElement(el) });
      if (ts.isJsxElement(node)) walkRoutes(node.children, isIndex ? parent : path);
    }
  };

  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) && tagOf(n) === "Routes") {
      tree += 1;
      walkRoutes(n.children, "");
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
