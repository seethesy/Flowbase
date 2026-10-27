import { test, expect } from "./auth-fixture";
import { juniper } from "./fixtures";
import { seedRecords } from "./database";

test("client create, edit, archive and restore", async ({ page }) => {
  await seedRecords();
  await page.goto("/#/clients");
  await page.getByRole("button", { name: "New Client", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save client" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Name is required");
  await dialog.getByLabel("Name *", { exact: true }).fill("Orchard Events");
  await dialog
    .getByLabel("Contact name *", { exact: true })
    .fill("Avery Stone");
  await dialog
    .getByLabel("Email", { exact: true })
    .fill("avery@orchard.example");
  await dialog.getByRole("button", { name: "Save client" }).click();
  await expect(
    page.getByRole("heading", { name: "Orchard Events", level: 1 }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name *", { exact: true })
    .fill("Orchard Events Co.");
  await page.getByRole("button", { name: "Save client" }).click();
  await expect(
    page.getByRole("heading", { name: "Orchard Events Co.", level: 1 }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(
    page.getByRole("heading", { name: "Clients", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Orchard Events Co.")).toHaveCount(0);
  await page.getByLabel("Show archived").check();
  await page
    .getByRole("button", { name: "OE Orchard Events Co.", exact: true })
    .click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText("Archived", { exact: true })).toHaveCount(0);
});

test("event created at a venue picks up its address and areas, then edits", async ({
  page,
}) => {
  await seedRecords({ clients: [juniper()] });
  await page.goto("/#/venues");
  await page.getByRole("button", { name: "New Venue", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name *", { exact: true }).fill("The Glasshouse");
  await dialog
    .getByLabel("Address", { exact: true })
    .fill("100 Garden Way, Arlington, VA");
  await dialog.getByLabel("Jurisdiction").selectOption("VA");
  await dialog.getByRole("button", { name: "Add area" }).click();
  await dialog.getByLabel("Area 1", { exact: true }).fill("Inside Tent");
  await dialog.getByRole("button", { name: "Add area" }).click();
  await dialog.getByLabel("Area 2", { exact: true }).fill("Outside Tent");
  await dialog.getByRole("button", { name: "Save venue" }).click();
  await expect(
    page.getByRole("heading", { name: "The Glasshouse", level: 1 }),
  ).toBeVisible();

  await page.goto("/#/events");
  await page.getByRole("button", { name: "New Event", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title *", { exact: true }).fill("Fall gala");
  await dialog.getByLabel("Date *", { exact: true }).fill("2026-11-14");
  await dialog.getByLabel("Start time *", { exact: true }).fill("18:00");
  // A label that wraps a <select> also contains its option text, so match the
  // start of the label instead of the whole string.
  await dialog
    .getByLabel(/^Client \*/)
    .selectOption({ label: "Juniper & Co." });
  await dialog.getByLabel(/^Venue/).selectOption({ label: "The Glasshouse" });
  await dialog.getByRole("button", { name: "Save event" }).click();
  await expect(
    page.getByRole("heading", { name: "Fall gala", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("100 Garden Way, Arlington, VA")).toBeVisible();
  await expect(page.getByText("Inside Tent, Outside Tent")).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Guest count", { exact: true }).fill("120");
  // Status changes on the event page, not in the edit form (FLOW-56).
  await expect(dialog.getByLabel(/^Status/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Save event" }).click();
  await expect(page.getByText("120", { exact: true })).toBeVisible();

  await page.getByLabel(/^New status/).selectOption("lost");
  await page.getByLabel("Why (optional)").fill("Went with another caterer");
  await page.getByRole("button", { name: "Change status" }).click();
  await expect(page.getByText("Lost").first()).toBeVisible();
  const history = page.getByRole("list", { name: "Status history" });
  await expect(history.getByText("Inquiry → Lost")).toBeVisible();
  await expect(history.getByText("Went with another caterer")).toBeVisible();
});
