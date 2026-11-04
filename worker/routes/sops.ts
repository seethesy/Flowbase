import { Hono } from "hono";
import { id } from "../../shared/schema-primitives";
import { sopInputSchema, sopUpdateSchema } from "../../shared/sops";
import { requirePermission } from "../auth";
import { notFound, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../hono";
import { createSop, getSop, listSops, updateSop } from "../records/sops";

export function sopRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const sopId = (value: string) => {
    const parsed = id.safeParse(value);
    if (!parsed.success) throw notFound("SOP");
    return parsed.data;
  };
  routes.get("/", requirePermission("sops.read"), async (c) =>
    c.json(await record(c, (db) => listSops(db, {
      q: c.req.query("q"), category: c.req.query("category"),
    }))));
  routes.get("/:id", requirePermission("sops.read"), async (c) =>
    c.json(await record(c, (db) => getSop(db, sopId(c.req.param("id"))))));
  routes.post("/", requirePermission("sops.write"), async (c) => {
    const input = await parseBody(c, sopInputSchema);
    return c.json(await record(c, (db, actor) => createSop(db, actor, input)), 201);
  });
  routes.put("/:id", requirePermission("sops.write"), async (c) => {
    const input = await parseBody(c, sopUpdateSchema);
    return c.json(await record(c, (db, actor) =>
      updateSop(db, actor, sopId(c.req.param("id")), input)));
  });
  return routes;
}
