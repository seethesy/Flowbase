import { Hono } from "hono";
import { id as uuid } from "../../shared/schema-primitives";
import {
  applyTemplateInputSchema,
  checklistItemInputSchema,
  checklistItemUpdateSchema,
  taskCommentInputSchema,
  taskFilterSchema,
  taskInputSchema,
  taskTemplateInputSchema,
  taskUpdateSchema,
  taskViewInputSchema,
} from "../../shared/tasks";
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
  addChecklistItem,
  addComment,
  archiveChecklistItem,
  archiveTask,
  claimTask,
  createTask,
  getTask,
  getTaskSummaries,
  listTasksPage,
  taskDashboard,
  updateChecklistItem,
  updateTask,
} from "../records/tasks";
import {
  applyTaskTemplate,
  archiveTaskTemplate,
  createTaskTemplate,
  getTaskTemplate,
  listTaskTemplates,
  updateTaskTemplate,
} from "../records/task-templates";
import { createTaskView, deleteTaskView, listTaskViews } from "../records/task-views";

// Tasks (FLOW-58), mounted at /api/tasks. Every write answers with the whole
// task. Tasks the user can't see answer 404. The dashboard (FLOW-61), saved views
// (FLOW-59) and templates (FLOW-62) are registered before /:id.
export function taskRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const param = (c: AppContext, name: string, what: string) => {
    const parsed = uuid.safeParse(c.req.param(name));
    if (!parsed.success) throw notFound(what);
    return parsed.data;
  };
  const taskId = (c: AppContext) => param(c, "id", "Task");
  const templateId = (c: AppContext) => param(c, "id", "Task template");

  routes.get("/dashboard", requirePermission("tasks.read"), async (c) =>
    c.json(await record(c, (db, actor) => taskDashboard(db, actor))),
  );
  routes.get("/views", requirePermission("tasks.read"), async (c) =>
    c.json(await record(c, (db, actor) => listTaskViews(db, actor))),
  );
  routes.post("/views", requirePermission("tasks.read"), async (c) => {
    const input = await parseBody(c, taskViewInputSchema);
    return c.json(
      await record(c, (db, actor) => createTaskView(db, actor, input)),
      201,
    );
  });
  routes.post("/views/:id/archive", requirePermission("tasks.read"), async (c) => {
    const id = param(c, "id", "View");
    await record(c, (db, actor) => deleteTaskView(db, actor, id));
    return c.body(null, 204);
  });
  routes.get("/templates", requirePermission("tasks.read"), async (c) =>
    c.json(await record(c, (db) => listTaskTemplates(db))),
  );
  routes.get("/templates/:id", requirePermission("tasks.read"), async (c) => {
    const id = templateId(c);
    return c.json(await record(c, (db) => getTaskTemplate(db, id)));
  });
  routes.post("/templates", requirePermission("tasks.templates"), async (c) => {
    const input = await parseBody(c, taskTemplateInputSchema);
    return c.json(
      await record(c, async (db, actor) => {
        const id = await db.transaction((tx) => createTaskTemplate(tx, actor, input));
        return getTaskTemplate(db, id);
      }),
      201,
    );
  });
  routes.put("/templates/:id", requirePermission("tasks.templates"), async (c) => {
    const id = templateId(c);
    const input = await parseBody(c, taskTemplateInputSchema);
    return c.json(
      await record(c, async (db, actor) => {
        await db.transaction((tx) => updateTaskTemplate(tx, actor, id, input));
        return getTaskTemplate(db, id);
      }),
    );
  });
  routes.post(
    "/templates/:id/archive",
    requirePermission("tasks.templates"),
    async (c) => {
      const id = templateId(c);
      await record(c, (db, actor) =>
        db.transaction((tx) => archiveTaskTemplate(tx, actor, id)),
      );
      return c.body(null, 204);
    },
  );
  // Applying creates unassigned tasks on the event: for people who delegate.
  routes.post(
    "/templates/:id/apply",
    requirePermission("tasks.delegate"),
    async (c) => {
      const id = templateId(c);
      const input = await parseBody(c, applyTemplateInputSchema);
      return c.json(
        await record(c, async (db, actor) => {
          const { createdIds, skipped } = await db.transaction((tx) =>
            applyTaskTemplate(tx, actor, id, input.eventId),
          );
          return { created: await getTaskSummaries(db, actor, createdIds), skipped };
        }),
      );
    },
  );

  routes.get("/", requirePermission("tasks.read"), async (c) => {
    const filter = taskFilterSchema.safeParse(c.req.query());
    if (!filter.success)
      throw new ApiError(400, "INVALID_REQUEST", "Invalid task filter.");
    return sendPage(
      c,
      await record(c, (db, actor) =>
        listTasksPage(db, actor, filter.data, pageRequest(c)),
      ),
    );
  });
  routes.get("/:id", requirePermission("tasks.read"), async (c) => {
    const id = taskId(c);
    return c.json(await record(c, (db, actor) => getTask(db, actor, id)));
  });
  routes.post("/", requirePermission("tasks.write"), async (c) => {
    const input = await parseBody(c, taskInputSchema);
    return c.json(
      await record(c, async (db, actor) => {
        const id = await db.transaction((tx) => createTask(tx, actor, input));
        return getTask(db, actor, id);
      }),
      201,
    );
  });
  routes.patch("/:id", requirePermission("tasks.write"), async (c) => {
    const id = taskId(c);
    const input = await parseBody(c, taskUpdateSchema);
    return c.json(
      await record(c, async (db, actor) => {
        await db.transaction((tx) => updateTask(tx, actor, id, input));
        return getTask(db, actor, id);
      }),
    );
  });
  routes.post("/:id/claim", requirePermission("tasks.write"), async (c) => {
    const id = taskId(c);
    return c.json(
      await record(c, async (db, actor) => {
        await db.transaction((tx) => claimTask(tx, actor, id));
        return getTask(db, actor, id);
      }),
    );
  });
  routes.post("/:id/archive", requirePermission("tasks.write"), async (c) => {
    const id = taskId(c);
    await record(c, (db, actor) =>
      db.transaction((tx) => archiveTask(tx, actor, id)),
    );
    return c.body(null, 204);
  });
  routes.post("/:id/checklist", requirePermission("tasks.write"), async (c) => {
    const id = taskId(c);
    const input = await parseBody(c, checklistItemInputSchema);
    return c.json(
      await record(c, async (db, actor) => {
        await db.transaction((tx) => addChecklistItem(tx, actor, id, input.label));
        return getTask(db, actor, id);
      }),
      201,
    );
  });
  routes.patch(
    "/:id/checklist/:itemId",
    requirePermission("tasks.write"),
    async (c) => {
      const id = taskId(c);
      const itemId = param(c, "itemId", "Checklist item");
      const input = await parseBody(c, checklistItemUpdateSchema);
      return c.json(
        await record(c, async (db, actor) => {
          await db.transaction((tx) =>
            updateChecklistItem(tx, actor, id, itemId, input),
          );
          return getTask(db, actor, id);
        }),
      );
    },
  );
  routes.post(
    "/:id/checklist/:itemId/archive",
    requirePermission("tasks.write"),
    async (c) => {
      const id = taskId(c);
      const itemId = param(c, "itemId", "Checklist item");
      return c.json(
        await record(c, async (db, actor) => {
          await db.transaction((tx) =>
            archiveChecklistItem(tx, actor, id, itemId),
          );
          return getTask(db, actor, id);
        }),
      );
    },
  );
  routes.post("/:id/comments", requirePermission("tasks.write"), async (c) => {
    const id = taskId(c);
    const input = await parseBody(c, taskCommentInputSchema);
    return c.json(
      await record(c, async (db, actor) => {
        await db.transaction((tx) => addComment(tx, actor, id, input.body));
        return getTask(db, actor, id);
      }),
      201,
    );
  });
  return routes;
}
