import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { globToRegExp, listSpecs, readMap, selectSpecs } from "../../scripts/select-e2e.mjs";

// FLOW-315: the Playwright selection for draft PRs.
const map = readMap();
const specs = listSpecs();
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const matches = (file: string, globs: string[]) => globs.some((glob) => globToRegExp(glob).test(file));
const find = (pattern: RegExp) => {
  const file = tracked.find((path) => pattern.test(path));
  if (!file) throw new Error(`No tracked file matches ${pattern}`);
  return file;
};
const draft = (changed: string[]) => selectSpecs(changed, map, { draft: true, specs });

describe("area map", () => {
  it("puts every spec in the smoke set, core or an area (AC5)", () => {
    const placed = (spec: string) =>
      matches(spec, map.smoke) || matches(spec, map.core) ||
      Object.values(map.areas).some((area) => matches(spec, area.specs));
    expect(specs.filter((spec) => !placed(spec))).toEqual([]);
  });
  it("names only files and folders that exist", () => {
    const globs = [
      ...map.smoke,
      ...Object.values(map.areas).flatMap((area) => [...area.paths, ...area.specs]),
    ];
    expect(globs.filter((glob) => !tracked.some((file) => globToRegExp(glob).test(file)))).toEqual([]);
  });
});

describe("selection", () => {
  it("runs smoke plus the kitchen specs on one shard for a kitchen screen change (AC1)", () => {
    const result = draft([find(/^src\/features\/(kitchen\/)?kitchen-screen\.tsx$/)]);
    expect(result.mode).toBe("selected");
    expect(result.shards).toEqual([1]);
    expect(result.specs).toEqual(expect.arrayContaining(specs.filter((spec) => matches(spec, map.smoke))));
    expect(result.specs).toContain(find(/^tests\/e2e\/(kitchen\/)?kitchen-screen\.spec\.ts$/));
    expect(result.specs.some((spec) => /leads\.spec\.ts$/.test(spec))).toBe(false);
  });
  it("runs the full suite for a shared foundation even on a draft (AC2)", () => {
    expect(draft(["worker/hono.ts"]).mode).toBe("full");
    expect(draft(["src/app/router.tsx"]).mode).toBe("full");
  });
  it("runs the full suite for a file that maps to no area", () => {
    expect(draft(["scripts/seed.mjs"]).mode).toBe("full");
  });
  it("runs the full suite once the PR is ready for review (AC3)", () => {
    const kitchen = find(/^src\/features\/(kitchen\/)?kitchen-screen\.tsx$/);
    expect(selectSpecs([kitchen], map, { draft: false, specs })).toEqual({
      mode: "full", specs: [], shards: [1, 2, 3, 4],
    });
  });
  it("runs nothing for Markdown, docs and unit or DB tests (AC4)", () => {
    for (const ready of [true, false])
      expect(selectSpecs(["README.md", "docs/architecture.md", "tests/db/x.test.ts"], map, { draft: ready, specs }).mode).toBe("skip");
  });
  it("runs a changed spec file itself", () => {
    const spec = find(/^tests\/e2e\/(tasks\/)?sops\.spec\.ts$/);
    expect(draft([spec]).specs).toContain(spec);
  });
  it("runs the lead specs for a collector change", () => {
    expect(draft(["collector/src/sites/bark.ts"]).specs).toContain(find(/^tests\/e2e\/(leads\/)?collector-sites\.spec\.ts$/));
  });
});
