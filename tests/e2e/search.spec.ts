import { test, expect } from "@playwright/test";
import type { SearchResult } from "../../shared/search";
import { lead, mockLeadsApi } from "./mock-api";

// Global search (FLOW-46): the header search asks the API and opens the record.
test("global search finds a misspelled lead and opens it", async ({ page }) => {
  const maya = lead({ name: "Maya Ortiz" });
  await mockLeadsApi(page, [maya]);
  const queries: string[] = [];
  await page.route(/\/api\/search\?/, async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    queries.push(q);
    const results: SearchResult[] = q.toLowerCase().startsWith("ort")
      ? [
          {
            type: "lead",
            id: maya.id,
            title: "Maya Ortiz",
            subtitle: "Bark",
            path: `/leads/${maya.id}`,
            score: 0.8,
          },
        ]
      : [];
    await route.fulfill({ json: results });
  });
  await page.goto("/#/");
  await page.getByRole("button", { name: "Search anything" }).click();
  const box = page.getByPlaceholder("Search clients, leads, events, venues, items…");
  await box.fill("o");
  await expect(page.getByText("Everything, in one place")).toBeVisible();
  await box.fill("ortz");
  const result = page.getByRole("button", { name: /Maya Ortiz/ });
  await expect(result).toContainText("Lead · Bark");
  expect(queries).not.toContain("o");
  await result.click();
  await expect(page.getByRole("heading", { name: "Maya Ortiz", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Search anything" }).click();
  await box.fill("nobody");
  await expect(page.getByText("No matching records")).toBeVisible();
});
