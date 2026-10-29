import { Hono } from "hono";
import { id as uuid } from "../../shared/schema-primitives";
import {
  approvalFilterSchema,
  approveInputSchema,
  rejectInputSchema,
} from "../../shared/approvals";
import { requirePermission } from "../auth";
import {
  ApiError,
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
  decideApproval,
  getApproval,
  listApprovalsPage,
  withdrawApproval,
} from "../records/approvals";

// Approval requests (FLOW-44), mounted at /api/approvals. Modules create requests
// through the engine (worker/records/approvals.ts); these routes list them and
// decide or withdraw them. Every write answers with the whole request; requests
// the user can't see answer 404.
export function approvalRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const approvalId = (c: AppContext) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Approval request");
    return parsed.data;
  };

  routes.get("/", requirePermission("approvals.read"), async (c) => {
    const filter = approvalFilterSchema.safeParse(c.req.query());
    if (!filter.success)
      throw new ApiError(400, "INVALID_REQUEST", "Invalid approval filter.");
    return sendPage(
      c,
      await record(c, (db, actor) =>
        listApprovalsPage(db, actor, filter.data, pageRequest(c)),
      ),
    );
  });
  routes.get("/:id", requirePermission("approvals.read"), async (c) => {
    const id = approvalId(c);
    return c.json(await record(c, (db, actor) => getApproval(db, actor, id)));
  });
  routes.post("/:id/approve", requirePermission("approvals.write"), async (c) => {
    const id = approvalId(c);
    const input = await parseBody(c, approveInputSchema);
    return c.json(
      await record(c, async (db, actor) => {
        await db.transaction((tx) =>
          decideApproval(tx, actor, id, "approve", input.comment),
        );
        return getApproval(db, actor, id);
      }),
    );
  });
  routes.post("/:id/reject", requirePermission("approvals.write"), async (c) => {
    const id = approvalId(c);
    const input = await parseBody(c, rejectInputSchema);
    return c.json(
      await record(c, async (db, actor) => {
        await db.transaction((tx) =>
          decideApproval(tx, actor, id, "reject", input.comment),
        );
        return getApproval(db, actor, id);
      }),
    );
  });
  routes.post("/:id/withdraw", requirePermission("approvals.write"), async (c) => {
    const id = approvalId(c);
    return c.json(
      await record(c, async (db, actor) => {
        await db.transaction((tx) => withdrawApproval(tx, actor, id));
        return getApproval(db, actor, id);
      }),
    );
  });
  return routes;
}
