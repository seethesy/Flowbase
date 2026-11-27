import { test, expect } from "../auth-fixture";
import { fallGala, juniper } from "../fixtures";
import { seedRecords } from "../database";
import { addLocalDays, utcToBusinessTime } from "../../../shared/time";
import type { EventStatus } from "../../../shared/core-records";

// Sales › Past Events (FLOW-340 A2) on the real Worker and database: events
// dated before today that reached Closed are Past, the rest are Lost, newest
// first; today's and later events are in neither.

const today = () => utcToBusinessTime(new Date()).date;
const event = (n: number, title: string, days: number, status: EventStatus) => ({
  ...fallGala(),
  id: `e0000000-0000-4000-8000-00000000034${n}`,
  title,
  date: addLocalDays(today(), days),
  status,
});

test("Past Events splits past events into Past and Lost, newest first", async ({ page }) => {
  await seedRecords({
    clients: [juniper()],
    events: [
      event(1, "Older finished", -30, "finished"),
      event(2, "Newer closed", -3, "closed"),
      event(3, "Never closed", -10, "negotiation"),
      event(4, "Marked lost", -5, "lost"),
      event(5, "Upcoming closed", 4, "closed"),
    ],
  });
  await page.goto("/#/sales/past-events");
  await expect(page.getByRole("tab", { name: "Past" })).toHaveAttribute("aria-selected", "true");
  const titles = page.locator("tbody tr").getByRole("button", { name: /^(Older finished|Newer closed|Never closed|Marked lost|Upcoming closed)$/ });
  await expect(titles).toHaveText(["Newer closed", "Older finished"]);

  await page.getByRole("tab", { name: "Lost" }).click();
  await expect(page).toHaveURL(/#\/sales\/past-events\?view=lost$/);
  await expect(titles).toHaveText(["Marked lost", "Never closed"]);
});

test("Network has Clients, Venues, Corporate and Industry (FLOW-340 A1)", async ({ page }) => {
  await page.goto("/#/sales/network");
  await expect(page.getByRole("tablist").first().getByRole("tab")).toHaveText(["Clients", "Venues", "Corporate", "Industry"]);
  await page.getByRole("tab", { name: "Corporate" }).click();
  await expect(page).toHaveURL(/view=corporate$/);
  await expect(page.getByRole("heading", { name: "Corporate", level: 1 })).toBeVisible();
  await page.goto("/#/sales/analytics");
  await expect(page.getByRole("tablist").first().getByRole("tab")).toHaveText(["Sales tracker", "Sales reports", "Marketing analytics"]);
});
