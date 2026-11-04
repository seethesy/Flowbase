import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Role } from "../../shared/access";
import type { Sop } from "../../shared/sops";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const users: { id: string; role: Role }[] = [
  { id: "b1390000-0000-4000-8000-000000000001", role: "admin" },
  { id: "b1390000-0000-4000-8000-000000000002", role: "sales_manager" },
  { id: "b1390000-0000-4000-8000-000000000003", role: "kitchen_lead" },
  { id: "b1390000-0000-4000-8000-000000000004", role: "staff" },
];
const requestAs = (index: number, method: string, path: string, body?: unknown) =>
  createApp({ withDb, resolveActor: async () => ({ userId: users[index].id,
    role: users[index].role, employmentType: "full_time" as const }) })
    .request(path, { method, ...(body && { body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" } }) }, { ASSETS: { fetch } });
const content = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const input = { title: "Load truck", category: "Production", content: content("Check the manifest") };

beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  await db.execute(sql`truncate table task_assignees, task_checklist_items, task_comments, tasks, task_template_items, task_templates, sop_versions, sops, users cascade`);
  await db.insert(schema.users).values(users.map((user, index) => ({
    id: user.id, role: user.role, employmentType: "full_time" as const,
    email: `sop-${index}@example.test`, name: `Editor ${index}`,
    mobile: `20255513${String(index).padStart(2, "0")}`, status: "active" as const,
  })));
});
afterAll(async () => { await client.end(); });

describe("SOP library (FLOW-139)", () => {
  it("versions edits with who and when and rejects stale saves", async () => {
    const createdResponse = await requestAs(0, "POST", "/api/sops", input);
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as Sop;
    expect(created.history).toHaveLength(1);
    expect(created.history[0].editorName).toBe("Editor 0");
    const updatedResponse = await requestAs(2, "PUT", `/api/sops/${created.id}`,
      { ...input, content: content("Secure every cart"), version: 1 });
    expect(updatedResponse.status).toBe(200);
    const updated = await updatedResponse.json() as Sop;
    expect(updated.version).toBe(2);
    expect(updated.history.map((entry) => entry.editorName)).toEqual(["Editor 2", "Editor 0"]);
    expect(updated.history[0].editedAt).toBeTruthy();
    expect(updated.history[1].content).toEqual(input.content);
    expect((await requestAs(0, "PUT", `/api/sops/${created.id}`,
      { ...input, version: 1 })).status).toBe(409);
  });

  it("allows all readers but only the three editor roles to write", async () => {
    expect((await requestAs(1, "POST", "/api/sops", input)).status).toBe(201);
    expect((await requestAs(3, "GET", "/api/sops?q=manifest")).status).toBe(200);
    expect((await requestAs(3, "POST", "/api/sops", input)).status).toBe(403);
    const [sop] = await db.select().from(schema.sops);
    expect((await requestAs(3, "PUT", `/api/sops/${sop.id}`,
      { ...input, version: 1 })).status).toBe(403);
  });

  it("links a task and template to an SOP", async () => {
    const sop = await (await requestAs(0, "POST", "/api/sops", input)).json() as Sop;
    const taskResponse = await requestAs(0, "POST", "/api/tasks", { title: "Load vehicle", sopId: sop.id });
    expect(taskResponse.status).toBe(201);
    expect((await taskResponse.json() as { sopId: string }).sopId).toBe(sop.id);
    const templateResponse = await requestAs(0, "POST", "/api/tasks/templates", {
      name: "Loading", sopId: sop.id, items: [{ title: "Check truck", offsetDays: -1 }],
    });
    expect(templateResponse.status).toBe(201);
    expect((await templateResponse.json() as { sopId: string }).sopId).toBe(sop.id);
    const [row] = await db.select().from(schema.taskTemplates).where(eq(schema.taskTemplates.sopId, sop.id));
    expect(row).toBeDefined();
  });
});
