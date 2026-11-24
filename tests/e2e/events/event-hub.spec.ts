import { test, expect } from "../auth-fixture";
import { fallGala, juniper } from "../fixtures";
import { seedRecords } from "../database";
import { utcToBusinessTime } from "../../../shared/time";

// The event hub (FLOW-57), reached from the client page and the event list. The
// calendar's way in is in calendar.spec.ts (FLOW-166).
test("the event hub opens from the client page and the event list", async ({
  page,
}) => {
  const event = { ...fallGala(), date: utcToBusinessTime(new Date()).date };
  await seedRecords({ clients: [juniper()], events: [event] });
  await page.goto(`/#/clients/${juniper().id}`);
  await page.getByRole("row", { name: /Fall gala/ }).getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(new RegExp(`#/events/${event.id}$`));
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
  await page.getByRole("row", { name: /Fall gala/ }).getByRole("button", { name: "Open" }).click();
  await expect(
    page.getByRole("heading", { name: "Event files", exact: true }),
  ).toBeVisible();
});

// FLOW-335: Edit turns the event's own fields into inputs in place, in their
// cards, saved with one Save; Status (its own panel) and calculated values stay text.
test("edits the event's fields in place in each card and keeps them after a reload (FLOW-335)", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto(`/#/events/${fallGala().id}`);
  const heading = page.locator(".record-heading");
  await heading.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const card = (name: string) => page.locator("section.panel", { has: page.getByRole("heading", { name, exact: true }) });
  // AC2: Status has no input here.
  await expect(card("Event details").locator("[data-readonly]", { hasText: "Status" })).toBeVisible();

  await heading.getByRole("textbox", { name: "Title" }).fill("Fall gala dinner");
  await card("Event details").getByLabel("End time").fill("22:30");
  await card("Event details").getByRole("textbox", { name: "Address" }).fill("1 Elm St, Arlington, VA");
  await card("Event details").getByRole("spinbutton", { name: "Guests" }).fill("150");
  // An input with suggestions (a datalist) is a combobox.
  await card("Event details").getByRole("combobox", { name: "Dress code" }).fill("Black tie");
  await card("Event details").getByLabel("Arrival at venue").fill("15:00");
  await card("Event details").getByRole("textbox", { name: "Areas, one per line" }).fill("Ballroom\nTerrace");
  await card("Notes").getByRole("textbox", { name: "Internal" }).fill("Loading dock on the left.");
  await heading.getByRole("button", { name: "Save", exact: true }).click();
  await expect(heading.getByRole("button", { name: "Edit", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Fall gala dinner", level: 1 })).toBeVisible();
  const details = card("Event details");
  await expect(details).toContainText("10:30");
  await expect(details).toContainText("1 Elm St, Arlington, VA");
  await expect(details).toContainText("150");
  await expect(details).toContainText("Black tie");
  await expect(details).toContainText("3:00");
  await expect(details).toContainText("Ballroom, Terrace");
  await expect(card("Notes")).toContainText("Loading dock on the left.");
});

test("Cancel on the event page discards the changes in every card (FLOW-335 AC3)", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto(`/#/events/${fallGala().id}`);
  const heading = page.locator(".record-heading");
  await heading.getByRole("button", { name: "Edit", exact: true }).click();
  await heading.getByRole("textbox", { name: "Title" }).fill("Renamed");
  await page.getByRole("textbox", { name: "Address" }).fill("Elsewhere");
  await page.getByRole("textbox", { name: "Transportation" }).fill("Truck");
  page.once("dialog", (dialog) => dialog.accept());
  await heading.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fall gala", level: 1 })).toBeVisible();
  const details = page.locator("section.panel", { has: page.getByRole("heading", { name: "Event details", exact: true }) });
  await expect(details.getByText("100 Garden Way, Arlington, VA", { exact: true })).toBeVisible();
  await expect(page.getByText("Elsewhere")).toHaveCount(0);
  await expect(page.getByText("Truck", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Fall gala", level: 1 })).toBeVisible();
  await expect(details.getByText("100 Garden Way, Arlington, VA", { exact: true })).toBeVisible();
});
