import { Hono } from "hono";
import { z } from "zod";
import {
  leadAssignSchema,
  leadBulkAssignSchema,
  leadConvertSchema,
  leadStatusChangeSchema,
} from "../../shared/leads";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import {
  notFound,
  parseBody,
  runDb,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  assignLead,
  bulkAssignLeads,
  changeLeadStatus,
  convertLead,
  getLead,
  listLeads,
} from "../records/leads";

const uuid = z.string().uuid();

// Leads API (FLOW-100/111/112), mounted at /api/leads. Every route needs a signed-in
// user; leads the user can't see answer 404. There is no create route here: leads
// arrive through createLead (collector, webhook, manual entry, import).
export function leadRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const routes = new Hono<AppEnv>();
  routes.use("*", requireActor(options.resolveActor));
  const param = (c: AppContext) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Lead");
    return parsed.data;
  };
  const query = (c: AppContext, key: string) => c.req.query(key) || undefined;
  const flag = (c: AppContext, key: string) => c.req.query(key) === "true";

  routes.get("/", async (c) =>
    c.json(
      await runDb(options.withDb, c.env, (tx) =>
        listLeads(tx, c.get("actor"), {
          status: query(c, "status"),
          source: query(c, "source"),
          channel: query(c, "channel"),
          assigned: query(c, "assigned"),
          needsReview: flag(c, "needsReview"),
          triage: flag(c, "triage"),
          search: query(c, "search"),
        }),
      ),
    ),
  );
  // Bulk assign from the triage queue. Admin only.
  routes.post("/assign", requirePermission("leads.assign"), async (c) => {
    const input = await parseBody(c, leadBulkAssignSchema);
    return c.json(
      await runDb(options.withDb, c.env, (tx) =>
        bulkAssignLeads(
          tx,
          c.get("actor"),
          input.leadIds,
          input.assignedSalespersonId,
        ),
      ),
    );
  });
  routes.get("/:id", async (c) => {
    const id = param(c);
    return c.json(
      await runDb(options.withDb, c.env, (tx) => getLead(tx, c.get("actor"), id)),
    );
  });
  routes.post("/:id/assign", requirePermission("leads.assign"), async (c) => {
    const id = param(c);
    const input = await parseBody(c, leadAssignSchema);
    return c.json(
      await runDb(options.withDb, c.env, (tx) =>
        assignLead(tx, c.get("actor"), id, input.assignedSalespersonId),
      ),
    );
  });
  routes.post("/:id/status", requirePermission("leads.update"), async (c) => {
    const id = param(c);
    const input = await parseBody(c, leadStatusChangeSchema);
    return c.json(
      await runDb(options.withDb, c.env, (tx) =>
        changeLeadStatus(tx, c.get("actor"), id, input),
      ),
    );
  });
  routes.post("/:id/convert", requirePermission("leads.convert"), async (c) => {
    const id = param(c);
    const input = await parseBody(c, leadConvertSchema);
    return c.json(
      await runDb(options.withDb, c.env, (tx) =>
        convertLead(tx, c.get("actor"), id, input),
      ),
    );
  });
  return routes;
}
