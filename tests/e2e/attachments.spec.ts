import { test, expect, type Page } from "./auth-fixture";
import { mockAttachmentsApi, mockRecordsApi } from "./mock-api";

const openNewVenue = async (page: Page) => {
  await page.goto("/#/venues");
  await page.getByRole("button", { name: "New Venue", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name *", { exact: true })
    .fill("The Glasshouse");
  await page.getByRole("button", { name: "Save venue" }).click();
  await expect(
    page.getByRole("heading", { name: "The Glasshouse", level: 1 }),
  ).toBeVisible();
};

test("a large phone photo is resized in the browser and only the resized copies upload", async ({
  page,
}) => {
  await mockRecordsApi(page);
  const r2 = await mockAttachmentsApi(page);
  await openNewVenue(page);
  // A noisy 2400×1500 PNG compresses badly, like a ~10 MB phone photo.
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1500;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 1)
      pixels.data[index] = index % 4 === 3 ? 255 : Math.random() * 256;
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const original = Buffer.from(base64, "base64");
  expect(original.length).toBeGreaterThan(8 * 1024 * 1024);
  await page.getByLabel("Add to Floor plans").setInputFiles({
    name: "IMG_0042.png",
    mimeType: "image/png",
    buffer: original,
  });
  await expect(page.getByRole("img", { name: "IMG_0042.png" })).toBeVisible();
  expect(r2.puts.map((put) => put.key.split("/")[1]).sort()).toEqual([
    "display",
    "thumb",
  ]);
  for (const put of r2.puts) {
    expect(put.type).toBe("image/jpeg");
    expect(put.size).toBeLessThan(original.length / 4);
  }
});

test("unsupported files are rejected before anything uploads", async ({
  page,
}) => {
  await mockRecordsApi(page);
  const r2 = await mockAttachmentsApi(page);
  await openNewVenue(page);
  await page.getByLabel("Add to Aerial images").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a photo"),
  });
  await expect(page.getByRole("alert")).toContainText("Only photos");
  expect(r2.starts()).toBe(0);
  expect(r2.puts).toEqual([]);
});
