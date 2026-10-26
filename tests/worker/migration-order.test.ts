import { afterEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const entry = (idx: number, when: number) => ({
  idx,
  version: "7",
  when,
  tag: `00${String(idx).padStart(2, "0")}_migration`,
  breakpoints: true,
});
const journal = (...entries: ReturnType<typeof entry>[]) => ({
  version: "7",
  dialect: "postgresql",
  entries,
});
const main = journal(entry(0, 1000), entry(1, 2000));

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// Runs scripts/check-migration-order.mjs against fixture journals.
function check(base: object, head: object) {
  dir = mkdtempSync(join(tmpdir(), "flowbase-journal-"));
  writeFileSync(join(dir, "base.json"), JSON.stringify(base));
  writeFileSync(join(dir, "head.json"), JSON.stringify(head));
  const result = spawnSync(
    process.execPath,
    ["scripts/check-migration-order.mjs", "--base", join(dir, "base.json"), "--head", join(dir, "head.json")],
    { cwd: root, encoding: "utf8" },
  );
  if (result.error || result.status === null) throw result.error ?? new Error("check did not exit");
  return { status: result.status, stderr: result.stderr };
}

it("passes a branch whose new migration is newer than main's last (FLOW-187)", () => {
  expect(check(main, journal(entry(0, 1000), entry(1, 2000), entry(2, 3000))).status).toBe(0);
  expect(check(main, main).status).toBe(0);
});

it("fails a branch whose new migration is older than main's last (FLOW-187 AC3)", () => {
  // The branch generated 0002 at 1500, before main merged 0001 at 2000.
  const result = check(main, journal(entry(0, 1000), entry(1, 2000), entry(2, 1500)));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("0002_migration");
  expect(result.stderr).toContain("the last migration on main");
});

it("fails new migrations that are out of order among themselves", () => {
  const result = check(main, journal(entry(0, 1000), entry(1, 2000), entry(2, 3000), entry(3, 2500)));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("0003_migration");
});
