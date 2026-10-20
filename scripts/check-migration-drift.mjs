import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}
// Generate from the schema, then reject changes to tracked AND new SQL/snapshots.
// drizzle-kit check alone detects collisions, not missing migrations.
run(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "check"]);
run(process.execPath, [
  "node_modules/drizzle-kit/bin.cjs",
  "generate",
  "--name=ci_drift",
]);
const changed = run("git", [
  "status",
  "--porcelain",
  "--untracked-files=all",
  "--",
  "drizzle",
]);
if (changed.trim()) {
  console.error(
    "Schema and committed migrations differ. Generate and commit the migration and snapshots.\n" +
      changed,
  );
  process.exit(1);
}
