// Fails when a migration added on this branch is not newer than the last migration
// on main (FLOW-187). Drizzle's migrator skips any migration whose journal `when` is
// not later than the last one applied, so two branches that each add a migration
// could otherwise ship one that production silently never runs.
//
// Usage: node scripts/check-migration-order.mjs
//   compares drizzle/meta/_journal.json with the journal at the merge base of HEAD
//   and main (origin/main, else main). CI checks out with fetch-depth: 0.
// Or:    node scripts/check-migration-order.mjs --base <journal> --head <journal>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const JOURNAL = "drizzle/meta/_journal.json";

// Returns one message per new entry that would be skipped or applied out of order.
export function outOfOrderMigrations(base, head) {
  const known = new Set(base.entries.map((entry) => entry.tag));
  const latest = Math.max(0, ...base.entries.map((entry) => entry.when));
  const problems = [];
  let previous = latest;
  for (const entry of head.entries.filter((e) => !known.has(e.tag))) {
    if (entry.when <= previous)
      problems.push(
        `${entry.tag}: journal "when" ${entry.when} is not later than ${previous}` +
          (previous === latest ? " (the last migration on main)" : "") +
          ". Delete it and run npm run db:generate again on top of main.",
      );
    previous = Math.max(previous, entry.when);
  }
  return problems;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function mergeBaseJournal() {
  for (const main of ["origin/main", "main"]) {
    let base;
    try {
      base = git(["merge-base", "HEAD", main]);
    } catch {
      continue;
    }
    return JSON.parse(git(["show", `${base}:${JOURNAL}`]));
  }
  return undefined;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const basePath = option(args, "--base");
  const base = basePath ? JSON.parse(readFileSync(basePath, "utf8")) : mergeBaseJournal();
  const head = JSON.parse(readFileSync(option(args, "--head") ?? JOURNAL, "utf8"));
  if (!base) {
    console.warn("Migration order not checked: no main branch to compare with.");
    process.exit(0);
  }
  const problems = outOfOrderMigrations(base, head);
  if (problems.length) {
    console.error("Migrations out of order:\n" + problems.join("\n"));
    process.exit(1);
  }
}
