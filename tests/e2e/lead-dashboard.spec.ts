import { test, expect } from "./auth-fixture";
import type { LeadDashboard, LeadDashboardRow } from "../../shared/leads";

// Lead dashboard (FLOW-113): renders the API's numbers and asks again for a new range.
const row = (overrides: Partial<LeadDashboardRow> = {}): LeadDashboardRow => ({
  leads: 3,
  converted: 2,
  conversionRate: 2 / 3,
  closed: 2,
  estimatedClosedCents: 1_750_000,
  medianFirstResponseSeconds: 7_200,
  awaitingAction: 1,
  purchased: 1,
  ...overrides,
});
const dashboard = (from: string, to: string): LeadDashboard => ({
  from,
  to,
  scope: "all",
  averageBudgetCents: 750_000,
  totals: row({ leads: 5, conversionRate: 0.4 }),
  bySource: [
    { ...row(), source: "Bark", hasPurchased: true },
    { ...row({ leads: 2, converted: 0, conversionRate: 0, closed: 0, estimatedClosedCents: 0 }), source: "Thumbtack", hasPurchased: false },
  ],
  byChannel: [{ ...row(), channel: "collector" }],
  byStatus: [
    { status: "new", leads: 1 },
    { status: "converted", leads: 2 },
  ],
  bySalesperson: [{ ...row(), salespersonId: null }],
});

test("the lead dashboard shows conversion, estimated value and response time by source", async ({
  page,
}) => {
  const asked: string[] = [];
  await page.route(/\/api\/leads\/dashboard/, async (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    await route.fulfill({
      json: dashboard(
        url.searchParams.get("from") ?? "2026-09-24",
        url.searchParams.get("to") ?? "2026-10-23",
      ),
    });
  });
  await page.goto("/#/leads/dashboard");
  await expect(page.getByRole("heading", { name: "Lead dashboard", level: 1 })).toBeVisible();
  await expect(page.getByText("40%")).toBeVisible();
  await expect(page.getByText("$17,500").first()).toBeVisible();
  await expect(page.getByText("Average budget $7,500 where none given")).toBeVisible();
  const sources = page.getByRole("table").first();
  await expect(sources.getByText("Bark")).toBeVisible();
  await expect(sources.getByText("1 / 2")).toBeVisible();
  await expect(sources.getByText("2h 0m").first()).toBeVisible();
  await expect(page.getByText("By salesperson")).toBeVisible();

  await page.getByLabel("From").fill("2026-10-01");
  await expect.poll(() => asked.at(-1)).toContain("from=2026-10-01");
});
