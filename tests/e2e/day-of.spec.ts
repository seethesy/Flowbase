import { choose } from "./dropdown";
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
    await expect(watched).toHaveAttribute("data-value", "available");

    await page.goto(board);
    await choose(page.getByLabel(`${truck.name} status`), "en_route");
    await expect(page.getByLabel(`${truck.name} status`)).toHaveAttribute("data-value", "en_route");

    await watcher.clock.runFor(31_000);
    await expect(watched).toHaveAttribute("data-value", "en_route");
  } finally {
    await other.close();
  }
  const [row] = await browserDb((db) => db.select().from(s.dayOfUpdates));
  expect(row.summary).toContain("Available → En route");
});

test("marking food left kitchen records the time against the timeline (AC2)", async ({ page }) => {
  await seedBoard();
  await page.goto(board);
  await page.getByRole("button", { name: "Record Food left kitchen now" }).click();
  await expect(page.getByText(/^Actual \d{1,2}:\d{2} (AM|PM)/)).toBeVisible();
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
  await choose(page.getByLabel(`${truck.name} status`), "loading");
  await expect(page.getByLabel(`${truck.name} status`)).toHaveAttribute("data-value", "loading");
  await page.goto(`/#/events/${fallGala().id}`);
  await page.getByRole("heading", { name: "Day-of log" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("list", { name: "Day-of log" })).toContainText(`${truck.name}: status: Available → Loading`);
});

// FLOW-265: the Events screen's Day-of tab.
test("adds a note to the event's day-of log from its card, and it stays after a reload", async ({ page }) => {
  await seedBoard();
  await page.goto(board);
  await expect(page.getByRole("heading", { name: "Events", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Saturday, November 14/ })).toBeVisible();
  const card = page.getByRole("region", { name: fallGala().title });
  await expect(card).toContainText("120 guests");
  await card.getByRole("textbox", { name: `Note for ${fallGala().title}` }).fill("Guest count changed to 64");
  await card.getByRole("button", { name: "Add", exact: true }).click();
  const log = card.getByRole("list", { name: `${fallGala().title} day-of log` });
  await expect(log).toContainText("Guest count changed to 64");
  await page.reload();
  await expect(page.getByRole("list", { name: `${fallGala().title} day-of log` })).toContainText("Guest count changed to 64");
  const [row] = await browserDb((db) => db.select().from(s.dayOfUpdates).where(eq(s.dayOfUpdates.kind, "note")));
  expect(row).toMatchObject({ summary: "Guest count changed to 64", urgent: false });
});

test("Mark urgent makes that card's updates urgent (A2)", async ({ page }) => {
  const { truck } = await seedBoard();
  await page.goto(board);
  const card = page.getByRole("region", { name: fallGala().title });
  await card.getByRole("button", { name: "Mark urgent" }).click();
  await expect(card.getByRole("button", { name: "Urgent on" })).toHaveAttribute("aria-pressed", "true");
  await choose(card.getByLabel(`${truck.name} status`), "loading");
  await expect(card.getByLabel(`${truck.name} status`)).toHaveAttribute("data-value", "loading");
  await expect.poll(() => browserDb(async (db) => (await db.select().from(s.dayOfUpdates))[0]?.urgent ?? null)).toBe(true);
});

test("the date stepper moves a day at a time and Today comes back", async ({ page }) => {
  await page.goto(board);
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page).toHaveURL(/date=2026-11-15/);
  await page.getByRole("button", { name: "Previous day" }).click();
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(page).toHaveURL(/date=2026-11-13/);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByRole("heading", { name: /· Today$/ })).toBeVisible();
});
