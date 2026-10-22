import type { Bindings } from "../bindings";
import { ApiError } from "../hono";
import { encodePath, presignUrl } from "./presign";

// Signed R2 URLs for one bucket. Without the account, bucket and key pair the
// attachment routes answer 503.
export function fileStorage(env: Partial<Bindings>) {
  const {
    R2_ACCOUNT_ID: account,
    R2_BUCKET: bucket,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
  } = env;
  if (!account || !bucket || !accessKeyId || !secretAccessKey)
    throw new ApiError(
      503,
      "STORAGE_NOT_CONFIGURED",
      "File storage is not configured.",
    );
  const sign = (
    method: "GET" | "PUT",
    key: string,
    expiresIn: number,
    now: Date,
    headers?: Record<string, string>,
  ) =>
    presignUrl({
      method,
      host: `${account}.r2.cloudflarestorage.com`,
      path: encodePath(`/${bucket}/${key}`),
      region: "auto",
      accessKeyId,
      secretAccessKey,
      expiresIn,
      now,
      headers,
    });
  return {
    // The browser must send exactly this type and length, so a ticket can't be
    // reused for a different or larger file.
    uploadUrl: (
      key: string,
      contentType: string,
      size: number,
      expiresIn: number,
      now: Date,
    ) =>
      sign("PUT", key, expiresIn, now, {
        "content-length": String(size),
        "content-type": contentType,
      }),
    downloadUrl: (key: string, expiresIn: number, now: Date) =>
      sign("GET", key, expiresIn, now),
  };
}
