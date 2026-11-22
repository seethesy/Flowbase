import { test, expect } from "./auth-fixture";

test("Admin creates a category and type inside the New Item form and saves both", async ({ page }) => {
  await page.goto("/#/inventory");
  await page.getByRole("button", { name: "New Item", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name *").fill("Synthetic rental item");
  const category = dialog.getByRole("combobox", { name: "Category", exact: true });
  await category.click();
  await dialog.getByRole("textbox", { name: "Add option" }).fill("Synthetic equipment");
  await dialog.getByRole("button", { name: "New category" }).click();
  await expect(category).toContainText("Synthetic equipment");
  const type = dialog.getByRole("combobox", { name: "Type", exact: true });
  await type.click();
  await dialog.getByRole("textbox", { name: "Add option" }).fill("Synthetic type");
  await dialog.getByRole("button", { name: "New type" }).click();
  await expect(type).toContainText("Synthetic type");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("combobox", { name: "Category", exact: true })).toContainText("Synthetic equipment");
  await expect(page.getByRole("dialog").getByRole("combobox", { name: "Type", exact: true })).toContainText("Synthetic type");
});
