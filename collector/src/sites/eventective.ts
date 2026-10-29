import type { SiteModule } from "../types.ts";
import { clean, dateOnly, emailFrom, firstNumber, phoneFrom } from "./fields.ts";
import { logInWithCredentials } from "./login.ts";

export const eventectiveReadSelectors = {
  row: ".sc-table-content .sc-table-row",
  selected: ".sc-table-content .sc-table-row-selected",
  detail: ".sc-detail-panel",
} as const;

export function eventectiveModule(baseUrl: string): SiteModule {
  const listUrl = new URL("/myeventective/#/crm/Event/LeadMarket", baseUrl).href;
  return {
    site: "eventective",
    source: "Eventective",
    logIn: logInWithCredentials,
    checkLogin: async ({ page, visit }) => {
      await visit(listUrl);
      return (await page.locator('#leadmarket-menu-item').count()) > 0;
    },
    listLeads: async ({ page }) => page.locator(eventectiveReadSelectors.row).evaluateAll((rows) =>
      rows.map((_, index) => ({ id: `row-${index}` })),
    ),
    readLead: async ({ page, selectDetail }, id) => {
      const index = Number(id.replace(/^row-/, ""));
      if (!Number.isInteger(index) || index < 0) throw new Error("Eventective row is invalid.");
      const row = page.locator(eventectiveReadSelectors.row).nth(index);
      if (!(await row.evaluate((item) => item.classList.contains("sc-table-row-selected")))) {
        if (!selectDetail) throw new Error("Eventective detail selection is unavailable.");
        await selectDetail(`${eventectiveReadSelectors.row} >> nth=${index}`);
        await page.waitForFunction((selectedIndex) =>
          document.querySelectorAll(".sc-table-content .sc-table-row")[selectedIndex]?.classList.contains("sc-table-row-selected"), index);
      }
      const selected = page.locator(eventectiveReadSelectors.selected);
      const summary = clean(await selected.locator(".lead-market-table-data").first().textContent());
      const budgetText = clean(await selected.locator(".lead-market-table-data").nth(1).textContent());
      const dateText = clean(await selected.locator(".display-inline-block").first().textContent());
      const panels = await page.locator(eventectiveReadSelectors.detail).allTextContents();
      const inquiry = clean(panels.find((text) => /^\s*Inquiry\b/i.test(text))?.replace(/^\s*Inquiry\s*/i, ""));
      const code = clean(await page.locator(".sc-event-details .fa-hashtag").first().locator("xpath=..").textContent().catch(() => ""));
      if (!code) throw new Error("Eventective lead ID was not visible.");
      const match = summary.match(/^(.*?)\s+-\s+(.*?),\s*([^,]+),\s*([\d,]+)\s+Guests?$/i);
      const contact = clean(panels.join(" "));
      const email = emailFrom(contact);
      const phone = phoneFrom(contact);
      return {
        sourceLeadId: code,
        sourceLeadUrl: page.url(),
        purchased: Boolean(email || phone),
        name: clean(match?.[1]),
        email,
        phone,
        eventDate: dateOnly(dateText.split(" - ")[0]),
        guestCount: firstNumber(match?.[4] ?? ""),
        location: clean(match?.[2]),
        eventType: clean(match?.[3]),
        budgetCents: null,
        message: inquiry,
        raw: { budgetText, dateText },
      };
    },
  };
}
