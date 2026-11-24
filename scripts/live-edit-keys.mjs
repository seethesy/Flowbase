// The live-edit key manifest (FLOW-277): every wording key the code renders
// (with its default's {placeholders}), the key prefixes the code builds at run
// time, every page layout's built-in block and field-card ids and
// layout-aware table keys, and every sidebar heading and tab key (FLOW-284). Committed as shared/generated/live-edit-keys.json;
// the Worker reads it to find saved edits that no longer match a screen, and
// tests/settings/live-edit-keys.test.ts fails CI when a key disappears without an entry
// in shared/live-edit-renames.ts.
//
// Regenerate: node scripts/live-edit-keys.mjs   (npm run live-edit:keys)
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const MANIFEST_PATH = "shared/generated/live-edit-keys.json";

function files(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return path.endsWith(".tsx") || path.endsWith(".ts") ? [path] : [];
    });
}

const placeholderPattern = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
export const placeholderNames = (text) => [...new Set([...text.matchAll(placeholderPattern)].map((m) => m[1]))].sort();

const literal = (node) => {
  while (node && ts.isParenthesizedExpression(node)) node = node.expression;
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return literal(node.expression);
  return null;
};
// The fixed start of a template literal id, e.g. `task-lists.group.${slug}` -> "task-lists.group.".
const templateHead = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node))) node = node.expression;
  return node && ts.isTemplateExpression(node) && node.head.text ? node.head.text : null;
};
const stringArray = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node))) node = node.expression;
  if (!node || !ts.isArrayLiteralExpression(node)) return null;
  const values = node.elements.map((element) => literal(element));
  return values.every((value) => value !== null) ? values : null;
};
const tagName = (node) =>
  ts.isJsxElement(node) ? node.openingElement.tagName.getText() : ts.isJsxSelfClosingElement(node) ? node.tagName.getText() : null;
const attributesOf = (node) =>
  ts.isJsxElement(node) ? node.openingElement.attributes : ts.isJsxSelfClosingElement(node) ? node.attributes : null;
const attribute = (node, name) =>
  attributesOf(node)?.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText() === name)?.initializer;

