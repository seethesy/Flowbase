import { choose, optionTexts } from "../dropdown";
import { readFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { test, expect } from "../auth-fixture";
import { browserDb } from "../database";
import * as s from "../../../worker/db/schema";
import { seedUsers } from "../../../worker/db/seed";

// Staff directory (FLOW-40), business settings (FLOW-45) and CSV export (FLOW-48)
// on the real Worker and database, signed in as the seeded Admin.

test("filters the staff directory by position and exports the filtered list", async ({
  page,
}) => {
  const [server, inactiveServer, driver] = [seedUsers[1], seedUsers[3], seedUsers[5]];
  await browserDb(async (db) => {
    await db
      .update(s.users)
      .set({ positions: ["Server"] })
      .where(eq(s.users.id, server.id));
    await db
      .update(s.users)
      .set({ positions: ["Server", "Driver"], status: "deactivated" })
      .where(eq(s.users.id, inactiveServer.id));
    await db
      .update(s.users)
      .set({ positions: ["Driver"] })
      .where(inArray(s.users.id, [driver.id]));
  });
  await page.goto("/#/staff");
  await expect(
    page.getByText(`${seedUsers.length - 1} staff`, { exact: true }),
  ).toBeVisible();
  await choose(page.getByLabel("Position", { exact: true }), "Server");
  await expect(page.getByText("1 staff", { exact: true })).toBeVisible();
  await page.getByLabel("Show inactive").check();
  await expect(page.getByText("2 staff", { exact: true })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^staff-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = (await readFile((await file.path())!, "utf8"))
    .replace(/^\ufeff/, "")
    .trimEnd()
    .split("\r\n");
  // Employment type left with Part-time Staff becoming a role (FLOW-249).
  expect(lines[0]).toBe("Name,Positions,Role,Phone,Email,Status");
  expect(lines).toHaveLength(3);
  expect(lines.join("\n")).toContain(server.email);
  expect(lines.join("\n")).toContain(inactiveServer.email);
  expect(lines.join("\n")).toContain("Server; Driver");
  expect(lines.join("\n")).not.toContain(driver.email);
});

test("a list value Admin adds in Settings is offered in the event form, and archiving removes it", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await choose(page.getByLabel(/^List/), { label: "Event types" });
  await page.getByLabel("Add to Event types").fill("Gala");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Gala added.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Event types" }).getByText("Gala"),
  ).toBeVisible();

  await page.goto("/#/events");
  await page.getByRole("button", { name: "New Event", exact: true }).click();
  await expect.poll(() => optionTexts(page.getByRole("dialog").getByLabel(/^Event type/))).toEqual(["—", "Corporate", "Wedding", "Gala"]);
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/#/settings");
  await choose(page.getByLabel(/^List/), { label: "Event types" });
  await page
    .getByRole("list", { name: "Event types" })
    .getByRole("listitem")
    .filter({ hasText: "Gala" })
    .getByRole("button", { name: "Archive" })
    .click();
  await expect(page.getByText("Gala archived.", { exact: true })).toBeVisible();
  await page.goto("/#/events");
  await page.getByRole("button", { name: "New Event", exact: true }).click();
  await expect.poll(() => optionTexts(page.getByRole("dialog").getByLabel(/^Event type/))).toEqual(["—", "Corporate", "Wedding"]);
});
