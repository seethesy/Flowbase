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

// FLOW-288: select BEOs, Delete skips the approved one with its reason, and
// Ctrl+Z brings the deleted one back.
test("deletes BEOs that aren't approved, and Ctrl+Z restores them", async ({ page }) => {
  const date = addLocalDays(utcToBusinessTime(new Date()).date, 10);
  const draft = { ...fallGala(), date };
  const signed = { ...fallGala(), id: "e0000000-0000-4000-8000-000000002881", title: "Winter dinner", date };
  await seedRecords({ clients: [juniper()], events: [draft, signed] });
  await browserDb(async (db) => {
    await db.insert(s.beos).values([
      { eventId: draft.id, status: "working_on", snapshot: {} },
      { eventId: signed.id, status: "approved", approvedAt: new Date(), snapshot: {} },
    ]);
  });
  await page.goto("/#/beos");
  const draftRow = page.getByRole("row", { name: /Fall gala/ });
  const signedRow = page.getByRole("row", { name: /Winter dinner/ });
  await expect(draftRow).toBeVisible();
  await expect(signedRow).toBeVisible();

  await draftRow.getByRole("cell").nth(1).click({ modifiers: ["ControlOrMeta"] });
  await signedRow.getByRole("cell").nth(1).click({ modifiers: ["ControlOrMeta"] });
  const bar = page.getByRole("region", { name: "Selected rows" });
  await expect(bar).toContainText("2 selected");
  await bar.getByRole("button", { name: "Delete" }).click();

  const toast = page.getByRole("status").filter({ hasText: "deleted." });
  await expect(toast).toContainText("1 deleted.");
  await expect(toast).toContainText("BEO: Winter dinner has an approved BEO");
  await expect(draftRow).toHaveCount(0);
  await expect(signedRow).toBeVisible();

  await page.keyboard.press("ControlOrMeta+z");
  await expect(draftRow).toBeVisible();
  await expect(draftRow).toContainText("Draft");
});
