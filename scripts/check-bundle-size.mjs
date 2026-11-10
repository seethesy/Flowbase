import { readFileSync, readdirSync, statSync } from "node:fs";
// Vite's warning threshold is 500 kB (uncompressed). Keep it a CI gate.
//
// The one exception is the layout annotation editor (FLOW-147): Excalidraw is
// large, loads only when someone opens that screen, and splits into several
// chunks. A chunk is exempt only if the editor's chunk (the one holding the
// "layout-plan" marker in src/features/beo-layout-editor.tsx) pulls it in and it
// is NOT part of the first load (the entry script and what it imports statically).
const dir = "dist/assets";
const files = readdirSync(dir).filter((name) => name.endsWith(".js"));
const text = (name) => readFileSync(`${dir}/${name}`, "utf8");
const refs = (name, pattern) => {
  const found = new Set();
  for (const match of text(name).matchAll(pattern)) if (files.includes(match[1])) found.add(match[1]);
  return found;
};
const staticImports = /(?:from|import)\s*["']\.\/([^"']+\.js)["']/g;
const anyImports = /(?:\.\/|assets\/)([\w.-]+\.js)/g;
const closure = (starts, pattern) => {
  const seen = new Set(starts);
  const queue = [...starts];
  while (queue.length) {
    for (const next of refs(queue.pop(), pattern)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
};
const html = readFileSync("dist/index.html", "utf8");
const first = [...html.matchAll(/assets\/([\w.-]+\.js)/g)].map((m) => m[1]).filter((name) => files.includes(name));
const eager = closure(first, staticImports);
const lazyExcalidraw = new Set(
  [...closure(files.filter((name) => text(name).includes("layout-plan")), anyImports)].filter((name) => !eager.has(name)),
);
const oversized = files.filter((name) => statSync(`${dir}/${name}`).size > 500_000 && !lazyExcalidraw.has(name));
if (oversized.length) {
  const detail = oversized.map((name) => `${name} ${statSync(`${dir}/${name}`).size} ${eager.has(name) ? "eager" : "lazy"}`);
  // A workflow annotation, so the offending chunks show on the check run.
  console.log(`::error file=scripts/check-bundle-size.mjs::${detail.join("; ")} | first: ${first.join(", ")}`);
  throw new Error(`SPA chunks exceed 500 kB: ${oversized.join(", ")}`);
}
