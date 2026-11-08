import { test, expect } from "./auth-fixture";
import { fallGala, juniper } from "./fixtures";
import { seedRecords } from "./database";

// Event timeline and production schedule (FLOW-126): add entries on two days, see
// them in order on the hub, then edit one, on the real Worker and database.

// TEMPORARY: prints what the page showed when this test failed on CI.
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const info = await page
    .evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dialogs: [...document.querySelectorAll("[role=dialog]")].map((d) =>
        (d.textContent ?? "").slice(0, 400),
      ),
      text: document.body.innerText.slice(0, 2500),
    }))
    .catch((e: Error) => ({ error: e.message }));
  console.log(`DIAG ${testInfo.project.name} ${testInfo.title} ${JSON.stringify(info)}`);
});

test("adds timeline entries on two days, shows them in order and edits one", async ({
  page,
}) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto(`/#/events/${fallGala().id}`);
  await expect(
    page.getByRole("heading", { name: "Timeline", exact: true }),
  ).toBeVisible();

  const addEntry = async (
    kind: string,
    day: string,
    start: string,
    end: string,
    activity: string,
  ) => {
    await page.getByRole("button", { name: "Add entry" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Kind").selectOption({ label: kind });
    await dialog.getByLabel("Date").fill(day);
    await dialog.getByLabel("Start time").fill(start);
    await dialog.getByLabel("End time").fill(end);
    await dialog.getByLabel("Activity").fill(activity);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
  };
  await addEntry("Event", "2026-11-14", "21:00", "22:00", "Cake cutting");
  await addEntry("Production", "2026-11-13", "09:00", "11:00", "Pull rentals");
  await addEntry("Event", "2026-11-14", "16:00", "17:30", "Guest arrival");

  const days = page.locator(".timeline-day");
  await expect(days).toHaveCount(2);
  await expect(days.nth(0)).toContainText("Fri, Nov 13, 2026");
  await expect(days.nth(0)).toContainText("Pull rentals");
  await expect(days.nth(1)).toContainText("Sat, Nov 14, 2026");
  await expect(days.nth(1).locator(".timeline-activity")).toHaveText([
    /Guest arrival/,
    /Cake cutting/,
  ]);

  await page.getByRole("button", { name: "Edit Guest arrival" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Activity").fill("Guest arrival and welcome drink");
  await dialog.getByLabel("Who").selectOption({ label: "Role" });
  await dialog.getByLabel("Role", { exact: true }).selectOption("Server");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(days.nth(1)).toContainText("Guest arrival and welcome drink");
  await expect(days.nth(1)).toContainText("Server");
});
