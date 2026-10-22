// @vitest-environment node
import { expect, it } from "vitest";
import { presignUrl } from "../../worker/attachments/presign";
import { fileStorage } from "../../worker/attachments/storage";

it("matches the AWS Signature V4 presigned URL example", async () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
  const url = await presignUrl({
    method: "GET",
    host: "examplebucket.s3.amazonaws.com",
    path: "/test.txt",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    expiresIn: 86400,
    now: new Date("2013-05-24T00:00:00Z"),
  });
  expect(url).toBe(
    "https://examplebucket.s3.amazonaws.com/test.txt" +
      "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
      "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
  );
});

const storage = fileStorage({
  R2_ACCOUNT_ID: "acct",
  R2_BUCKET: "flowbase-files",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
});
const now = new Date("2026-10-22T09:00:00Z");

it("signs uploads for one exact type and size, expiring after 5 minutes", async () => {
  const url = new URL(
    await storage.uploadUrl("venue/v1/a1/display.jpg", "image/jpeg", 1234, 300, now),
  );
  expect(url.host).toBe("acct.r2.cloudflarestorage.com");
  expect(url.pathname).toBe("/flowbase-files/venue/v1/a1/display.jpg");
  expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  expect(url.searchParams.get("X-Amz-Date")).toBe("20261022T090000Z");
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
    "content-length;content-type;host",
  );
  const other = new URL(
    await storage.uploadUrl("venue/v1/a1/display.jpg", "image/jpeg", 9999, 300, now),
  );
  expect(other.searchParams.get("X-Amz-Signature")).not.toBe(
    url.searchParams.get("X-Amz-Signature"),
  );
});

it("signs downloads that expire", async () => {
  const url = new URL(await storage.downloadUrl("client/c1/a1/original.pdf", 300, now));
  expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
});

it("refuses to sign without the R2 settings", () => {
  expect(() => fileStorage({ R2_BUCKET: "flowbase-files" })).toThrow(
    "File storage is not configured.",
  );
});
