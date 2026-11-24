import { Hono } from "hono";
import { staffCreateSchema, staffUpdateSchema } from "../../../shared/staff";
import { requirePermission } from "../../auth";
import {
  idParam,
  parseBody,
  recordRunner,
  type AppEnv,
  type RunWithDb,
} from "../../hono";
import {
  createStaffMember,
  getStaffMember,
  listStaff,
  updateStaffMember,
} from "../../records/staff/staff";

// Staff directory (FLOW-40), mounted at /api/staff. The record module limits which
// fields a non-Admin may change (their own phone number and SMS consent).
export function staffRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.get("/", requirePermission("staff.read"), async (c) =>
    c.json(await record(c, (db, actor) => listStaff(db, actor))),
  );
  // A staff member without a Flowbase account (FLOW-270 A3): Admin only.
  routes.post("/", requirePermission("users.manage"), async (c) => {
    const input = await parseBody(c, staffCreateSchema);
    return c.json(await record(c, (db, actor) => createStaffMember(db, actor, input)), 201);
  });
  routes.get("/:id", requirePermission("staff.read"), async (c) => {
    const id = idParam(c, "Staff member");
    return c.json(await record(c, (db, actor) => getStaffMember(db, actor, id)));
  });
  routes.patch("/:id", requirePermission("staff.update_self"), async (c) => {
    const id = idParam(c, "Staff member");
    const input = await parseBody(c, staffUpdateSchema);
    return c.json(
      await record(c, (db, actor) => updateStaffMember(db, actor, id, input)),
    );
  });
  return routes;
}
