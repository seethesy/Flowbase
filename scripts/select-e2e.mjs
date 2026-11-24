// FLOW-315: chooses the Playwright specs a PR runs.
//
// A draft PR runs the smoke specs plus the specs for the areas its changed
// files belong to (tests/e2e/areas.json). A PR that is ready for review, and a
// manual run, run every spec. Changes that cannot affect the browser (Markdown,
// docs, unit and DB tests) run none. A changed file that maps to no area, or to
// a shared foundation, runs the full suite: when in doubt, test everything.
//
// CLI (CI's `changes` job): BASE_SHA, HEAD_SHA and DRAFT come from the
// pull_request event; prints `mode=`, `specs=` and `shards=` lines for
// $GITHUB_OUTPUT.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// The selected specs fit on one Playwright shard; the full suite uses four.
export const SMALL_SELECTION = 10;
const FULL_SHARDS = [1, 2, 3, 4];

// `**` spans folders, `*` stays within one.
export function globToRegExp(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else source += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}
const matches = (file, globs) => globs.some((glob) => globToRegExp(glob).test(file));

export function listSpecs(root = ".") {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".spec.ts")) out.push(path);
    }
  };
  walk("tests/e2e");
  return out.sort();
}

// Returns { mode: "skip" | "selected" | "full", specs, shards }. specs is empty
// in "full" mode, which means every spec.
export function selectSpecs(changed, map, { draft, specs }) {
  const relevant = changed.filter((file) => !matches(file, map.skip));
  if (!relevant.length) return { mode: "skip", specs: [], shards: [] };
  const full = { mode: "full", specs: [], shards: FULL_SHARDS };
  if (!draft) return full;
  const chosen = new Set(specs.filter((spec) => matches(spec, map.smoke)));
  for (const file of relevant) {
    if (file.endsWith(".spec.ts")) {
      chosen.add(file);
      continue;
    }
    if (matches(file, map.full)) return full;
    const areas = Object.values(map.areas).filter((area) => matches(file, area.paths));
    if (!areas.length) return full;
    for (const area of areas)
      for (const spec of specs) if (matches(spec, area.specs)) chosen.add(spec);
  }
  const list = [...chosen].sort();
  return {
    mode: "selected",
    specs: list,
    shards: list.length <= SMALL_SELECTION ? [1] : FULL_SHARDS,
  };
}

export function readMap(root = ".") {
  return JSON.parse(readFileSync(join(root, "tests/e2e/areas.json"), "utf8"));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { BASE_SHA, HEAD_SHA, DRAFT } = process.env;
  const changed = BASE_SHA && HEAD_SHA
    ? execFileSync("git", ["diff", "--name-only", `${BASE_SHA}...${HEAD_SHA}`], { encoding: "utf8" })
        .split("\n").filter(Boolean).map((file) => relative(".", file).replace(/\\/g, "/"))
    : null;
  // No pull request (a manual run): the full suite.
  const result = changed
    ? selectSpecs(changed, readMap(), { draft: DRAFT === "true", specs: listSpecs() })
    : { mode: "full", specs: [], shards: FULL_SHARDS };
  console.log(`mode=${result.mode}`);
  console.log(`specs=${result.specs.join(" ")}`);
  console.log(`shards=${JSON.stringify(result.shards)}`);
  console.error(`Playwright: ${result.mode}${result.specs.length ? ` (${result.specs.length} spec files)` : ""}`);
}
