import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const scripts: Record<string, string> = JSON.parse(read("package.json")).scripts;
// wrangler.jsonc allows full-line comments and trailing commas.
const wrangler = JSON.parse(
  read("wrangler.jsonc")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1"),
);
const steps = (script: string) => script.split("&&").map((step) => step.trim());

describe("production deploy (FLOW-25)", () => {
  it("builds, migrates, then deploys, stopping at the first failing step", () => {
    expect(steps(scripts.deploy)).toEqual([
      "npm run build",
      "npm run deploy:migrate",
      "wrangler deploy --env production",
    ]);
  });

  it("refuses to migrate without an explicit DATABASE_URL", () => {
    expect(steps(scripts["deploy:migrate"])).toEqual([
      "node scripts/require-env.mjs DATABASE_URL",
      "drizzle-kit migrate",
    ]);
  });

  it("deploys the flowbase Worker with the production database", () => {
    expect(wrangler.env.production.name).toBe("flowbase");
    expect(wrangler.env.production.hyperdrive).toEqual([
      { binding: "HYPERDRIVE", id: "d6486e8ab1314d8ca1dbf5addf1036d0" },
    ]);
  });

  it("is not triggered by GitHub Actions on merge", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).not.toMatch(/^\s*push:/m);
  });
});

describe("preview versions (FLOW-25)", () => {
  it("upload a version without migrating or deploying", () => {
    expect(steps(scripts["deploy:preview"])).toEqual([
      "npm run build",
      "wrangler versions upload --env preview",
    ]);
  });

  it("target the flowbase Worker with the dev database", () => {
    expect(wrangler.env.preview.name).toBe("flowbase");
    expect(wrangler.env.preview.hyperdrive).toEqual(wrangler.env.dev.hyperdrive);
    expect(wrangler.env.preview.vars?.DB_CHECK_ROUTE).toBeUndefined();
  });
});

describe("require-env script", () => {
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, ["scripts/require-env.mjs", "DATABASE_URL"], {
      cwd: new URL("../../", import.meta.url),
      env: { PATH: process.env.PATH ?? "", ...env },
      encoding: "utf8",
    });

  it("fails when the variable is missing or empty", () => {
    expect(run({}).status).toBe(1);
    const empty = run({ DATABASE_URL: "" });
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain("DATABASE_URL");
  });

  it("passes when the variable is set", () => {
    expect(run({ DATABASE_URL: "postgres://example" }).status).toBe(0);
  });
});
