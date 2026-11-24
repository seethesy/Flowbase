import { afterEach, expect, it, vi } from "vitest";
import { putToStorage, STORAGE_UNREACHABLE, StorageUnreachableError } from "../../src/services/attachments";
import { uploadDocument } from "../../src/services/documents";

// Documents › Upload (FLOW-331): the storage PUT and its failures.
const ticket = { id: "00000000-0000-4000-8000-0000000000a1", url: "https://acct.r2.cloudflarestorage.com/flowbase-files/documents/x/original.pdf?X-Amz-Signature=s", headers: { "Content-Type": "application/pdf" } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

it("PUTs with only the method and header the bucket's CORS rule allows (AC3)", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  await putToStorage(ticket.url, ticket.headers, new Blob(["%PDF"]));
  const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(init.method).toBe("PUT");
  // The documented rule: methods GET and PUT, header Content-Type.
  expect(Object.keys(init.headers as Record<string, string>).map((name) => name.toLowerCase())).toEqual(["content-type"]);
  expect(init.credentials).toBe("omit");
});

it("a network or CORS failure shows the storage message (AC2)", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  const error = await putToStorage(ticket.url, ticket.headers, new Blob(["x"])).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(StorageUnreachableError);
  expect((error as Error).message).toBe(STORAGE_UNREACHABLE);
});

it("removes the pending upload when the file can't reach storage, so no document is left (AC2)", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url.replace(/\?.*/, "")}`);
    if (url.startsWith("https://acct.r2")) throw new TypeError("Failed to fetch");
    if (url.endsWith("/api/documents")) return json(ticket, 201);
    if (url.endsWith(`/api/documents/${ticket.id}/cancel`)) return json({ id: ticket.id, cancelled: true });
    return json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
  }));
  const file = new File(["%PDF-1.4"], "synthetic.pdf", { type: "application/pdf" });
  await expect(uploadDocument(file, { name: "Synthetic", docType: "contract", recordType: "document" })).rejects.toBeInstanceOf(StorageUnreachableError);
  expect(calls.map((call) => call.replace(/^(\w+) https?:\/\/[^/]+/, "$1 "))).toEqual([
    "POST /api/documents",
    "PUT /flowbase-files/documents/x/original.pdf",
    `POST /api/documents/${ticket.id}/cancel`,
  ]);
});
