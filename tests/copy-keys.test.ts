// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { copyKeySchema } from "../shared/copy";

// Live text editing (FLOW-240): one key per distinct string, so a key must have
// the same default everywhere it is used, and every key follows the convention
// in docs/live-text-editing.md. Scans every <T id="…">, <Plural id="…"> and
// useCopy("…", "…") with literal arguments under src/.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith(".tsx") || path.endsWith(".ts") ? [path] : [];
  });
}
const literal = (node: ts.Node | undefined): string | null => {
  while (node && ts.isParenthesizedExpression(node)) node = node.expression;
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return literal(node.expression);
  return null;
};

function usages() {
  const found: { key: string; text: string; where: string }[] = [];
  for (const file of files("src")) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const where = (node: ts.Node) => `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const attr = (attributes: ts.JsxAttributes, name: string) => {
      const found = attributes.properties.find(
        (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
      );
      return found?.initializer ? literal(found.initializer) : null;
    };
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === "T") {
        const key = attr(node.openingElement.attributes, "id");
        const children = node.children.filter((child) => !(ts.isJsxText(child) && !child.text.trim()));
        const text =
          children.length === 1
            ? ts.isJsxText(children[0])
              ? children[0].text.trim()
              : literal(children[0])
            : null;
        if (key !== null && text !== null) found.push({ key, text, where: where(node) });
      }
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === "Plural") {
        const key = attr(node.attributes, "id");
        const one = attr(node.attributes, "one");
        const other = attr(node.attributes, "other");
        if (key !== null && one !== null) found.push({ key: `${key}.one`, text: one, where: where(node) });
        if (key !== null && other !== null) found.push({ key: `${key}.other`, text: other, where: where(node) });
      }
      if (ts.isCallExpression(node) && node.expression.getText() === "useCopy") {
        const key = literal(node.arguments[0]);
        const text = literal(node.arguments[1]);
        if (key !== null && text !== null) found.push({ key, text, where: where(node) });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

it("finds the wrapped wording", () => {
  expect(usages().length).toBeGreaterThan(1000);
});

it("gives each key one default everywhere it is used", () => {
  const defaults = new Map<string, { text: string; where: string }>();
  const conflicts: string[] = [];
  for (const usage of usages()) {
    const seen = defaults.get(usage.key);
    if (!seen) defaults.set(usage.key, usage);
    else if (seen.text !== usage.text)
      conflicts.push(`${usage.key}: "${seen.text}" (${seen.where}) vs "${usage.text}" (${usage.where})`);
  }
  expect(conflicts).toEqual([]);
});

it("names every key area.screen.element", () => {
  const bad = usages().filter((usage) => !copyKeySchema.safeParse(usage.key).success);
  expect(bad.map((usage) => `${usage.key} (${usage.where})`)).toEqual([]);
});
