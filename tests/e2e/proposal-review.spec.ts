import { test, expect } from "./auth-fixture";
import { strToU8, zipSync } from "fflate";
import { eq } from "drizzle-orm";
import * as s from "../../worker/db/schema";
import { DOCX_TYPE } from "../../shared/proposals";
import { browserDb, seedRecords } from "./database";
import { fallGala, juniper } from "./fixtures";

const proposalId = "c3000000-0000-4000-8000-000000000001";
const versionId = "c3000000-0000-4000-8000-000000000002";
const word = Buffer.from(zipSync({ "word/document.xml": strToU8(
  `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Mains</w:t></w:r></w:p><w:p><w:r><w:t>Tuscan Chicken</w:t></w:r></w:p><w:p><w:r><w:t>Gold chairs</w:t></w:r></w:p></w:body></w:document>`,
) }));

test("reviews a Word proposal, suggests a recipe and blocks an unmatched rental", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await browserDb(async (db) => {
    await db.update(s.events).set({ endsAt: new Date("2026-11-15T03:00:00.000Z") }).where(eq(s.events.id, fallGala().id));
    await db.insert(s.recipes).values({ name: "Tuscan Chicken", category: "Mains" });
    await db.insert(s.proposals).values({ id: proposalId, eventId: fallGala().id, clientId: juniper().id, title: "Gala proposal", stage: "finalized" });
    await db.insert(s.proposalVersions).values({ id: versionId, proposalId, number: 1, status: "ready", docx: { key: `proposal/${proposalId}/${versionId}/proposal.docx`, fileName: "proposal.docx", contentType: DOCX_TYPE, size: word.length }, completedAt: new Date() });
    await db.update(s.proposals).set({ currentVersionId: versionId }).where(eq(s.proposals.id, proposalId));
  });
  await page.route(/proposal\.docx\?/, (route) => route.fulfill({ status: 200, body: word, contentType: DOCX_TYPE, headers: { "access-control-allow-origin": "*" } }));
  await page.goto(`/#/events/${fallGala().id}`);
  await page.getByRole("listitem", { name: "Gala proposal" }).getByRole("button", { name: "Open" }).click();
  const dialog = page.getByRole("dialog", { name: "Gala proposal" });
  await expect(dialog.getByRole("heading", { name: "Review and map" })).toBeVisible();
  await expect(dialog.getByText("Not extracted").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Add line", exact: true }).click();
  const menu = dialog.locator(".proposal-mapping-line").first();
  await menu.getByLabel("Section").fill("Mains");
  await menu.getByLabel("Line name").fill("Tuscan Chicken");
  await expect(menu.getByLabel("Catalog match for Tuscan Chicken").locator("option", { hasText: "Suggested: Tuscan Chicken" })).toHaveCount(1);
  await menu.getByLabel("Catalog match for Tuscan Chicken").selectOption({ label: "Suggested: Tuscan Chicken" });
  await dialog.getByRole("button", { name: "Add line", exact: true }).click();
  const rental = dialog.locator(".proposal-mapping-line").last();
  await rental.getByLabel("Line kind").selectOption("rental");
  await rental.getByLabel("Line name").fill("Gold chairs");
  await dialog.getByRole("button", { name: "Submit for approval" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Gold chairs");
  await rental.getByLabel("Not tracked").check();
  await dialog.getByRole("button", { name: "Add staffing line" }).click();
  await dialog.getByLabel("Staff position").fill("Server");
  await dialog.getByLabel("Staff count").fill("2");
  await dialog.getByRole("button", { name: "Add payment schedule line" }).click();
  await dialog.getByLabel("Payment schedule 1").fill("Deposit $500 due at signing");
  await dialog.getByRole("button", { name: "Submit for approval" }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("region", { name: "Gala proposal plan" })).toContainText("Tuscan Chicken");
  await expect(page.getByRole("region", { name: "Gala proposal plan" })).toContainText("2 Server");
  await expect(page.getByRole("region", { name: "Gala proposal plan" })).toContainText("Deposit $500 due at signing");
});
