import { expect, it } from "vitest";
import { checkFile, fitWithin } from "../shared/attachments";

it("resizes to fit without enlarging", () => {
  expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
  expect(fitWithin(3024, 4032, 320)).toEqual({ width: 240, height: 320 });
  expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
});
it("rejects unsupported and oversized files before upload", () => {
  const mb = 1024 * 1024;
  expect(checkFile({ type: "image/jpeg", size: 10 * mb })).toBeUndefined();
  expect(checkFile({ type: "image/jpeg", size: 26 * mb })).toMatch("25 MB");
  expect(checkFile({ type: "application/pdf", size: 21 * mb })).toMatch("20 MB");
  expect(checkFile({ type: "text/plain", size: 10 })).toMatch(
    "Only photos",
  );
  expect(checkFile({ type: "", size: 10 })).toMatch("Only photos");
});
