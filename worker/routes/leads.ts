import { Hono } from "hono";
import {
  leadAssignSchema,
  leadBulkAssignSchema,
  leadConvertSchema,
  leadMergeSchema,
  leadStatusChangeSchema,
} from "../../shared/leads";
import { id as uuid } from "../../shared/schema-primitives";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import {
  notFound,
  parseBody,
  recordRunner,
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
import { leadDashboard } from "../records/lead-dashboard";
import {
  dismissLeadDuplicate,
  listLeadDuplicates,
  mergeLeadDuplicate,
} from "../records/lead-duplicates";

// Leads API (FLOW-100/111/112), mounted at /api/leads. Every route needs a signed-in
// user; leads the user can't see answer 404. There is no create route here: leads
// arrive through createLead (collector, webhook, manual entry, import).
export function leadRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
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
      await record(c, (db, actor) =>
        listLeads(db, actor, {
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
      await record(c, (db, actor) =>
        bulkAssignLeads(
          db,
          actor,
          input.leadIds,
          input.assignedSalespersonId,
        ),
      ),
    );
  });
  // Lead dashboard (FLOW-113): ?from=&to= are New York dates; the last 30 days by
  // default.
  routes.get("/dashboard", async (c) =>
    c.json(
      await record(c, (db, actor) =>
        leadDashboard(db, actor, {
          from: query(c, "from"),
          to: query(c, "to"),
        }),
      ),
    ),
  );
  // Possible duplicates (FLOW-110): the queue, merge into the kept lead, dismiss.
  routes.get("/duplicates", async (c) =>
    c.json(
      await record(c, (db, actor) =>
        listLeadDuplicates(db, actor),
      ),
    ),
  );
  const duplicateParam = (c: AppContext) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Duplicate");
    return parsed.data;
  };
  routes.post(
    "/duplicates/:id/merge",
    requirePermission("leads.merge"),
    async (c) => {
      const id = duplicateParam(c);
      const input = await parseBody(c, leadMergeSchema);
      return c.json(
        await record(c, async (db, actor) =>
          getLead(
            db,
            actor,
            await mergeLeadDuplicate(db, actor, id, input.keepLeadId),
          ),
        ),
      );
    },
  );
  routes.post(
    "/duplicates/:id/dismiss",
    requirePermission("leads.merge"),
    async (c) => {
      const id = duplicateParam(c);
      await record(c, (db, actor) =>
        dismissLeadDuplicate(db, actor, id),
      );
      return c.body(null, 204);
    },
  );
  routes.get("/:id", async (c) => {
    const id = param(c);
    return c.json(
      await record(c, (db, actor) => getLead(db, actor, id)),
    );
  });
  routes.post("/:id/assign", requirePermission("leads.assign"), async (c) => {
    const id = param(c);
    const input = await parseBody(c, leadAssignSchema);
    return c.json(
      await record(c, (db, actor) =>
        assignLead(db, actor, id, input.assignedSalespersonId),
      ),
    );
  });
  routes.post("/:id/status", requirePermission("leads.update"), async (c) => {
    const id = param(c);
    const input = await parseBody(c, leadStatusChangeSchema);
    return c.json(
      await record(c, (db, actor) =>
        changeLeadStatus(db, actor, id, input),
      ),
    );
  });
  routes.post("/:id/convert", requirePermission("leads.convert"), async (c) => {
    const id = param(c);
    const input = await parseBody(c, leadConvertSchema);
    return c.json(
      await record(c, (db, actor) =>
        convertLead(db, actor, id, input),
      ),
    );
  });
  return routes;
}
