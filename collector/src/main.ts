/// <reference types="node" />
import { chromium } from "@playwright/test";
import { httpIngest } from "./ingest.ts";
import { runCollector } from "./run.ts";
import { siteModules } from "./sites/index.ts";
import { fileStateStore } from "./state.ts";
import { isCollectionSlot } from "./window.ts";

// Entry point for the ops workflow (ops-templates/collector.yml):
//   node collector/src/main.ts            scheduled run, only in a collection slot
//   node collector/src/main.ts --any-time manual run
// Configuration comes from the environment; collector/README.md lists the names.
const anyTime = process.argv.includes("--any-time");

async function main() {
  // Checked first, so a run outside 8am–8pm New York time opens nothing.
  if (!anyTime && !isCollectionSlot(new Date())) {
    console.log(JSON.stringify({ event: "collector_skipped", reason: "outside_window" }));
    return;
  }
  const env = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set.`);
    return value;
  };
  const credentials = (site: string) => {
    const prefix = `COLLECTOR_${site.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    const username = process.env[`${prefix}_USERNAME`];
    const password = process.env[`${prefix}_PASSWORD`];
    return username && password ? { username, password } : undefined;
  };
  const result = await runCollector({
    modules: siteModules,
    ingest: httpIngest({ baseUrl: env("FLOWBASE_URL"), token: env("INGEST_TOKEN_LEADS") }),
    state: fileStateStore(
      process.env.COLLECTOR_STATE_DIR ?? ".collector-state",
      env("COLLECTOR_STATE_KEY"),
    ),
    launch: () => chromium.launch({ headless: true }),
    credentials,
    artifactsDir: process.env.COLLECTOR_ARTIFACTS_DIR ?? "collector-artifacts",
    anyTime,
  });
  // A site that needs a login or is blocked is reported, not a failed run; an
  // error is, so the workflow keeps the failure screenshots.
  if (result.runs.some((run) => run.status === "error")) process.exitCode = 1;
}

main().catch((error: Error) => {
  console.error(JSON.stringify({ event: "collector_failed", error: error.message }));
  process.exitCode = 1;
});
