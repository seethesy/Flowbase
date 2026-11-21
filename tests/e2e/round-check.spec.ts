import { test, expect } from "./auth-fixture";
import type { Locator, Page } from "@playwright/test";
import { browserDb } from "./database";
import { createTask } from "../../worker/records/tasks";
import { taskInputSchema } from "../../shared/tasks";

// FLOW-245: every checkbox is the 16px round RoundCheck, never the browser's
// default square. Smoke test on Profile, Leads and Tasks.
async function expectRound(check: Locator) {
  await expect(check).toHaveClass(/round-check/);
  await expect(check).toHaveCSS("appearance", "none");
  await expect(check).toHaveCSS("border-radius", "50%");
  await expect(check).toHaveCSS("width", "16px");
  await expect(check).toHaveCSS("height", "16px");
}
async function expectAllRound(page: Page) {
  const checks = page.getByRole("checkbox");
  expect(await checks.count()).toBeGreaterThan(0);
  for (const check of await checks.all()) await expectRound(check);
}

test("profile checkboxes are round and toggle from their label", async ({ page }) => {
  await page.goto("/#/profile");
  await expect(page.getByRole("checkbox").first()).toBeVisible();
  await expectAllRound(page);
  // The profile is read-only until Edit (FLOW-249); SMS consent is in the form.
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const consent = page.getByRole("checkbox", { name: /Text me work updates/ });
  await expectRound(consent);
  const before = await consent.isChecked();
  await page.getByText(/Text me work updates/).click();
  await expect(consent).toBeChecked({ checked: !before });
  await consent.focus();
  await page.keyboard.press("Space");
  await expect(consent).toBeChecked({ checked: before });
});

test("task checklist items are round checks", async ({ page }) => {
  const id = await browserDb((db) =>
    createTask(db, null, taskInputSchema.parse({ title: "Polish chafing dishes", checklist: ["Wipe trays"] })),
  );
  await page.goto(`/#/tasks/${id}`);
  const item = page.getByRole("checkbox", { name: "Wipe trays" });
  await expect(item).toBeVisible();
  await expectAllRound(page);
  await page.getByText("Wipe trays", { exact: true }).click();
  await expect(item).toBeChecked();
});
