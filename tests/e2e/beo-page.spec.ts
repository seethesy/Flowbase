import { test, expect } from "./auth-fixture";
import * as s from "../../worker/db/schema";
import { fallGala, juniper } from "./fixtures";
import { browserDb, seedRecords } from "./database";

// The BEO's own page (FLOW-221), where time is credited to the BEO.
test("the hub links to the BEO page, which refuses another BEO's id", async ({
  page,
}) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  const [beo] = await browserDb((db) =>
    db.insert(s.beos).values({ eventId: fallGala().id }).returning(),
  );
  await page.goto(`/#/events/${fallGala().id}`);
  await page.getByRole("link", { name: "Open BEO page" }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${fallGala().id}/beo/${beo.id}$`));
  await expect(
    page.getByRole("heading", { name: "Fall gala", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Banquet event order").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open BEO page" })).toHaveCount(0);

  await page.goto(
    `/#/events/${fallGala().id}/beo/b0000000-0000-4000-8000-0000000000ff`,
  );
  await expect(page.getByRole("alert")).toHaveText("BEO not found.");
});
