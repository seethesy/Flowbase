import { test, expect, type Page } from "@playwright/test";
import type { ActivitySessionInput } from "../../shared/time-tracking";
import { fallGala, juniper, mockAttachmentsApi, mockRecordsApi } from "./mock-api";

// Automatic time tracking (FLOW-119) in a real browser with a fake clock: idle and
// visibility rules, and at most one tracking request per minute.
const SECOND = 1000;
const MIN = 60 * SECOND;

const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((hidden) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

test("time accrues only while the tab is visible and the user is active", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-11-02T14:00:00.000Z") });
  const requests: ActivitySessionInput[][] = [];
  await page.route("**/api/time/sessions", async (route) => {
    requests.push(route.request().postDataJSON().sessions);
    await route.fulfill({ json: { recorded: 1 } });
  });
  await mockRecordsApi(page, { clients: [juniper()], events: [fallGala()] });
  await mockAttachmentsApi(page);
  await page.goto(`/#/events/${fallGala().id}`);
  const heading = page.getByRole("heading", { name: "Fall gala", level: 1 });
  await expect(heading).toBeVisible();
  // Seconds credited so far, from the latest copy of each session sent.
  const credited = () => {
    const latest = new Map<string, ActivitySessionInput>();
    for (const batch of requests) for (const s of batch) latest.set(s.id, s);
    return [...latest.values()].map((s) => {
      expect(s).toMatchObject({
        recordType: "event",
        recordId: fallGala().id,
        activity: "event_planning",
      });
      return (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / SECOND;
    });
  };
  const total = () => credited().reduce((sum, seconds) => sum + seconds, 0);

  // Active for about a minute, then idle for seven: the session stops 5 minutes
  // (the idle cutoff) after the last click.
  for (let i = 0; i < 6; i++) {
    await heading.click();
    await page.clock.runFor(10 * SECOND);
  }
  await page.clock.runFor(7 * MIN);
  await expect.poll(total).toBeGreaterThanOrEqual(345);
  expect(total()).toBeLessThanOrEqual(365);
  const afterIdle = total();

  // Idle long past the cutoff: nothing more accrues.
  await page.clock.runFor(3 * MIN);
  expect(total()).toBe(afterIdle);

  // Hidden: clicks don't count. Shown again: nothing until the next click.
  await setHidden(page, true);
  await heading.click();
  await page.clock.runFor(2 * MIN);
  await setHidden(page, false);
  await page.clock.runFor(2 * MIN);
  expect(total()).toBe(afterIdle);

  // Active again for a minute, then the tab is hidden: one more ~1 minute session.
  for (let i = 0; i < 6; i++) {
    await heading.click();
    await page.clock.runFor(10 * SECOND);
  }
  await setHidden(page, true);
  await page.clock.runFor(2 * MIN);
  await expect.poll(() => credited().length).toBe(2);
  expect(total() - afterIdle).toBeGreaterThanOrEqual(55);
  expect(total() - afterIdle).toBeLessThanOrEqual(65);

  // About 18 simulated minutes: at most one request per minute.
  expect(requests.length).toBeGreaterThan(1);
  expect(requests.length).toBeLessThanOrEqual(19);
});
