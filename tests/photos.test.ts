import { describe, expect, it } from "vitest";
import {
  filterPhotos,
  isPhotoArea,
  photoCaption,
  photoChangeSchema,
  photoSchema,
  stepIndex,
  zipNames,
  type Photo,
} from "../shared/photos";
import { uploadRequestSchema } from "../shared/attachments";

const photo = (overrides: Partial<Photo>): Photo =>
  photoSchema.parse({
    id: "71000000-0000-4000-8000-000000000001",
    attachmentId: "71000000-0000-4000-8000-000000000001",
    title: "IMG_0001.jpg",
    label: "",
    fileName: "IMG_0001.jpg",
    recordType: "event",
    recordId: "71000000-0000-4000-8000-0000000000e1",
    area: null,
    eventId: "71000000-0000-4000-8000-0000000000e1",
    eventTitle: "Synthetic gala",
    tags: [],
    approvedForMarketing: false,
    date: "2026-11-20",
    uploadedBy: "71000000-0000-4000-8000-0000000000a1",
    uploaderName: "Avery",
    createdAt: "2026-11-20T15:00:00.000Z",
    urls: null,
    urlsExpireAt: null,
    ...overrides,
  });

describe("photo galleries (FLOW-271, FLOW-298)", () => {
  const food = photo({ id: "71000000-0000-4000-8000-000000000002", tags: ["Food"], approvedForMarketing: true });
  const team = photo({
    id: "71000000-0000-4000-8000-000000000003",
    tags: ["Team"],
    eventId: null,
    eventTitle: null,
    uploadedBy: "71000000-0000-4000-8000-0000000000a2",
  });
  const all = [food, team];

  it("filters by event, tag, uploader and approval (AC2)", () => {
    expect(filterPhotos(all, {})).toEqual(all);
    expect(filterPhotos(all, { eventId: food.eventId! })).toEqual([food]);
    expect(filterPhotos(all, { tag: "Team" })).toEqual([team]);
    expect(filterPhotos(all, { uploadedBy: "71000000-0000-4000-8000-0000000000a2" })).toEqual([team]);
    expect(filterPhotos(all, { approvedOnly: true })).toEqual([food]);
    expect(filterPhotos(all, { tag: "Team", approvedOnly: true })).toEqual([]);
  });

  it("captions a tile as event · tag · uploader, date", () => {
    expect(photoCaption(food)).toMatch(/^Synthetic gala · Food · Avery, Nov 20, 2026$/);
    expect(photoCaption(team)).toMatch(/^Team · Avery, Nov 20, 2026$/);
  });

  it("wraps previous and next at either end of the lightbox (AC4)", () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });

  it("names .zip entries uniquely and safely (AC3)", () => {
    expect(zipNames(["IMG_1.jpg", "img_1.jpg", "IMG_1.jpg", "a/b.jpg", ""])).toEqual([
      "IMG_1.jpg",
      "img_1 (2).jpg",
      "IMG_1 (3).jpg",
      "a_b.jpg",
      "photo.jpg",
    ]);
  });

  it("knows the gallery groups and validates changes", () => {
    expect(["marketing", "kitchen", "inventory", "", "floor_plan"].map(isPhotoArea)).toEqual([true, true, true, false, false]);
    expect(photoChangeSchema.parse({ label: "  Prep line ", date: "2026-11-02" })).toEqual({ label: "Prep line", date: "2026-11-02" });
    expect(photoChangeSchema.safeParse({ date: "2026-02-31" }).success).toBe(false);
    expect(photoChangeSchema.safeParse({ caption: "x" }).success).toBe(false);
    expect(photoChangeSchema.safeParse({ tags: [""] }).success).toBe(false);
  });

  it("takes a photo's date with the upload", () => {
    const base = {
      recordType: "document",
      recordId: "71000000-0000-4000-8000-000000000009",
      group: "kitchen",
      fileName: "walk-in.jpg",
      variants: [
        { name: "thumb", contentType: "image/jpeg", size: 100 },
        { name: "display", contentType: "image/jpeg", size: 1000 },
      ],
    };
    expect(uploadRequestSchema.parse({ ...base, photoDate: "2026-11-01" }).photoDate).toBe("2026-11-01");
    expect(uploadRequestSchema.parse(base).photoDate).toBeUndefined();
    expect(uploadRequestSchema.safeParse({ ...base, photoDate: "11/01/2026" }).success).toBe(false);
  });
});
