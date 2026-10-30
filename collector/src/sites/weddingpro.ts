import type { SiteModule } from "../types.ts";
import { clean, dateOnly, dollars, emailFrom, firstNumber, phoneFrom } from "./fields.ts";
import { logInWithCredentials } from "./login.ts";

export const weddingProReadSelectors = {
  list: '[data-component="LeadListItem"][data-track-cds]',
  details: '[data-component="WeddingDetails"]',
} as const;

export function weddingProModule(baseUrl: string): SiteModule {
  const inbox = new URL("/inbox", baseUrl);
  return {
    site: "weddingpro",
    source: "WeddingPro",
    logIn: logInWithCredentials,
    checkLogin: async ({ page, visit }) => {
      await visit(inbox.href);
      return (await page.locator('a[data-test-selector="top-nav-inbox"]').count()) > 0;
    },
    listLeads: async ({ page }) => page.locator(weddingProReadSelectors.list).evaluateAll((items) =>
      items.flatMap((item) => {
        try {
          const value = JSON.parse(item.getAttribute("data-track-cds") ?? "{}");
          return value.brand_code && value.lead_id
            ? [{ id: `${value.brand_code}:${value.lead_id}` }]
            : [];
        } catch { return []; }
      }),
    ),
    readLead: async ({ page, visit }, id) => {
      const [brand, leadId] = id.split(":", 2);
      if (!brand || !leadId) throw new Error("WeddingPro lead ID is invalid.");
      const inboxHref = await page.locator('a[data-test-selector="top-nav-inbox"]').first().getAttribute("href");
      const storefrontSearch = new URL(inboxHref ?? "/inbox", baseUrl).search;
      const sourceLeadUrl = new URL(`/inbox/${encodeURIComponent(brand)}/${encodeURIComponent(leadId)}${storefrontSearch}`, baseUrl).href;
      await visit(sourceLeadUrl);
      await page.locator(weddingProReadSelectors.details).waitFor();
      const rows = await page.locator(`${weddingProReadSelectors.details} [data-component="renderDetailRowContent"]`).evaluateAll((items) =>
        items.map((item) => ({
          label: item.parentElement?.querySelector("div")?.textContent?.trim() ?? "",
          value: item.textContent?.trim() ?? "",
        })),
      );
      const value = (label: string) => clean(rows.find((row) => row.label.toLowerCase() === label)?.value);
      const contact = clean(await page.locator('[data-component="MoreInfo"]').first().textContent().catch(() => ""));
      const messages = await page.locator('[data-component="LeadDetails"] [data-test-selector="lead-message-body"]').allTextContents();
      const name = clean(await page.locator(".rightRail .fontWeightBolder").first().textContent().catch(() => ""));
      const guestText = value("number of guests");
      return {
        sourceLeadId: id,
        sourceLeadUrl,
        purchased: true,
        name,
        email: emailFrom(contact.match(/Personal email\s*([^\s]+)/i)?.[1] ?? ""),
        phone: phoneFrom(clean(await page.locator(".rightRail").first().textContent().catch(() => ""))),
        eventDate: dateOnly(value("wedding date")),
        guestCount: firstNumber(guestText),
        location: value("wedding location"),
        eventType: value("event type") || "Wedding",
        budgetCents: dollars(value("budget")),
        message: clean(messages[0]),
        raw: { guestText, brand },
      };
    },
  };
}
