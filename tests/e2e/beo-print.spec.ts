import { eq } from "drizzle-orm";
import { databaseTest, expect, mockBrowserAuth, test } from "./auth-fixture";
import * as s from "../../worker/db/schema";
import { beoSectionLabels, beoSections } from "../../shared/beo";
import { seedUsers } from "../../worker/db/seed";
import { fallGala, juniper } from "./fixtures";
import { browserDb, seedRecords } from "./database";

// The printable BEO (FLOW-149): sections in order, role-limited contacts, and a
// footer with the BEO status and the time it was printed. Printing is done by the
// browser, so the checks are on the print view as the print stylesheet renders it.

const approvedBeo = async () => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  return browserDb(async (db) => {
    const [beo] = await db
      .insert(s.beos)
      .values({ eventId: fallGala().id, status: "approved", approvedAt: new Date() })
      .returning();
    await db.insert(s.beoAreas).values({ beoId: beo.id, eventId: fallGala().id, kind: "layout", name: "Ballroom" });
    await db.insert(s.beoChecklistItems).values({
      beoId: beo.id,
      eventId: fallGala().id,
      section: "Load-out",
      label: "Strip linens",
    });
    return beo;
  });
};

test("the printed BEO has every section in order and a status and print-time footer", async ({ page }) => {
  await approvedBeo();
  await page.goto(`/#/print/events/${fallGala().id}/beo`);
  await expect(page.getByRole("heading", { name: "Banquet event order", level: 1 })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  // AC1: the same sections as the BEO, in the same order.
  const headings = await page.locator(".beo-print-section > h2").allTextContents();
  expect(headings).toEqual(beoSections.map((section, i) => `${i + 1}. ${beoSectionLabels[section]}`));
  await expect(page.locator(".beo-print-section").nth(0)).toHaveAttribute("data-section", "header");
  await expect(page.getByText("Strip linens")).toBeVisible();
  // The print button is not printed; the footer repeats on every page.
  await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".print-page > tfoot")!).display)).toBe(
    "table-footer-group",
  );
  // AC3: status and print time.
  await expect(page.getByTestId("beo-print-footer")).toHaveText(/BEO status: Approved · Printed at .+/);
  // Full-time Admin sees contact details.
  await expect(page.getByText("olivia@juniper.example").first()).toBeVisible();
});

test("a phone-sized print view does not overflow and the hub links to it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await approvedBeo();
  await page.goto(`/#/events/${fallGala().id}`);
  await page.getByRole("link", { name: "Print" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/print/events/${fallGala().id}/beo$`));
  await expect(page.getByTestId("beo-print-footer")).toBeVisible();
  const wide = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    return [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > limit + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName}.${el.className}:${Math.round(el.getBoundingClientRect().right)}>${limit}`);
  });
  expect(wide).toEqual([]);
});

databaseTest("a part-time user's printout has no client or venue contact details", async ({ page }) => {
  const staff = seedUsers.find((u) => u.role === "staff" && u.employmentType === "part_time")!;
  await approvedBeo();
  await browserDb((db) =>
    db.update(s.events).set({ productionLeadId: staff.id }).where(eq(s.events.id, fallGala().id)),
  );
  await mockBrowserAuth(page, { userId: staff.id });
  await page.goto(`/#/print/events/${fallGala().id}/beo`);
  await expect(page.getByTestId("beo-print-footer")).toBeVisible();
  await expect(page.getByText("Phone numbers and emails are for full-time staff.")).toBeVisible();
  const text = await page.locator(".print-document").innerText();
  expect(text).not.toContain("olivia@juniper.example");
  expect(text).not.toContain("202-555-0101");
});
