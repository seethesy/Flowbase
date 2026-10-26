import { test, expect } from "./auth-fixture";
import { consumable, defaultSections, mockInventoryApi } from "./mock-api";

// Count mode (FLOW-82) is used on a phone in the storage area.
test.use({ viewport: { width: 390, height: 844 } });

test("counts a storage section on a phone and resumes a partial count", async ({
  page,
}) => {
  const fridge = defaultSections[5];
  await mockInventoryApi(page, {
    items: [
      consumable("Heavy Cream", {
        unit: "qt",
        category: "Dairy",
        onHand: 15,
        details: { parLevel: 6, storageOrder: 1 },
      }),
      consumable("Butter", {
        unit: "lb",
        category: "Dairy",
        onHand: 4,
        details: { storageOrder: 2 },
      }),
    ],
  });
  await page.goto("/#/inventory/counts");
  await page
    .getByRole("button", { name: `Start counting ${fridge.name}` })
    .click();
  await expect(
    page.getByRole("heading", { name: `Count: ${fridge.name}` }),
  ).toBeVisible();
  const lines = page.locator(".count-line");
  await expect(lines.locator("strong")).toHaveText(["Heavy Cream", "Butter"]);
  await expect(page.getByText("0 of 2 counted")).toBeVisible();

  // AC1: counting 12 where the system shows 15 records −3.
  const cream = page.getByRole("listitem", { name: "Heavy Cream" });
  await expect(cream.getByText("In system: 15 qt")).toBeVisible();
  await expect(cream.getByLabel("Counted (qt)")).toBeFocused();
  await cream.getByLabel("Counted (qt)").fill("12");
  await cream
    .getByRole("button", { name: "Save count for Heavy Cream" })
    .click();
  await expect(cream.getByRole("status")).toHaveText("Counted 12 qt (−3)");
  await expect(cream.getByText("In system: 12 qt")).toBeVisible();
  await expect(page.getByText("1 of 2 counted")).toBeVisible();

  // AC3: leave and come back; the count resumes at the next uncounted item.
  await page.getByRole("link", { name: "← All counts" }).click();
  await page
    .getByRole("button", { name: `Resume counting ${fridge.name}` })
    .click();
  await expect(page.getByText("1 of 2 counted")).toBeVisible();
  await expect(
    page.getByRole("listitem", { name: "Heavy Cream" }).getByRole("status"),
  ).toHaveText("Counted 12 qt (−3)");
  const butter = page.getByRole("listitem", { name: "Butter" });
  await expect(butter.getByLabel("Counted (lb)")).toBeFocused();

  // AC2: a recount below par puts the cream on the low-stock list.
  const recount = page.getByRole("listitem", { name: "Heavy Cream" });
  await recount.getByLabel("Counted (qt)").fill("4");
  await recount.getByLabel("Reason").fill("Used for brunch");
  await recount
    .getByRole("button", { name: "Save count for Heavy Cream" })
    .click();
  await expect(recount.getByRole("status")).toHaveText("Counted 4 qt (−8)");
  await expect(recount.getByText("Below par")).toBeVisible();
  await butter.getByLabel("Counted (lb)").fill("4");
  await butter.getByRole("button", { name: "Save count for Butter" }).click();
  await expect(page.getByText("2 of 2 counted")).toBeVisible();
  await page.getByRole("button", { name: "Finish count" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm" })
    .click();
  await expect(
    page.getByRole("button", { name: `Start counting ${fridge.name}` }),
  ).toBeVisible();

  await page.goto("/#/inventory/low-stock");
  await expect(page.getByRole("button", { name: "Heavy Cream" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Butter" })).toHaveCount(0);
});
