import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { test, expect, mockBrowserAuth } from "../auth-fixture";
import { browserDb } from "../database";
import { choose } from "../dropdown";
import * as s from "../../../worker/db/schema";
import { seedUsers } from "../../../worker/db/seed";

// Staff profile details (FLOW-333): address, notes, staff ID, drives and has a
// car, on the real Worker and database, as Admin (the default sign-in) and as
// Part Time Staff.

const partTime = seedUsers.find((user) => user.role === "part_time_staff")!;

async function addRobin() {
  const [row] = await browserDb((db) =>
    db.insert(s.users).values({
      email: "",
      name: "Robin Driver",
      mobile: "202-555-7714",
      role: "part_time_staff",
      status: "active",
      hasAccount: false,
    }).returning({ id: s.users.id }),
  );
  return row.id;
}

test("an Admin sets address, notes, drives and has a car; they show after reload, with the staff ID from the phone (AC1, AC3, AC4)", async ({ page }) => {
  const id = await addRobin();
  await page.goto(`/#/staff/${id}`);
  await expect(page.getByRole("heading", { name: "Robin Driver" })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByLabel("Address").fill("12 Example Lane\nSpringfield");
  await choose(page.getByLabel("Drives", { exact: true }), { label: "Yes" });
  await choose(page.getByLabel("Has a car", { exact: true }), { label: "No" });
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/staff/${id}`) && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save profile" }).click();
  expect((await saved).ok()).toBeTruthy();
  await page.getByRole("button", { name: "Edit notes" }).click();
  await page.getByLabel("Staff notes").fill("Prefers weekend shifts");
  await page.getByRole("button", { name: "Save notes" }).click();
  await page.reload();
  await expect(page.getByText("12 Example Lane")).toBeVisible();
  await expect(page.getByText("Prefers weekend shifts")).toBeVisible();
  await expect(page.getByText("7714", { exact: true })).toBeVisible();

  // Filter the directory by Drives and Has a car.
  await page.goto("/#/staff");
  await choose(page.getByLabel("Drives", { exact: true }), { label: "Drives: yes" });
  await choose(page.getByLabel("Has a car", { exact: true }), { label: "Has a car: no" });
  await expect(page.getByText("1 staff", { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Robin Driver/ })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const lines = (await readFile((await (await download).path())!, "utf8")).replace(/^\ufeff/, "").trimEnd().split("\r\n");
  expect(lines[0]).toContain("Staff ID,Address,Drives,Has a car");
  expect(lines[1]).toContain("7714");
  expect(lines[1]).toContain("Yes,No");
});

test("Part Time Staff can't read another person's address or staff ID, but sees drives (AC2)", async ({ browser }) => {
  const id = await addRobin();
  await browserDb((db) =>
    db.update(s.users).set({ address: "12 Example Lane", drives: true }).where(eq(s.users.id, id)),
  );
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockBrowserAuth(page, { userId: partTime.id });
  const response = page.waitForResponse((r) => r.url().endsWith(`/api/staff/${id}`) && r.request().method() === "GET");
  await page.goto(`/#/staff/${id}`);
  const body = await (await response).json();
  expect(body).toMatchObject({ address: null, employeeId: null, drives: true });
  await expect(page.getByRole("heading", { name: "Robin Driver" })).toBeVisible();
  await expect(page.getByText("12 Example Lane")).toHaveCount(0);
  await expect(page.getByText("7714", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit notes" })).toHaveCount(0);
  await context.close();
});
