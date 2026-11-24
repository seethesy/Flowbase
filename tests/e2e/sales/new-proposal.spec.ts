import { eq } from "drizzle-orm";
import { choose } from "../dropdown";
import { test, expect } from "../auth-fixture";
import { fallGala, juniper } from "../fixtures";
import { browserDb, seedRecords } from "../database";
import { proposals } from "../../../worker/db/schema";

// FLOW-336 AC2: New proposal on the Proposals library creates the proposal for
// the chosen event; it shows on the event. (With a first-version file it is also
// listed in the library, as any uploaded version is.)
test("New proposal for a chosen event creates it and it shows on the event", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto("/#/proposals");
  await page.getByRole("button", { name: "New proposal" }).click();
  const drawer = page.getByRole("dialog", { name: "New proposal" });
  await drawer.getByRole("searchbox").fill("Fall");
  await choose(drawer.getByRole("combobox", { name: "Event" }), fallGala().id);
  await expect(drawer.getByLabel("Title")).toHaveValue("Fall gala");
  await drawer.getByLabel("Title").fill("Gala menu proposal");
  await drawer.getByRole("button", { name: "Save proposal" }).click();
  await expect(drawer).toHaveCount(0);

  const [row] = await browserDb((db) => db.select().from(proposals).where(eq(proposals.title, "Gala menu proposal")));
  expect(row.eventId).toBe(fallGala().id);
  await page.goto(`/#/events/${fallGala().id}`);
  await expect(page.getByText("Gala menu proposal")).toBeVisible();
});
