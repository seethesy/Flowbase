import { test, expect, type Page } from "./auth-fixture";
import type { ActivitySessionInput } from "../../shared/time-tracking";
import { fallGala, juniper } from "./fixtures";
import { seedRecords } from "./database";

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
  await page.clock.install({ time: new Date(Date.now() - 60 * MIN) });
  const requests: ActivitySessionInput[][] = [];
  const pending: Promise<unknown>[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/time/sessions") {
      requests.push(request.postDataJSON().sessions);
      pending.push(
        request.response().then((response) => {
          expect(response?.status()).toBe(200);
        }),
      );
    }
  });
  // Let each real database write finish before advancing another timer tick.
  // Otherwise an entire fake idle interval can elapse while one fetch is in flight.
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 15 * SECOND) {
      await page.clock.runFor(Math.min(15 * SECOND, ms - elapsed));
      await Promise.all(pending.splice(0));
    }
  };
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
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
    await advance(10 * SECOND);
  }
  await advance(7 * MIN);
  await expect.poll(total).toBeGreaterThanOrEqual(345);
  expect(total()).toBeLessThanOrEqual(365);
  const afterIdle = total();

  // Idle long past the cutoff: nothing more accrues.
  await advance(3 * MIN);
  expect(total()).toBe(afterIdle);

  // Hidden: clicks don't count. Shown again: nothing until the next click.
  await setHidden(page, true);
  await heading.click();
  await advance(2 * MIN);
  await setHidden(page, false);
  await advance(2 * MIN);
  expect(total()).toBe(afterIdle);

  // Active again for a minute, then the tab is hidden: one more ~1 minute session.
  for (let i = 0; i < 6; i++) {
    await heading.click();
    await advance(10 * SECOND);
  }
  await setHidden(page, true);
  await advance(2 * MIN);
  await expect.poll(() => credited().length).toBe(2);
  expect(total() - afterIdle).toBeGreaterThanOrEqual(55);
  expect(total() - afterIdle).toBeLessThanOrEqual(65);

  // About 18 simulated minutes: at most one request per minute.
  expect(requests.length).toBeGreaterThan(1);
  expect(requests.length).toBeLessThanOrEqual(19);
});

// FLOW-167 AC1: time in a proposal's drawer is credited to that proposal, and
// closing it back to the event ends one session and starts another.
test("time in a proposal is credited to the proposal, then to its event", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(Date.now() - 60 * MIN) });
  const requests: ActivitySessionInput[][] = [];
  const pending: Promise<unknown>[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/time/sessions") {
      requests.push(request.postDataJSON().sessions);
      pending.push(request.response());
    }
  });
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 15 * SECOND) {
      await page.clock.runFor(Math.min(15 * SECOND, ms - elapsed));
      await Promise.all(pending.splice(0));
    }
  };
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto(`/#/events/${fallGala().id}`);
  await page.getByRole("button", { name: "New proposal" }).click();
  const form = page.getByRole("dialog", { name: "New proposal" });
  await form.getByLabel("Title *").fill("Gala dinner");
  await form.getByRole("button", { name: "Save proposal" }).click();
  const drawer = page.getByRole("dialog", { name: "Gala dinner" });
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/[?&]proposal=[0-9a-f-]{36}/);
  const proposalId = new URL(
    new URL(page.url()).hash.slice(1),
    "http://flowbase",
  ).searchParams.get("proposal");

  for (let i = 0; i < 6; i++) {
    await drawer.getByRole("heading", { name: "Gala dinner" }).click();
    await advance(10 * SECOND);
  }
  await drawer.getByRole("button", { name: "Close dialog" }).click();
  await expect(page).not.toHaveURL(/proposal=/);
  const heading = page.getByRole("heading", { name: "Fall gala", level: 1 });
  for (let i = 0; i < 6; i++) {
    await heading.click();
    await advance(10 * SECOND);
  }
  await setHidden(page, true);
  await advance(2 * MIN);

  const latest = () => {
    const sessions = new Map<string, ActivitySessionInput>();
    for (const batch of requests) for (const s of batch) sessions.set(s.id, s);
    return [...sessions.values()].map((s) => ({
      recordType: s.recordType,
      recordId: s.recordId,
      activity: s.activity,
      seconds: (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / SECOND,
    }));
  };
  // Real seconds pass while the proposal is created, so a short event session may
  // come first; the proposal's session and the event's after it are what count.
  const afterCreating = () =>
    latest().slice(latest().findIndex((s) => s.recordType === "proposal"));
  await expect.poll(() => afterCreating().length).toBe(2);
  const [onProposal, onEvent] = afterCreating();
  expect(onProposal).toMatchObject({
    recordType: "proposal",
    recordId: proposalId,
    activity: "proposal_work",
  });
  expect(onEvent).toMatchObject({
    recordType: "event",
    recordId: fallGala().id,
    activity: "event_planning",
  });
  for (const session of [onProposal, onEvent]) {
    expect(session.seconds).toBeGreaterThanOrEqual(50);
    expect(session.seconds).toBeLessThanOrEqual(70);
  }
});
