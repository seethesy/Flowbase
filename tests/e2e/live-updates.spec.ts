import { databaseTest as test, expect, mockBrowserAuth } from "./auth-fixture";
import { seedDatabase, seedId } from "../../worker/db/seed";

// FLOW-206 AC1/AC2: a venue page left open in one browser shows a change saved
// in another, with no reload or navigation. Realtime can't connect in the test
// stack (no Supabase project), so this goes through the 30-second fallback.
test("an open venue page shows another session's saved change", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  await seedDatabase(process.env.DATABASE_URL);
  const note = "Loading dock on the north side";
  await mockBrowserAuth(page);
  await page.clock.install();
  await page.goto(`/#/venues/${seedId(5, 1)}`);
  await expect(
    page.getByRole("heading", { name: "The Glasshouse", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText(note, { exact: true })).toHaveCount(0);

  const other = await browser.newContext();
  try {
    const editor = await other.newPage();
    await mockBrowserAuth(editor);
    await editor.goto(`/#/venues/${seedId(5, 1)}`);
    await editor.getByRole("button", { name: "Edit", exact: true }).click();
    await editor.getByRole("dialog").getByLabel("Parking notes").fill(note);
    await editor.getByRole("button", { name: "Save venue" }).click();
    await expect(editor.getByRole("dialog")).toHaveCount(0);
    await expect(editor.getByText(note, { exact: true })).toBeVisible();
  } finally {
    await other.close();
  }

  // Not yet: the first page hasn't polled.
  await expect(page.getByText(note, { exact: true })).toHaveCount(0);
  await page.clock.runFor(31_000);
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The Glasshouse", level: 1 }),
  ).toBeVisible();
});
