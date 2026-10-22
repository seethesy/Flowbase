import { test, expect } from "@playwright/test";
import { fallGala, juniper, mockAttachmentsApi, mockRecordsApi } from "./mock-api";

// The event hub (FLOW-57). The calendar (FLOW-63) doesn't exist yet, so the hub is
// reached from the client page and the event list.
test("the event hub opens from the client page and the event list", async ({
  page,
}) => {
  await mockRecordsApi(page, { clients: [juniper()], events: [fallGala()] });
  await mockAttachmentsApi(page);
  await page.goto(`/#/clients/${juniper().id}`);
  await page.getByRole("button", { name: "Fall gala", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/events/${fallGala().id}$`));
  await expect(
    page.getByRole("heading", { name: "Fall gala", level: 1 }),
  ).toBeVisible();
  for (const section of ["Event details", "Client", "Event files"])
    await expect(
      page.getByRole("heading", { name: section, exact: true }),
    ).toBeVisible();
  await expect(
    page.getByText("Olivia Bennett (point of contact)", { exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Open client" }).click();
  await expect(
    page.getByRole("heading", { name: "Juniper & Co.", level: 1 }),
  ).toBeVisible();

  await page.goto("/#/events");
  await page.getByRole("button", { name: "Fall gala", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Event files", exact: true }),
  ).toBeVisible();
});
