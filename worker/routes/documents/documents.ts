import { Hono } from "hono";
import { documentChangeSchema, documentUploadSchema, documentTypeSchema } from "../../../shared/documents";
import { recordTypeSchema } from "../../../shared/attachments";
import { id as uuid } from "../../../shared/schema-primitives";
import { requireActor, requirePermission, type ResolveActor } from "../../auth";
import { ApiError, notFound, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../../hono";
import { archiveDocument, changeDocument, completeDocumentUpload, getDocument, listDocuments, startDocumentUpload } from "../../records/documents/documents";

export function documentRoutes(options: { withDb?: RunWithDb; resolveActor?: ResolveActor }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));
  const param = (value: string) => {
    const result = uuid.safeParse(value);
    if (!result.success) throw notFound("Document");
    return result.data;
  };
  routes.get("/", requirePermission("attachments.read"), async (c) => {
    const type = c.req.query("docType");
    const link = c.req.query("recordType");
    const uploader = c.req.query("uploadedBy");
    const updated = c.req.query("updated");
    if (type && !documentTypeSchema.safeParse(type).success) throw new ApiError(400, "INVALID_FILTER", "Invalid document type.");
    if (link && !recordTypeSchema.safeParse(link).success) throw new ApiError(400, "INVALID_FILTER", "Invalid linked record type.");
    if (uploader && !uuid.safeParse(uploader).success) throw new ApiError(400, "INVALID_FILTER", "Invalid uploader.");
    if (updated && !["7", "90"].includes(updated)) throw new ApiError(400, "INVALID_FILTER", "Invalid update range.");
    return c.json(await record(c, (db, actor) => listDocuments(db, actor, c.env ?? {}, {
      search: c.req.query("search"), docType: type, recordType: link, uploadedBy: uploader,
      since: updated ? new Date(Date.now() - Number(updated) * 86_400_000) : undefined,
    })));
  });
  routes.post("/", requirePermission("attachments.write"), async (c) => {
    const input = await parseBody(c, documentUploadSchema);
    return c.json(await record(c, (db, actor) => startDocumentUpload(db, actor, c.env ?? {}, input)), 201);
  });
  routes.get("/:id", requirePermission("attachments.read"), async (c) =>
    c.json(await record(c, (db, actor) => getDocument(db, actor, c.env ?? {}, param(c.req.param("id"))))));
  routes.post("/:id/complete", requirePermission("attachments.write"), async (c) =>
    c.json(await record(c, (db, actor) => completeDocumentUpload(db, actor, c.env ?? {}, param(c.req.param("id"))))));
  routes.patch("/:id", requirePermission("attachments.write"), async (c) => {
    const change = await parseBody(c, documentChangeSchema);
    return c.json(await record(c, (db, actor) => changeDocument(db, actor, c.env ?? {}, param(c.req.param("id")), change)));
  });
  routes.post("/:id/archive", requirePermission("attachments.write"), async (c) =>
    c.json(await record(c, (db, actor) => archiveDocument(db, actor, param(c.req.param("id"))))));
  routes.post("/:id/restore", requirePermission("attachments.write"), async (c) =>
    c.json(await record(c, (db, actor) => archiveDocument(db, actor, param(c.req.param("id")), true))));
  return routes;
}
