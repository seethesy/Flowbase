import { test, expect, mockBrowserAuth } from "./auth-fixture";
import { seedUsers } from "../../worker/db/seed";
import { lead } from "./fixtures";
import { seedLeads } from "./database";

// FLOW-273 against the real Worker and database: Leads columns (add Guests, hide
// and reorder, drag a width), and a field added to the lead page's boxes showing
// up as an input in Edit mode.
const salesperson = seedUsers.find((user) => user.role === "salesperson")!;

test("adds Guests, hides Source and resizes a column on Leads, for everyone (FLOW-254 AC1, AC2)", async ({ page, browser }) => {
  await seedLeads([lead({ name: "Maya Ortiz", source: "Bark", guestCount: 80, assignedSalespersonId: salesperson.id })]);
  await page.goto("/#/leads");
  await expect(page.getByRole("columnheader", { name: "Source" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Guests" })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit screen text" }).click();
  await page.getByRole("button", { name: "Columns" }).click();
  const picker = page.getByRole("dialog", { name: "Columns" });
  await picker.getByRole("checkbox", { name: "Show Guests" }).click();
  await picker.getByRole("checkbox", { name: "Show Source" }).click();
  // Guests goes to the far right; move it left twice.
  await picker.getByRole("button", { name: "Move Guests left" }).click();
  await picker.getByRole("button", { name: "Move Guests left" }).click();
  await picker.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("columnheader", { name: "Source" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Guests" })).toBeVisible();

  // Column width: focus the handle and press the arrow keys (FLOW-273).
  const before = await page.getByRole("columnheader", { name: "Guests" }).evaluate((th) => th.getBoundingClientRect().width);
  const handle = page.getByRole("separator", { name: "Resize Guests" });
  await handle.focus();
  for (let i = 0; i < 5; i += 1) await handle.press("ArrowRight");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
  const saved = await page.getByRole("columnheader", { name: "Guests" }).evaluate((th) => th.getBoundingClientRect().width);
  expect(saved).toBeGreaterThan(before + 20);
  await expect(page.getByRole("separator", { name: "Resize Guests" })).toHaveCount(0);

  // Everyone sees the same columns and the width, and the Guests value.
  const context = await browser.newContext();
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId: salesperson.id });
  await other.goto("/#/leads");
  await expect(other.getByRole("columnheader", { name: "Guests" })).toBeVisible();
  await expect(other.getByRole("columnheader", { name: "Source" })).toHaveCount(0);
  await expect(other.getByRole("row").filter({ hasText: "Maya Ortiz" }).getByRole("cell", { name: "80", exact: true })).toBeVisible();
  await context.close();
});

test("a field added as a box on the lead page gets an input in Edit mode (FLOW-255 AC1)", async ({ page }) => {
  const seeded = lead({ name: "Maya Ortiz", guestCount: 80 });
  await seedLeads([seeded]);
  await page.goto(`/#/leads/${seeded.id}`);
  // Edit as it is: no Guests input until a Guests box exists.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Guests")).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).first().click();

  // Add the Guests box in layout edit mode and save.
  await page.getByRole("button", { name: "Edit screen text" }).click();
  await page.getByRole("combobox", { name: "Add field" }).click();
  await page.getByRole("listbox").last().getByRole("option", { name: "Guests", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();

  // Now Edit mode matches: a Guests input with the stored value, which saves.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const guests = page.getByLabel("Guests");
  await expect(guests).toHaveValue("80");
  await guests.fill("95");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("95", { exact: true }).first()).toBeVisible();
});
