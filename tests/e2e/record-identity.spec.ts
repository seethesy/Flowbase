import type { Page, Request, Route } from "@playwright/test";
import { test, expect } from "./auth-fixture";
import { juniper, mockRecordsApi } from "./mock-api";
import type { Client } from "../../shared/core-records";

// FLOW-197: a draft, a late response or a finished save for one record must never
// land on another. Responses are held and released by hand to force the races.
const alpha = juniper();
const beta: Client = {
  ...juniper(),
  id: "c0000000-0000-4000-8000-0000000000b2",
  name: "Glasshouse Group",
  contacts: [],
};

// Holds the matching requests until release() is called, then lets the mock API
// answer them.
async function hold(page: Page, pattern: RegExp, method = "GET") {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(pattern, async (route: Route) => {
    if (route.request().method() !== method) return route.fallback();
    await released;
    await route.fallback();
  });
  return release;
}
const exactly = (id: string) => new RegExp(`/api/clients/${id}$`);
const goTo = (page: Page, hash: string) =>
  page.evaluate((target) => (window.location.hash = target), hash);
function recordPuts(page: Page) {
  const puts: { url: string; body: { name?: string } }[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "PUT" && request.url().includes("/api/clients/"))
      puts.push({ url: request.url(), body: request.postDataJSON() });
  });
  return puts;
}
const heading = (page: Page, name: string) =>
  page.getByRole("heading", { name, level: 1 });

test("a delayed record never offers the previous record's data to edit (AC1)", async ({
  page,
}) => {
  await mockRecordsApi(page, { clients: [alpha, beta] });
  const puts = recordPuts(page);
  await page.goto(`/#/clients/${alpha.id}`);
  await expect(heading(page, alpha.name)).toBeVisible();

  const releaseBeta = await hold(page, exactly(beta.id));
  await goTo(page, `#/clients/${beta.id}`);
  // While Beta loads, Alpha's page and its Edit action are gone.
  await expect(heading(page, alpha.name)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);

  releaseBeta();
  await expect(heading(page, beta.name)).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Name *", { exact: true })).toHaveValue(beta.name);
  await dialog.getByRole("button", { name: "Save client" }).click();
  await expect(dialog).toHaveCount(0);
  expect(puts).toHaveLength(1);
  expect(puts[0].url).toMatch(exactly(beta.id));
  expect(puts[0].body.name).toBe(beta.name);
});

test("navigating away closes an open draft without saving it (AC2)", async ({
  page,
}) => {
  await mockRecordsApi(page, { clients: [alpha, beta] });
  const puts = recordPuts(page);
  await page.goto(`/#/clients/${alpha.id}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name *", { exact: true })
    .fill("Alpha draft");

  await goTo(page, `#/clients/${beta.id}`);
  await expect(heading(page, beta.name)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Name *", { exact: true }),
  ).toHaveValue(beta.name);
  expect(puts).toEqual([]);
});

test("a save that finishes after navigating away doesn't replace the record on screen (AC2)", async ({
  page,
}) => {
  await mockRecordsApi(page, { clients: [alpha, beta] });
  const puts = recordPuts(page);
  await page.goto(`/#/clients/${alpha.id}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name *", { exact: true })
    .fill("Juniper Events");
  const releaseSave = await hold(page, exactly(alpha.id), "PUT");
  await page.getByRole("button", { name: "Save client" }).click();

  await goTo(page, `#/clients/${beta.id}`);
  await expect(heading(page, beta.name)).toBeVisible();
  releaseSave();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].url).toMatch(exactly(alpha.id));
  // Give the finished save a moment to (wrongly) land, then check Beta is intact.
  await page.waitForTimeout(300);
  await expect(heading(page, beta.name)).toBeVisible();
  await expect(heading(page, "Juniper Events")).toHaveCount(0);

  await page.goBack();
  await expect(heading(page, "Juniper Events")).toBeVisible();
});

test("an older response arriving last doesn't win, and back/forward keep the right record (AC3)", async ({
  page,
}) => {
  await mockRecordsApi(page, { clients: [alpha, beta] });
  await page.goto("/#/clients");
  const releaseAlpha = await hold(page, exactly(alpha.id));
  await goTo(page, `#/clients/${alpha.id}`);
  await goTo(page, `#/clients/${beta.id}`);
  await expect(heading(page, beta.name)).toBeVisible();
  releaseAlpha();
  await page.waitForTimeout(300);
  await expect(heading(page, beta.name)).toBeVisible();
  await expect(heading(page, alpha.name)).toHaveCount(0);

  await page.unroute(exactly(alpha.id));
  await page.goBack();
  await expect(heading(page, alpha.name)).toBeVisible();
  await page.goForward();
  await expect(heading(page, beta.name)).toBeVisible();
});
