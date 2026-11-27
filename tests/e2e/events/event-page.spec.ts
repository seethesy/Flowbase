import { databaseTest, expect, mockBrowserAuth, test, type Page } from "../auth-fixture";
import { fallGala, juniper } from "../fixtures";
import { seedRecords } from "../database";
import { seedUsers } from "../../../worker/db/seed";

// FLOW-350: the event page links the client, changes the status under the
// title (the Status card is gone) and folds every card. These specs check the
// real fold defaults.
test.use({ openCards: false });

const card = (page: Page, title: string) =>
  page.locator("section.panel", { has: page.getByRole("heading", { name: title, exact: true }) });

test("the client's name opens the client's page (AC1)", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto(`/#/events/${fallGala().id}`);
  await card(page, "Event details").getByRole("link", { name: "Juniper & Co." }).click();
  await expect(page).toHaveURL(new RegExp(`#/clients/${juniper().id}$`));
  await page.goBack();
  await card(page, "Client").getByRole("link", { name: "Juniper & Co." }).click();
  await expect(page).toHaveURL(new RegExp(`#/clients/${juniper().id}$`));
});

test("the status changes in the dropdown under the title; the Status card is gone (AC2)", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto(`/#/events/${fallGala().id}`);
  await expect(page.getByRole("heading", { name: "Status", exact: true })).toHaveCount(0);
  const status = page.locator(".record-heading").getByRole("combobox", { name: "Event status" });
  await expect(status).toHaveAttribute("data-value", "closed");
  const saved = page.waitForResponse((response) =>
    response.url().endsWith(`/api/events/${fallGala().id}/status`) && response.request().method() === "POST");
  await status.click();
  await page.getByRole("listbox").last().getByRole("option", { name: "Preparation", exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(status).toHaveAttribute("data-value", "preparation");
  await page.reload();
  await expect(status).toHaveAttribute("data-value", "preparation");
  // The history is in the History card (A1).
  await card(page, "History").getByRole("button", { name: "Unfold History" }).click();
  await expect(page.getByRole("list", { name: "Status history" }).getByText("Closed → Preparation")).toBeVisible();
});

databaseTest("a viewer who may not change the status sees the plain pill (AC2)", async ({ page }) => {
  const manager = seedUsers.find((u) => u.role === "sales_manager")!;
  await mockBrowserAuth(page, { userId: manager.id });
  await seedRecords({ clients: [juniper()], events: [{ ...fallGala(), assignedSalespersonId: null }] });
  await page.goto(`/#/events/${fallGala().id}`);
  const heading = page.locator(".record-heading");
  await expect(heading.getByRole("heading", { name: "Fall gala", level: 1 })).toBeVisible();
  await expect(heading.locator(".status-pill")).toHaveText("Closed");
  await expect(heading.getByRole("combobox", { name: "Event status" })).toHaveCount(0);
});

test("Event details, Notes, Client and Proposals start open; the other cards start folded (AC3)", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto(`/#/events/${fallGala().id}`);
  for (const title of ["Event details", "Notes", "Client", "Proposals"])
    await expect(card(page, title).getByRole("button", { name: `Fold ${title}` })).toHaveAttribute("aria-expanded", "true");
  for (const title of ["Event files", "History"])
    await expect(card(page, title).getByRole("button", { name: `Unfold ${title}` })).toHaveAttribute("aria-expanded", "false");
  // Each folds and unfolds with its arrow.
  await card(page, "Notes").getByRole("button", { name: "Fold Notes" }).click();
  await expect(card(page, "Notes").getByText("Internal")).toBeHidden();
  await card(page, "Event files").getByRole("button", { name: "Unfold Event files" }).click();
  await expect(card(page, "Event files").getByRole("button", { name: "Fold Event files" })).toHaveAttribute("aria-expanded", "true");
});
