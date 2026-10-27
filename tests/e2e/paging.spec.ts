import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { test, expect } from "./auth-fixture";
import { browserDb } from "./database";

// FLOW-179 AC1: with 600 clients, the one that sorts last is found from the
// Clients screen's search and from the event form's client picker, although the
// first page holds only 100.
test("a client beyond the first page is found by searching", async ({ page }) => {
  await browserDb((db) =>
    db.execute(sql`
      insert into clients (name, kind)
      select 'Client ' || lpad(n::text, 3, '0'), 'organization'
      from generate_series(1, 599) as n
      union all select 'Zinnia Hall', 'organization'
    `),
  );

  await page.goto("/#/clients");
  await expect(page.getByText("100+ clients", { exact: true })).toBeVisible();
  await expect(page.getByText("Zinnia Hall", { exact: true })).toHaveCount(0);
  await page.getByPlaceholder("Search clients or contacts…").fill("Zinnia");
  await expect(page.getByText("1 clients", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Zinnia Hall/ }).click();
  await expect(
    page.getByRole("heading", { name: "Zinnia Hall", level: 1 }),
  ).toBeVisible();

  await page.goto("/#/events");
  await page.getByRole("button", { name: "New Event", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const picker = dialog.getByLabel(/^Client \*/);
  await expect(picker.locator("option", { hasText: "Zinnia Hall" })).toHaveCount(0);
  await dialog.getByLabel("Find client", { exact: true }).fill("Zinnia");
  await expect(picker.locator("option", { hasText: "Zinnia Hall" })).toHaveCount(1);
  await picker.selectOption({ label: "Zinnia Hall" });
  await expect(picker).not.toHaveValue("");
});

test("the clients list loads further pages on request", async ({ page }) => {
  await browserDb((db) =>
    db.execute(sql`
      insert into clients (name, kind)
      select 'Client ' || lpad(n::text, 3, '0'), 'organization'
      from generate_series(1, 150) as n
    `),
  );
  await page.goto("/#/clients");
  await expect(page.getByText("100+ clients", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load more clients" }).click();
  await expect(page.getByText("150 clients", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more clients" })).toHaveCount(0);
});

// FLOW-216 AC1/AC2: Export CSV writes every client matching the search, not
// just the first page on screen, in the table's current sort.
test("exports every matching client, not just the loaded page, in the current sort", async ({
  page,
}) => {
  await browserDb((db) =>
    db.execute(sql`
      insert into clients (name, kind)
      select 'Gala Client ' || lpad(n::text, 3, '0'), 'organization'
      from generate_series(1, 250) as n
      union all
      select 'Other ' || lpad(n::text, 3, '0'), 'organization'
      from generate_series(1, 50) as n
    `),
  );
  await page.goto("/#/clients");
  await page.getByPlaceholder("Search clients or contacts…").fill("Gala Client");
  await expect(page.getByText("100+ clients", { exact: true })).toBeVisible();
  // Sort by name, descending (second click).
  const sort = page.locator("th").getByRole("button", { name: /^Client/ });
  await sort.click();
  await sort.click();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^clients-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = (await readFile((await file.path())!, "utf8"))
    .replace(/^\ufeff/, "")
    .trimEnd()
    .split("\r\n");
  expect(lines[0].startsWith("Client,")).toBe(true);
  expect(lines).toHaveLength(251);
  expect(lines[1].startsWith("Gala Client 250,")).toBe(true);
  expect(lines.at(-1)!.startsWith("Gala Client 001,")).toBe(true);
  expect(lines.some((line) => line.startsWith("Other "))).toBe(false);
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();
});
