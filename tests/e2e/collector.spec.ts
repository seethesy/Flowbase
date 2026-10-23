import { chromium, test, expect } from "@playwright/test";
import { httpIngest } from "../../collector/src/ingest.ts";
import { runCollector } from "../../collector/src/run.ts";
import type { SiteState, StateStore } from "../../collector/src/state.ts";
import type { CollectedLead, CollectorRun } from "../../shared/collector.ts";
import { fakeSiteModule, serveFakeSite, serveIngest } from "./fake-site";

// The lead collector framework (FLOW-102) against saved fixture pages only: CI never
// signs in to a live site or uses a secret (ADR-21). It drives its own Chromium, so
// it runs once, in the desktop project.
test.beforeEach(({ browserName }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop" || browserName !== "chromium",
    "Runs once, in the desktop project.",
  );
});

const memoryState = (): StateStore & { saved: Map<string, SiteState> } => {
  const saved = new Map<string, SiteState>();
  return {
    saved,
    load: async (site) => saved.get(site) ?? {},
    save: async (site, state) => void saved.set(site, state),
  };
};

test("a site module reads fixture pages and posts normalized leads to the Worker (AC1)", async () => {
  const site = await serveFakeSite();
  const worker = await serveIngest("test-token");
  const state = memoryState();
  try {
    const result = await runCollector({
      modules: [fakeSiteModule(site.url)],
      ingest: httpIngest({ baseUrl: worker.url, token: "test-token" }),
      state,
      launch: () => chromium.launch(),
      anyTime: true,
      pauseMs: [0, 0],
    });
    const leads = worker.posts
      .filter((post) => post.path === "/api/ingest/leads")
      .map((post) => post.body as CollectedLead);
    expect(leads).toHaveLength(2);
    expect(leads[0]).toMatchObject({
      site: "fake",
      source: "Fake site",
      sourceLeadId: "fake-101",
      name: "Sample Person",
      email: "sample.person@example.com",
      eventDate: "2026-11-14",
      guestCount: 80,
      budgetCents: 1_200_000,
    });
    expect(leads[0].sourceRecordId).toMatch(/^fake:fake-101:[0-9a-f]{16}$/);
    expect(leads[1]).toMatchObject({ sourceLeadId: "fake-102", eventDate: null, email: "" });
    const runs = worker.posts
      .filter((post) => post.path === "/api/ingest/collector-runs")
      .map((post) => post.body as CollectorRun);
    expect(runs).toEqual([
      expect.objectContaining({ site: "fake", status: "ok", leadsFound: 2 }),
    ]);
    expect(result.runs[0].status).toBe("ok");
    expect(state.saved.get("fake")?.lastSuccessAt).toBeTruthy();
  } finally {
    await Promise.all([site.close(), worker.close()]);
  }
});

test("a CAPTCHA stops the site as blocked and no further page is visited (AC2)", async () => {
  const site = await serveFakeSite({ "/leads.html": "/captcha.html" });
  const worker = await serveIngest("test-token");
  try {
    const result = await runCollector({
      modules: [fakeSiteModule(site.url)],
      ingest: httpIngest({ baseUrl: worker.url, token: "test-token" }),
      state: memoryState(),
      launch: () => chromium.launch(),
      anyTime: true,
      pauseMs: [0, 0],
    });
    expect(result.runs).toEqual([
      expect.objectContaining({ status: "blocked", leadsFound: 0, message: "The site showed a CAPTCHA." }),
    ]);
    expect(site.requested).toEqual(["/account.html", "/leads.html"]);
    expect(worker.posts.map((post) => post.path)).toEqual(["/api/ingest/collector-runs"]);
  } finally {
    await Promise.all([site.close(), worker.close()]);
  }
});

test("stops at the page limit and leaves the rest for the next run", async () => {
  const site = await serveFakeSite();
  const worker = await serveIngest("test-token");
  const state = memoryState();
  try {
    const result = await runCollector({
      modules: [fakeSiteModule(site.url)],
      ingest: httpIngest({ baseUrl: worker.url, token: "test-token" }),
      state,
      launch: () => chromium.launch(),
      anyTime: true,
      pauseMs: [0, 0],
      pageLimit: 3,
    });
    expect(result.runs[0]).toMatchObject({ status: "ok", leadsFound: 1 });
    expect(result.runs[0].message).toContain("Page limit reached");
    expect(site.requested).toHaveLength(3);
    expect(state.saved.get("fake")?.lastSuccessAt).toBeUndefined();
  } finally {
    await Promise.all([site.close(), worker.close()]);
  }
});
