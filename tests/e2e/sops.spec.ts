import { test, expect } from "./auth-fixture";

test("creates, links, and opens an SOP from a task (FLOW-139)", async ({ page }) => {
  await page.goto("/#/sops");
  await page.getByRole("link", { name: "New SOP" }).click();
  await page.getByLabel("Title").fill("Truck loading procedure");
  await page.getByLabel("Category").fill("Production");
  await page.getByRole("textbox", { name: "SOP content" }).fill("Verify every crate against the manifest.");
  await page.getByRole("button", { name: "Save SOP" }).click();
  await expect(page.getByRole("heading", { name: "Truck loading procedure" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit history" })).toBeVisible();
  await page.goto("/#/tasks/all");
  await page.getByRole("button", { name: "New task" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Title").fill("Load the truck");
  await form.getByLabel("SOP").selectOption({ label: "Truck loading procedure (Production)" });
  await form.getByRole("button", { name: "Add task" }).click();
  await page.getByRole("link", { name: "Load the truck" }).click();
  await page.getByRole("link", { name: "Open SOP" }).click();
  await expect(page.getByRole("heading", { name: "Truck loading procedure" })).toBeVisible();
  await expect(page.getByText("Verify every crate against the manifest.")).toBeVisible();
});
