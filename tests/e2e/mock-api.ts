import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import {
  attachmentSchema,
  uploadTicketSchema,
  type Attachment,
  type UploadRequest,
} from "../../shared/attachments";
import { apiErrorSchema } from "../../shared/api";

// Only unavailable external R2 transport is mocked. Validate every API response.
function fulfill(route: Route, options: { json: unknown; status?: number }) {
  const status = options.status ?? 200;
  const body = options.json;
  const schema =
    status >= 400
      ? apiErrorSchema
      : Array.isArray(body)
        ? attachmentSchema.array()
        : status === 201
          ? uploadTicketSchema
          : attachmentSchema;
  return route.fulfill({ status, json: schema.parse(body) });
}

// Attachments (FLOW-42) with R2 mocked: signed URLs point at /r2-mock/ on the
// app's own origin, where the browser's PUTs are recorded and served back.
export async function mockAttachmentsApi(page: Page) {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const puts: { key: string; size: number; type: string }[] = [];
  const attachments = new Map<string, Attachment>();
  const keysOf = new Map<string, string[]>();
  let starts = 0;
  await page.route(/\/r2-mock\//, async (route) => {
    const request = route.request();
    const key = new URL(request.url()).pathname.replace("/r2-mock/", "");
    if (request.method() === "PUT") {
      const body = request.postDataBuffer() ?? Buffer.alloc(0);
      const type = request.headers()["content-type"] ?? "";
      objects.set(key, { body, type });
      puts.push({ key, size: body.length, type });
      return route.fulfill({ status: 200 });
    }
    const object = objects.get(key);
    return object
      ? route.fulfill({
          status: 200,
          body: object.body,
          contentType: object.type,
        })
      : route.fulfill({ status: 404 });
  });
  await page.route(/\/api\/attachments/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const id = url.pathname.split("/")[3];
    const action = url.pathname.split("/")[4];
    const signed = (key: string) => `${url.origin}/r2-mock/${key}`;
    if (!id && request.method() === "GET")
      return fulfill(route, {
        json: [...attachments.values()].filter(
          (attachment) =>
            attachment.recordId === url.searchParams.get("recordId") &&
            attachment.urlsExpireAt !== null,
        ),
      });
    if (!id && request.method() === "POST") {
      starts += 1;
      const input = request.postDataJSON() as UploadRequest;
      const attachmentId = randomUUID();
      const keys = input.variants.map(
        (variant) => `${attachmentId}/${variant.name}`,
      );
      const attachment: Attachment = {
        id: attachmentId,
        recordType: input.recordType,
        recordId: input.recordId,
        group: input.group ?? "",
        fileName: input.fileName,
        caption: input.caption ?? "",
        kind: input.variants[0].name === "original" ? "document" : "photo",
        urls: {},
        urlsExpireAt: null,
        createdAt: new Date().toISOString(),
      };
      attachments.set(attachmentId, attachment);
      keysOf.set(attachmentId, keys);
      return fulfill(route, {
        status: 201,
        json: {
          attachment,
          uploads: input.variants.map((variant, index) => ({
            name: variant.name,
            url: signed(keys[index]),
            headers: { "Content-Type": variant.contentType },
          })),
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
      });
    }
    const attachment = id ? attachments.get(id) : undefined;
    if (attachment && action === "complete") {
      const ready: Attachment = {
        ...attachment,
        urls: Object.fromEntries(
          (keysOf.get(attachment.id) ?? []).map((key) => [
            key.split("/")[1],
            signed(key),
          ]),
        ),
        urlsExpireAt: new Date(Date.now() + 300_000).toISOString(),
      };
      attachments.set(attachment.id, ready);
      return fulfill(route, { json: ready });
    }
    return fulfill(route, {
      status: 404,
      json: {
        error: {
          code: "NOT_FOUND",
          message: "Not found.",
          requestId: randomUUID(),
        },
      },
    });
  });
  return { puts, starts: () => starts };
}
