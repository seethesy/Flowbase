import { Hono } from "hono";
import { id, localDate } from "../../../shared/schema-primitives";
import {
  payExceptionInputSchema,
  payExceptionUpdateSchema,
  staffPayInputSchema,
} from "../../../shared/staff-pay";
import { addLocalDays, utcToBusinessTime } from "../../../shared/time";
import { requirePermission } from "../../auth";
import { ApiError, notFound, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../../hono";
import {
  archivePayException,
  createPayException,
  getPayroll,
  saveStaffPay,
  updatePayException,
} from "../../records/staff/staff-pay";

// Staff pay and the Payroll tab (FLOW-270), mounted at /api/staff-pay. Admin and
// Technical by default (the Staff pay area); everyone else gets 403.

export function staffPayRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const exceptionId = (value: string) => {
    const parsed = id.safeParse(value);
    if (!parsed.success) throw notFound("Pay exception");
    return parsed.data;
  };
  // ?from=&to= (New York dates, inclusive); defaults to this month so far.
  routes.get("/", requirePermission("staff.pay.read"), async (c) => {
    const today = utcToBusinessTime(new Date()).date;
    const from = c.req.query("from") ?? `${today.slice(0, 8)}01`;
    const to = c.req.query("to") ?? today;
    if (!localDate.safeParse(from).success || !localDate.safeParse(to).success || from > to)
      throw new ApiError(400, "INVALID_REQUEST", "Choose a valid date range.");
    if (addLocalDays(from, 400) < to)
      throw new ApiError(400, "INVALID_REQUEST", "Choose a range of 400 days or less.");
    return c.json(await record(c, (db, actor) => getPayroll(db, actor, { from, to })));
  });
  routes.put("/", requirePermission("staff.pay.write"), async (c) => {
    const input = await parseBody(c, staffPayInputSchema);
    return c.json(await record(c, (db, actor) => saveStaffPay(db, actor, input)));
  });
  routes.post("/exceptions", requirePermission("staff.pay.write"), async (c) => {
    const input = await parseBody(c, payExceptionInputSchema);
    return c.json(await record(c, (db, actor) => createPayException(db, actor, input)), 201);
  });
  routes.patch("/exceptions/:id", requirePermission("staff.pay.write"), async (c) => {
    const target = exceptionId(c.req.param("id"));
    const input = await parseBody(c, payExceptionUpdateSchema);
    return c.json(await record(c, (db, actor) => updatePayException(db, actor, target, input)));
  });
  routes.delete("/exceptions/:id", requirePermission("staff.pay.write"), async (c) => {
    const target = exceptionId(c.req.param("id"));
    return c.json(await record(c, (db, actor) => archivePayException(db, actor, target)));
  });
  return routes;
}
