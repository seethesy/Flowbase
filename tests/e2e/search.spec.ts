import { test, expect } from "./auth-fixture";
import { lead } from "./fixtures";
import { seedLeads } from "./database";

// Global search (FLOW-46): the header search asks the API and opens the record.
test("global search finds a misspelled lead and opens it", async ({ page }) => {
  const maya = lead({ name: "Maya Ortiz" });
  await seedLeads([maya]);
  const queries: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/search")
      queries.push(url.searchParams.get("q") ?? "");
  });
  await page.goto("/#/");
  await page.getByRole("button", { name: "Search anything" }).click();
  const box = page.getByPlaceholder(
    "Search clients, leads, events, venues, items, vendors…",
  );
  await box.fill("o");
  await expect(page.getByText("Everything, in one place")).toBeVisible();
  await box.fill("ortz");
  const result = page.getByRole("button", { name: /Maya Ortiz/ });
  await expect(result).toContainText("Lead · Bark");
  expect(queries).not.toContain("o");
  await result.click();
  await expect(
    page.getByRole("heading", { name: "Maya Ortiz", level: 1 }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Search anything" }).click();
  await box.fill("nobody");
  await expect(page.getByText("No matching records")).toBeVisible();
});
