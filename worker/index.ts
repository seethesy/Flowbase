import { Hono } from "hono";
import { recordSchemas } from "../shared/records";
import * as fixtures from "../src/data/mock/fixtures";

export type Bindings = { ASSETS: { fetch: typeof fetch } };
export const app = new Hono<{ Bindings: Bindings }>();
app.get("/api/health", (c) => c.json({ ok: true }));
// Temporary demo adapters. Writes validate and echo, without database storage.
for (const resource of ["clients", "proposals", "inventory"] as const) {
  const schema = recordSchemas[resource];
  app.get(`/api/demo/${resource}`, (c) => c.json(schema.array().parse(fixtures[resource])));
  app.put(`/api/demo/${resource}/:id`, async (c) => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || parsed.data.id !== c.req.param("id"))
      return c.json({ error: "Invalid record" }, 400);
    return c.json(parsed.data);
  });
  app.delete(`/api/demo/${resource}/:id`, (c) => c.body(null, 204));
}
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
export default app;
