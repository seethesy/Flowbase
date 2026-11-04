import { test, expect } from "./auth-fixture";
import { consumable, fallGala, juniper } from "./fixtures";
import { seedInventory, seedRecords } from "./database";

// Bar plan (FLOW-170): plan bar quantities on an event by item and by tier.
const vodka = (name: string, housePick: boolean) =>
  consumable(name, {
    subtype: "bar",
    category: "Liquor",
    tier: "rail",
    bar: { brand: "", subcategory: "Vodka", container: "bottle", housePick },
    details: { purchaseUnit: "case", packCount: 12 },
  });

test("plans bar quantities on an event by item and by tier", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await seedInventory({ items: [vodka("Smirnoff", true), vodka("Svedka", false)] });
  await page.goto(`/#/events/${fallGala().id}`);
  // The planning sections load when they scroll into view.
  await page.getByRole("heading", { name: "Equipment & stock" }).scrollIntoViewIfNeeded();
  await expect(page.getByText("No bar planned yet.")).toBeVisible();
  await page.getByRole("form", { name: "Add bar tier" }).scrollIntoViewIfNeeded();

  const tierForm = page.getByRole("form", { name: "Add bar tier" });
  await tierForm.getByLabel("Tier", { exact: true }).selectOption("rail");
  await tierForm.getByLabel("Bar category").selectOption("Liquor");
  await tierForm.getByLabel("Subcategory").selectOption("Vodka");
  await tierForm.getByLabel("Tier quantity").fill("12");
  await tierForm.getByRole("button", { name: "Add bar tier" }).click();
  await expect(page.getByText("Rail vodka")).toBeVisible();
  await expect(page.getByText("from Smirnoff, Svedka")).toBeVisible();

  const itemForm = page.getByRole("form", { name: "Add bar item" });
  await itemForm.getByLabel("Item").selectOption({ label: "Svedka" });
  await itemForm.getByLabel("Quantity").fill("2");
  await itemForm.getByRole("button", { name: "Add bar item" }).click();
  await expect(page.getByRole("button", { name: "Remove Svedka" })).toBeVisible();

  await page.getByRole("button", { name: "Remove Rail vodka" }).click();
  await expect(page.getByText("Rail vodka")).toBeHidden();
});
