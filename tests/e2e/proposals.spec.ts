import { test, expect } from "./auth-fixture";
import { fallGala, juniper } from "./fixtures";
import { seedRecords } from "./database";
import { docxExportHint } from "../../shared/proposals";

// Proposals on the event hub (FLOW-122/123), as the seeded Admin on the real Worker
// and database: create one, move its manual stages, refuse a PDF-only upload
// before anything is sent, and lose it, which loses the event too.

test("tracks a proposal's stages and loses the event with its last proposal", async ({
  page,
}) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto(`/#/events/${fallGala().id}`);
  await expect(
    page.getByRole("heading", { name: "Proposals", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No proposals yet.")).toBeVisible();

  await page.getByRole("button", { name: "New proposal" }).click();
  const form = page.getByRole("dialog", { name: "New proposal" });
  await expect(form.getByLabel("Title *")).toHaveValue("Fall gala");
  await form.getByLabel("Title *").fill("Gala dinner");
  await form.getByRole("button", { name: "Save proposal" }).click();

  const drawer = page.getByRole("dialog", { name: "Gala dinner" });
  await expect(drawer).toBeVisible();
  const history = drawer.getByRole("list", { name: "Stage history" });
  await expect(history).toContainText("Created in Client communication");

  // AC1: Finalized, Approved, Sent and Signed are never offered by hand.
  const stage = drawer.getByLabel("Move to stage");
  for (const name of ["Finalized", "Approved", "Sent", "Signed"])
    await expect(stage.locator("option", { hasText: name })).toHaveCount(0);
  await stage.selectOption({ label: "Menu curation" });
  await expect(history).toContainText("Client communication → Menu curation");
  await stage.selectOption({ label: "Revisions" });
  await expect(history).toContainText("Menu curation → Revisions");

  // FLOW-123 AC3: a PDF alone is refused with the export hint; nothing uploads.
  let versionRequests = 0;
  page.on("request", (request) => {
    if (/\/api\/proposals\/[^/]+\/versions/.test(request.url()))
      versionRequests += 1;
  });
  await drawer.getByLabel("Upload version (.docx, optional PDF)").setInputFiles({
    name: "Gala dinner.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n"),
  });
  await expect(drawer.getByRole("alert")).toHaveText(docxExportHint);
  expect(versionRequests).toBe(0);
  await expect(drawer.getByText("No versions uploaded yet.")).toBeVisible();

  // AC2: Lost needs a reason, and the event's only proposal takes the event along.
  await stage.selectOption({ label: "Lost" });
  await drawer.getByRole("button", { name: "Mark lost" }).click();
  await expect(drawer.getByRole("alert")).toHaveText(
    "Enter why the proposal was lost.",
  );
  await drawer.getByLabel("Why was it lost? *").fill("Booked another caterer");
  await drawer.getByRole("button", { name: "Mark lost" }).click();
  await expect(drawer.getByText("Lost: Booked another caterer")).toBeVisible();
  await expect(history).toContainText("Revisions → Lost");
  await expect(drawer.getByLabel("Move to stage")).toHaveCount(0);
  await drawer.getByRole("button", { name: "Close dialog" }).click();

  const row = page.getByRole("listitem", { name: "Gala dinner" });
  await expect(row).toContainText("Lost");
  await expect(row).toContainText("No version yet");
  await expect(
    page.locator(".record-heading").getByText("Lost", { exact: true }),
  ).toBeVisible();
});
