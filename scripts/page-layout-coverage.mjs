// FLOW-283: inspect routed components, following local components and re-exports.
// A PageGrid elsewhere in the same file does not cover a route.
import { existsSync, statSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

export function layoutCoverage(root, overrides = {}) {
  const cache = new Map();
  const resolveFile = (from, spec) => {
    if (!spec.startsWith(".")) return null;
    const stem = resolve(dirname(from), spec);
    return [stem, `${stem}.tsx`, `${stem}.ts`, `${stem}/index.tsx`, `${stem}/index.ts`]
      .find((file) => Object.hasOwn(overrides, file) || (existsSync(file) && statSync(file).isFile())) ?? null;
  };
  const parse = (file) => {
    if (cache.has(file)) return cache.get(file);
    const text = overrides[file] ?? readFileSync(file, "utf8");
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const symbols = new Map();
    const imports = new Map();
    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) symbols.set(node.name.text, node.body);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        symbols.set(node.name.text, node.initializer);
        const lazy = node.initializer.getText(ast).match(/import\(["']([^"']+)["']\)[\s\S]*?default:\s*\w+\.(\w+)/);
        if (lazy) imports.set(node.name.text, [resolveFile(file, lazy[1]), lazy[2]]);
      }
      if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings))
        for (const entry of node.importClause.namedBindings.elements)
          imports.set(entry.name.text, [resolveFile(file, node.moduleSpecifier.text), entry.propertyName?.text ?? entry.name.text]);
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause))
        for (const entry of node.exportClause.elements)
          imports.set(entry.name.text, [resolveFile(file, node.moduleSpecifier.text), entry.propertyName?.text ?? entry.name.text]);
      ts.forEachChild(node, visit);
    };
    visit(ast);
    const parsed = { ast, symbols, imports };
    cache.set(file, parsed);
    return parsed;
  };
  const covered = (file, name, seen = new Set()) => {
    if (!file || seen.has(`${file}:${name}`)) return false;
    seen = new Set([...seen, `${file}:${name}`]);
    const { symbols, imports } = parse(file);
    if (imports.has(name)) {
      const [target, symbol] = imports.get(name);
      if (name === "PageGrid" && target?.replaceAll("\\", "/").endsWith("/app/live-edit/page-grid.tsx")) return true;
      return covered(target, symbol, seen);
    }
    const node = symbols.get(name);
    if (!node) return false;
    let found = false;
    const visit = (child) => {
      if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child))
        found ||= covered(file, child.tagName.getText(), seen);
      ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
  };
  const router = resolve(root, "src/app/router.tsx");
  const { ast } = parse(router);
  const missing = [];
  const routes = [];
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const prop = (name) => node.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(ast) === name)?.initializer;
      const path = prop("path");
      const element = prop("element");
      // The wildcard routes use a shorthand path inside map().
      const dynamic = node.properties.some((p) => ts.isShorthandPropertyAssignment(p) && p.name.text === "path");
      if ((path || dynamic) && element) {
        const route = path && ts.isStringLiteral(path) ? path.text : "[dynamic]";
        if (!/^\/(?:print(?:\/|$)|offline(?:\/|$)|sign-in$)/.test(route)) {
          const tags = [];
          const collect = (n) => {
            if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) tags.push(n.tagName.getText(ast));
            ts.forEachChild(n, collect);
          };
          collect(element);
          // Redirects render no page of their own.
          if (!tags.includes("LegacyRoute") && !tags.includes("Navigate")) {
            routes.push(route);
            if (!tags.some((name) => covered(router, name))) missing.push(`${route}: ${tags.join(", ")} needs a PageGrid`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return { routes, missing };
}
