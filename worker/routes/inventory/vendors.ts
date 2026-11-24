import { getItemsByIds } from "../../records/inventory/inventory";
import { Hono } from "hono";
import { vendorInputSchema, vendorTypeSchema } from "../../../shared/vendors";
import { requireActor, requirePermission, type ResolveActor } from "../../auth";
import {
  idParam,
  pageRequest,
  parseBody,
  queryParam,
  recordRunner,
  sendPage,
  type AppEnv,
  type RunWithDb,
} from "../../hono";
import {
  createVendor,
  getVendor,
  listVendors,
  setVendorArchived,
  updateVendor,
  vendorHistory,
} from "../../records/inventory/vendors";

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

  routes.get("/", requirePermission("vendors.read"), async (c) => {
    const type = vendorTypeSchema.safeParse(c.req.query("type"));
    return sendPage(
      c,
      await record(c, (db, actor) =>
        listVendors(
          db,
          actor,
          {
            archived: c.req.query("archived") === "true",
            search: queryParam(c, "search"),
            type: type.success ? type.data : undefined,
          },
          pageRequest(c),
        ),
      ),
    );
  });
  routes.get("/:id", requirePermission("vendors.read"), async (c) => {
    const id = idParam(c, "Vendor");
    return c.json(await record(c, (db, actor) => getVendor(db, actor, id)));
  });
  routes.get("/:id/items", requirePermission("vendors.read"), requirePermission("inventory.read"), async (c) =>
    c.json(await record(c, async (db, actor) => {
      const vendor = await getVendor(db, actor, idParam(c, "Vendor"));
      return getItemsByIds(db, actor, vendor.items.map((item) => item.id));
    })));
  routes.get("/:id/history", requirePermission("vendors.read"), async (c) => {
    const id = idParam(c, "Vendor");
    return sendPage(
      c,
      await record(c, (db, actor) =>
        vendorHistory(db, actor, id, pageRequest(c)),
      ),
    );
  });
  routes.post("/", requirePermission("vendors.write"), async (c) => {
    const input = await parseBody(c, vendorInputSchema);
    return c.json(
      await record(c, (db, actor) => createVendor(db, actor, input)),
      201,
    );
  });
  routes.put("/:id", requirePermission("vendors.write"), async (c) => {
    const id = idParam(c, "Vendor");
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
      requirePermission("vendors.write"),
      async (c) => {
        const id = idParam(c, "Vendor");
        return c.json(
          await record(c, (db, actor) =>
            setVendorArchived(db, actor, id, archived),
          ),
        );
      },
    );
  return routes;
}
