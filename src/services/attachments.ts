import {
  PHOTO_SIZES,
  attachmentSchema,
  checkFile,
  fitWithin,
  uploadTicketSchema,
  type AttachmentRecordType,
  type UploadRequest,
} from "../../shared/attachments";
import { request } from "./core";

export const attachmentsApi = {
  list: (recordType: AttachmentRecordType, recordId: string) =>
    request(
      attachmentSchema.array(),
      `/api/attachments?recordType=${recordType}&recordId=${encodeURIComponent(recordId)}`,
    ),
  start: (input: UploadRequest) =>
    request(uploadTicketSchema, "/api/attachments", "POST", input),
  complete: (id: string) =>
    request(attachmentSchema, `/api/attachments/${id}/complete`, "POST", {}),
  update: (id: string, change: { caption?: string; sortOrder?: number }) =>
    request(attachmentSchema, `/api/attachments/${id}`, "PATCH", change),
  archive: (id: string) =>
    request(attachmentSchema, `/api/attachments/${id}/archive`, "POST", {}),
};

// Draws the photo at a smaller size and encodes it as JPEG, in the browser
// (ADR-09): only these resized copies are uploaded, never the original.
async function resize(image: ImageBitmap, max: number) {
  const { width, height } = fitWithin(image.width, image.height, max);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't resize photos.");
  context.drawImage(image, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("The photo couldn't be resized.")),
      "image/jpeg",
      0.82,
    ),
  );
}

async function prepare(file: File) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  if (!file.type.startsWith("image/"))
    return [{ name: "original" as const, blob: file as Blob }];
  const image = await createImageBitmap(file).catch(() => {
    throw new Error("This photo couldn't be read. Try a JPEG or PNG.");
  });
  try {
    return [
      { name: "thumb" as const, blob: await resize(image, PHOTO_SIZES.thumb) },
      {
        name: "display" as const,
        blob: await resize(image, PHOTO_SIZES.display),
      },
    ];
  } finally {
    image.close();
  }
}

// Validates, resizes, uploads each variant straight to R2 with its signed URL,
// then marks the attachment complete.
export async function uploadAttachment(
  file: File,
  target: {
    recordType: AttachmentRecordType;
    recordId: string;
    group?: string;
    caption?: string;
  },
) {
  const variants = await prepare(file);
  const ticket = await attachmentsApi.start({
    ...target,
    fileName: file.name,
    variants: variants.map(({ name, blob }) => ({
      name,
      contentType: blob.type || file.type,
      size: blob.size,
    })),
  });
  for (const upload of ticket.uploads) {
    const variant = variants.find((candidate) => candidate.name === upload.name);
    const response = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: variant?.blob,
    });
    if (!response.ok)
      throw new Error(`The upload failed (${response.status}). Please retry.`);
  }
  return attachmentsApi.complete(ticket.attachment.id);
}
