import { choose } from "./dropdown";
import { test, expect } from "./auth-fixture";
import { fallGala, juniper } from "./fixtures";
import { browserDb, seedRecords } from "./database";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import * as s from "../../worker/db/schema";

// The Events screen's BEOs tab (FLOW-265 AC4).
test("lists BEOs with working filters, and Saved PDF opens the file in Documents", async ({ page }) => {
  const event = { ...fallGala(), date: addLocalDays(utcToBusinessTime(new Date()).date, 10) };
  await seedRecords({ clients: [juniper()], events: [event] });
  await browserDb(async (db) => {
    await db.insert(s.beos).values({ eventId: event.id, status: "approved", approvedAt: new Date(), snapshot: {} });
    // The approved version's PDF, saved in Documents by the beo.approved job.
    await db.insert(s.attachments).values({
      documentId: event.id, recordType: "event", recordId: event.id, group: "generated",
      fileName: "BEO.pdf", displayName: "BEO - Fall gala", docType: "beo", protected: true,
      status: "ready", variants: [],
    });
  });
  await page.goto("/#/beos");
  await expect(page.getByRole("heading", { name: "Events", level: 1 })).toBeVisible();
  const row = page.getByRole("row", { name: /Fall gala/ });
  await expect(row).toContainText("Approved");
  await expect(row).toContainText("v1");

  await choose(page.getByRole("combobox", { name: "Status", exact: true }), "draft");
  await expect(page.getByRole("row", { name: /Fall gala/ })).toHaveCount(0);
  await choose(page.getByRole("combobox", { name: "Status", exact: true }), "approved");
  await expect(row).toBeVisible();
  await choose(page.getByRole("combobox", { name: "When" }), "past");
  await expect(page.getByRole("row", { name: /Fall gala/ })).toHaveCount(0);
  await choose(page.getByRole("combobox", { name: "When" }), "upcoming");
  await expect(row).toBeVisible();

  // Open: the side preview.
  await row.getByRole("button", { name: "Open" }).click();
  const preview = page.getByRole("dialog", { name: /Fall gala/ });
  await expect(preview.getByRole("link", { name: "Open in Documents" })).toBeVisible();
  await preview.getByRole("button", { name: "Close dialog" }).click();

  await row.getByRole("link", { name: "BEO - Fall gala" }).click();
  await expect(page).toHaveURL(new RegExp(`#/documents\\?document=${event.id}$`));
  await expect(page.getByRole("dialog", { name: "BEO - Fall gala" })).toBeVisible();
});
