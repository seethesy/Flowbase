/// <reference types="node" />
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContextOptions, Page } from "@playwright/test";
import {
  collectedLeadSchema,
  type CollectedLead,
  type CollectorRun,
  type CollectorRunStatus,
} from "../../shared/collector.ts";
import { stopIfBlocked } from "./blocked.ts";
import { leadRecordId, type Ingest } from "./ingest.ts";
import type { StateStore } from "./state.ts";
import { SiteStopped, type SiteContext, type SiteModule } from "./types.ts";
import { isCollectionSlot } from "./window.ts";

// Runs every site module once (FLOW-102, ADR-14): one browser, one page at a time,
// a human pause between pages and a page limit per site. Read-only: modules only
// open pages and read them. Each site ends with a CollectorRun record.
export type RunOptions = {
  modules: SiteModule[];
  ingest: Ingest;
  state: StateStore;
  // Opens the browser; never called outside a collection slot.
  launch: () => Promise<Browser>;
  credentials?: (site: string) => SiteContext["credentials"];
  now?: () => Date;
  // Pages a site may open per run, login included.
  pageLimit?: number;
  // Pause between pages, picked between these bounds.
  pauseMs?: [number, number];
  sleep?: (ms: number) => Promise<void>;
  // No new site starts after this long, so the run fits the 5-minute time box.
  budgetMs?: number;
  // Where failure screenshots and HTML go (uploaded as short-lived artifacts).
  artifactsDir?: string;
  // Runs even outside a collection slot (a manual run).
  anyTime?: boolean;
  log?: (event: Record<string, unknown>) => void;
};

export type RunResult = { skipped: boolean; runs: CollectorRun[] };

const DEFAULT_PAGE_LIMIT = 40;
const DEFAULT_PAUSE: [number, number] = [2_000, 6_000];
const DEFAULT_BUDGET_MS = 4 * 60_000;

class PageLimitReached extends Error {}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// A short reason that never carries page content or client details.
const reasonOf = (error: unknown) =>
  error instanceof SiteStopped
    ? error.message
    : `${error instanceof Error ? error.name : "Error"}: the site could not be read.`;

async function saveFailure(page: Page, directory: string, site: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(directory, { recursive: true });
  await page
    .screenshot({ path: join(directory, `${site}-${stamp}.png`), fullPage: true })
    .catch(() => undefined);
  const html = await page.content().catch(() => "");
  await writeFile(join(directory, `${site}-${stamp}.html`), html).catch(() => undefined);
}

export async function runCollector(options: RunOptions): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((event) => console.log(JSON.stringify(event)));
  if (!options.anyTime && !isCollectionSlot(now())) {
    log({ event: "collector_skipped", reason: "outside_window" });
    return { skipped: true, runs: [] };
  }
  const runId = randomUUID();
  const started = now().getTime();
  const runs: CollectorRun[] = [];
  const browser = await options.launch();
  try {
    for (const module of options.modules) {
      if (now().getTime() - started > (options.budgetMs ?? DEFAULT_BUDGET_MS)) {
        log({ event: "collector_out_of_time", site: module.site });
        break;
      }
      const run = await runSite(browser, module, runId, options, now);
      runs.push(run);
      log({ event: "collector_site", ...run });
      await options.ingest
        .postRun(run)
        .catch((error: Error) => log({ event: "collector_run_post_failed", error: error.message }));
    }
  } finally {
    await browser.close();
  }
  return { skipped: false, runs };
}

async function runSite(
  browser: Browser,
  module: SiteModule,
  runId: string,
  options: RunOptions,
  now: () => Date,
): Promise<CollectorRun> {
  const startedAt = now();
  const saved = await options.state.load(module.site);
  const context = await browser.newContext(
    saved.storageState
      ? { storageState: saved.storageState as BrowserContextOptions["storageState"] }
      : {},
  );
  const page = await context.newPage();
  const [minPause, maxPause] = options.pauseMs ?? DEFAULT_PAUSE;
  const sleep = options.sleep ?? sleepFor;
  const pageLimit = options.pageLimit ?? DEFAULT_PAGE_LIMIT;
  let pages = 0;
  const beforePage = async () => {
    if (pages >= pageLimit) throw new PageLimitReached();
    if (pages > 0) await sleep(minPause + Math.random() * (maxPause - minPause));
    pages += 1;
  };
  const site: SiteContext = {
    page,
    credentials: options.credentials?.(module.site),
    visit: async (url) => {
      await beforePage();
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      await stopIfBlocked(page, response);
    },
    selectDetail: async (selector) => {
      await beforePage();
      await page.locator(selector).click();
      await stopIfBlocked(page, null);
    },
  };

  let status: CollectorRunStatus = "ok";
  let message = "";
  let complete = false;
  const collected: CollectedLead[] = [];
  let posted = 0;
  const post = async () => {
    await options.ingest.postLeads(collected.slice(posted));
    posted = collected.length;
  };
  try {
    let signedIn = await module.checkLogin(site);
    if (!signedIn && module.logIn && site.credentials) {
      await module.logIn(site);
      signedIn = await module.checkLogin(site);
    }
    if (!signedIn) throw new SiteStopped("needs_login", "The site needs a new login.");
    const since = saved.lastSuccessAt ? new Date(saved.lastSuccessAt) : null;
    const listed = await module.listLeads(site, since);
    const due = listed.filter(
      (lead) => !since || !lead.updatedAt || new Date(lead.updatedAt) > since,
    );
    try {
      for (const { id } of due) {
        const read = await module.readLead(site, id);
        const sourceLeadId = read.sourceLeadId || id;
        const details = { ...read, source: module.source, sourceLeadId };
        collected.push(
          collectedLeadSchema.parse({
            ...details,
            site: module.site,
            sourceRecordId: leadRecordId(module.site, sourceLeadId, details),
          }),
        );
      }
      complete = true;
    } catch (error) {
      // The rest wait for the next run; the last successful run stays where it was.
      if (!(error instanceof PageLimitReached)) throw error;
      message = `Page limit reached; ${due.length - collected.length} leads left for the next run.`;
    }
    await post();
    await options.state.save(module.site, {
      storageState: await context.storageState(),
      lastSuccessAt: complete ? startedAt.toISOString() : saved.lastSuccessAt,
    });
  } catch (error) {
    status = error instanceof SiteStopped ? error.status : "error";
    message = reasonOf(error);
    if (options.artifactsDir) await saveFailure(page, options.artifactsDir, module.site);
    // Leads read before the site stopped are still delivered.
    await post().catch(() => undefined);
  } finally {
    await context.close();
  }
  return {
    sourceRecordId: `${runId}:${module.site}`,
    runId,
    site: module.site,
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    leadsFound: posted,
    status,
    message,
  };
}
