import { eq } from "drizzle-orm";
import { test, expect, mockBrowserAuth } from "./auth-fixture";
import { fallGala, juniper } from "./fixtures";
import { browserDb, seedRecords } from "./database";
import * as s from "../../worker/db/schema";

// Day-of board (FLOW-155) and update log (FLOW-156), phone first.
test.use({ viewport: { width: 390, height: 844 } });

async function seedBoard() {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  return browserDb(async (db) => {
    const [truck] = await db.select().from(s.trucks);
    const [assignment] = await db
      .insert(s.truckAssignments)
      .values({
        truckId: truck.id,
        eventId: fallGala().id,
        departsAt: new Date("2026-11-14T18:00:00.000Z"),
        returnsAt: new Date("2026-11-15T04:00:00.000Z"),
      })
      .returning();
    return { truck, assignment };
  });
}
const board = "/#/day-of?date=2026-11-14";

test("a truck status update appears on another open board (AC1)", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const { truck } = await seedBoard();
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    // Realtime can't connect in the test stack, so the second board refreshes
    // through the 30-second fallback (FLOW-206).
    const watcher = await other.newPage();
    await mockBrowserAuth(watcher);
    await watcher.clock.install();
    await watcher.goto(board);
    const watched = watcher.getByLabel(`${truck.name} status`);
    await expect(watched).toHaveValue("available");

    await page.goto(board);
    await page.getByLabel(`${truck.name} status`).selectOption("en_route");
    await expect(page.getByLabel(`${truck.name} status`)).toHaveValue("en_route");

    await watcher.clock.runFor(31_000);
    await expect(watched).toHaveValue("en_route");
  } finally {
    await other.close();
  }
  const [row] = await browserDb((db) => db.select().from(s.dayOfUpdates));
  expect(row.summary).toContain("Available → En route");
});

test("marking food left kitchen records the time against the timeline (AC2)", async ({ page }) => {
  await seedBoard();
  await page.goto(board);
  await page.getByRole("button", { name: "Mark Food left kitchen" }).click();
  await expect(page.getByText(/^Reached \d{1,2}:\d{2}(am|pm)/)).toBeVisible();
  await expect
    .poll(() =>
      browserDb(async (db) => {
        const [row] = await db
          .select()
          .from(s.dayOfCheckpoints)
          .where(eq(s.dayOfCheckpoints.key, "food_left_kitchen"));
        return row?.reachedAt ?? null;
      }),
    )
    .not.toBeNull();
});

test("the update log shows on the event hub (FLOW-156 AC2)", async ({ page }) => {
  const { truck } = await seedBoard();
  await page.goto(board);
  await page.getByLabel(`${truck.name} status`).selectOption("loading");
  await expect(page.getByLabel(`${truck.name} status`)).toHaveValue("loading");
  await page.goto(`/#/events/${fallGala().id}`);
  await page.getByRole("heading", { name: "Day-of log" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("list", { name: "Day-of log" })).toContainText(`${truck.name}: status: Available → Loading`);
});
