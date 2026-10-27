import { Hono } from "hono";
import { id as uuid } from "../../shared/schema-primitives";
import { vendorInputSchema, vendorTypeSchema } from "../../shared/vendors";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import {
  notFound,
  pageRequest,
  parseBody,
  recordRunner,
  sendPage,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  createVendor,
  getVendor,
  listVendors,
  setVendorArchived,
  updateVendor,
  vendorHistory,
} from "../records/vendors";

// Vendor and distributor directory (FLOW-84), mounted at /api/vendors. Every
// signed-in user with inventory.read sees it; inventory.write edits it. There is
// no route or field for a portal password (AC1).
export function vendorRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));
  const param = (c: AppContext) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Vendor");
    return parsed.data;
  };

  routes.get("/", requirePermission("inventory.read"), async (c) => {
    const type = vendorTypeSchema.safeParse(c.req.query("type"));
    return sendPage(
      c,
      await record(c, (db, actor) =>
        listVendors(
          db,
          actor,
          {
            archived: c.req.query("archived") === "true",
            search: c.req.query("search") || undefined,
            type: type.success ? type.data : undefined,
          },
          pageRequest(c),
        ),
      ),
    );
  });
  routes.get("/:id", requirePermission("inventory.read"), async (c) => {
    const id = param(c);
    return c.json(await record(c, (db, actor) => getVendor(db, actor, id)));
  });
  routes.get("/:id/history", requirePermission("inventory.read"), async (c) => {
    const id = param(c);
    return sendPage(
      c,
      await record(c, (db, actor) =>
        vendorHistory(db, actor, id, pageRequest(c)),
      ),
    );
  });
  routes.post("/", requirePermission("inventory.write"), async (c) => {
    const input = await parseBody(c, vendorInputSchema);
    return c.json(
      await record(c, (db, actor) => createVendor(db, actor, input)),
      201,
    );
  });
  routes.put("/:id", requirePermission("inventory.write"), async (c) => {
    const id = param(c);
    const input = await parseBody(c, vendorInputSchema);
    return c.json(
      await record(c, (db, actor) => updateVendor(db, actor, id, input)),
    );
  });
  for (const [action, archived] of [
    ["archive", true],
    ["restore", false],
  ] as const)
    routes.post(
      `/:id/${action}`,
      requirePermission("inventory.write"),
      async (c) => {
        const id = param(c);
        return c.json(
          await record(c, (db, actor) =>
            setVendorArchived(db, actor, id, archived),
          ),
        );
      },
    );
  return routes;
}
