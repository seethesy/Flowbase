import { test, expect } from "../auth-fixture";
import { randomUUID } from "node:crypto";

test("the Documents library shows types, filters and an upload form", async ({ page }) => {
  await page.goto("/#/documents");
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(page.getByRole("button", { name: /All \d+/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Linked to" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Uploaded by" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Updated" })).toBeVisible();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("PDF, Word, Excel, JPG, PNG or HEIC. Maximum 25 MB.")).toBeVisible();
  await expect(drawer.getByRole("combobox", { name: "Type" })).toBeVisible();
});

test("uploads, previews, deletes and restores a document", async ({ page }) => {
  const documents: { id: string; name: string; docType: string; recordType: string; recordId: string;
    protected: boolean; updatedAt: string; versions: { id: string; number: number; fileName: string;
      size: number; contentType: string; url: string; createdAt: string; uploadedBy: string | null; uploaderName: string | null }[] }[] = [];
  const pending = new Map<string, { id: string; name: string; docType: string; fileName: string; size: number }>();
  const archived = new Map<string, typeof documents[number]>();
  const now = new Date().toISOString();
  await page.route("**/r2-mock/**", (route) => route.fulfill({ status: 200, body: "%PDF-1.4\n%%EOF", contentType: "application/pdf" }));
  await page.route("**/api/documents**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const [, , , id, action] = url.pathname.split("/");
    if (request.method() === "GET" && !id) return route.fulfill({ json: documents });
    if (request.method() === "POST" && !id) {
      const input = request.postDataJSON() as { name: string; docType: string; fileName: string; size: number };
      const uploadId = randomUUID();
      pending.set(uploadId, { id: randomUUID(), ...input });
      return route.fulfill({ status: 201, json: { id: uploadId, url: `${url.origin}/r2-mock/file.pdf`, headers: { "Content-Type": "application/pdf" } } });
    }
    if (action === "complete") {
      const upload = pending.get(id)!;
      const document = { id: upload.id, name: upload.name, docType: upload.docType,
        recordType: "document", recordId: upload.id, protected: false, updatedAt: now,
        versions: [{ id, number: 1, fileName: upload.fileName, size: upload.size,
          contentType: "application/pdf", url: `${url.origin}/r2-mock/file.pdf`, createdAt: now,
          uploadedBy: null, uploaderName: null }] };
      documents.push(document);
      return route.fulfill({ json: document });
    }
    if (request.method() === "PATCH" && id) {
      const document = documents.find((entry) => entry.id === id)!;
      Object.assign(document, request.postDataJSON());
      return route.fulfill({ json: document });
    }
    if (action === "archive" || action === "restore") {
      const document = action === "archive" ? documents.find((entry) => entry.id === id)! : archived.get(id)!;
      if (action === "archive") { documents.splice(documents.indexOf(document), 1); archived.set(id, document); }
      else { documents.push(document); archived.delete(id); }
      return route.fulfill({ json: { id, restored: action === "restore" } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not found" } } });
  });
  await page.goto("/#/documents");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.locator('input[type="file"]').setInputFiles({ name: "synthetic.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
  await drawer.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByRole("row", { name: /synthetic.pdf/ })).toBeVisible();
  const uploadedRow = page.locator("tbody tr").first();
  await uploadedRow.getByRole("button", { name: "synthetic.pdf" }).click();
  await uploadedRow.getByRole("textbox").fill("Synthetic contract");
  await uploadedRow.getByRole("textbox").press("Enter");
  await expect(page.getByRole("row", { name: /Synthetic contract/ })).toBeVisible();
  await page.getByRole("row", { name: /Synthetic contract/ }).getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Versions" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("row", { name: /Synthetic contract/ })).toBeVisible();
});
