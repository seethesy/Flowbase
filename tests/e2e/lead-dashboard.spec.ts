import { test, expect } from "./auth-fixture";
import { fallGala, juniper, lead } from "./fixtures";
import { seedRecords, seedLeads } from "./database";

test("the lead dashboard shows real conversion, estimated value and response time by source", async ({
  page,
}) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  const receivedAt = new Date(Date.now() - 86_400_000).toISOString();
  const firstRespondedAt = new Date(
    Date.parse(receivedAt) + 7_200_000,
  ).toISOString();
  await seedLeads([
    lead({
      receivedAt,
      firstRespondedAt,
      status: "converted",
      convertedEventId: fallGala().id,
      budgetCents: 1_000_000,
      purchased: true,
    }),
    lead({
      receivedAt,
      firstRespondedAt,
      status: "converted",
      convertedEventId: fallGala().id,
    }),
    lead({ receivedAt }),
    lead({
      receivedAt,
      source: "Thumbtack",
      status: "contacted",
      budgetCents: 500_000,
    }),
    lead({ receivedAt, source: "Thumbtack", status: "contacted" }),
  ]);
  const asked: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/leads/dashboard") asked.push(url.search);
  });
  await page.goto("/#/leads/dashboard");
  await expect(
    page.getByRole("heading", { name: "Lead dashboard", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Conversion rate 40%/ }),
  ).toBeVisible();
  await expect(page.getByText("$17,500").first()).toBeVisible();
  await expect(
    page.getByText("Average budget $7,500 where none given"),
  ).toBeVisible();
  const sources = page.getByRole("table").first();
  await expect(sources.getByText("Bark")).toBeVisible();
  await expect(sources.getByText("1 / 2")).toBeVisible();
  await expect(sources.getByText("2h 0m").first()).toBeVisible();
  await expect(page.getByText("By salesperson")).toBeVisible();
  await page.getByLabel("From").fill("2026-10-01");
  await expect.poll(() => asked.at(-1)).toContain("from=2026-10-01");
});
