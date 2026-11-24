// FLOW-316: trims the saved lead-site pages in collector/fixtures/<site>/ to
// what the collector and its tests read. It removes comments, SVG, <head>
// links and metadata, inline styles, and the class names and data-* attributes
// that no collector selector or test names, plus framework
// (`_ngcontent-*`) and rendering attributes. Run it after replacing a fixture
// with a newly saved page, then run tests/e2e/collector-sites.spec.ts and
// tests/leads/collector.test.ts. Bark's pages also drop everything outside
// the lead list and detail (KEEP).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const SITES = ["bark", "eventective", "perfect-venue", "weddingpro"];
const SOURCES = ["collector/src", "collector/src/sites", "tests/e2e"];

// Every word in the collector and its tests: a class or data-* name absent from
// all of them can't be one a selector or assertion depends on.
const words = new Set();
for (const dir of SOURCES)
  for (const file of readdirSync(dir).filter((name) => /\.(ts|mjs)$/.test(name) && (dir !== "tests/e2e" || name.startsWith("collector"))))
    for (const word of readFileSync(join(dir, file), "utf8").match(/[\w-]+/g) ?? []) words.add(word);

// Rendering and framework attributes no selector or role query reads.
const NOISE = new Set([
  "aria-live", "aria-busy", "aria-atomic", "aria-relevant", "srcset", "sizes",
  "loading", "decoding", "width", "height", "tabindex", "spellcheck",
  "ng-reflect-router-link", "rel", "target",
]);

// Sites whose saved pages carry a whole dashboard around the lead list and
// detail: only these elements (with their contents and ancestors) are kept,
// plus every form control, so the login check still sees what the site shows.
const KEEP = {
  bark: ".responses-projects-item, #dashboard-project-details, a[href=\"/sellers/my-barks/#\"]",
};
const CONTROLS = "form, input, button, select, textarea, [role=button]";

function keepOnly(document, selector) {
  const kept = new Set();
  for (const element of document.body.querySelectorAll(`${selector}, ${CONTROLS}`)) {
    element.querySelectorAll("*").forEach((child) => kept.add(child));
    for (let node = element; node && node !== document.body; node = node.parentElement) kept.add(node);
  }
  for (const element of [...document.body.querySelectorAll("*")])
    if (!kept.has(element) && element.isConnected) element.remove();
}

function trim(html, site) {
  const dom = new JSDOM(html);
  const { document, NodeFilter } = dom.window;
  if (KEEP[site]) keepOnly(document, KEEP[site]);
  const comments = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
  const drop = [];
  while (comments.nextNode()) drop.push(comments.currentNode);
  drop.forEach((node) => node.remove());
  document.querySelectorAll("svg, head link, head meta, noscript, template, iframe").forEach((node) => node.remove());
  for (const element of document.querySelectorAll("*")) {
    element.removeAttribute("style");
    const kept = [...element.classList].filter((name) => words.has(name));
    if (kept.length) element.setAttribute("class", kept.join(" "));
    else element.removeAttribute("class");
    for (const { name } of [...element.attributes])
      if (
        (name.startsWith("data-") && !words.has(name)) ||
        name.startsWith("_ng") || NOISE.has(name)
      )
        element.removeAttribute(name);
  }
  return `<!DOCTYPE html>\n${document.documentElement.outerHTML.replace(/\n\s*\n+/g, "\n")}\n`;
}

for (const site of SITES)
  for (const page of ["leads.html", "lead.html"]) {
    const path = join("collector/fixtures", site, page);
    const before = readFileSync(path, "utf8");
    const after = trim(before, site);
    writeFileSync(path, after);
    console.log(`${path}: ${Math.round(before.length / 1024)} kB → ${Math.round(after.length / 1024)} kB`);
  }
