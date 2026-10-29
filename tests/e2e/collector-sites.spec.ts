import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { barkModule, barkReadSelectors } from "../../collector/src/sites/bark.ts";
import { perfectVenueModule, perfectVenueReadSelectors } from "../../collector/src/sites/perfect-venue.ts";
import { weddingProModule, weddingProReadSelectors } from "../../collector/src/sites/weddingpro.ts";
import { eventectiveModule, eventectiveReadSelectors } from "../../collector/src/sites/eventective.ts";
import { leadRecordId } from "../../collector/src/ingest.ts";
import { logInWithCredentials } from "../../collector/src/sites/login.ts";
import type { SiteContext } from "../../collector/src/types.ts";

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop" || browserName !== "chromium", "Runs once in Chromium.");
});

async function fixture(page: SiteContext["page"], site: string, name: "leads" | "lead") {
  await page.setContent(await readFile(`collector/fixtures/${site}/${name}.html`, "utf8"));
}

function context(page: SiteContext["page"], site: string): SiteContext {
  return { page, visit: async (url) => fixture(page, site, url.includes("/events/") || url.includes("/inbox/tk/") ? "lead" : "leads") };
}

test("Bark lists stable IDs and preserves the purchased gate", async ({ page }) => {
  const module = barkModule("https://bark.example");
  const site = context(page, "bark");
  expect(await module.checkLogin(site)).toBe(true);
  const listed = await module.listLeads(site, null);
  expect(listed.length).toBeGreaterThan(1);
  expect(new Set(listed.map((lead) => lead.id)).size).toBe(listed.length);
  const selected = await page.locator(barkReadSelectors.detail).getAttribute("data-project-id");
  const bought = await module.readLead(site, selected!);
  expect(bought).toMatchObject({ sourceLeadId: selected, purchased: true, name: "Morgan", guestCount: 20, eventDate: "2027-02-13", email: "client1@example.com" });
  await page.locator("#dashboard-project-details .item-message").filter({ hasText: "Purchased the lead" }).evaluateAll((items) => items.forEach((item) => item.remove()));
  const unbought = await module.readLead(site, selected!);
  expect(unbought).toMatchObject({ purchased: false, email: "", phone: "" });
});

test("Perfect Venue maps a lead and reuses its source ID after an update", async ({ page }) => {
  const module = perfectVenueModule("https://venue.example");
  const site = context(page, "perfect-venue");
  expect(await module.checkLogin(site)).toBe(true);
  const listed = await module.listLeads(site, null);
  expect(listed.length).toBeGreaterThan(1);
  expect(new Set(listed.map((lead) => lead.id)).size).toBe(listed.length);
  const id = listed[0].id;
  const original = await module.readLead(site, id);
  expect(original).toMatchObject({ sourceLeadId: id, name: "Kendall Dummy", email: "client1@example.com", guestCount: 100, budgetCents: 1_500_000, eventType: "Wedding" });
  await page.locator(`${perfectVenueReadSelectors.detail} input[name="groupSize"]`).evaluate((input: HTMLInputElement) => { input.value = "120"; });
  const updated = await module.readLead({ ...site, visit: async () => undefined }, id);
  expect(updated.sourceLeadId).toBe(original.sourceLeadId);
  expect(leadRecordId("perfect_venue", id, original)).not.toBe(leadRecordId("perfect_venue", id, updated));
});

test("WeddingPro reads inbox IDs and wedding details", async ({ page }) => {
  const module = weddingProModule("https://wedding.example");
  const site = context(page, "weddingpro");
  expect(await module.checkLogin(site)).toBe(true);
  const listed = await module.listLeads(site, null);
  expect(listed.length).toBeGreaterThan(1);
  expect(new Set(listed.map((lead) => lead.id)).size).toBe(listed.length);
  const lead = await module.readLead(site, listed[0].id);
  expect(lead).toMatchObject({ eventType: "Wedding", eventDate: "2027-05-08", guestCount: 101, email: "placeholder.personal.2@example.com" });
});

test("Eventective reads a selected lead without purchase or reply actions", async ({ page }) => {
  const module = eventectiveModule("https://event.example");
  const site = context(page, "eventective");
  expect(await module.checkLogin(site)).toBe(true);
  const listed = await module.listLeads(site, null);
  expect(listed.length).toBeGreaterThan(1);
  await fixture(page, "eventective", "lead");
  const selectedIndex = await page.locator(eventectiveReadSelectors.row).evaluateAll((rows) => rows.findIndex((row) => row.classList.contains("sc-table-row-selected")));
  const lead = await module.readLead(site, `row-${selectedIndex}`);
  expect(lead).toMatchObject({ sourceLeadId: "EHDOFRGT", name: "Casey", guestCount: 80, eventType: "Memorial Service", eventDate: "2026-11-08", purchased: false });
});

test("site detail selectors exclude purchase, reply, dismissal and status controls", () => {
  const selectors = [barkReadSelectors, perfectVenueReadSelectors, weddingProReadSelectors, eventectiveReadSelectors]
    .flatMap((site) => Object.values(site));
  expect(selectors.join(" ")).not.toMatch(/purchase|buy|reply|send|dismiss|archive|decline|accept|status/i);
});

test("login never submits a page without a password form", async ({ page }) => {
  await page.setContent('<button type="submit">Purchase Lead</button><input type="email" name="email">');
  await expect(logInWithCredentials({ page, visit: async () => undefined, credentials: { username: "collector@example.com", password: "example" } })).rejects.toThrow("supported login form");
  expect(await page.locator('input[name="email"]').inputValue()).toBe("collector@example.com");
});