// Every <T id>, <Plural id> and useCopy(id, text) with literal arguments under
// src/ (the scan tests/settings/copy-keys.test.ts checks), and the prefixes of keys built
// at run time.
export function scanSource(file, text) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const where = (node) => `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const copy = [];
  const prefixes = [];
  const blocks = [];
  const problems = [];
  const nav = file.replace(/\\/g, "/").endsWith("src/app/navigation.ts");
  const visit = (node) => {
    const tag = tagName(node);
    if (tag === "T" && ts.isJsxElement(node)) {
      const id = attribute(node, "id");
      const key = literal(id);
      const children = node.children.filter((child) => !(ts.isJsxText(child) && !child.text.trim()));
      const value =
        children.length === 1 ? (ts.isJsxText(children[0]) ? children[0].text.trim() : literal(children[0])) : null;
      if (key !== null && value !== null) copy.push({ key, text: value, where: where(node) });
      const head = templateHead(id);
      if (head) prefixes.push(head);
    }
    if (tag === "Plural") {
      const key = literal(attribute(node, "id"));
      const one = literal(attribute(node, "one"));
      const other = literal(attribute(node, "other"));
      if (key !== null && one !== null) copy.push({ key: `${key}.one`, text: one, where: where(node) });
      if (key !== null && other !== null) copy.push({ key: `${key}.other`, text: other, where: where(node) });
    }
    if (tag) {
      // A label map's keys (<LabelT id="labels.task-status" value={…}>), a
      // DataTable's or Tabs' column and tab keys (copyKey="leads.inbox.table").
      const id = literal(attribute(node, "id"));
      if (id !== null && (tag === "LabelT" || id.startsWith("labels."))) prefixes.push(`${id}.`);
      const copyKey = literal(attribute(node, "copyKey"));
      if (copyKey !== null) prefixes.push(`${copyKey}.`);
    }
    if (tag === "Block") {
      let parent = node.parent;
      while (parent && tagName(parent) !== "PageGrid") parent = parent.parent;
      const pageKey = parent ? literal(attribute(parent, "pageKey")) : null;
      const id = literal(attribute(node, "id"));
      const declared = parent ? stringArray(attribute(parent, "blockIds")) : null;
      if (!parent || pageKey === null)
        problems.push(`${where(node)}: a <Block> must sit inside a <PageGrid pageKey="…"> in the same file.`);
      else if (id !== null) blocks.push({ pageKey, id, where: where(node) });
      else if (declared) for (const each of declared) blocks.push({ pageKey, id: each, where: where(node) });
      else problems.push(`${where(node)}: give <Block> a literal id, or list its ids in <PageGrid blockIds={[…]}>.`);
    }
    if (ts.isCallExpression(node) && node.expression.getText() === "useCopy") {
      const key = literal(node.arguments[0]);
      const value = literal(node.arguments[1]);
      if (key !== null && value !== null) copy.push({ key, text: value, where: where(node) });
    }
    if (ts.isPropertyAssignment(node) && node.name.getText() === "copyId") {
      const id = literal(node.initializer);
      // Nav names are nav.<copyId> (FLOW-277); a field's option labels are <copyId>.<value>.
      if (id !== null && nav) copy.push({ key: `nav.${id}`, text: navLabel(node), where: where(node) });
      else if (id !== null) prefixes.push(`${id}.`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { copy, prefixes, blocks, problems };
}

// The name next to a nav copyId: { copyId, name } or { copyId, label }.
function navLabel(node) {
  const object = node.parent;
  for (const property of object.properties ?? [])
    if (ts.isPropertyAssignment(property) && ["name", "label"].includes(property.name.getText())) {
      const value = literal(property.initializer);
      if (value !== null) return value;
    }
  return "";
}

// The keys of an exported object literal (layoutTables) or the string arrays
// under one property of each entry (recordPages[page].fieldCards).
function objectLiteral(source, name) {
  let found = null;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === name && node.initializer) {
      let init = node.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression?.(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) found = init;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
const propertyName = (property) => literal(property.name) ?? property.name.getText();

export function scanLayoutConfig(text) {
  const source = ts.createSourceFile("shared/layout.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const tables = (objectLiteral(source, "layoutTables")?.properties ?? []).map(propertyName);
  const fieldCards = {};
  for (const property of objectLiteral(source, "recordPages")?.properties ?? []) {
    if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) continue;
    const cards = property.initializer.properties.find((p) => p.name?.getText() === "fieldCards");
    fieldCards[propertyName(property)] = cards ? (stringArray(cards.initializer) ?? []) : [];
  }
  return { tables: tables.sort(), fieldCards };
}

// Every sidebar heading and tab key (FLOW-284): "<heading copyId>" and
// "<heading copyId>.<tab copyId>", from navigationGroups in src/app/navigation.ts.
// A heading's tabs are an array literal, or withOverview(id, to, [...]), which
// puts an Overview tab first.
export function scanNavigation(text) {
  const source = ts.createSourceFile("src/app/navigation.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let groups = null;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === "navigationGroups" && node.initializer && ts.isArrayLiteralExpression(node.initializer))
      groups = node.initializer;
    if (!groups) ts.forEachChild(node, visit);
  };
  visit(source);
  const keys = [];
  const copyIdOf = (object) => {
    const property = object.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === "copyId");
    return property ? literal(property.initializer) : null;
  };
  for (const group of groups?.elements ?? []) {
    if (!ts.isObjectLiteralExpression(group)) continue;
    const groupId = copyIdOf(group);
    if (!groupId) continue;
    keys.push(groupId);
    const tabsProperty = group.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === "tabs");
    let tabs = tabsProperty?.initializer;
    if (tabs && ts.isCallExpression(tabs) && tabs.expression.getText() === "withOverview") {
      keys.push(`${groupId}.overview`);
      tabs = tabs.arguments[tabs.arguments.length - 1];
    }
    if (!tabs || !ts.isArrayLiteralExpression(tabs)) continue;
    for (const tab of tabs.elements) {
      if (!ts.isObjectLiteralExpression(tab)) continue;
      const tabId = copyIdOf(tab);
      if (tabId) keys.push(`${groupId}.${tabId}`);
    }
  }
  return [...new Set(keys)].sort();
}

const sortedObject = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

// Every usage, for the per-key checks in tests/settings/copy-keys.test.ts.
export function copyUsages(root = ".") {
  return files(join(root, "src")).flatMap((file) =>
    scanSource(relative(root, file), readFileSync(file, "utf8")).copy,
  );
}

export function buildManifest(root = ".") {
  const copy = {};
  const prefixes = new Set();
  const layout = {};
  const problems = [];
  const scanned = [...files(join(root, "src")), ...files(join(root, "shared"))].map((file) =>
    scanSource(relative(root, file).replace(/\\/g, "/"), readFileSync(file, "utf8")),
  );
  for (const result of scanned) {
    for (const usage of result.copy) copy[usage.key] ??= placeholderNames(usage.text);
    for (const prefix of result.prefixes) prefixes.add(prefix);
    for (const block of result.blocks) {
      layout[block.pageKey] ??= { blocks: [], fieldCards: [] };
      if (!layout[block.pageKey].blocks.includes(block.id)) layout[block.pageKey].blocks.push(block.id);
    }
    problems.push(...result.problems);
  }
  const config = scanLayoutConfig(readFileSync(join(root, "shared/layout.ts"), "utf8"));
  for (const [pageKey, cards] of Object.entries(config.fieldCards)) {
    layout[pageKey] ??= { blocks: [], fieldCards: [] };
    layout[pageKey].fieldCards = [...cards].sort();
  }
  for (const page of Object.values(layout)) page.blocks.sort();
  return {
    manifest: {
      version: 1,
      copy: sortedObject(copy),
      copyPrefixes: [...prefixes].sort(),
      layout: sortedObject(layout),
      tables: config.tables,
      nav: scanNavigation(readFileSync(join(root, "src/app/navigation.ts"), "utf8")),
    },
    problems,
  };
}

export const manifestText = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

const follow = (map, key) => {
  const seen = new Set();
  let current = key;
  while (Object.hasOwn(map, current) && !seen.has(current)) {
    seen.add(current);
    current = map[current];
  }
  return current;
};
const knownCopy = (manifest, key) =>
  Object.hasOwn(manifest.copy, key) || manifest.copyPrefixes.some((prefix) => key.startsWith(prefix));
const pageIds = (page) => [...(page?.blocks ?? []), ...(page?.fieldCards ?? [])];

// Keys and block ids the base branch had that the head lost without a rename to
// a key the head has, or a `removed` entry (FLOW-277 AC2).
export function lostKeys(base, head, renames) {
  const lost = [];
  for (const key of Object.keys(base.copy)) {
    // Exact keys: a prefix (e.g. events.event-detail.) would hide a dropped literal key.
    if (Object.hasOwn(head.copy, key) || renames.removed.copy.includes(key)) continue;
    const next = follow(renames.copy, key);
    if (next !== key && knownCopy(head, next)) continue;
    lost.push(
      next !== key
        ? `Wording key "${key}" is renamed to "${next}", which no screen renders.`
        : `Wording key "${key}" is gone. In shared/live-edit-renames.ts add it to copy ("${key}": "<new key>") if it was renamed, or to removed.copy if it was dropped.`,
    );
  }
  for (const [pageKey, page] of Object.entries(base.layout)) {
    const now = pageIds(head.layout[pageKey]);
    for (const id of pageIds(page)) {
      const entry = `${pageKey}/${id}`;
      if (now.includes(id) || renames.removed.blocks.includes(entry)) continue;
      let next = id;
      const seen = new Set();
      while (Object.hasOwn(renames.blocks, `${pageKey}/${next}`) && !seen.has(next)) {
        seen.add(next);
        next = renames.blocks[`${pageKey}/${next}`];
      }
      if (next !== id && now.includes(next)) continue;
      lost.push(
        next !== id
          ? `Block "${entry}" is renamed to "${next}", which page ${pageKey} doesn't have.`
          : `Block "${entry}" is gone. In shared/live-edit-renames.ts add it to blocks ("${entry}": "<new id>") if it was renamed, or to removed.blocks if it was dropped.`,
      );
    }
  }
  return lost;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { manifest, problems } = buildManifest(".");
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  writeFileSync(MANIFEST_PATH, manifestText(manifest));
  console.log(
    `Wrote ${MANIFEST_PATH}: ${Object.keys(manifest.copy).length} wording keys, ${Object.keys(manifest.layout).length} page layouts.`,
  );
}
