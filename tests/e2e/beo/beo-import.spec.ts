import { Buffer } from "node:buffer";
import { and, eq } from "drizzle-orm";
import { choose } from "../dropdown";
import { test, expect } from "../auth-fixture";
import { fallGala, juniper } from "../fixtures";
import { browserDb, seedRecords } from "../database";
import * as s from "../../../worker/db/schema";
import { syntheticBeoDocx } from "../../fixtures/beo/synthetic-beo";

// FLOW-338: Import BEO on the BEOs tab: pick the event and a Word BEO in the
// template layout (synthetic), review what was read, then confirm. The BEO page
// shows the values and the file is in Documents as the event's BEO. Cancelling
// the review saves nothing.
const file = { name: "synthetic-beo.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from(syntheticBeoDocx()) };

async function openReview(page: import("@playwright/test").Page) {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto("/#/beos");
  await page.getByRole("button", { name: "Import BEO" }).click();
  const drawer = page.getByRole("dialog", { name: "Import BEO" });
  await drawer.getByRole("searchbox").fill("Fall");
  await choose(drawer.getByRole("combobox", { name: "Event" }), fallGala().id);
  await drawer.getByLabel("BEO file").setInputFiles(file);
  await drawer.getByRole("button", { name: "Read file" }).click();
  return page.getByRole("dialog", { name: "Review the import" });
}

test("import → review → confirm: the BEO page shows the values and the file is in Documents", async ({ page }) => {
  const review = await openReview(page);
  // AC1: each section recognized, with where it goes.
  await expect(review.getByRole("textbox", { name: "Client", exact: true })).toHaveValue("Testwood Family");
  await expect(review.getByLabel("menu")).toHaveValue(/Invented roast/);
  await expect(review.getByLabel("drinks")).toHaveValue(/Sample spritz/);
  await expect(review.getByLabel("staff")).toHaveValue(/Captain- Pat Example/);
  await expect(review.getByLabel("Cue 3")).toHaveValue("Guests Arrive");
  // AC3: the unplaced line is listed.
  await expect(review.getByLabel("unrecognized")).toHaveValue("Post event: team unloads the truck");
  // Fix one value and skip one schedule line.
  await review.getByLabel("Cue 4").fill("Toasts and speeches");
  await review.getByRole("checkbox", { name: "Include Leave Warehouse" }).uncheck();
  await review.getByRole("button", { name: "Import BEO" }).click();

  await expect(page).toHaveURL(new RegExp(`#/events/${fallGala().id}/beo/`));
  await expect(page.getByText("Toasts and speeches")).toBeVisible();
  await expect(page.getByText("Leave Warehouse")).toHaveCount(0);
  const documents = await browserDb((db) => db.select().from(s.attachments)
    .where(and(eq(s.attachments.recordId, fallGala().id), eq(s.attachments.docType, "beo"))));
  expect(documents).toHaveLength(1);
});

test("cancelling the review saves nothing (AC4)", async ({ page }) => {
  const review = await openReview(page);
  await review.getByRole("button", { name: "Cancel" }).click();
  await expect(review).toHaveCount(0);
  expect(await browserDb((db) => db.select().from(s.beos))).toHaveLength(0);
});

test("a file that isn't Word or PDF gets a clear error (AC6)", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto("/#/beos");
  await page.getByRole("button", { name: "Import BEO" }).click();
  const drawer = page.getByRole("dialog", { name: "Import BEO" });
  await choose(drawer.getByRole("combobox", { name: "Event" }), fallGala().id);
  await drawer.getByLabel("BEO file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await drawer.getByRole("button", { name: "Read file" }).click();
  await expect(drawer.getByText("Choose a Word (.docx) or PDF file.")).toBeVisible();
});
