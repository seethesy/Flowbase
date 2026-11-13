import { test, expect } from "./auth-fixture";
import { fallGala, juniper } from "./fixtures";
import { browserDb, seedRecords } from "./database";
import { proposals, paymentScheduleItems, payments, proposalMappings, proposalVersionMappings, proposalVersions } from "../../worker/db/schema";
import { eq } from "drizzle-orm";

test("sales tracker filters, saved views, export and live proposal stages", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  const proposalId = "f0000000-0000-4000-8000-000000000001";
  await browserDb(async (db) => { await db.insert(proposals).values({ id: proposalId, eventId: fallGala().id, clientId: juniper().id, title: "Gala proposal" }); });
  await page.goto("/#/proposals");
  await expect(page.getByRole("heading", { name: "Sales tracker" })).toBeVisible();
  await page.getByLabel("Type").selectOption("proposal");
  await expect(page.getByRole("table").getByText("Gala proposal")).toBeVisible();
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("Gala");
  await page.getByLabel("New view name").fill("Gala proposals");
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(page.getByLabel("Saved views").locator("option", { hasText: "Gala proposals" })).toHaveCount(1);
  await page.reload();
  await page.getByLabel("Saved views").selectOption({ label: "Gala proposals" });
  await expect(page.getByLabel("Type")).toHaveValue("proposal");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe("sales-tracker.csv");
  await page.getByRole("link", { name: /Gala proposal/ }).click();
  const drawer = page.getByRole("dialog", { name: "Gala proposal" });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Move to stage").selectOption({ label: "Menu curation" });
  await expect(drawer.getByRole("list", { name: "Stage history" })).toContainText("Client communication → Menu curation");
  await page.goto("/#/proposals");
  await expect(page.getByRole("table").getByText("Menu curation")).toBeVisible();
});

test("client tracker includes finished and preparation events with balances", async ({ page }) => {
  const events = [
    { ...fallGala(), status: "finished" as const },
    { ...fallGala(), id: "e0000000-0000-4000-8000-000000000002", title: "Winter gala", date: "2026-12-14", status: "finished" as const },
    { ...fallGala(), id: "e0000000-0000-4000-8000-000000000003", title: "Spring gala", date: "2027-03-14", status: "preparation" as const },
  ];
  await seedRecords({ clients: [juniper()], events });
  await browserDb(async (db) => {
    for (const [index, event] of events.entries()) {
      const proposalId = `f0000000-0000-4000-8000-00000000000${index + 1}`;
      const versionId = `a0000000-0000-4000-8000-00000000000${index + 1}`;
      const totalCents = (index + 1) * 100_000;
      await db.insert(proposals).values({ id: proposalId, eventId: event.id, clientId: juniper().id, title: `${event.title} proposal`, stage: "signed" });
      await db.insert(proposalVersions).values({ id: versionId, proposalId, number: 1, status: "ready", completedAt: new Date(), docx: { key: `test-${index}`, fileName: "test.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 10 } });
      await db.update(proposals).set({ currentVersionId: versionId }).where(eq(proposals.id, proposalId));
      const data = { versionId, totalCents, fields: {}, lines: [], staffing: [], timeline: [], charges: [], paymentSchedule: [], unextractedBlockIds: [] };
      await db.insert(proposalMappings).values({ proposalId, versionId, data });
      await db.insert(proposalVersionMappings).values({ versionId, data });
      await db.insert(paymentScheduleItems).values({ eventId: event.id, kind: "balance", dueDate: "2027-04-01", amountCents: totalCents });
      await db.insert(payments).values({ eventId: event.id, method: "cash", receivedOn: "2026-11-10", amountCents: 20_000 });
    }
  });
  await page.goto(`/#/clients/${juniper().id}`);
  await page.getByRole("tab", { name: "Proposal tracker" }).click();
  await expect(page.getByText("3 events · Lifetime booked total: $6,000.00")).toBeVisible();
  await expect(page.getByText("Balance due $800.00")).toBeVisible();
  await expect(page.getByText("Balance due $1,800.00")).toBeVisible();
  await expect(page.getByText("Balance due $2,800.00")).toBeVisible();
  await page.goto("/#/sales/reports");
  await expect(page.getByRole("heading", { name: "Sales reports" })).toBeVisible();
  await expect(page.getByRole("table").first().getByText("Signed")).toBeVisible();
});
