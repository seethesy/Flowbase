import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "../auth-fixture";

// Documents › Templates (FLOW-330): the library limited to Template documents.
// Storage is mocked as in documents.spec.ts.
type Doc = {
  id: string; name: string; docType: string; recordType: string; recordId: string; protected: boolean; updatedAt: string;
  versions: { id: string; number: number; fileName: string; size: number; contentType: string; url: string;
    createdAt: string; uploadedBy: string | null; uploaderName: string | null }[];
};
const now = new Date().toISOString();
const doc = (name: string, docType: string): Doc => {
  const id = randomUUID();
  return { id, name, docType, recordType: "document", recordId: id, protected: false, updatedAt: now,
    versions: [{ id: randomUUID(), number: 1, fileName: `${name}.pdf`, size: 2048, contentType: "application/pdf",
      url: "http://localhost/r2-mock/file.pdf", createdAt: now, uploadedBy: null, uploaderName: null }] };
};

async function mockLibrary(page: Page, documents: Doc[]) {
  const pending = new Map<string, { name: string; docType: string; fileName: string; size: number }>();
  await page.route("**/r2-mock/**", (route) => route.fulfill({ status: 200, body: "%PDF-1.4\n%%EOF", contentType: "application/pdf" }));
  await page.route("**/api/documents**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const [, , , id, action] = url.pathname.split("/");
    if (request.method() === "GET" && !id) return route.fulfill({ json: documents });
    if (request.method() === "POST" && !id) {
      const uploadId = randomUUID();
      pending.set(uploadId, request.postDataJSON());
      return route.fulfill({ status: 201, json: { id: uploadId, url: `${url.origin}/r2-mock/file.pdf`, headers: { "Content-Type": "application/pdf" } } });
    }
    if (action === "complete") {
      const upload = pending.get(id)!;
      const created = { ...doc(upload.name, upload.docType) };
      created.versions[0].fileName = upload.fileName;
      documents.push(created);
      return route.fulfill({ json: created });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not found" } } });
  });
}

test("lists only templates, and an upload from the tab is a template (AC1, AC2)", async ({ page }) => {
  const documents = [doc("Proposal template", "template"), doc("Signed contract", "contract")];
  await mockLibrary(page, documents);
  await page.goto("/#/documents/templates");
  await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText(/Workspace\s*\/\s*Documents\s*\/\s*Templates/);
  await expect(page.getByRole("row", { name: /Proposal template/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Signed contract/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("combobox", { name: "Type" })).toHaveAttribute("data-value", "template");
  await drawer.locator('input[type="file"]').setInputFiles({ name: "blank-beo.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
  await drawer.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByRole("row", { name: /blank-beo.pdf/ })).toBeVisible();
  expect(documents.find((entry) => entry.name === "blank-beo.pdf")?.docType).toBe("template");

  // The Documents tab still lists every type, templates included.
  await page.goto("/#/documents");
  await expect(page.getByRole("row", { name: /Signed contract/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /blank-beo.pdf/ })).toBeVisible();
});
