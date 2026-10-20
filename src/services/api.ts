import type { z } from "zod";
import type { RecordService } from "./records";

// The prototype validates writes at the API and keeps its working set in browser
// memory. Refetching the page reloads the fixtures; no persistence is implied.
export function createRecordService<T extends { id: string }>(
  resource: string, schema: z.ZodType<T>, request: typeof fetch = fetch,
): RecordService<T> {
  let records: T[] | undefined;
  const send = async (path = "", init?: RequestInit) => {
    const response = await request(`/api/demo/${resource}${path}`, init);
    if (!response.ok) throw new Error(`Unable to update demo records (${response.status}). Please retry.`);
    return response;
  };
  const list = async () => {
    if (!records) records = schema.array().parse(await (await send()).json());
    return records;
  };
  return {
    list,
    get: async (id) => (await list()).find((record) => record.id === id),
    save: async (record) => {
      await list();
      const saved = schema.parse(await (await send(`/${encodeURIComponent(record.id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(schema.parse(record)),
      })).json());
      const current = records!;
      records = current.some((r) => r.id === saved.id)
        ? current.map((r) => r.id === saved.id ? saved : r) : [saved, ...current];
    },
    remove: async (id) => {
      await list();
      await send(`/${encodeURIComponent(id)}`, { method: "DELETE" });
      records = records!.filter((r) => r.id !== id);
    },
  };
}
