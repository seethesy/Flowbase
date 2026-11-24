import { test, expect, mockBrowserAuth } from "../auth-fixture";
import { seedUsers } from "../../../worker/db/seed";

for (const entry of [
  { path: "/#/documents", key: "documents.library", block: "filters", name: "Document filters" },
  { path: "/#/profile", key: "notifications.settings", block: "preferences", name: "Notification preferences" },
  { path: "sop", key: "sops.detail", block: "edit-history", name: "Edit history" },
  { path: "task", key: "tasks.detail", block: "checklist", name: "Checklist" },
]) {
  test(`FLOW-283: ${entry.key} moves, saves and keeps its record controls`, async ({ page, browser }) => {
    let path = entry.path;
    if (path === "sop") {
      await page.goto("/#/sops/new");
      await page.getByLabel("Title", { exact: true }).fill("Sample procedure");
      await page.getByLabel("Category", { exact: true }).fill("Production");
      await page.getByRole("textbox", { name: "SOP content" }).fill("Keep this record text intact.");
      await page.getByRole("button", { name: "Save SOP" }).click();
      await expect(page.getByRole("heading", { name: "Sample procedure" })).toBeVisible();
      path = page.url();
    } else if (path === "task") {
      await page.goto("/#/tasks/all");
      await page.getByRole("button", { name: "New task" }).click();
      const form = page.getByRole("dialog");
      await form.getByLabel("Title", { exact: true }).fill("Sample task");
      await form.getByRole("button", { name: "Add task" }).click();
      await page.getByRole("link", { name: "Sample task", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Sample task" })).toBeVisible();
      path = page.url();
    } else await page.goto(path);
    await page.getByRole("button", { name: "Edit screen text" }).click();
    await page.getByRole("button", { name: `Half width: ${entry.name}`, exact: true }).click();
    const item = page.getByLabel(`${entry.name}: arrow keys move, Shift and arrow keys resize`, { exact: true });
    await item.focus();
    if (entry.path === "sop") {
      await page.getByRole("button", { name: "Half width: Procedure", exact: true }).click();
      await item.focus();
      for (let n = 0; n < 26; n++) await item.press("ArrowUp");
      for (let n = 0; n < 6; n++) await item.press("ArrowRight");
      await page.getByRole("button", { name: "Delete SOP facts", exact: true }).click();
      await page.getByRole("dialog", { name: "Delete SOP facts?", exact: true }).getByRole("button", { name: "Confirm", exact: true }).click();
    } else await item.press("ArrowDown");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
    const selector = `[data-page-layout="${entry.key}"] > [data-block-id="${entry.block}"]`;
    await expect(page.locator(selector)).toHaveCSS("grid-column-end", "span 6");
    const context = await browser.newContext();
    const other = await context.newPage();
    await mockBrowserAuth(other, { userId: seedUsers.find((u) => u.role === "sales_manager")!.id });
    await other.goto(path);
    await expect(other.locator(selector)).toHaveCSS("grid-column-end", "span 6");
    if (entry.path === "sop") {
      await expect(other.locator('[data-block-id="sop-header-facts"]')).toHaveCount(0);
      await expect(other.getByText("Keep this record text intact.", { exact: true })).toBeVisible();
    }
    await context.close();
    if (entry.path === "sop") {
      await expect(page.getByText("Keep this record text intact.", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Edit SOP", exact: true }).click();
      await page.getByRole("textbox", { name: "SOP content" }).fill("Changed only through the SOP editor.");
      await page.getByRole("button", { name: "Save SOP" }).click();
      await expect(page.getByText("Changed only through the SOP editor.", { exact: true })).toBeVisible();
      // A second record inherits the same page layout, while its procedure is its own data.
      await page.goto("/#/sops/new");
      await page.getByLabel("Title", { exact: true }).fill("Another procedure");
      await page.getByLabel("Category", { exact: true }).fill("Kitchen");
      await page.getByRole("textbox", { name: "SOP content" }).fill("Another record's own procedure.");
      await page.getByRole("button", { name: "Save SOP" }).click();
      await expect(page.getByRole("heading", { name: "Another procedure", exact: true })).toBeVisible();
      await expect(page.locator('[data-block-id="sop-header-facts"]')).toHaveCount(0);
      await expect(page.locator(selector)).toHaveCSS("grid-column-end", "span 6");
    }
    if (entry.path === "task") {
      await page.getByLabel("New checklist item").fill("Check sample crate");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByText("Check sample crate", { exact: true })).toBeVisible();
    }
  });
}
