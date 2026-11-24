import { Hono } from "hono";
import {
  proposalCreateSchema,
  proposalInputSchema,
  proposalStageChangeSchema,
  proposalUploadSchema,
  proposalSentSchema,
} from "../../../shared/proposals";
import { id as uuid } from "../../../shared/schema-primitives";
import { proposalMappingSchema } from "../../../shared/proposal-mapping";
import { recordContractSchema, recordAddendumSchema, signAddendumSchema } from "../../../shared/contracts";
import { requirePermission } from "../../auth";
import { salesProposals } from "../../fields";
import { salesDataset } from "../../records/sales/sales";
import {
  ApiError,
  idParam,
  parseBody,
  recordRunner,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../../hono";
import {
  changeProposalStage,
  completeProposalUpload,
  createProposal,
  getProposal,
  listProposalFiles,
  listProposals,
  startProposalUpload,
  updateProposal,
  submitProposalForApproval,
  recordProposalSent,
} from "../../records/sales/proposals";
import { getPreviousProposalMapping, getProposalCatalog, getProposalMapping, saveProposalMapping } from "../../records/sales/proposal-mapping";
import { listEventContracts, recordContract, listEventAddendums, listOpenAddendums, recordAddendum, signAddendum } from "../../records/sales/contracts";

// /api/proposals (FLOW-122/123). Proposals on events the user can't open answer
// 404. Versions are created by uploading and are never changed or deleted: there is
// no route that edits or removes one (FLOW-123 AC2).
export function proposalRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const proposalId = (c: AppContext) => idParam(c, "Proposal");
  const env = (c: AppContext) => c.env ?? {};

  routes.get("/addendums/open", requirePermission("proposals.read"), async (c) =>
    c.json(await record(c, (db, actor) => listOpenAddendums(db, actor))),
  );
  // The Proposals library (FLOW-276): one file per event the user can open.
  routes.get("/files", requirePermission("proposals.read"), async (c) =>
    c.json(await record(c, (db, actor) => listProposalFiles(db, actor, env(c)))),
  );

  routes.get("/event/:eventId/contracts", requirePermission("proposals.read"), async (c) =>
    c.json(await record(c, (db, actor) => listEventContracts(db, actor, idParam(c, "Event", "eventId")))),
  );
  routes.post("/:id/contracts", requirePermission("bookings.record"), async (c) => {
    const input = await parseBody(c, recordContractSchema);
    return c.json(await record(c, (db, actor) => recordContract(db, actor, proposalId(c), input)), 201);
  });
  routes.get("/event/:eventId/addendums", requirePermission("proposals.read"), async (c) =>
    c.json(await record(c, (db, actor) => listEventAddendums(db, actor, idParam(c, "Event", "eventId")))),
  );
  routes.post("/event/:eventId/addendums", requirePermission("addendums.record"), async (c) => {
    const input = await parseBody(c, recordAddendumSchema);
    return c.json(await record(c, (db, actor) => recordAddendum(db, actor, idParam(c, "Event", "eventId"), input)), 201);
  });
  routes.post("/event/:eventId/addendums/:addendumId/sign", requirePermission("addendums.record"), async (c) => {
    const input = await parseBody(c, signAddendumSchema);
    return c.json(await record(c, (db, actor) => signAddendum(db, actor, idParam(c, "Event", "eventId"), idParam(c, "Addendum", "addendumId"), input.signedAt)));
  });

  // The event's proposals: GET /api/proposals?eventId=<id>.
  routes.get("/", requirePermission("proposals.read"), async (c) => {
    const eventId = uuid.safeParse(c.req.query("eventId"));
    // A custom card on all proposals (FLOW-308) reads the sales tracker's
    // proposal rows, which apply the viewer's scope (worker/fields.ts).
    if (!eventId.success && c.get("card"))
      return c.json(salesProposals(await record(c, salesDataset)));
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
  routes.get("/:id/mapping", requirePermission("proposals.read"), async (c) =>
    c.json(await record(c, (db, actor) => getProposalMapping(db, actor, proposalId(c)))),
  );
  routes.get("/:id/previous-mapping", requirePermission("proposals.read"), async (c) =>
    c.json(await record(c, (db, actor) => getPreviousProposalMapping(db, actor, proposalId(c)))),
  );
  routes.get("/:id/catalog", requirePermission("proposals.read"), async (c) =>
    c.json(await record(c, (db, actor) => getProposalCatalog(db, actor, proposalId(c)))),
  );
  routes.put("/:id/mapping", requirePermission("proposals.write"), async (c) => {
    const id = proposalId(c);
    const input = await parseBody(c, proposalMappingSchema);
    return c.json(await record(c, (db, actor) => saveProposalMapping(db, actor, id, input)));
  });
  routes.post("/:id/submit", requirePermission("proposals.write"), async (c) =>
    c.json(await record(c, (db, actor) => submitProposalForApproval(db, actor, env(c), proposalId(c)))),
  );
  routes.post("/:id/sent", requirePermission("proposals.write"), async (c) => {
    const input = await parseBody(c, proposalSentSchema);
    return c.json(await record(c, (db, actor) => recordProposalSent(db, actor, env(c), proposalId(c), input)));
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
      const versionId = idParam(c, "Proposal version", "versionId");
      return c.json(
        await record(c, (db, actor) =>
          completeProposalUpload(db, actor, env(c), id, versionId),
        ),
      );
    },
  );
  return routes;
}
