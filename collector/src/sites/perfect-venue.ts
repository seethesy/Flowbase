import type { SiteModule } from "../types.ts";
import { clean, dateOnly, dollars, emailFrom, firstNumber, phoneFrom } from "./fields.ts";
import { logInWithCredentials } from "./login.ts";

export const perfectVenueReadSelectors = {
  row: '[data-cy="events-table"] .MuiDataGrid-row[data-id]',
  detail: '[data-cy="event-drawer"]',
} as const;

export function perfectVenueModule(baseUrl: string): SiteModule {
  const listUrl = new URL("/events", baseUrl).href;
  return {
    site: "perfect_venue",
    source: "Perfect Venue",
    logIn: logInWithCredentials,
    checkLogin: async ({ page, visit }) => {
      await visit(listUrl);
      return (await page.locator('[data-cy="events-page"]').count()) > 0;
    },
    listLeads: async ({ page }) => page.locator(perfectVenueReadSelectors.row).evaluateAll((rows) =>
      rows.filter((row) => row.querySelector('[data-field="status"]')?.textContent?.trim() === "Lead")
        .map((row) => ({ id: row.getAttribute("data-id") ?? "" })).filter((row) => row.id),
    ),
    readLead: async ({ page, visit }, id) => {
      const sourceLeadUrl = new URL(`/events/${encodeURIComponent(id)}`, baseUrl).href;
      await visit(sourceLeadUrl);
      const detail = page.locator(perfectVenueReadSelectors.detail);
      await detail.waitFor();
      const input = async (selector: string) => {
        const field = detail.locator(selector).first();
        return (await field.count()) ? clean(await field.inputValue()) : "";
      };
      const text = async (selector: string) => {
        const field = detail.locator(selector).first();
        return (await field.count()) ? clean(await field.innerText()) : "";
      };
      const contact = await text('[data-cy="contact-item"]');
      const startTime = await text('[data-cy="event-page-start-time"] [role="combobox"]');
      const endTime = await text('[data-cy="event-page-end-time"] [role="combobox"]');
      const budgetText = await input('input[name="budget"]');
      const guestText = await input('input[name="groupSize"]');
      return {
        sourceLeadId: id,
        sourceLeadUrl,
        purchased: true,
        name: await text('[data-cy="contact-item"] h6'),
        email: emailFrom(contact),
        phone: phoneFrom(contact),
        eventDate: dateOnly(await input('[data-cy="event-page-date"] input')),
        guestCount: firstNumber(guestText),
        location: await input('input[name]:not([name="budget"]):not([name="groupSize"]):not([name="space"]):not([name="eventTypeName"])'),
        eventType: await input('input[name="eventTypeName"]'),
        budgetCents: dollars(budgetText),
        message: clean(await page.locator('[data-cy="message-body"]').first().innerText().catch(() => "")),
        raw: { startTime, endTime, budgetText },
      };
    },
  };
}
