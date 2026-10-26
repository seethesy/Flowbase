import { Hono } from "hono";
import { z } from "zod";
import {
  recordTypeSchema,
  uploadRequestSchema,
} from "../../shared/attachments";
import { requireActor, type ResolveActor } from "../auth";
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
  completeUpload,
  listAttachments,
  startUpload,
  updateAttachment,
} from "../attachments/records";

const uuid = z.string().uuid();
const changeSchema = z.object({
  caption: z.string().trim().max(500).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

// /api/attachments (FLOW-42). The Worker issues short-lived signed R2 URLs and
// records metadata; file bytes go straight between the browser and R2.
export function attachmentRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));
  const id = (c: AppContext) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Attachment");
    return parsed.data;
  };

  routes.get("/", async (c) => {
    const recordType = recordTypeSchema.safeParse(c.req.query("recordType"));
    const recordId = uuid.safeParse(c.req.query("recordId"));
    if (!recordType.success || !recordId.success)
      throw new ApiError(400, "INVALID_REQUEST", "Invalid request.");
    return c.json(
      await record(c, (db, actor) =>
        listAttachments(
          db,
          actor,
          c.env ?? {},
          recordType.data,
          recordId.data,
        ),
      ),
    );
  });
  routes.post("/", async (c) => {
    const input = await parseBody(c, uploadRequestSchema);
    return c.json(
      await record(c, (db, actor) =>
        startUpload(db, actor, c.env ?? {}, input),
      ),
      201,
    );
  });
  routes.post("/:id/complete", async (c) => {
    const attachmentId = id(c);
    return c.json(
      await record(c, (db, actor) =>
        completeUpload(db, actor, c.env ?? {}, attachmentId),
      ),
    );
  });
  routes.patch("/:id", async (c) => {
    const attachmentId = id(c);
    const change = await parseBody(c, changeSchema);
    return c.json(
      await record(c, (db, actor) =>
        updateAttachment(db, actor, c.env ?? {}, attachmentId, change),
      ),
    );
  });
  routes.post("/:id/archive", async (c) => {
    const attachmentId = id(c);
    return c.json(
      await record(c, (db, actor) =>
        updateAttachment(db, actor, c.env ?? {}, attachmentId, {
          archived: true,
        }),
      ),
    );
  });
  return routes;
}
