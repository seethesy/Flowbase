import type { SiteModule } from "../types.ts";
import { clean, dateOnly, dollars, emailFrom, firstNumber, phoneFrom } from "./fields.ts";
import { logInWithCredentials } from "./login.ts";

const listPath = "/sellers/my-barks/";
export const barkReadSelectors = {
  list: ".responses-projects-item[data-project-id]",
  detail: "#dashboard-project-details[data-project-id]",
  open: ".responses-projects-item[data-project-id]",
} as const;

export function barkModule(baseUrl: string): SiteModule {
  const listUrl = new URL(listPath, baseUrl).href;
  return {
    site: "bark",
    source: "Bark",
    logIn: logInWithCredentials,
    checkLogin: async ({ page, visit }) => {
      await visit(listUrl);
      return (await page.locator('a[href="/sellers/my-barks/#"]').count()) > 0;
    },
    listLeads: async ({ page }) => page.locator(barkReadSelectors.list).evaluateAll((items) =>
      items.map((item) => ({ id: item.getAttribute("data-project-id") ?? "" })).filter((item) => item.id),
    ),
    readLead: async ({ page, selectDetail }, id) => {
      const selected = page.locator(`${barkReadSelectors.detail}[data-project-id="${id}"]`);
      if (!(await selected.count())) {
        if (!selectDetail) throw new Error("Bark detail selection is unavailable.");
        await selectDetail(`${barkReadSelectors.open}[data-project-id="${id}"]`);
        await selected.waitFor();
      }
      const detail = page.locator(barkReadSelectors.detail);
      const text = async (selector: string) => clean(await detail.locator(selector).first().textContent().catch(() => ""));
      const answers = await detail.locator(".project-details .qa-item").evaluateAll((items) =>
        items.map((item) => ({
          question: item.querySelector(".project-details-question")?.textContent?.trim() ?? "",
          answer: item.querySelector(".project-details-answer")?.textContent?.trim() ?? "",
        })),
      );
      const answer = (pattern: RegExp) => clean(answers.find((item) => pattern.test(item.question))?.answer);
      const contact = clean(await detail.innerText());
      const purchased = /Purchased the lead/i.test(contact);
      const guestText = answer(/how many guests|number of guests/i);
      const budgetText = answer(/budget/i);
      return {
        sourceLeadId: id,
        sourceLeadUrl: page.url(),
        purchased,
        name: await text(".buyer_name"),
        phone: purchased ? phoneFrom(contact) : "",
        email: purchased ? emailFrom(contact) : "",
        eventDate: dateOnly(answer(/date of the event|event date/i)),
        guestCount: firstNumber(guestText),
        location: await text(".location"),
        eventType: answer(/kind of event|type of event/i),
        budgetCents: dollars(budgetText),
        message: await text(".additional-details .project-details-answer"),
        raw: { guestText, budgetText, purchased },
      };
    },
  };
}
