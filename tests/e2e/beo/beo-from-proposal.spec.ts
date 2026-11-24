import { eq } from "drizzle-orm";
import { test, expect } from "../auth-fixture";
import { fallGala, juniper } from "../fixtures";
import { browserDb, seedRecords } from "../database";
import { proposalMappings, proposals, proposalVersions } from "../../../worker/db/schema";
import { DOCX_TYPE } from "../../../shared/proposals";
import { proposalMappingSchema } from "../../../shared/proposal-mapping";

// FLOW-337: Generate BEO on a Closing proposal lands on the event's BEO page,
// which names the proposal and version it came from.
const ids = { proposal: "f0000000-0000-4000-8000-000000000337", version: "a0000000-0000-4000-8000-000000003371" };

test("Generate BEO from a Closing proposal opens the BEO page with its source", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await browserDb(async (db) => {
    await db.insert(proposals).values({ id: ids.proposal, eventId: fallGala().id, clientId: juniper().id, title: "Gala proposal", stage: "closing" });
    await db.insert(proposalVersions).values({ id: ids.version, proposalId: ids.proposal, number: 3, status: "ready", completedAt: new Date(),
      docx: { key: "proposal/gala/v3/proposal.docx", fileName: "Gala v3.docx", contentType: DOCX_TYPE, size: 10 } });
    await db.update(proposals).set({ currentVersionId: ids.version }).where(eq(proposals.id, ids.proposal));
    await db.insert(proposalMappings).values({ proposalId: ids.proposal, versionId: ids.version,
      data: proposalMappingSchema.parse({ versionId: ids.version, totalCents: 500_000,
        timeline: [{ value: "6:00 PM - Guests arrive", sourceBlockId: "t1" }] }) });
  });

  await page.goto(`/#/events/${fallGala().id}?proposal=${ids.proposal}`);
  const drawer = page.getByRole("dialog", { name: "Gala proposal" });
  await drawer.getByRole("button", { name: "Generate BEO" }).click();

  await expect(page).toHaveURL(new RegExp(`#/events/${fallGala().id}/beo/`));
  await expect(page.getByText("From proposal: Gala proposal v3")).toBeVisible();
});

test("Generate BEO isn't offered before Closing", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await browserDb((db) => db.insert(proposals).values({ id: ids.proposal, eventId: fallGala().id, clientId: juniper().id, title: "Gala proposal", stage: "negotiation" }));
  await page.goto(`/#/events/${fallGala().id}?proposal=${ids.proposal}`);
  const drawer = page.getByRole("dialog", { name: "Gala proposal" });
  await expect(drawer.getByText("Stage", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Generate BEO" })).toHaveCount(0);
});
