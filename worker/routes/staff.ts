import { Hono } from "hono";
import { id as uuid } from "../../shared/schema-primitives";
import { staffUpdateSchema } from "../../shared/staff";
import { requirePermission } from "../auth";
import {
  notFound,
  parseBody,
  recordRunner,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  getStaffMember,
  listStaff,
  updateStaffMember,
} from "../records/staff";

// Staff directory (FLOW-40), mounted at /api/staff. The record module limits which
// fields a non-Admin may change (their own phone number and SMS consent).
export function staffRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const param = (c: AppContext) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Staff member");
    return parsed.data;
  };
  routes.get("/", requirePermission("staff.read"), async (c) =>
    c.json(await record(c, (db, actor) => listStaff(db, actor))),
  );
  routes.get("/:id", requirePermission("staff.read"), async (c) => {
    const id = param(c);
    return c.json(await record(c, (db, actor) => getStaffMember(db, actor, id)));
  });
  routes.patch("/:id", requirePermission("staff.update_self"), async (c) => {
    const id = param(c);
    const input = await parseBody(c, staffUpdateSchema);
    return c.json(
      await record(c, (db, actor) => updateStaffMember(db, actor, id, input)),
    );
  });
  return routes;
}
