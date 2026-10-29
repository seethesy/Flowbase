import { test, expect } from "./auth-fixture";
import { fallGala, juniper } from "./fixtures";
import { seedRecords } from "./database";

// The event hub (FLOW-57), reached from the client page and the event list. The
// calendar's way in is in calendar.spec.ts (FLOW-166).
test("the event hub opens from the client page and the event list", async ({
  page,
}) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
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
