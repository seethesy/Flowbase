import { test, expect } from "../auth-fixture";
import { chairs, lead } from "../fixtures";
import { seedInventory, seedLeads } from "../database";

// FLOW-259: the shared Dropdown on real screens.

test("Leads: no native select, and a status dropdown on the last row opens fully (AC1, AC2, AC4)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  const leads = Array.from({ length: 12 }, (_, index) => lead({ name: `Dropdown lead ${String(index + 1).padStart(2, "0")}` }));
  await seedLeads(leads);
  await page.goto("/#/leads");
  await expect(page.getByRole("combobox", { name: "Status for Dropdown lead 12" })).toBeVisible();
  await expect(page.locator("select")).toHaveCount(0);

  const last = page.getByRole("combobox", { name: /^Status for Dropdown lead/ }).last();
  await last.scrollIntoViewIfNeeded();
  await last.click();
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  // Each status is its colored pill.
  await expect(list.getByRole("option", { name: "Closing" }).locator(".status-pill--closing")).toBeVisible();
  // Not clipped by the scrolling table: the whole list is inside the viewport.
  const box = (await list.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(700);
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(last).toBeFocused();
});

test("Inventory: filters are custom dropdowns that work from the keyboard (AC1, AC3)", async ({ page }) => {
  await seedInventory({ items: [chairs()] });
  await page.goto("/#/inventory");
  await expect(page.getByRole("link", { name: chairs().name }).or(page.getByText(chairs().name)).first()).toBeVisible();
  await expect(page.locator("select")).toHaveCount(0);
  // The Location filter (FLOW-291 replaced the Kind filter).
  const kind = page.getByRole("combobox", { name: "Location", exact: true }).first();
  await kind.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(kind).toBeFocused();
  await expect(kind).not.toHaveAttribute("data-value", "");
});

test("A form in a drawer: picking an option keeps the drawer open and saves the choice", async ({ page }) => {
  await page.goto("/#/inventory");
  await page.getByRole("button", { name: "New Item", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("select")).toHaveCount(0);
  // Admin's Stock tracking choice (FLOW-289) stands in for the old Kind picker.
  const kind = dialog.getByRole("combobox", { name: "Stock tracking", exact: true });
  await kind.click();
  // The list renders inside the dialog, so the dialog's focus trap and outside-click
  // handling leave it alone.
  await expect(dialog.getByRole("listbox")).toBeVisible();
  await dialog.locator('[role="option"][data-value="not_stocked"]').click();
  await expect(dialog).toBeVisible();
  await expect(kind).toHaveAttribute("data-value", "not_stocked");
});
