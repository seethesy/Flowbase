import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "../auth-fixture";
import { choose } from "../dropdown";
import type { Photo } from "../../../shared/photos";

// Photo galleries (FLOW-271, FLOW-298). R2 transport and the photo API are
// mocked with synthetic photos; the app's own screens and upload code run as is.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const now = "2026-11-20T15:00:00.000Z";
const avery = "71000000-0000-4000-8000-0000000000a1";
const blake = "71000000-0000-4000-8000-0000000000a2";

// The mock serves each photo's links from the app's own origin.
const links = (origin: string, id: string) => ({
  thumb: `${origin}/r2-mock/${id}/thumb.jpg`,
  display: `${origin}/r2-mock/${id}/display.jpg`,
});
function synthetic(overrides: Partial<Photo> & { id: string; title: string }): Photo {
  return {
    attachmentId: overrides.id,
    label: "",
    fileName: `${overrides.title}.jpg`,
    recordType: "event",
    recordId: randomUUID(),
    area: null,
    eventId: null,
    eventTitle: null,
    tags: [],
    approvedForMarketing: false,
    date: "2026-11-20",
    uploadedBy: avery,
    uploaderName: "Avery",
    createdAt: now,
    urls: links("http://localhost", overrides.id),
    urlsExpireAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// A stand-in for /api/photos and /api/attachments that keeps state in memory.
async function mockPhotos(page: Page, photos: Photo[]) {
  const archived = new Map<string, Photo>();
  const pending = new Map<string, { group: string; caption: string; photoDate?: string; fileName: string; recordId: string }>();
  await page.route("**/r2-mock/**", (route) =>
    route.fulfill({ status: 200, body: PNG, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.route("**/api/photos**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const [, , , id, action] = url.pathname.split("/");
    const area = url.searchParams.get("area");
    if (request.method() === "GET" && !id)
      return route.fulfill({
        json: photos
          .filter((photo) => area === "marketing" || photo.area === area)
          .map((photo) => ({ ...photo, urls: links(url.origin, photo.id) })),
      });
    const photo = photos.find((entry) => entry.id === id);
    if (request.method() === "PATCH" && photo) {
      const change = request.postDataJSON() as Partial<Photo>;
      Object.assign(photo, change, change.label !== undefined ? { title: change.label || photo.fileName } : {});
      return route.fulfill({ json: { ...photo, urls: links(url.origin, photo.id) } });
    }
    if (action === "archive" && photo) {
      photos.splice(photos.indexOf(photo), 1);
      archived.set(id, photo);
      return route.fulfill({ json: { id, restored: false } });
    }
    if (action === "restore" && archived.has(id)) {
      photos.push(archived.get(id)!);
      archived.delete(id);
      return route.fulfill({ json: { id, restored: true } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not found" } } });
  });
  await page.route("**/api/attachments**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const [, , , id, action] = url.pathname.split("/");
    const attachment = (attachmentId: string, input: { group: string; caption: string; fileName: string; recordId: string }) => ({
      id: attachmentId, recordType: "document", recordId: input.recordId, group: input.group, fileName: input.fileName,
      caption: input.caption, kind: "photo", urls: {}, urlsExpireAt: null, createdAt: now,
    });
    if (request.method() === "POST" && !id) {
      const input = request.postDataJSON() as { group: string; caption: string; photoDate?: string; fileName: string; recordId: string };
      const attachmentId = randomUUID();
      pending.set(attachmentId, input);
      return route.fulfill({
        status: 201,
        json: {
          attachment: attachment(attachmentId, input),
          uploads: ["thumb", "display"].map((name) => ({
            name, url: `${url.origin}/r2-mock/${attachmentId}/${name}.jpg`, headers: { "Content-Type": "image/jpeg" },
          })),
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      });
    }
    if (action === "complete" && pending.has(id)) {
      const input = pending.get(id)!;
      photos.push(synthetic({
        id, title: input.caption || input.fileName, label: input.caption, fileName: input.fileName,
        recordType: "document", recordId: input.recordId, area: input.group as Photo["area"],
        date: input.photoDate ?? "2026-11-20",
      }));
      return route.fulfill({ json: attachment(id, input) });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not found" } } });
  });
}

const tiles = (page: Page) => page.getByRole("list", { name: "Photos" }).getByRole("listitem");

test("Marketing › Photos: icon, filters, bulk approve, download and delete with Undo (FLOW-271)", async ({ page, isMobile }) => {
  const photos = [
    synthetic({ id: randomUUID(), title: "Gala dessert", eventId: randomUUID(), eventTitle: "Synthetic gala", tags: ["Food"] }),
    synthetic({ id: randomUUID(), title: "Picnic crew", eventId: randomUUID(), eventTitle: "Synthetic picnic", tags: ["Team"], approvedForMarketing: true }),
    synthetic({ id: randomUUID(), title: "Venue lawn", uploadedBy: blake, uploaderName: "Blake", tags: ["Venue"] }),
  ];
  await mockPhotos(page, photos);
  await page.goto("/#/marketing");
  await expect(page.getByRole("heading", { name: "Photos", level: 1 })).toBeVisible();
  // AC1: Marketing's sidebar icon is the image icon.
  if (!isMobile)
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Marketing", exact: true }).locator("svg.lucide-image"),
    ).toHaveCount(1);
  await expect(tiles(page)).toHaveCount(3);
  await expect(tiles(page).filter({ hasText: "Gala dessert" })).toContainText("Synthetic gala · Food · Avery");

  // AC2: the filters.
  await choose(page.getByRole("combobox", { name: "Tag" }), "Food");
  await expect(tiles(page)).toHaveCount(1);
  await choose(page.getByRole("combobox", { name: "Tag" }), { label: "Any tag" });
  await choose(page.getByRole("combobox", { name: "Event" }), { label: "Synthetic picnic" });
  await expect(tiles(page)).toHaveText([/Picnic crew/]);
  await choose(page.getByRole("combobox", { name: "Event" }), { label: "Any event" });
  await choose(page.getByRole("combobox", { name: "Uploaded by" }), { label: "Blake" });
  await expect(tiles(page)).toHaveText([/Venue lawn/]);
  await choose(page.getByRole("combobox", { name: "Uploaded by" }), { label: "Anyone" });
  const approvedOnly = page.getByLabel("Approved for marketing only");
  await approvedOnly.check();
  await expect(tiles(page)).toHaveText([/Picnic crew/]);
  await approvedOnly.uncheck();

  // AC3: select two, approve them, download them, delete one and undo.
  await page.getByRole("checkbox", { name: "Select Gala dessert" }).check();
  await page.getByRole("checkbox", { name: "Select Venue lawn" }).check();
  const bar = page.getByRole("region", { name: "Selected photos" });
  await expect(bar).toContainText("2 selected");
  await bar.getByRole("button", { name: "Approve for marketing" }).click();
  await approvedOnly.check();
  await expect(tiles(page)).toHaveCount(3);
  await approvedOnly.uncheck();
  const download = page.waitForEvent("download");
  await bar.getByRole("button", { name: "Download (.zip)" }).click();
  expect((await download).suggestedFilename()).toBe("photos.zip");
  await bar.getByRole("button", { name: "Clear" }).click();
  await expect(bar).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Select Venue lawn" }).check();
  await bar.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 photo deleted." })).toBeVisible();
  await expect(tiles(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(tiles(page)).toHaveCount(3);
});

test("the lightbox moves with the mouse and the keyboard, and approves (FLOW-271 AC4)", async ({ page }) => {
  const photos = ["First", "Second", "Third"].map((title, index) =>
    synthetic({ id: randomUUID(), title, createdAt: `2026-11-2${index}T15:00:00.000Z` }));
  await mockPhotos(page, photos);
  await page.goto("/#/marketing");
  await page.getByRole("button", { name: "Open First" }).click();
  const lightbox = page.getByRole("dialog");
  const heading = lightbox.getByRole("heading");
  await expect(heading).toHaveText("First");
  await page.keyboard.press("ArrowRight");
  await expect(heading).toHaveText("Second");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(heading).toHaveText("Third");
  await lightbox.getByRole("button", { name: "Next photo" }).click();
  await expect(heading).toHaveText("First");
  await lightbox.getByRole("button", { name: "Previous photo" }).click();
  await expect(heading).toHaveText("Third");
  await lightbox.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(lightbox.getByRole("button", { name: "Remove approval" })).toBeVisible();
  await lightbox.getByRole("button", { name: "Food", exact: true }).click();
  await expect(lightbox.getByRole("button", { name: "Food", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(lightbox.getByRole("link", { name: "Open in Documents" })).toHaveAttribute("href", new RegExp(`documents\\?document=${photos[2].id}`));
  await page.keyboard.press("Escape");
  await expect(lightbox).toHaveCount(0);
  await expect(tiles(page).filter({ hasText: "Third" }).getByText("Approved")).toBeVisible();
});

test("Kitchen › Photos uploads with a label and date, edits them and confirms delete (FLOW-298)", async ({ page }) => {
  const photos = [synthetic({ id: randomUUID(), title: "Inventory shelf", recordType: "document", area: "inventory" })];
  await mockPhotos(page, photos);
  await page.goto("/#/kitchen/photos");
  await expect(page.getByRole("heading", { name: "Kitchen photos", level: 1 })).toBeVisible();
  // Only Kitchen's own photos.
  await expect(page.getByText("No photos yet")).toBeVisible();

  await page.getByRole("button", { name: "Upload photos" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Type: Photo")).toBeVisible();
  await drawer.getByLabel("Photos").setInputFiles([
    { name: "walk-in.png", mimeType: "image/png", buffer: PNG },
    { name: "pass.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(drawer.getByText("2 photos chosen")).toBeVisible();
  await drawer.getByLabel("Label").fill("Walk-in");
  await drawer.getByLabel("Date").fill("2026-11-01");
  await drawer.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(tiles(page)).toHaveCount(2);
  await expect(tiles(page).first()).toContainText("Walk-in");
  await expect(tiles(page).first()).toContainText("Nov 1, 2026");

  await tiles(page).first().getByRole("button", { name: /^Open / }).click();
  const lightbox = page.getByRole("dialog");
  await lightbox.getByLabel("Label").fill("Prep line");
  await lightbox.getByLabel("Date").fill("2026-11-02");
  await lightbox.getByRole("button", { name: "Save" }).click();
  await expect(lightbox.getByRole("heading")).toHaveText("Prep line");
  await expect(lightbox).toContainText("Nov 2, 2026");

  await lightbox.getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this photo?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(tiles(page)).toHaveCount(2);
  await page.getByRole("checkbox", { name: "Select Prep line" }).check();
  await page.getByRole("region", { name: "Selected photos" }).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete this photo?" }).getByRole("button", { name: "Confirm" }).click();
  await expect(tiles(page)).toHaveCount(1);
  await expect(tiles(page).filter({ hasText: "Prep line" })).toHaveCount(0);
});
