import { Hono } from "hono";
import {
  proposalCreateSchema,
  proposalInputSchema,
  proposalStageChangeSchema,
  proposalUploadSchema,
} from "../../shared/proposals";
import { id as uuid } from "../../shared/schema-primitives";
import { requirePermission } from "../auth";
import {
  ApiError,
  notFound,
  parseBody,
  recordRunner,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  changeProposalStage,
  completeProposalUpload,
  createProposal,
  getProposal,
  listProposals,
  startProposalUpload,
  updateProposal,
} from "../records/proposals";

// /api/proposals (FLOW-122/123). Proposals on events the user can't open answer
// 404. Versions are created by uploading and are never changed or deleted: there is
// no route that edits or removes one (FLOW-123 AC2).
export function proposalRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const param = (c: AppContext, name: string, what: string) => {
    const parsed = uuid.safeParse(c.req.param(name));
    if (!parsed.success) throw notFound(what);
    return parsed.data;
  };
  const proposalId = (c: AppContext) => param(c, "id", "Proposal");
  const env = (c: AppContext) => c.env ?? {};

  // The event's proposals: GET /api/proposals?eventId=<id>.
  routes.get("/", requirePermission("proposals.read"), async (c) => {
    const eventId = uuid.safeParse(c.req.query("eventId"));
    if (!eventId.success)
      throw new ApiError(400, "INVALID_REQUEST", "Choose an event.");
    return c.json(
      await record(c, (db, actor) => listProposals(db, actor, eventId.data)),
    );
  });
  routes.post("/", requirePermission("proposals.write"), async (c) => {
    const input = await parseBody(c, proposalCreateSchema);
    return c.json(
      await record(c, (db, actor) => createProposal(db, actor, env(c), input)),
      201,
    );
  });
  routes.get("/:id", requirePermission("proposals.read"), async (c) => {
    const id = proposalId(c);
    return c.json(
      await record(c, (db, actor) => getProposal(db, actor, env(c), id)),
    );
  });
  routes.put("/:id", requirePermission("proposals.write"), async (c) => {
    const id = proposalId(c);
    const input = await parseBody(c, proposalInputSchema);
    return c.json(
      await record(c, (db, actor) => updateProposal(db, actor, env(c), id, input)),
    );
  });
  routes.post("/:id/stage", requirePermission("proposals.write"), async (c) => {
    const id = proposalId(c);
    const input = await parseBody(c, proposalStageChangeSchema);
    return c.json(
      await record(c, (db, actor) =>
        changeProposalStage(db, actor, env(c), id, input),
      ),
    );
  });
  routes.post("/:id/versions", requirePermission("proposals.write"), async (c) => {
    const id = proposalId(c);
    const input = await parseBody(c, proposalUploadSchema);
    return c.json(
      await record(c, (db, actor) =>
        startProposalUpload(db, actor, env(c), id, input),
      ),
      201,
    );
  });
  routes.post(
    "/:id/versions/:versionId/complete",
    requirePermission("proposals.write"),
    async (c) => {
      const id = proposalId(c);
      const versionId = param(c, "versionId", "Proposal version");
      return c.json(
        await record(c, (db, actor) =>
          completeProposalUpload(db, actor, env(c), id, versionId),
        ),
      );
    },
  );
  return routes;
}
